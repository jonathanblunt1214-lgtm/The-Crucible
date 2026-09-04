const test = require('node:test');
const assert = require('node:assert/strict');
const { preSoakReadiness, evaluateR2, evaluateR3, evaluateR4, evaluateR5, evaluateR6, evaluateR7, evaluateR8 } = require('../src/preSoakReadiness');

const sha = 'a'.repeat(64);
const candidate = (id, provenance = { sourceId: 'src-1', retrievedAt: '2026-09-01T00:00:00.000Z', contentSha256: sha }) => ({ candidate: { id, provenance } });
const ALL_EIGHT = ['kill-switch', 'duplicate-url', 'duplicate-content-hash', 'duplicate-claim', 'prompt-injection', 'executable-content', 'blocked-source', 'contradiction-quarantine'];

const everythingDone = () => ({
  payload: {
    candidateRecords: [candidate('c-1')],
    knowledgeVersions: [
      { version: 'v-1', boundary: 'node-22/linux/test-y', status: 'rolled-back', rollback: { at: '2026-09-02T00:00:00.000Z', reason: 'superseded by v-2' } },
      { version: 'v-2', boundary: 'node-22/linux/test-y', status: 'active' },
    ],
    activeVersion: 'v-2',
  },
  queue: { documents: [], links: [{ id: 's-1', state: 'claim-extraction-complete' }] },
  research: { topics: [{ topic: 'node', runs: 1 }], discoveredUrls: ['https://example.edu/a'] },
  combinedSafetyEvidence: ALL_EIGHT,
});

test('R2 tracks the live drain and does not claim the restart proof it does not own', () => {
  assert.equal(evaluateR2({ links: [{ id: 's-1', state: 'claim-extraction-forced-pending' }] }).state, 'pending');
  const done = evaluateR2({ links: [{ id: 's-1', state: 'claim-extraction-complete' }] });
  assert.equal(done.state, 'satisfied');
  assert.match(done.detail, /durableLock\.test\.js/);
  assert.equal(evaluateR2({}).state, 'unknown', 'an absent queue is unknown, never satisfied');
});

test('R3 requires a recorded bounded run, not merely a registered topic', () => {
  assert.equal(evaluateR3({}).state, 'pending');
  assert.equal(evaluateR3({ topics: [{ topic: 'node', runs: 0 }] }).state, 'pending');
  assert.equal(evaluateR3({ topics: [{ topic: 'node', runs: 2 }], discoveredUrls: [] }).state, 'satisfied');
});

test('R4 requires a complete provenance chain, not merely a candidate record', () => {
  assert.equal(evaluateR4({ candidateRecords: [] }).state, 'pending');
  assert.equal(evaluateR4({ candidateRecords: [candidate('c-1', { sourceId: 'src-1', retrievedAt: '2026-09-01T00:00:00.000Z', contentSha256: 'not-a-hash' })] }).state, 'pending');
  assert.equal(evaluateR4({ candidateRecords: [candidate('c-1')] }).state, 'satisfied');
});

test('R5 is the linchpin and reads pending while there is no verified version', () => {
  const pending = evaluateR5({ knowledgeVersions: [] });
  assert.equal(pending.state, 'pending');
  assert.match(pending.detail, /zero verified knowledge versions/);
  assert.equal(evaluateR5({ knowledgeVersions: [{ version: 'v-1' }] }).state, 'satisfied');
});

test('R6 requires the active pointer to actually resolve to a stored version', () => {
  assert.equal(evaluateR6({ activeVersion: null }).state, 'pending');
  assert.equal(evaluateR6({ activeVersion: 'v-9', knowledgeVersions: [{ version: 'v-1' }] }).state, 'pending');
  assert.equal(evaluateR6({ activeVersion: 'v-1', knowledgeVersions: [{ version: 'v-1', boundary: 'b' }] }).state, 'satisfied');
});

test('R7 requires a real rollback or supersession record', () => {
  assert.equal(evaluateR7({ knowledgeVersions: [] }).state, 'pending');
  assert.equal(evaluateR7({ knowledgeVersions: [{ version: 'v-1', status: 'active' }] }).state, 'pending');
  assert.equal(evaluateR7({ knowledgeVersions: [{ version: 'v-1', status: 'rolled-back' }] }).state, 'satisfied');
});

test('R8 says it cannot judge the combined cycle rather than inferring it from unit coverage', () => {
  const unknown = evaluateR8(null);
  assert.equal(unknown.state, 'manual-evidence-required');
  assert.notEqual(unknown.state, 'satisfied', 'unit proof of the behaviours is not proof of the combined run');
  assert.equal(evaluateR8(ALL_EIGHT.slice(0, 7)).state, 'pending');
  assert.equal(evaluateR8(ALL_EIGHT).state, 'satisfied');
});

test('reports the whole picture and holds the soak while anything is outstanding', () => {
  const report = preSoakReadiness({ payload: { candidateRecords: [], knowledgeVersions: [], activeVersion: null }, queue: { links: [{ id: 's-1', state: 'claim-extraction-forced-pending' }] }, research: {} });
  assert.equal(report.gatesGreen, false);
  assert.deepEqual(report.outstanding, ['R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  assert.equal(report.soak.state, 'held');
  assert.match(report.soak.blockers.join(' '), /R2-R8 are not simultaneously green/);
  assert.equal(report.authorizesPromotion, false);
});

test('only lets the soak read ready once every gate is genuinely satisfied', () => {
  const report = preSoakReadiness(everythingDone());
  assert.deepEqual(report.outstanding, []);
  assert.equal(report.gatesGreen, true);
  assert.equal(report.soak.state, 'ready');
  assert.equal(report.authorizesPromotion, false, 'readiness reporting never authorizes anything');
});

test('one unsatisfied gate is enough to keep the soak held', () => {
  for (const breakOne of [
    (input) => { input.research = {}; },
    (input) => { input.payload.knowledgeVersions = []; input.payload.activeVersion = null; },
    (input) => { input.combinedSafetyEvidence = null; },
    (input) => { input.queue.links = [{ id: 's-1', state: 'claim-extraction-forced-pending' }]; },
  ]) {
    const input = everythingDone();
    breakOne(input);
    const report = preSoakReadiness(input);
    assert.equal(report.gatesGreen, false);
    assert.equal(report.soak.state, 'held');
  }
});

// The report said ready and then could not start the soak it had just approved: the projection
// dropped the observed population that startSoak freezes its window from, so the success path threw
// a TypeError while the held path, which never reaches that line, looked fine.
test('a ready pre-soak decision can actually start a soak', () => {
  const { startSoak } = require('../src/soakRun');
  const report = preSoakReadiness(everythingDone());
  assert.equal(report.soak.state, 'ready');
  assert.ok(Array.isArray(report.soak.observed), 'the decision carries the population it was made about');
  const soak = startSoak({ readiness: report.soak, at: '2026-09-01T00:00:00.000Z', hours: 72 });
  // One knowledge version plus one candidate record, frozen at the start.
  assert.equal(soak.dataPoints.length, report.soak.observedDataPoints);
  assert.deepEqual(soak.dataPoints.map((item) => item.id), report.soak.observed.map((item) => item.id));
  assert.equal(soak.failed, false);
});
