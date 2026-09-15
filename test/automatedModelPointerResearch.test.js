'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoveryPrompt, extractUrlsFromText, ModelPointerTransport, MODEL_POINTER_PROVIDER_KIND, CITATION_PROVIDER_KIND } = require('../src/providerCirculation');
const { DEFAULT_RESEARCH_INTERVAL_MS, MAXIMUM_QUERIES_PER_RUN, DEFAULT_DISCOVERY_PROVIDER, ModelPointerResearchStore, AutomatedModelPointerResearch, AtomicSourceQueueCandidateSink } = require('../src/automatedModelPointerResearch');
const { run: runCli } = require('../src/automatedModelPointerResearchCli');

const PROJECT = 'github:owner/repository';
const HASH = 'a'.repeat(64);

function fixture(t, topics = ['JavaScript']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-pointer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const queue = path.join(root, 'queue.json');
  fs.writeFileSync(queue, JSON.stringify({ schemaVersion: 1, projectId: PROJECT, updatedAt: null, protocol: {}, documents: [], links: [] }));
  return { root, queue, store: new ModelPointerResearchStore(root, PROJECT, topics, { now: () => '2026-09-14T12:00:00.000Z' }) };
}

test('URLs are read out of prose strictly, because the model has no citations to give', () => {
  const text = [
    'Try https://developer.mozilla.org/en-US/docs/Web/JavaScript.',
    'Also [the spec](https://www.ecma-international.org/publications/) and (https://nist.gov/x).',
    'Duplicate: https://nist.gov/x',
    'Not a URL: http://insecure.org/nope',
  ].join('\n');
  const found = extractUrlsFromText(text);
  assert.deepEqual(found, [
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    'https://www.ecma-international.org/publications/',
    'https://nist.gov/x',
  ]);
  // A trailing full stop is punctuation, a markdown href is not the bracket after it, the same
  // URL twice is once, and plain http never becomes an https candidate by accident.
  assert.equal(found.some((url) => url.endsWith('.')), false);
  assert.equal(found.some((url) => url.startsWith('http://')), false);
  assert.equal(extractUrlsFromText('no links here').length, 0);
});

test('the transport labels pointers as pointers and still honours the kill switch', async (t) => {
  const { root } = fixture(t);
  const calls = [];
  const transport = new ModelPointerTransport({
    env: { NVIDIA_NIM_API_KEY: 'test-key' },
    providerId: 'nvidia-nim',
    model: 'test-model',
    killSwitchFile: path.join(root, 'KILL'),
    now: () => '2026-09-14T12:00:00.000Z',
    adapter: { run: async (request) => { calls.push(request); return { text: 'This generated claim must never enter the queue. See https://nist.gov/a', model: 'test-model', evidence: [] }; } },
  });
  const result = await transport.search('JavaScript');
  assert.equal(result.provider, 'nvidia-nim');
  assert.equal(result.providerKind, MODEL_POINTER_PROVIDER_KIND);
  assert.deepEqual(result.citations, ['https://nist.gov/a']);
  assert.match(calls[0].prompt, /independently retrieve and vet citation URLs/);
  // The prose is hashed and dropped; it must not survive anywhere in the returned record.
  assert.equal(Object.values(result).some((value) => String(value).includes('generated claim')), false);

  fs.writeFileSync(path.join(root, 'KILL'), 'stop');
  await assert.rejects(() => transport.search('JavaScript'), /kill switch/);
  assert.match(discoveryPrompt('JavaScript'), /Approved topic: JavaScript/);
});

test('real citations are preferred over prose when a provider sends them', async (t) => {
  const { root } = fixture(t);
  const transport = new ModelPointerTransport({
    env: {}, providerId: 'nvidia-nim', model: 'm', killSwitchFile: path.join(root, 'KILL'),
    adapter: { run: async () => ({ text: 'prose mentioning https://example.org/ignored', model: 'm', evidence: ['https://nist.gov/cited'] }) },
  });
  const result = await transport.search('JavaScript');
  assert.deepEqual(result.citations, ['https://nist.gov/cited']);
  assert.equal(result.providerKind, CITATION_PROVIDER_KIND);
});

test('only governed suffixes are admitted and candidates stay pending retrieval', async (t) => {
  const { queue, store } = fixture(t);
  const sink = new AtomicSourceQueueCandidateSink(queue, PROJECT, { now: () => '2026-09-14T12:00:00.000Z' });
  const client = {
    search: async () => ({
      citations: ['https://nist.gov/guide', 'https://example.org/spec', 'https://wikipedia.org/wiki/X', 'http://mit.edu/no', 'https://example.com/blog'],
      searchedAt: '2026-09-14T12:00:00.000Z', provider: 'nvidia-nim', providerKind: MODEL_POINTER_PROVIDER_KIND,
      model: 'test-model', promptSha256: HASH, responseSha256: HASH,
    }),
  };
  const outcomes = await new AutomatedModelPointerResearch({ store, client, candidateSink: sink }).runDue();
  assert.deepEqual(
    { cited: outcomes[0].cited, admitted: outcomes[0].admitted, rejected: outcomes[0].rejected, novel: outcomes[0].novel },
    { cited: 5, admitted: 2, rejected: 3, novel: 2 },
  );
  const held = JSON.parse(fs.readFileSync(queue, 'utf8')).links;
  assert.equal(held.length, 2);
  assert.ok(held.every((item) => item.id.startsWith('model-pointer-research:')));
  assert.ok(held.every((item) => item.classification === 'Insufficient Evidence' && item.state === 'research-approved-pending-retrieval'));
  // The distinction between a guess and a citation is recorded on every candidate, not inferred.
  assert.ok(held.every((item) => item.discovery.method === 'automated-model-pointer-discovery' && item.discovery.providerKind === MODEL_POINTER_PROVIDER_KIND));
  assert.ok(held.every((item) => item.contentSha256 === null && item.retrievedAt === null));
});

test('provenance is mandatory: an unlabelled pointer candidate is refused', async (t) => {
  const { queue } = fixture(t);
  const sink = new AtomicSourceQueueCandidateSink(queue, PROJECT);
  const base = { url: 'https://nist.gov/a', classification: 'Insufficient Evidence', discoveredBy: 'automated-model-pointer-discovery', provider: 'nvidia-nim', model: 'm', promptSha256: HASH, responseSha256: HASH };
  await assert.rejects(async () => sink.register({ ...base, providerKind: undefined }), /providerKind/);
  await assert.rejects(async () => sink.register({ ...base, providerKind: 'invented-kind' }), /providerKind/);
  await assert.rejects(async () => sink.register({ ...base, providerKind: MODEL_POINTER_PROVIDER_KIND, promptSha256: 'short' }), /prompt hash/);
  // An ungoverned discovery method is still refused; adding one method did not open the gate.
  await assert.rejects(async () => sink.register({ ...base, providerKind: MODEL_POINTER_PROVIDER_KIND, discoveredBy: 'freelance-discovery' }), /not governed/);
});

test('governed bounds are unchanged: one run per topic per day, at most fifty topics', async (t) => {
  const { queue, store } = fixture(t);
  const sink = new AtomicSourceQueueCandidateSink(queue, PROJECT, { now: () => '2026-09-14T12:00:00.000Z' });
  const client = { search: async () => ({ citations: ['https://nist.gov/guide'], searchedAt: '2026-09-14T12:00:00.000Z', provider: 'nvidia-nim', providerKind: MODEL_POINTER_PROVIDER_KIND, model: 'm', promptSha256: HASH, responseSha256: HASH }) };
  const research = new AutomatedModelPointerResearch({ store, client, candidateSink: sink });

  assert.equal((await research.runDue()).length, 1);
  // Same day: the topic is no longer due, so a second run does no work at all.
  assert.equal((await research.runDue('2026-09-14T18:00:00.000Z')).length, 0);
  assert.equal((await research.runDue('2026-09-15T12:00:00.001Z')).length, 1);
  assert.equal(DEFAULT_RESEARCH_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(MAXIMUM_QUERIES_PER_RUN, 50);
  assert.equal(DEFAULT_DISCOVERY_PROVIDER, 'nvidia-nim');
  assert.throws(() => new ModelPointerResearchStore(path.dirname(queue), PROJECT, new Array(51).fill('x').map((_, i) => `topic-${i}`)), /Between 1 and 50/);
});

test('a blocked topic is recorded and still consumes its slot rather than retrying forever', async (t) => {
  const { queue, store } = fixture(t);
  const sink = new AtomicSourceQueueCandidateSink(queue, PROJECT, { now: () => '2026-09-14T12:00:00.000Z' });
  const client = { search: async () => { throw new Error('provider unreachable'); } };
  const outcomes = await new AutomatedModelPointerResearch({ store, client, candidateSink: sink }).runDue();
  assert.equal(outcomes[0].state, 'blocked');
  assert.match(outcomes[0].reason, /provider unreachable/);
  assert.equal(JSON.parse(fs.readFileSync(queue, 'utf8')).links.length, 0);
  const audit = store.read().auditLog;
  assert.equal(audit[0].state, 'blocked');
  assert.equal(store.read().topics[0].runs, 1);
});

test('the CLI fails closed on a missing credential and never reports an empty look', async (t) => {
  const { root, queue } = fixture(t);
  const env = { CRUCIBLE_LEARNING_PROJECT_ID: PROJECT, CRUCIBLE_LEARNING_ROOT: root, CRUCIBLE_SOURCE_QUEUE: queue, NVIDIA_NIM_MODEL: 'test-model' };
  const lines = [];
  await assert.rejects(() => runCli(['readiness'], env, (line) => lines.push(line)), /NVIDIA_NIM_API_KEY/);
  const report = JSON.parse(lines[0]);
  assert.equal(report.ready, false);
  assert.deepEqual(report.missing, ['NVIDIA_NIM_API_KEY']);
  assert.equal(report.provider, 'nvidia-nim');
  assert.equal(report.authorizesPromotion, false);
  // A run without the credential must refuse rather than report zero admitted URLs.
  await assert.rejects(() => runCli(['run', 'JavaScript'], env, () => {}), /requires NVIDIA_NIM_API_KEY/);
});

test('the provider is selectable only from the governed set', async (t) => {
  const { root, queue } = fixture(t);
  const base = { CRUCIBLE_LEARNING_PROJECT_ID: PROJECT, CRUCIBLE_LEARNING_ROOT: root, CRUCIBLE_SOURCE_QUEUE: queue };
  const lines = [];
  await runCli(['init'], { ...base, CRUCIBLE_DISCOVERY_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-x' }, (line) => lines.push(line));
  assert.equal(JSON.parse(lines[0]).provider, 'openai');
  await assert.rejects(() => runCli(['init'], { ...base, CRUCIBLE_DISCOVERY_PROVIDER: 'free-llm-of-the-week' }, () => {}), /Unknown AI provider/);
});

test('the CLI run path registers real candidates and reports them without authorizing promotion', async (t) => {
  const { root, queue } = fixture(t);
  const env = { CRUCIBLE_LEARNING_PROJECT_ID: PROJECT, CRUCIBLE_LEARNING_ROOT: root, CRUCIBLE_SOURCE_QUEUE: queue, NVIDIA_NIM_API_KEY: 'test-key', NVIDIA_NIM_MODEL: 'test-model' };
  const client = { search: async () => ({ citations: ['https://nist.gov/guide', 'https://example.com/blog'], searchedAt: '2026-09-14T12:00:00.000Z', provider: 'nvidia-nim', providerKind: MODEL_POINTER_PROVIDER_KIND, model: 'test-model', promptSha256: HASH, responseSha256: HASH }) };
  const lines = [];
  await runCli(['run', 'JavaScript'], env, (line) => lines.push(line), { client });
  const report = JSON.parse(lines[0]);
  assert.equal(report.overallState, 'completed');
  assert.equal(report.provider, 'nvidia-nim');
  assert.equal(report.providerKind, MODEL_POINTER_PROVIDER_KIND);
  assert.deepEqual({ cited: report.cited, admitted: report.admitted, rejected: report.rejected, novel: report.novel }, { cited: 2, admitted: 1, rejected: 1, novel: 1 });
  assert.equal(report.outcomes[0].candidateIds.length, 1);
  assert.equal(report.authorizesPromotion, false);
});
