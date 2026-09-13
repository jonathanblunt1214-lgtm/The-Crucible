'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_PERPLEXITY_DISCOVERY_MODEL, discoveryPrompt, PerplexityCitationTransport } = require('../src/providerCirculation');
const { DEFAULT_RESEARCH_INTERVAL_MS, MAXIMUM_QUERIES_PER_RUN, PerplexityResearchStore, AutomatedPerplexityResearch, AtomicSourceQueueCandidateSink } = require('../src/automatedPerplexityResearch');
const { run:runCli } = require('../src/automatedPerplexityResearchCli');

function fixture(t, topics = ['JavaScript']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-perplexity-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const queue = path.join(root, 'queue.json');
  fs.writeFileSync(queue, JSON.stringify({ schemaVersion:1, projectId:'github:owner/repository', updatedAt:null, protocol:{}, documents:[], links:[] }));
  return { root, queue, store:new PerplexityResearchStore(root, 'github:owner/repository', topics, { now:() => '2026-09-10T12:00:00.000Z' }) };
}

test('transport uses the explicit discovery default and discards provider prose', async (t) => {
  const { root } = fixture(t); const calls = [];
  const transport = new PerplexityCitationTransport({
    env:{ PERPLEXITY_API_KEY:'test-key' }, killSwitchFile:path.join(root, 'KILL'), now:() => '2026-09-10T12:00:00.000Z',
    adapter:{ run:async (request) => { calls.push(request); return { text:'This generated claim must never enter the queue.', model:'sonar', evidence:['https://nist.gov/a', 'https://example.com/rejected'] }; } },
  });
  const result = await transport.search('JavaScript');
  assert.equal(calls[0].model, DEFAULT_PERPLEXITY_DISCOVERY_MODEL);
  assert.match(calls[0].prompt, /independently retrieve and vet citation URLs/);
  assert.deepEqual(result.citations, ['https://nist.gov/a', 'https://example.com/rejected']);
  assert.equal(Object.values(result).some((value) => String(value).includes('generated claim')), false, 'provider prose is hashed and discarded');
  fs.writeFileSync(path.join(root, 'KILL'), 'stop');
  await assert.rejects(() => transport.search('JavaScript'), /kill switch/);
  assert.match(discoveryPrompt('JavaScript'), /Approved topic: JavaScript/);
});

test('daily coordinator admits only governed citations and retains candidate-only provenance', async (t) => {
  const { queue, store } = fixture(t); const sink = new AtomicSourceQueueCandidateSink(queue, 'github:owner/repository', { now:() => '2026-09-10T12:00:00.000Z' });
  const client = { search:async () => ({ citations:['https://nist.gov/guide', 'https://example.org/spec', 'https://wikipedia.org/wiki/X', 'http://mit.edu/no', 'https://example.com/blog'], searchedAt:'2026-09-10T12:00:00.000Z', provider:'perplexity', model:'sonar', promptSha256:'a'.repeat(64), responseSha256:'b'.repeat(64) }) };
  const result = await new AutomatedPerplexityResearch({ store, client, candidateSink:sink }).runDue();
  assert.deepEqual({ cited:result[0].cited, admitted:result[0].admitted, rejected:result[0].rejected, novel:result[0].novel }, { cited:5, admitted:2, rejected:3, novel:2 });
  const held = JSON.parse(fs.readFileSync(queue, 'utf8')).links;
  assert.equal(held.length, 2); assert.ok(held.every((item) => item.id.startsWith('perplexity-research:')));
  assert.ok(held.every((item) => item.classification === 'Insufficient Evidence' && item.state === 'research-approved-pending-retrieval'));
  assert.ok(held.every((item) => item.discovery.method === 'automated-perplexity-discovery' && item.discovery.provider === 'perplexity'));
  assert.equal(held.some((item) => JSON.stringify(item).includes('generated claim')), false);
  assert.equal(store.due('2026-09-11T11:59:59.999Z').length, 0);
  assert.equal(store.due('2026-09-11T12:00:00.000Z').length, 1);
});

test('one run processes all 50 due topics without changing the one-day interval', async (t) => {
  const topics = Array.from({ length:50 }, (_, index) => `Topic ${index + 1}`);
  const { store } = fixture(t, topics); const searched = [];
  const research = new AutomatedPerplexityResearch({ store, client:{ search:async (topic) => { searched.push(topic); return { citations:[], searchedAt:'2026-09-10T12:00:00.000Z', model:'sonar', promptSha256:'a'.repeat(64), responseSha256:'b'.repeat(64) }; } }, candidateSink:{ register:async () => assert.fail('no admitted URLs') } });
  const outcomes = await research.runDue();
  assert.equal(DEFAULT_RESEARCH_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(MAXIMUM_QUERIES_PER_RUN, 50); assert.equal(outcomes.length, 50); assert.deepEqual(searched, topics);
  assert.throws(() => new AutomatedPerplexityResearch({ store, client:{ search:async () => {} }, candidateSink:{ register:async () => {} }, maximumQueriesPerRun:51 }), /between 1 and 50/);
});

test('store fails closed on tampering and project mismatch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-perplexity-store-'));
  try {
    const store = new PerplexityResearchStore(root, 'github:owner/repository', ['JavaScript']); store.write(store.read());
    const envelope = JSON.parse(fs.readFileSync(store.file, 'utf8')); envelope.payload.projectId = 'github:other/repository'; fs.writeFileSync(store.file, JSON.stringify(envelope));
    assert.throws(() => store.read(), /integrity check failed/);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('CLI preserves completed results in a structured partial report and exits failing', async (t) => {
  const { root, queue } = fixture(t); const lines = [];
  await assert.rejects(() => runCli(['run', 'JavaScript', 'Python'], { CRUCIBLE_LEARNING_PROJECT_ID:'github:owner/repository', CRUCIBLE_LEARNING_ROOT:root, CRUCIBLE_SOURCE_QUEUE:queue, PERPLEXITY_API_KEY:'test-key' }, (line) => lines.push(JSON.parse(line)), {
    research:{ runDue:async () => [
      { topic:'JavaScript', state:'completed', cited:3, admitted:2, rejected:1, novel:2, registered:[{ id:'perplexity-research:one' }, { id:'perplexity-research:two' }] },
      { topic:'Python', state:'blocked', cited:0, admitted:0, rejected:0, novel:0, reason:'provider unavailable', registered:[] },
    ] },
  }), /completed partially/);
  assert.equal(lines.length, 1); assert.equal(lines[0].overallState, 'partial'); assert.equal(lines[0].completed, 1); assert.equal(lines[0].blocked, 1);
  assert.deepEqual(lines[0].outcomes[0].candidateIds, ['perplexity-research:one', 'perplexity-research:two']); assert.equal(lines[0].authorizesPromotion, false);
});

test('CLI initializes the holding queue and readiness fails honestly without the key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-perplexity-cli-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const queue = path.join(root, 'holding', 'queue.json'); const env = { CRUCIBLE_LEARNING_PROJECT_ID:'github:owner/repository', CRUCIBLE_LEARNING_ROOT:root, CRUCIBLE_SOURCE_QUEUE:queue };
  const initialized = []; await runCli(['init'], env, (line) => initialized.push(JSON.parse(line)));
  assert.equal(initialized[0].model, 'sonar'); assert.equal(initialized[0].authorizesPromotion, false); assert.ok(fs.existsSync(queue));
  const readiness = []; await assert.rejects(() => runCli(['readiness'], env, (line) => readiness.push(JSON.parse(line))), /PERPLEXITY_API_KEY/);
  assert.deepEqual(readiness[0].missing, ['PERPLEXITY_API_KEY']); assert.equal(readiness[0].ready, false);
});
