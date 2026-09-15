const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MAX_REFRESH_INTERVAL_MS, MonthlyKnowledgeRefreshStore, MonthlyKnowledgeRefresher } = require('../src/monthlyKnowledgeRefresh');

function fixture(now = '2026-08-30T20:00:00.000Z') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-refresh-'));
  return { root, store:new MonthlyKnowledgeRefreshStore(root, 'repo:the-crucible', { now:() => now }) };
}

const bounded = { claim:'Array.prototype.map returns a new array.', claimBoundary:'ECMAScript Array map on ordinary arrays.', generalizationBoundary:'Does not assert behavior for arbitrary array-like host objects.' };
const retrieval = { finalUrl:'https://example.org/reference', retrievedAt:'2026-08-30T20:00:00.000Z', author:'Example Standards Group', license:'terms recorded; redistribution not assumed', contentSha256:'a'.repeat(64) };

test('logged URLs are unique and immediately due for a refresh', () => {
  const { store } = fixture();
  const first = store.register('https://example.org/reference#section');
  const duplicate = store.register('https://example.org/reference');
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(store.due().length, 1);
});

test('a completed refresh is due again within exactly 30 days', () => {
  const { store } = fixture();
  const { source } = store.register(retrieval.finalUrl);
  const result = store.recordRetrieval(source.id, retrieval, []);
  assert.equal(Date.parse(result.nextCheckAt) - Date.parse(retrieval.retrievedAt), MAX_REFRESH_INTERVAL_MS);
  assert.equal(store.due('2026-09-29T19:59:59.999Z').length, 0);
  assert.equal(store.due('2026-09-29T20:00:00.000Z').length, 1);
});

test('unchanged or historically seen content never emits duplicate candidate evidence', () => {
  const { store } = fixture();
  const { source } = store.register(retrieval.finalUrl);
  assert.equal(store.recordRetrieval(source.id, retrieval, [bounded, bounded]).candidateClaims.length, 1);
  const later = { ...retrieval, retrievedAt:'2026-09-29T20:00:00.000Z' };
  assert.deepEqual(store.recordRetrieval(source.id, later, [bounded]).candidateClaims, []);
  assert.equal(store.read().sources[0].contentRevisions.length, 1);
});

test('new content emits only novel bounded claims and never verified knowledge', () => {
  const { store } = fixture();
  const { source } = store.register(retrieval.finalUrl);
  store.recordRetrieval(source.id, retrieval, [bounded]);
  store.markClaimsLearned(source.id, [bounded]);
  const novel = { claim:'Promise callbacks run as jobs after the current stack.', claimBoundary:'ECMAScript promise reaction jobs.', generalizationBoundary:'Does not claim a browser rendering schedule.' };
  const result = store.recordRetrieval(source.id, { ...retrieval, retrievedAt:'2026-09-29T20:00:00.000Z', contentSha256:'b'.repeat(64) }, [bounded, novel]);
  assert.equal(result.candidateClaims.length, 1);
  assert.equal(result.candidateClaims[0].claim, novel.claim);
  assert.equal(result.candidateClaims[0].classification, 'Insufficient Evidence');
  assert.equal(result.candidateClaims[0].state, 'candidate-evidence');
  assert.equal('verified' in result.candidateClaims[0], false);
});

test('a claim already emitted as a candidate is not emitted again before promotion', () => {
  const { store } = fixture();
  const { source } = store.register(retrieval.finalUrl);
  store.recordRetrieval(source.id, retrieval, [bounded]);
  const changed = store.recordRetrieval(source.id, { ...retrieval, retrievedAt:'2026-09-29T20:00:00.000Z', contentSha256:'c'.repeat(64) }, [bounded]);
  assert.deepEqual(changed.candidateClaims, []);
});

test('store integrity and repository identity fail closed', () => {
  const { root, store } = fixture();
  store.register(retrieval.finalUrl);
  const file = path.join(root, 'monthly-source-refresh.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.payload.projectId = 'repo:other';
  fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(() => store.read(), /integrity check failed/);
});

test('due refreshes use the governed retriever and never learn blocked or quarantined content', async () => {
  const { store } = fixture();
  store.register(retrieval.finalUrl);
  const retriever = { retrieve:async () => ({ record:retrieval, content:null }) };
  const refresher = new MonthlyKnowledgeRefresher({ store, retriever, extractClaims:async () => { throw new Error('must not extract quarantined content'); } });
  const outcomes = await refresher.runDue();
  assert.equal(outcomes[0].state, 'quarantined');
  assert.deepEqual(outcomes[0].candidateClaims, []);
});

// Atomic rename stops a half-written file being read; it never stopped a lost update. Each mutation
// read the whole snapshot, changed it and replaced the file, so two overlapping mutations both
// succeeded and the later rename silently discarded the earlier one - a registered source, a
// recorded revision or a learned fingerprint simply gone, with nothing reporting it. A write now
// refuses unless the file still holds the snapshot the mutation was computed from.
test('a mutation computed from a stale snapshot is refused rather than silently winning', () => {
  const { root, store } = fixture();
  const registered = store.register('https://example.org/reference');

  // Another writer commits while this one is preparing its change: read the snapshot, let the
  // other mutation land, then try to write the change built from the now-stale revision.
  const stale = store.read();
  const revisionItWasBuiltFrom = store.currentSha256();
  store.register('https://example.org/committed-meanwhile');
  stale.sources.push({ id:'source-lost', url:'https://example.org/third', registeredAt:'2026-08-30T20:00:00.000Z', lastCheckedAt:null, nextCheckAt:'2026-08-30T20:00:00.000Z', contentRevisions:[], learnedClaimFingerprints:[] });
  assert.throws(() => store.write(stale, revisionItWasBuiltFrom), /changed while this update was being prepared/);

  // The other writer's registration survived, which is the whole point.
  assert.deepEqual(store.read().sources.map((source) => source.url).sort(), ['https://example.org/committed-meanwhile', 'https://example.org/reference']);
  // And ordinary sequential mutation is untouched.
  assert.equal(store.markClaimsLearned(registered.source.id, [bounded]).length, 1);
  assert.equal(store.recordRetrieval(registered.source.id, retrieval, [bounded]).state, 'new-content');
  fs.rmSync(root, { recursive:true, force:true });
});

test('the revision a mutation is computed from is the one it must still find', () => {
  const { root, store } = fixture();
  assert.equal(store.currentSha256(), null, 'no file yet is no revision');
  store.register('https://example.org/reference');
  const revision = store.currentSha256();
  assert.match(revision, /^[a-f0-9]{64}$/);
  // An unchanged store accepts a write computed from its current revision.
  const state = store.read();
  state.sources[0].learnedClaimFingerprints = [];
  store.write(state, revision);
  assert.notEqual(store.currentSha256(), null);
  fs.rmSync(root, { recursive:true, force:true });
});
