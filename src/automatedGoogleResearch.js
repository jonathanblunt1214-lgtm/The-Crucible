const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const { parseGoogleSearchResults, privateAddress } = require('./safeInformationRetrieval');

const DEFAULT_RESEARCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_SEARCH_HOST = 'www.google.com';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function boundedTopic(value) {
  if (typeof value !== 'string') throw new Error('Research topics must be strings.');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('Research topics cannot contain control characters.');
  const topic = value.trim().replace(/\s+/g, ' ');
  if (!topic || topic.length > 80) throw new Error('Research topics must contain 1-80 printable characters.');
  return topic;
}

function buildGoogleSearchUrl(topic, { resultCount = 10, trustedSuffixes = ['.edu', '.org', '.gov'] } = {}) {
  const checked = boundedTopic(topic);
  if (!Number.isSafeInteger(resultCount) || resultCount < 1 || resultCount > 10) throw new Error('Google resultCount must be between 1 and 10.');
  if (!Array.isArray(trustedSuffixes) || !trustedSuffixes.length || trustedSuffixes.some((item) => !['.edu', '.org', '.gov'].includes(item))) throw new Error('Research suffixes must be a non-empty subset of .edu, .org, and .gov.');
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', `${checked} (${trustedSuffixes.map((suffix) => `site:${suffix}`).join(' OR ')})`);
  url.searchParams.set('num', String(resultCount));
  url.searchParams.set('filter', '1');
  url.searchParams.set('safe', 'active');
  return url.toString();
}

function emptyState(projectId, topics, now) {
  return { schemaVersion:1, projectId, revision:0, topics:topics.map((topic) => ({ topic, nextRunAt:now, lastRunAt:null, runs:0 })), discoveredUrls:[], auditLog:[] };
}

class GoogleResearchStore {
  constructor(root, projectId, topics, { now = () => new Date().toISOString() } = {}) {
    if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('A repository-bound projectId is required.');
    if (!Array.isArray(topics) || !topics.length || topics.length > 50) throw new Error('Between 1 and 50 approved research topics are required.');
    this.projectId = projectId;
    this.topics = [...new Set(topics.map(boundedTopic))];
    this.now = now;
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'automated-google-research.json');
    fs.mkdirSync(this.root, { recursive:true });
  }

  read() {
    if (!fs.existsSync(this.file)) return emptyState(this.projectId, this.topics, this.now());
    const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (Object.keys(envelope).sort().join(',') !== 'payload,sha256' || sha256(JSON.stringify(envelope.payload)) !== envelope.sha256) throw new Error('Google research store integrity check failed.');
    const state = envelope.payload;
    if (state?.schemaVersion !== 1 || state.projectId !== this.projectId || !Array.isArray(state.topics) || !Array.isArray(state.discoveredUrls) || !Array.isArray(state.auditLog)) throw new Error('Google research store is invalid or belongs to another project.');
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

  due(at = this.now(), maximum = 5) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10) throw new Error('maximum due searches must be between 1 and 10.');
    const timestamp = Date.parse(at);
    if (!Number.isFinite(timestamp)) throw new Error('A valid due timestamp is required.');
    return this.read().topics.filter((item) => Date.parse(item.nextRunAt) <= timestamp).slice(0, maximum).map((item) => structuredClone(item));
  }

  recordRun(topic, { searchedAt, intervalMs, candidates, state, reason = null }) {
    const checked = boundedTopic(topic);
    if (!Number.isFinite(Date.parse(searchedAt))) throw new Error('A valid search timestamp is required.');
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 24 * 60 * 60 * 1000 || intervalMs > 30 * 24 * 60 * 60 * 1000) throw new Error('Research interval must be between 1 and 30 days.');
    if (!Array.isArray(candidates)) throw new Error('Search candidates must be an array.');
    const data = this.read();
    const entry = data.topics.find((item) => item.topic === checked);
    if (!entry) throw new Error('Research topic is not approved.');
    const known = new Set(data.discoveredUrls);
    const novel = [];
    for (const candidate of candidates) {
      if (typeof candidate?.url !== 'string' || known.has(candidate.url)) continue;
      known.add(candidate.url); novel.push(structuredClone(candidate)); data.discoveredUrls.push(candidate.url);
    }
    entry.lastRunAt = searchedAt;
    entry.nextRunAt = new Date(Date.parse(searchedAt) + intervalMs).toISOString();
    entry.runs += 1;
    data.auditLog.push({ topic:checked, searchedAt, state, reason, discovered:candidates.length, novel:novel.length, querySha256:sha256(buildGoogleSearchUrl(checked)) });
    this.write(data);
    return novel;
  }
}

class BoundedGoogleSearchClient {
  constructor({ fetchImpl = globalThis.fetch, lookup = dns.lookup, killSwitchFile, maximumBytes = 1024 * 1024, timeoutMs = 15_000, minimumIntervalMs = 2_000, now = () => new Date().toISOString() }) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    this.fetchImpl = fetchImpl; this.lookup = lookup; this.killSwitchFile = path.resolve(killSwitchFile); this.maximumBytes = maximumBytes; this.timeoutMs = timeoutMs; this.minimumIntervalMs = minimumIntervalMs; this.now = now; this.lastRequestAt = 0;
  }

  async search(topic, { trustedSuffixes = ['.edu', '.org', '.gov'] } = {}) {
    if (fs.existsSync(this.killSwitchFile)) throw new Error('Google research kill switch is active.');
    const searchUrl = new URL(buildGoogleSearchUrl(topic, { trustedSuffixes }));
    if (searchUrl.hostname !== GOOGLE_SEARCH_HOST || searchUrl.pathname !== '/search') throw new Error('Only the fixed Google search endpoint is allowed.');
    const addresses = await this.lookup(searchUrl.hostname, { all:true, verbatim:true });
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => privateAddress(item.address))) throw new Error('Google search resolved to a forbidden network target.');
    const delay = Math.max(0, this.minimumIntervalMs - (Date.now() - this.lastRequestAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastRequestAt = Date.now();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(searchUrl, { method:'GET', redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal, headers:{ accept:'text/html', 'user-agent':'The-Crucible-Research-Discovery/1.0' } });
      if (!response.ok) throw new Error(`Google search HTTP ${response.status}.`);
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (type !== 'text/html') throw new Error('Google search returned a non-HTML response.');
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > this.maximumBytes) throw new Error('Google search response exceeds the size limit.');
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > this.maximumBytes) throw new Error('Google search response exceeds the size limit.'); chunks.push(Buffer.from(chunk)); }
      return { html:Buffer.concat(chunks).toString('utf8'), searchedAt:this.now(), queryUrl:searchUrl.toString() };
    } finally { clearTimeout(timer); }
  }
}

class AtomicSourceQueueCandidateSink {
  constructor(queueFile, projectId, { now = () => new Date().toISOString() } = {}) {
    this.file = path.resolve(queueFile); this.projectId = projectId; this.now = now;
  }

  register(candidate) {
    if (typeof candidate?.url !== 'string' || candidate.classification !== 'Insufficient Evidence') throw new Error('Only bounded Insufficient Evidence URL candidates may be registered.');
    const url = new URL(candidate.url); if (url.protocol !== 'https:') throw new Error('Only HTTPS candidates may be registered.');
    const queue = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (queue?.schemaVersion !== 1 || queue.projectId !== this.projectId || !Array.isArray(queue.links)) throw new Error('Source queue is invalid or belongs to another project.');
    const existing = queue.links.find((item) => item.url === url.toString() || item.finalUrl === url.toString());
    if (existing) return { created:false, id:existing.id };
    const discoveredAt = this.now(); const id = `google-research:${sha256(url.toString())}`;
    queue.links.push({ id, catalogSourceId:null, ordinal:null, url:url.toString(), author:'unknown until retrieved', license:'not declared; verify source terms before redistribution', retrievedAt:null, contentSha256:null, classification:'Insufficient Evidence', state:'research-approved-pending-retrieval', retrievalStartedAt:null, finalUrl:null, httpStatus:null, contentType:null, contentLength:null, durablePath:null, publisher:null, blocker:null, discovery:{ method:'automated-google-discovery', discoveredAt, querySha256:candidate.querySha256 } });
    queue.updatedAt = discoveredAt;
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(queue, null, 2)}\n`, { flag:'wx', mode:0o600 }); fs.renameSync(temporary, this.file);
    return { created:true, id };
  }
}

class AutomatedGoogleResearch {
  constructor({ store, client, candidateSink, scopeProvider = null, intervalMs = DEFAULT_RESEARCH_INTERVAL_MS, maximumQueriesPerRun = 5 }) {
    if (!store?.due || !store?.recordRun) throw new Error('A Google research store is required.');
    if (!client?.search) throw new Error('A bounded Google search client is required.');
    if (!candidateSink?.register) throw new Error('A candidate URL sink is required.');
    if (!Number.isSafeInteger(maximumQueriesPerRun) || maximumQueriesPerRun < 1 || maximumQueriesPerRun > 10) throw new Error('maximumQueriesPerRun must be between 1 and 10.');
    this.store = store; this.client = client; this.candidateSink = candidateSink; this.scopeProvider = scopeProvider; this.intervalMs = intervalMs; this.maximumQueriesPerRun = maximumQueriesPerRun;
  }

  async runDue(at) {
    const outcomes = [];
    for (const entry of this.store.due(at, this.maximumQueriesPerRun)) {
      try {
        const scope = this.scopeProvider ? this.scopeProvider(entry.topic) : { trustedSuffixes:['.edu', '.org', '.gov'], deniedDomains:[] };
        const search = await this.client.search(entry.topic, { trustedSuffixes:scope.trustedSuffixes });
        const candidates = parseGoogleSearchResults(search.html, { trustedDomains:[], trustedSuffixes:scope.trustedSuffixes, extremeVettingSuffixes:[], deniedDomains:scope.deniedDomains || [], maximumResults:10 });
        const known = new Set(this.store.read().discoveredUrls);
        const novel = candidates.filter((candidate) => !known.has(candidate.url));
        const registered = [];
        for (const candidate of novel) registered.push(await this.candidateSink.register({ ...candidate, discoveredBy:'automated-google-discovery', querySha256:sha256(search.queryUrl) }));
        this.store.recordRun(entry.topic, { searchedAt:search.searchedAt, intervalMs:this.intervalMs, candidates:novel, state:'completed' });
        outcomes.push({ topic:entry.topic, state:'completed', discovered:candidates.length, novel:novel.length, registered });
      } catch (error) {
        const searchedAt = new Date().toISOString();
        this.store.recordRun(entry.topic, { searchedAt, intervalMs:this.intervalMs, candidates:[], state:'blocked', reason:String(error.message || error) });
        outcomes.push({ topic:entry.topic, state:'blocked', reason:String(error.message || error), discovered:0, novel:0, registered:[] });
      }
    }
    return outcomes;
  }
}

module.exports = { DEFAULT_RESEARCH_INTERVAL_MS, GOOGLE_SEARCH_HOST, boundedTopic, buildGoogleSearchUrl, GoogleResearchStore, BoundedGoogleSearchClient, AtomicSourceQueueCandidateSink, AutomatedGoogleResearch };
