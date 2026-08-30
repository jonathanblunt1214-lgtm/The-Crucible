const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalUrl(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:') throw new Error('Only approved HTTPS source URLs may be logged.');
  url.hash = '';
  return url.toString();
}

function claimFingerprint(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new Error('A bounded claim object is required.');
  const keys = Object.keys(claim).sort();
  if (keys.join(',') !== 'claim,claimBoundary,generalizationBoundary') throw new Error('Claims require exactly claim, claimBoundary, and generalizationBoundary.');
  for (const key of keys) if (typeof claim[key] !== 'string' || !claim[key].trim()) throw new Error(`${key} must be a non-empty string.`);
  return sha256(JSON.stringify({ claim:claim.claim.trim(), claimBoundary:claim.claimBoundary.trim(), generalizationBoundary:claim.generalizationBoundary.trim() }));
}

function emptyState(projectId) {
  return { schemaVersion:1, projectId, sources:[] };
}

class MonthlyKnowledgeRefreshStore {
  constructor(root, projectId, { now = () => new Date().toISOString() } = {}) {
    if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('A repository-bound projectId is required.');
    this.projectId = projectId;
    this.now = now;
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'monthly-source-refresh.json');
    fs.mkdirSync(this.root, { recursive:true });
  }

  read() {
    if (!fs.existsSync(this.file)) return emptyState(this.projectId);
    const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (Object.keys(envelope).sort().join(',') !== 'payload,sha256') throw new Error('Monthly refresh store envelope is invalid.');
    if (sha256(JSON.stringify(envelope.payload)) !== envelope.sha256) throw new Error('Monthly refresh store integrity check failed.');
    if (envelope.payload?.schemaVersion !== 1 || envelope.payload.projectId !== this.projectId || !Array.isArray(envelope.payload.sources)) throw new Error('Monthly refresh store is invalid or belongs to another project.');
    return structuredClone(envelope.payload);
  }

  write(state) {
    const envelope = { payload:state, sha256:sha256(JSON.stringify(state)) };
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { flag:'wx', mode:0o600 });
    fs.renameSync(temporary, this.file);
  }

  register(url) {
    const normalized = canonicalUrl(url);
    const state = this.read();
    const existing = state.sources.find((source) => source.url === normalized);
    if (existing) return { created:false, source:structuredClone(existing) };
    const registeredAt = this.now();
    const source = { id:`source-${sha256(normalized).slice(0, 24)}`, url:normalized, registeredAt, lastCheckedAt:null, nextCheckAt:registeredAt, contentRevisions:[], learnedClaimFingerprints:[] };
    state.sources.push(source);
    this.write(state);
    return { created:true, source:structuredClone(source) };
  }

  due(at = this.now()) {
    const when = Date.parse(at);
    if (!Number.isFinite(when)) throw new Error('A valid due-check timestamp is required.');
    return this.read().sources.filter((source) => Date.parse(source.nextCheckAt) <= when).map((source) => structuredClone(source));
  }

  recordRetrieval(sourceId, retrievalRecord, claims = []) {
    if (!retrievalRecord || typeof retrievalRecord !== 'object') throw new Error('A retrieval provenance record is required.');
    for (const key of ['finalUrl', 'retrievedAt', 'author', 'license', 'contentSha256']) if (typeof retrievalRecord[key] !== 'string' || !retrievalRecord[key].trim()) throw new Error(`Retrieval ${key} is required.`);
    if (!/^[a-f0-9]{64}$/i.test(retrievalRecord.contentSha256)) throw new Error('Retrieval contentSha256 must be a SHA-256 digest.');
    const checkedAtMs = Date.parse(retrievalRecord.retrievedAt);
    if (!Number.isFinite(checkedAtMs)) throw new Error('Retrieval retrievedAt must be valid.');
    if (!Array.isArray(claims)) throw new Error('Extracted claims must be an array.');

    const state = this.read();
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error('Logged source does not exist in this project.');
    const finalUrl = canonicalUrl(retrievalRecord.finalUrl);

    source.lastCheckedAt = retrievalRecord.retrievedAt;
    source.nextCheckAt = new Date(checkedAtMs + MAX_REFRESH_INTERVAL_MS).toISOString();
    const seenContent = source.contentRevisions.some((revision) => revision.contentSha256.toLowerCase() === retrievalRecord.contentSha256.toLowerCase());
    if (seenContent) {
      this.write(state);
      return { state:'duplicate-content', candidateClaims:[], nextCheckAt:source.nextCheckAt };
    }

    const known = new Set([...source.learnedClaimFingerprints, ...source.contentRevisions.flatMap((revision) => revision.candidateClaimFingerprints)]);
    const candidateClaims = [];
    const emitted = new Set();
    for (const claim of claims) {
      const fingerprint = claimFingerprint(claim);
      if (known.has(fingerprint) || emitted.has(fingerprint)) continue;
      emitted.add(fingerprint);
      candidateClaims.push({ ...structuredClone(claim), fingerprint, sourceId, contentSha256:retrievalRecord.contentSha256, classification:'Insufficient Evidence', state:'candidate-evidence' });
    }
    source.contentRevisions.push({ finalUrl, retrievedAt:retrievalRecord.retrievedAt, author:retrievalRecord.author, license:retrievalRecord.license, contentSha256:retrievalRecord.contentSha256.toLowerCase(), candidateClaimFingerprints:[...emitted] });
    this.write(state);
    return { state:'new-content', candidateClaims, nextCheckAt:source.nextCheckAt };
  }

  markClaimsLearned(sourceId, claims) {
    if (!Array.isArray(claims)) throw new Error('Verified claims must be an array.');
    const state = this.read();
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error('Logged source does not exist in this project.');
    const fingerprints = claims.map(claimFingerprint);
    source.learnedClaimFingerprints = [...new Set([...source.learnedClaimFingerprints, ...fingerprints])];
    this.write(state);
    return structuredClone(source.learnedClaimFingerprints);
  }
}

class MonthlyKnowledgeRefresher {
  constructor({ store, retriever, extractClaims }) {
    if (!store?.due || !store?.recordRetrieval) throw new Error('A monthly refresh store is required.');
    if (!retriever?.retrieve) throw new Error('The governed safe information retriever is required.');
    if (typeof extractClaims !== 'function') throw new Error('A bounded claim extractor is required.');
    this.store = store;
    this.retriever = retriever;
    this.extractClaims = extractClaims;
  }

  async runDue(at) {
    const outcomes = [];
    for (const source of this.store.due(at)) {
      try {
        const retrieved = await this.retriever.retrieve(source.url);
        if (!retrieved.content) {
          outcomes.push({ sourceId:source.id, state:'quarantined', candidateClaims:[] });
          continue;
        }
        const claims = await this.extractClaims(retrieved.content, structuredClone(retrieved.record));
        outcomes.push({ sourceId:source.id, ...this.store.recordRetrieval(source.id, retrieved.record, claims) });
      } catch (error) {
        outcomes.push({ sourceId:source.id, state:'blocked', classification:'Insufficient Evidence', reason:String(error.message || error), candidateClaims:[] });
      }
    }
    return outcomes;
  }
}

module.exports = { MAX_REFRESH_INTERVAL_MS, canonicalUrl, claimFingerprint, MonthlyKnowledgeRefreshStore, MonthlyKnowledgeRefresher };
