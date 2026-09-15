'use strict';

// Governed discovery driven by a provider that has no search engine behind it.
//
// R3 asks for one real scheduled discovery run that admits at least one governed URL. It has
// been stuck, and not for a code reason: the implementation was bound to Perplexity, whose API
// billing is separate from a Perplexity Pro subscription, so the gate waited on a key nobody
// had bought. NVIDIA NIM is already a governed provider here and is free, so discovery runs on
// it instead - and on any of the four governed providers, because the owner should be able to
// point this at whichever credential already exists rather than provision another.
//
// Every bound the Google and Perplexity paths enforce is enforced here unchanged: one run per
// topic per day, at most fifty topics per run, an atomic project-bound audit, a kill switch, and
// admission only for HTTPS results whose final host ends in an approved suffix. The provider is
// a source of guesses about where to look. It is never evidence, never corroboration, and never
// a vote - which is why the audit records how the URLs were obtained, not merely that they were.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { boundedTopic, AtomicSourceQueueCandidateSink } = require('./automatedGoogleResearch');
const { admitDiscoveryCandidateUrls } = require('./safeInformationRetrieval');
const { crucibleError } = require('./failureCodes');

const DEFAULT_RESEARCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_QUERIES_PER_RUN = 50;
const DEFAULT_DISCOVERY_PROVIDER = 'nvidia-nim';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function emptyState(projectId, provider, topics, now) {
  return { schemaVersion:1, projectId, revision:0, provider, topics:topics.map((topic) => ({ topic, nextRunAt:now, lastRunAt:null, runs:0 })), discoveredUrls:[], auditLog:[] };
}

class ModelPointerResearchStore {
  constructor(root, projectId, topics, { provider = DEFAULT_DISCOVERY_PROVIDER, now = () => new Date().toISOString() } = {}) {
    if (typeof projectId !== 'string' || !projectId.trim()) throw crucibleError('CRU-0042', 'A repository-bound projectId is required.');
    if (!Array.isArray(topics) || !topics.length || topics.length > MAXIMUM_QUERIES_PER_RUN) throw crucibleError('CRU-0042', `Between 1 and ${MAXIMUM_QUERIES_PER_RUN} approved research topics are required.`);
    this.projectId = projectId;
    this.provider = provider;
    this.topics = [...new Set(topics.map(boundedTopic))];
    this.now = now;
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'automated-model-pointer-research.json');
    fs.mkdirSync(this.root, { recursive:true });
  }

  read() {
    if (!fs.existsSync(this.file)) return emptyState(this.projectId, this.provider, this.topics, this.now());
    const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (Object.keys(envelope).sort().join(',') !== 'payload,sha256' || sha256(JSON.stringify(envelope.payload)) !== envelope.sha256) throw crucibleError('CRU-0042', 'Model-pointer research store integrity check failed.');
    const state = envelope.payload;
    // The provider is part of the store's identity. Switching providers mid-history would make
    // one audit trail describe runs that two different systems produced.
    if (state?.schemaVersion !== 1 || state.projectId !== this.projectId || state.provider !== this.provider || !Array.isArray(state.topics) || !Array.isArray(state.discoveredUrls) || !Array.isArray(state.auditLog)) throw crucibleError('CRU-0042', 'Model-pointer research store is invalid, belongs to another project, or was written by another provider.');
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
    // A topic that has never run is due, full stop, without consulting its deadline. `nextRunAt`
    // for such a topic is not a schedule anybody chose: it is whatever the clock said inside the
    // `read()` below, which happens after the reading that produced `timestamp`. Comparing the two
    // asked whether one clock reading was later than the next, and on 2026-09-15 the answer was
    // often enough yes to take all nine Self-Test legs red at once. `lastRunAt` is set by, and only
    // by, `recordRun`, so its absence is the honest record that no deadline has been earned yet.
    return this.read().topics.filter((item) => !item.lastRunAt || Date.parse(item.nextRunAt) <= timestamp).slice(0, maximum).map((item) => structuredClone(item));
  }

  recordRun(topic, { searchedAt, intervalMs, candidates, state, reason = null, cited = 0, provider = this.provider, providerKind = null, model = null, promptSha256 = null, responseSha256 = null }) {
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
    data.auditLog.push({ topic:checked, searchedAt, state, reason, cited, discovered:candidates.length, novel:novel.length, provider, providerKind, model, promptSha256, responseSha256 });
    this.write(data);
    return novel;
  }
}

class AutomatedModelPointerResearch {
  constructor({ store, client, candidateSink, scopeProvider = null, intervalMs = DEFAULT_RESEARCH_INTERVAL_MS, maximumQueriesPerRun = MAXIMUM_QUERIES_PER_RUN }) {
    if (!store?.due || !store?.recordRun) throw crucibleError('CRU-0042', 'A model-pointer research store is required.');
    if (!client?.search) throw crucibleError('CRU-0042', 'A bounded discovery transport is required.');
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
        // discoveredBy and providerKind travel with the candidate so a later reader can tell a
        // model's guess from a provider's citation without re-deriving it from the run.
        for (const candidate of novel) registered.push(await this.candidateSink.register({ ...candidate, discoveredBy:'automated-model-pointer-discovery', provider:search.provider, providerKind:search.providerKind, model:search.model, promptSha256:search.promptSha256, responseSha256:search.responseSha256 }));
        this.store.recordRun(entry.topic, { searchedAt:search.searchedAt, intervalMs:this.intervalMs, candidates:novel, state:'completed', cited:search.citations.length, provider:search.provider, providerKind:search.providerKind, model:search.model, promptSha256:search.promptSha256, responseSha256:search.responseSha256 });
        outcomes.push({ topic:entry.topic, state:'completed', cited:search.citations.length, admitted:candidates.length, rejected:Math.max(0, search.citations.length - candidates.length), novel:novel.length, providerKind:search.providerKind, registered });
      } catch (error) {
        // A blocked topic still consumes its daily slot, exactly as the other discovery paths
        // behave: a provider outage must not become an unbounded retry loop against the vendor.
        const searchedAt = new Date().toISOString();
        this.store.recordRun(entry.topic, { searchedAt, intervalMs:this.intervalMs, candidates:[], state:'blocked', reason:String(error.message || error) });
        outcomes.push({ topic:entry.topic, state:'blocked', reason:String(error.message || error), cited:0, admitted:0, rejected:0, novel:0, providerKind:null, registered:[] });
      }
    }
    return outcomes;
  }
}

module.exports = { DEFAULT_RESEARCH_INTERVAL_MS, MAXIMUM_QUERIES_PER_RUN, DEFAULT_DISCOVERY_PROVIDER, ModelPointerResearchStore, AutomatedModelPointerResearch, AtomicSourceQueueCandidateSink };
