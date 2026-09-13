'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AtomicClaimExtractionQueue } = require('./claimExtractionWorker');
const { publishContentAddressed } = require('./ownerFileIntake');
const { admitDiscoveryCandidateUrls, RetrievalAuditStore, SafeInformationRetriever } = require('./safeInformationRetrieval');
const { crucibleError } = require('./failureCodes');

const MAXIMUM_RETRIEVALS_PER_RUN = 25;
const EXTENSIONS = Object.freeze({
  'text/html': '.html',
  'application/xhtml+xml': '.xhtml',
  'text/plain': '.txt',
  'application/pdf': '.pdf',
  'application/json': '.json',
});

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function eligibleState(source, retryBlocked, retryQuarantined) {
  return source.state === 'research-approved-pending-retrieval' ||
    (retryBlocked && source.state === 'retrieval-blocked') ||
    (retryQuarantined && source.state === 'quarantined');
}

function registerOwnerDelegatedUrl({ queueFile, projectId, url, trustedDomains = [], trustedSuffixes = ['.edu', '.org', '.gov'], now = () => new Date().toISOString() }) {
  const admitted = admitDiscoveryCandidateUrls([url], { trustedDomains, trustedSuffixes, extremeVettingSuffixes:[], maximumResults:1 });
  if (admitted.length !== 1) throw crucibleError('CRU-0044', 'The delegated retrieval URL is outside the positive trust allow-list or is otherwise forbidden.');
  const normalized = admitted[0].url;
  const queue = new AtomicClaimExtractionQueue(queueFile, projectId);
  const held = queue.lock();
  try {
    const current = queue.read();
    const existing = current.links.find((item) => item.url === normalized || item.finalUrl === normalized);
    if (existing) return { created:false, sourceId:existing.id, state:existing.state, url:normalized };
    const approvedAt = now();
    const source = {
      id:`owner-delegated-url:${sha256(normalized)}`,
      catalogSourceId:null,
      ordinal:null,
      url:normalized,
      author:'unknown until retrieved',
      license:'not declared; verify source terms before redistribution',
      retrievedAt:null,
      contentSha256:null,
      classification:'Insufficient Evidence',
      state:'research-approved-pending-retrieval',
      retrievalStartedAt:null,
      finalUrl:null,
      httpStatus:null,
      contentType:null,
      contentLength:null,
      durablePath:null,
      publisher:null,
      blocker:null,
      discovery:{ method:'owner-delegated-retrieval', approvedAt, candidateOnly:true, promotionAuthorized:false },
    };
    current.links.push(source);
    current.updatedAt = approvedAt;
    queue.write(current);
    return { created:true, sourceId:source.id, state:source.state, url:normalized };
  } finally { held.release(); }
}

function defaultRetriever({ urls, auditRoot, killSwitchFile, minimumIntervalMs }) {
  return new SafeInformationRetriever({
    approvedUrls:urls,
    auditStore:new RetrievalAuditStore(auditRoot),
    killSwitchFile,
    minimumIntervalMs,
  });
}

class SourceRetrievalWorker {
  constructor({ queueFile, projectId, auditRoot, killSwitchFile = null, maximumSources = MAXIMUM_RETRIEVALS_PER_RUN, retryBlocked = false, retryQuarantined = false, sourceId = null, minimumIntervalMs = 1_000, retrieverFactory = defaultRetriever, now = () => new Date().toISOString() }) {
    if (!projectId || !queueFile || !auditRoot) throw crucibleError('CRU-0044', 'Source retrieval requires projectId, queueFile, and auditRoot.');
    if (!Number.isSafeInteger(maximumSources) || maximumSources < 1 || maximumSources > MAXIMUM_RETRIEVALS_PER_RUN) throw crucibleError('CRU-0044', `maximumSources must be between 1 and ${MAXIMUM_RETRIEVALS_PER_RUN}.`);
    if (!Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 0 || minimumIntervalMs > 60_000) throw crucibleError('CRU-0044', 'minimumIntervalMs must be between 0 and 60000.');
    this.queue = new AtomicClaimExtractionQueue(queueFile, projectId);
    this.queueFile = path.resolve(queueFile);
    this.projectId = projectId;
    this.auditRoot = path.resolve(auditRoot);
    this.killSwitchFile = path.resolve(killSwitchFile || path.join(this.auditRoot, 'RETRIEVAL-KILL'));
    this.maximumSources = maximumSources;
    this.retryBlocked = Boolean(retryBlocked);
    this.retryQuarantined = Boolean(retryQuarantined);
    this.sourceId = sourceId ? String(sourceId).trim() : null;
    this.minimumIntervalMs = minimumIntervalMs;
    this.retrieverFactory = retrieverFactory;
    this.now = now;
  }

  selectedSources() {
    const held = this.queue.lock();
    try {
      const links = this.queue.read().links;
      const inScope = (source) => !this.sourceId || source.id === this.sourceId;
      const pending = links.filter((source) => inScope(source) && source.state === 'research-approved-pending-retrieval');
      const blocked = this.retryBlocked ? links.filter((source) => inScope(source) && source.state === 'retrieval-blocked') : [];
      const quarantined = this.retryQuarantined ? links.filter((source) => inScope(source) && source.state === 'quarantined') : [];
      return [...pending, ...blocked, ...quarantined].slice(0, this.maximumSources).map((source) => ({ id:source.id, url:source.url }));
    } finally { held.release(); }
  }

  async run() {
    const selected = this.selectedSources();
    if (!selected.length) return [];
    const retriever = this.retrieverFactory({
      urls:selected.map((item) => item.url),
      auditRoot:this.auditRoot,
      killSwitchFile:this.killSwitchFile,
      minimumIntervalMs:this.minimumIntervalMs,
    });
    if (!retriever || typeof retriever.retrieve !== 'function') throw crucibleError('CRU-0044', 'Source retrieval requires a bounded retriever.');
    const outcomes = [];

    for (const selectedSource of selected) {
      const held = this.queue.lock();
      try {
        const current = this.queue.read();
        const source = current.links.find((item) => item.id === selectedSource.id);
        if (!source || !eligibleState(source, this.retryBlocked, this.retryQuarantined)) {
          outcomes.push({ sourceId:selectedSource.id, state:'skipped', reason:'source was advanced by another worker before this turn' });
          continue;
        }
        const startedAt = this.now();
        source.retrievalStartedAt = startedAt;
        source.retrievalAttempts = Number(source.retrievalAttempts || 0) + 1;
        try {
          const result = await retriever.retrieve(source.url);
          if (result.record.state === 'quarantined' || !result.content) {
            source.state = 'quarantined';
            source.classification = 'Crucible Issue';
            source.quarantineReasons = [...(result.record.quarantineReasons || [])];
            source.blocker = 'retrieved content was quarantined before persistence';
            source.retrievedAt = result.record.retrievedAt;
            current.updatedAt = result.record.retrievedAt;
            this.queue.write(current);
            outcomes.push({ sourceId:source.id, state:source.state, classification:source.classification, candidateOnly:true });
            continue;
          }

          const duplicate = [...current.documents, ...current.links].find((item) => item.id !== source.id && item.contentSha256 === result.record.contentSha256 && item.durablePath);
          let destination;
          if (duplicate) destination = duplicate.durablePath;
          else {
            const extension = EXTENSIONS[result.record.contentType];
            if (!extension) throw crucibleError('CRU-0044', `No durable extension is defined for ${result.record.contentType}.`);
            destination = path.join(path.dirname(this.queueFile), `${result.record.contentSha256}${extension}`);
            publishContentAddressed({ bytes:result.content, contentSha256:result.record.contentSha256 }, destination);
          }

          Object.assign(source, {
            finalUrl:result.record.finalUrl,
            author:source.author && !/unknown until retrieved/i.test(source.author) ? source.author : result.record.author,
            license:source.license && !/unknown until retrieved|not yet retrieved/i.test(source.license) ? source.license : result.record.license,
            retrievedAt:result.record.retrievedAt,
            contentSha256:result.record.contentSha256,
            retrievedContentSha256:result.record.retrievedContentSha256,
            contentType:result.record.contentType,
            mediaType:result.record.contentType,
            contentLength:result.record.contentLength,
            retrievedContentLength:result.record.retrievedContentLength,
            durablePath:destination,
            httpStatus:200,
            classification:'Insufficient Evidence',
            state:duplicate ? 'claim-extraction-complete' : 'claim-extraction-forced-pending',
            blocker:null,
            duplicateOfSourceId:duplicate ? duplicate.id : null,
            claimExtraction:duplicate ? {
              attempts:0,
              candidateIds:[...(duplicate.claimExtraction?.candidateIds || [])],
              classification:'Insufficient Evidence',
              sourceContentSha256:result.record.contentSha256,
              windows:[],
              nextPage:null,
              nextAction:'duplicate-content-reuses-existing-candidates',
              completedAt:result.record.retrievedAt,
            } : {
              attempts:0,
              candidateIds:[],
              classification:'Insufficient Evidence',
              sourceContentSha256:result.record.contentSha256,
              windows:[],
              nextPage:result.record.contentType === 'application/pdf' ? 1 : null,
              nextAction:'extract-bounded-candidate-claims',
            },
          });
          current.updatedAt = result.record.retrievedAt;
          this.queue.write(current);
          outcomes.push({ sourceId:source.id, state:source.state, contentSha256:source.contentSha256, duplicateOfSourceId:source.duplicateOfSourceId, classification:source.classification, candidateOnly:true });
        } catch (error) {
          const failedAt = this.now();
          source.state = 'retrieval-blocked';
          source.classification = 'Insufficient Evidence';
          source.blocker = String(error.message || error);
          source.retrievalFailedAt = failedAt;
          current.updatedAt = failedAt;
          this.queue.write(current);
          outcomes.push({ sourceId:source.id, state:source.state, reason:source.blocker, classification:source.classification, candidateOnly:true });
        }
      } finally { held.release(); }
    }
    return outcomes;
  }
}

module.exports = { MAXIMUM_RETRIEVALS_PER_RUN, EXTENSIONS, registerOwnerDelegatedUrl, SourceRetrievalWorker };
