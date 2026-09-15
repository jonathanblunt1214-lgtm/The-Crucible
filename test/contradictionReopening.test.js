const test = require('node:test');
const assert = require('node:assert/strict');
const { contradictionQuarantines, reopeningOrder, reopenContradictions } = require('../src/contradictionReopening');

const BOUNDARY = 'Node.js ordinary dense arrays of numbers';
const INCUMBENT = 'The map method returns a new array and does not modify the original array.';
const CHALLENGE = 'The map method returns a new array and does modify the original array.';
const ACTIVE = { version: 4, claim: INCUMBENT, boundary: BOUNDARY, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' };

const held = (id, claim, sourceId, at, reason) => ({
  state: 'quarantined',
  candidate: { id, claim, claimBoundary: BOUNDARY, provenance: { sourceId, retrievedAt: at, contentSha256: 'a'.repeat(64) } },
  history: [{ from: 'candidate', to: 'quarantined', at, reason }],
});
const candidate = (id, claim, sourceId, at) => ({
  state: 'candidate',
  candidate: { id, claim, claimBoundary: BOUNDARY, provenance: { sourceId, retrievedAt: at, contentSha256: 'b'.repeat(64) } },
});

test('only quarantines that came from contradiction are reopened', () => {
  const records = [
    held('q1', CHALLENGE, 'https://c.example/x', '2026-02-01T00:00:00.000Z', 'contradiction with knowledge version 4'),
    held('q2', CHALLENGE, 'https://d.example/x', '2026-03-01T00:00:00.000Z', 'prompt-injection pattern quarantined on retrieval'),
    held('q3', CHALLENGE, 'https://e.example/x', '2026-01-15T00:00:00.000Z', 'contradiction with knowledge version 4'),
    candidate('c1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'),
  ];
  const found = contradictionQuarantines(records);
  assert.deepEqual(found.map((item) => item.candidateId).sort(), ['q1', 'q3'], 'an injection quarantine is not a contradiction quarantine');
  assert.equal(found[0].againstVersion, 4);
});

// The priority, and why it is not a courtesy.
test('reopened contradictions precede every piece of new work, oldest first', () => {
  const quarantines = contradictionQuarantines([
    held('q-late', CHALLENGE, 'https://c.example/x', '2026-06-01T00:00:00.000Z', 'contradiction with knowledge version 4'),
    held('q-early', CHALLENGE, 'https://d.example/x', '2026-01-15T00:00:00.000Z', 'contradiction with knowledge version 4'),
  ]);
  const order = reopeningOrder(quarantines, [{ candidateId: 'new-1' }, { candidateId: 'new-2' }]);
  assert.deepEqual(order.map((item) => item.candidateId), ['q-early', 'q-late', 'new-1', 'new-2']);
  assert.deepEqual(order.map((item) => item.priority), ['reopened-contradiction', 'reopened-contradiction', 'new', 'new']);
  assert.deepEqual(order.map((item) => item.position), [1, 2, 3, 4]);
  assert.deepEqual(reopeningOrder([...quarantines].reverse(), [{ candidateId: 'new-1' }, { candidateId: 'new-2' }]).map((item) => item.candidateId), ['q-early', 'q-late', 'new-1', 'new-2'], 'the order is deterministic');
});

// The property that keeps this from being the original mistake in reverse.
test('reopening audits but never clears, promotes, or reverses anything', () => {
  const records = [
    held('q1', CHALLENGE, 'https://c.example/x', '2026-02-01T00:00:00.000Z', 'contradiction with knowledge version 4'),
    held('q2', CHALLENGE, 'https://d.example/x', '2026-02-02T00:00:00.000Z', 'contradiction with knowledge version 4'),
    candidate('c1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'),
    candidate('c2', INCUMBENT, 'https://b.example/x', '2026-01-02T00:00:00.000Z'),
  ];
  const result = reopenContradictions({ records, activeKnowledge: [ACTIVE] });

  assert.equal(result.reopened, 2);
  assert.equal(result.stillQuarantined, 2, 'looking again does not release anything');
  assert.equal(result.promotionAuthorized, false);
  for (const audit of result.audits) {
    assert.equal(audit.quarantineCleared, false);
    assert.equal(audit.promotionAuthorized, false);
    assert.equal(audit.audited, true);
    assert.ok(audit.route, 'each reopened record gets a route from the audit');
    assert.ok(audit.leadingResolutions.length, 'and the ways it could resolve');
  }
});

test('a quarantine with no surviving contradiction returns as ordinary evidence', () => {
  const elsewhere = { version: 7, claim: INCUMBENT, boundary: 'a different boundary entirely', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' };
  const records = [held('q1', CHALLENGE, 'https://c.example/x', '2026-02-01T00:00:00.000Z', 'contradiction with knowledge version 9')];
  const result = reopenContradictions({ records, activeKnowledge: [elsewhere] });
  const [audit] = result.audits;
  assert.equal(audit.audited, false);
  assert.match(audit.reason, /no longer active/);
  assert.equal(audit.route, 'return-to-candidate-evaluation');
  assert.equal(audit.promotionAuthorized, false);
});

// The incumbent may have moved on while this sat in quarantine.
test('a quarantine is audited against whatever stands now, and says the incumbent changed', () => {
  const records = [
    held('q1', CHALLENGE, 'https://c.example/x', '2026-02-01T00:00:00.000Z', 'contradiction with knowledge version 9'),
    candidate('c1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'),
  ];
  const result = reopenContradictions({ records, activeKnowledge: [ACTIVE] });
  const [audit] = result.audits;
  assert.equal(audit.audited, true, 'version 9 is gone but version 4 still contradicts it');
  assert.equal(audit.againstVersion, 4);
  assert.equal(audit.incumbentChangedSinceQuarantine, true);
  assert.equal(audit.quarantineCleared, false);
});

test('nothing to reopen is reported plainly, and new work starts first', () => {
  const result = reopenContradictions({ records: [candidate('c1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z')], activeKnowledge: [ACTIVE], newWork: [{ candidateId: 'new-1' }] });
  assert.equal(result.reopened, 0);
  assert.equal(result.newWorkBeginsAt, 1);
  assert.deepEqual(result.order.map((item) => item.priority), ['new']);
});
