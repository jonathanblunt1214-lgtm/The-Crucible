const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_RESEARCH_INTERVAL_MS, buildGoogleSearchUrl, GoogleResearchStore, BoundedGoogleSearchClient, AtomicSourceQueueCandidateSink, AutomatedGoogleResearch } = require('../src/automatedGoogleResearch');
const { run:runCli } = require('../src/automatedGoogleResearchCli');

function response(body, type = 'text/html') {
  const bytes = Buffer.from(body);
  return { ok:true, status:200, headers:{ get:(name) => name.toLowerCase() === 'content-type' ? type : name.toLowerCase() === 'content-length' ? String(bytes.length) : null }, body:(async function* () { yield bytes; })() };
}

function storeFixture(t, topics = ['JavaScript language specification']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-google-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  return { root, store:new GoogleResearchStore(root, 'github:owner/repository', topics, { now:() => '2026-08-30T20:00:00.000Z' }) };
}

test('query planner fixes Google endpoint, safe mode, result bound, and trusted suffix constraint', () => {
  const url = new URL(buildGoogleSearchUrl(' JavaScript   language specification '));
  assert.equal(url.origin, 'https://www.google.com'); assert.equal(url.pathname, '/search'); assert.equal(url.searchParams.get('safe'), 'active'); assert.equal(url.searchParams.get('num'), '10');
  assert.match(url.searchParams.get('q'), /site:\.edu OR site:\.org OR site:\.gov/);
  assert.throws(() => buildGoogleSearchUrl('x', { resultCount:100 }));
  assert.throws(() => buildGoogleSearchUrl('bad\nquery'));
});

test('bounded search is credential-free GET-only and rejects kill switch, private targets, type, and size', async (t) => {
  const { root } = storeFixture(t); const calls = [];
  const client = new BoundedGoogleSearchClient({ killSwitchFile:path.join(root, 'KILL'), minimumIntervalMs:0, lookup:async () => [{ address:'142.250.72.68', family:4 }], fetchImpl:async (url, options) => { calls.push({ url:String(url), options }); return response('<a href="https://www.nist.gov/page">NIST</a>'); } });
  await client.search('C secure coding');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.body, undefined); assert.equal(calls[0].options.redirect, 'error');
  fs.writeFileSync(path.join(root, 'KILL'), 'stop'); await assert.rejects(() => client.search('C secure coding'), /kill switch/); fs.rmSync(path.join(root, 'KILL'));
  const privateClient = new BoundedGoogleSearchClient({ killSwitchFile:path.join(root, 'KILL'), lookup:async () => [{ address:'127.0.0.1', family:4 }], fetchImpl:async () => response('') });
  await assert.rejects(() => privateClient.search('C'), /forbidden network target/);
  const typeClient = new BoundedGoogleSearchClient({ killSwitchFile:path.join(root, 'KILL'), lookup:async () => [{ address:'142.250.72.68', family:4 }], fetchImpl:async () => response('{}', 'application/json') });
  await assert.rejects(() => typeClient.search('C'), /non-HTML/);
});

test('due coordinator admits only edu org gov, deduplicates URLs, and registers candidates without proof', async (t) => {
  const { store } = storeFixture(t); const registered = [];
  const html = '<a href="https://www.nist.gov/secure">NIST</a><a href="https://example.org/spec">Org</a><a href="https://mit.edu/course">MIT</a><a href="https://wikipedia.org/wiki/JS">Wiki</a><a href="https://example.com/blog">Commercial</a>';
  const client = { search:async () => ({ html, searchedAt:'2026-08-30T20:00:00.000Z', queryUrl:buildGoogleSearchUrl('JavaScript language specification') }) };
  const coordinator = new AutomatedGoogleResearch({ store, client, candidateSink:{ register:async (candidate) => { registered.push(candidate); return candidate.url; } } });
  const first = await coordinator.runDue(); assert.equal(first[0].discovered, 3); assert.equal(first[0].novel, 3); assert.equal(registered.length, 3);
  assert.ok(registered.every((item) => item.classification === 'Insufficient Evidence')); assert.ok(registered.every((item) => item.state === 'trusted-domain-candidate-url'));
  assert.equal(store.due('2026-09-06T19:59:59.999Z').length, 0); assert.equal(store.due('2026-09-06T20:00:00.000Z').length, 1);
  const second = await coordinator.runDue('2026-09-06T20:00:00.000Z'); assert.equal(second[0].novel, 0); assert.equal(registered.length, 3);
});

test('failed searches are audited as blocked and cannot emit candidate URLs', async (t) => {
  const { store } = storeFixture(t); let registrations = 0;
  const coordinator = new AutomatedGoogleResearch({ store, client:{ search:async () => { throw new Error('consent page or rate limit'); } }, candidateSink:{ register:async () => { registrations += 1; } } });
  const result = await coordinator.runDue(); assert.equal(result[0].state, 'blocked'); assert.equal(registrations, 0);
  const data = store.read(); assert.equal(data.auditLog[0].state, 'blocked'); assert.match(data.auditLog[0].reason, /consent page/); assert.equal(data.discoveredUrls.length, 0);
});

test('research store fails closed on tampering and cross-project reuse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-google-integrity-'));
  const store = new GoogleResearchStore(root, 'github:owner/repository', ['Python']); store.write(store.read());
  const file = path.join(root, 'automated-google-research.json'); const envelope = JSON.parse(fs.readFileSync(file, 'utf8')); envelope.payload.projectId = 'github:other/repository'; fs.writeFileSync(file, JSON.stringify(envelope));
  assert.throws(() => store.read(), /integrity check failed/); fs.rmSync(root, { recursive:true, force:true });
});

test('default automated research cadence is weekly', () => assert.equal(DEFAULT_RESEARCH_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000));

test('source queue sink registers once as pending retrieval and fails closed across projects', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-google-queue-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const file = path.join(root, 'queue.json'); fs.writeFileSync(file, JSON.stringify({ schemaVersion:1, projectId:'github:owner/repository', updatedAt:null, protocol:{}, documents:[], links:[] }));
  const sink = new AtomicSourceQueueCandidateSink(file, 'github:owner/repository', { now:() => '2026-08-30T20:00:00.000Z' });
  const candidate = { url:'https://example.org/spec', classification:'Insufficient Evidence', querySha256:'a'.repeat(64) };
  assert.equal(sink.register(candidate).created, true); assert.equal(sink.register(candidate).created, false);
  const queue = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(queue.links.length, 1); assert.equal(queue.links[0].state, 'research-approved-pending-retrieval'); assert.equal(queue.links[0].contentSha256, null);
  assert.throws(() => new AtomicSourceQueueCandidateSink(file, 'github:other/repository').register({ ...candidate, url:'https://new.example.org/spec' }), /another project/);
});

test('CLI readiness requires explicit repository-bound durable configuration', async () => {
  await assert.rejects(() => runCli(['readiness'], {}, () => {}), /required/);
  const lines = []; await runCli(['readiness'], { CRUCIBLE_LEARNING_PROJECT_ID:'github:owner/repository', CRUCIBLE_LEARNING_ROOT:'.', CRUCIBLE_SOURCE_QUEUE:'queue.json' }, (line) => lines.push(JSON.parse(line)));
  assert.equal(lines[0].ready, true); assert.equal(lines[0].projectId, 'github:owner/repository');
});

test('automated research runs bounded claim extraction in the same governed execution', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-google-extract-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const queue = path.join(root, 'queue.json'); fs.writeFileSync(queue, JSON.stringify({ schemaVersion:1, projectId:'github:owner/repository', updatedAt:null, protocol:{}, documents:[], links:[] }));
  let extractionRuns = 0; const lines = [];
  await runCli(['run', 'JavaScript'], { CRUCIBLE_LEARNING_PROJECT_ID:'github:owner/repository', CRUCIBLE_LEARNING_ROOT:root, CRUCIBLE_SOURCE_QUEUE:queue }, (line) => lines.push(JSON.parse(line)), {
    research:{ runDue:async () => [{ state:'completed', novel:1 }] },
    extractionWorker:{ run:() => { extractionRuns += 1; return [{ state:'claim-extraction-complete', candidateIds:['candidate-1'] }]; } }
  });
  assert.equal(extractionRuns, 1); assert.deepEqual(lines[0].extraction, { processed:1, completed:1, continuing:0, blocked:0, candidates:1 });
});
