'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { boundedTopic, AtomicSourceQueueCandidateSink } = require('./automatedGoogleResearch');
const { admitDiscoveryCandidateUrls } = require('./safeInformationRetrieval');
const { crucibleError } = require('./failureCodes');

const DEFAULT_RESEARCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_QUERIES_PER_RUN = 50;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function emptyState(projectId, topics, now) {
  return { schemaVersion:1, projectId, revision:0, provider:'perplexity', topics:topics.map((topic) => ({ topic, nextRunAt:now, lastRunAt:null, runs:0 })), discoveredUrls:[], auditLog:[] };
}

class PerplexityResearchStore {
  constructor(root, projectId, topics, { now = () => new Date().toISOString() } = {}) {
    if (typeof projectId !== 'string' || !projectId.trim()) throw crucibleError('CRU-0042', 'A repository-bound projectId is required.');
    if (!Array.isArray(topics) || !topics.length || topics.length > MAXIMUM_QUERIES_PER_RUN) throw crucibleError('CRU-0042', `Between 1 and ${MAXIMUM_QUERIES_PER_RUN} approved research topics are required.`);
    this.projectId = projectId;
    this.topics = [...new Set(topics.map(boundedTopic))];
    this.now = now;
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'automated-perplexity-research.json');
    fs.mkdirSync(this.root, { recursive:true });
  }

  read() {
    if (!fs.existsSync(this.file)) return emptyState(this.projectId, this.topics, this.now());
    const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (Object.keys(envelope).sort().join(',') !== 'payload,sha256' || sha256(JSON.stringify(envelope.payload)) !== envelope.sha256) throw crucibleError('CRU-0042', 'Perplexity research store integrity check failed.');
    const state = envelope.payload;
    if (state?.schemaVersion !== 1 || state.projectId !== this.projectId || state.provider !== 'perplexity' || !Array.isArray(state.topics) || !Array.isArray(state.discoveredUrls) || !Array.isArray(state.auditLog)) throw crucibleError('CRU-0042', 'Perplexity research store is invalid or belongs to another project.');
    for (const topic of this.topics) if (!state.topics.some((item) => item.topic === topic)) state.topics.push({ topic, nextRunAt:this.now(), lastRunAt:null, runs:0 });
    return structuredClone(state);
  }

  write(state) {
    state.revision += 1;
    const envelope = { payload:state, sha256:sha256(JSON.stringify(state)) };
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { flag:'wx', mode:0o600 });
    fs.renameSync(temporary, this.file);
  }

  due(at = this.now(), maximum = MAXIMUM_QUERIES_PER_RUN) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAXIMUM_QUERIES_PER_RUN) throw crucibleError('CRU-0042', `maximum due searches must be between 1 and ${MAXIMUM_QUERIES_PER_RUN}.`);
    const timestamp = Date.parse(at);
    if (!Number.isFinite(timestamp)) throw crucibleError('CRU-0042', 'A valid due timestamp is required.');
    return this.read().topics.filter((item) => Date.parse(item.nextRunAt) <= timestamp).slice(0, maximum).map((item) => structuredClone(item));
  }

  recordRun(topic, { searchedAt, intervalMs, candidates, state, reason = null, cited = 0, provider = 'perplexity', model = null, promptSha256 = null, responseSha256 = null }) {
    const checked = boundedTopic(topic);
    if (!Number.isFinite(Date.parse(searchedAt))) throw crucibleError('CRU-0042', 'A valid search timestamp is required.');
    if (!Number.isSafeInteger(intervalMs) || intervalMs < DEFAULT_RESEARCH_INTERVAL_MS || intervalMs > 30 * DEFAULT_RESEARCH_INTERVAL_MS) throw crucibleError('CRU-0042', 'Research interval must be between 1 and 30 days.');
    if (!Array.isArray(candidates)) throw crucibleError('CRU-0042', 'Search candidates must be an array.');
    const data = this.read();
    const entry = data.topics.find((item) => item.topic === checked);
    if (!entry) throw crucibleError('CRU-0042', 'Research topic is not approved.');
    const known = new Set(data.discoveredUrls);
    const novel = [];
    for (const candidate of candidates) {
      if (typeof candidate?.url !== 'string' || known.has(candidate.url)) continue;
      known.add(candidate.url); novel.push(structuredClone(candidate)); data.discoveredUrls.push(candidate.url);
    }
    entry.lastRunAt = searchedAt;
    entry.nextRunAt = new Date(Date.parse(searchedAt) + intervalMs).toISOString();
    entry.runs += 1;
    data.auditLog.push({ topic:checked, searchedAt, state, reason, cited, discovered:candidates.length, novel:novel.length, provider, model, promptSha256, responseSha256 });
    this.write(data);
    return novel;
  }
}

class AutomatedPerplexityResearch {
  constructor({ store, client, candidateSink, scopeProvider = null, intervalMs = DEFAULT_RESEARCH_INTERVAL_MS, maximumQueriesPerRun = MAXIMUM_QUERIES_PER_RUN }) {
    if (!store?.due || !store?.recordRun) throw crucibleError('CRU-0042', 'A Perplexity research store is required.');
    if (!client?.search) throw crucibleError('CRU-0042', 'A bounded Perplexity citation client is required.');
    if (!candidateSink?.register) throw crucibleError('CRU-0042', 'A candidate URL sink is required.');
    if (!Number.isSafeInteger(maximumQueriesPerRun) || maximumQueriesPerRun < 1 || maximumQueriesPerRun > MAXIMUM_QUERIES_PER_RUN) throw crucibleError('CRU-0042', `maximumQueriesPerRun must be between 1 and ${MAXIMUM_QUERIES_PER_RUN}.`);
    this.store = store; this.client = client; this.candidateSink = candidateSink; this.scopeProvider = scopeProvider; this.intervalMs = intervalMs; this.maximumQueriesPerRun = maximumQueriesPerRun;
  }

  async runDue(at) {
    const outcomes = [];
    for (const entry of this.store.due(at, this.maximumQueriesPerRun)) {
      try {
        const scope = this.scopeProvider ? this.scopeProvider(entry.topic) : { trustedSuffixes:['.edu', '.org', '.gov'], deniedDomains:[] };
        const search = await this.client.search(entry.topic);
        const candidates = admitDiscoveryCandidateUrls(search.citations, { trustedDomains:[], trustedSuffixes:scope.trustedSuffixes, extremeVettingSuffixes:[], deniedDomains:scope.deniedDomains || [], maximumResults:10 });
        const known = new Set(this.store.read().discoveredUrls);
        const novel = candidates.filter((candidate) => !known.has(candidate.url));
        const registered = [];
        for (const candidate of novel) registered.push(await this.candidateSink.register({ ...candidate, discoveredBy:'automated-perplexity-discovery', provider:'perplexity', model:search.model, promptSha256:search.promptSha256, responseSha256:search.responseSha256 }));
        this.store.recordRun(entry.topic, { searchedAt:search.searchedAt, intervalMs:this.intervalMs, candidates:novel, state:'completed', cited:search.citations.length, provider:'perplexity', model:search.model, promptSha256:search.promptSha256, responseSha256:search.responseSha256 });
        outcomes.push({ topic:entry.topic, state:'completed', cited:search.citations.length, admitted:candidates.length, rejected:Math.max(0, search.citations.length - candidates.length), novel:novel.length, registered });
      } catch (error) {
        const searchedAt = new Date().toISOString();
        this.store.recordRun(entry.topic, { searchedAt, intervalMs:this.intervalMs, candidates:[], state:'blocked', reason:String(error.message || error) });
        outcomes.push({ topic:entry.topic, state:'blocked', reason:String(error.message || error), cited:0, admitted:0, rejected:0, novel:0, registered:[] });
      }
    }
    return outcomes;
  }
}

module.exports = { DEFAULT_RESEARCH_INTERVAL_MS, MAXIMUM_QUERIES_PER_RUN, PerplexityResearchStore, AutomatedPerplexityResearch, AtomicSourceQueueCandidateSink };
