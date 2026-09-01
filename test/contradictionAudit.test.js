const test = require('node:test');
const assert = require('node:assert/strict');
const { RESOLUTIONS, weigh, discriminator, auditContradiction } = require('../src/contradictionAudit');
const { sourceIndex } = require('../src/sourceIndependence');

const BOUNDARY = 'Node.js ordinary dense arrays of numbers';
const INCUMBENT = 'The map method returns a new array and does not modify the original array.';
const CHALLENGE = 'The map method returns a new array and does modify the original array.';

const ACTIVE = { version: 1, claim: INCUMBENT, boundary: BOUNDARY, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' };

const record = (id, claim, sourceId, retrievedAt, extra = {}) => ({
  state: 'candidate',
  candidate: { id, claim, claimBoundary: BOUNDARY, provenance: { sourceId, retrievedAt, contentSha256: id.repeat(4).padEnd(64, '0').slice(0, 64), ...extra } },
});

const bundleOf = (sources) => ({ sources });

test('the audit assembles everything held, and discards nothing from either side', () => {
  const records = [
    record('a1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'),
    record('b1', INCUMBENT, 'https://b.example/x', '2026-01-02T00:00:00.000Z'),
    record('c1', CHALLENGE, 'https://c.example/x', '2026-06-01T00:00:00.000Z'),
    record('d1', CHALLENGE, 'https://d.example/x', '2026-06-02T00:00:00.000Z'),
    record('e1', 'Array iteration order is defined by index ascending for dense arrays here.', 'https://e.example/x', '2026-03-01T00:00:00.000Z'),
  ];
  const audit = auditContradiction({ records, activeVersion: ACTIVE, challengeClaim: CHALLENGE });
  assert.equal(audit.intel.supporting.records, 2);
  assert.equal(audit.intel.challenging.records, 2);
  assert.equal(audit.intel.relatedHeld, 1, 'evidence about the same boundary that backs neither side is still held and shown');
  assert.equal(audit.intel.discarded, 0);
  assert.equal(audit.promotionAuthorized, false);
  assert.equal(audit.proofStageSatisfied, false);
});

// The property that keeps this from becoming a vote.
test('source counts prioritise investigation and never authorise a conclusion', () => {
  const many = Array.from({ length: 9 }, (unused, i) => record(`x${i}`, CHALLENGE, `https://s${i}.example/x`, '2026-06-01T00:00:00.000Z'));
  const audit = auditContradiction({
    records: [record('a1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'), record('b1', INCUMBENT, 'https://b.example/x', '2026-01-02T00:00:00.000Z'), ...many],
    activeVersion: ACTIVE,
    challengeClaim: CHALLENGE,
  });
  assert.equal(audit.intel.challenging.independentSources, 9);
  assert.equal(audit.intel.challenging.authorises, false, 'nine agreeing sources still authorise nothing');
  assert.equal(audit.promotionAuthorized, false);
  assert.ok(!/wins|true|correct/i.test(audit.route), 'the route is an action, never a verdict');
  assert.ok(audit.resolutions.some((item) => item.id === 'challenge-wrong' && item.leading), 'the possibility that the majority is wrong stays on the table');
});

// The discriminator this repository already has code for.
test('a challenge whose sources are not independent leads with shared upstream error', () => {
  const records = [
    record('a1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'),
    record('b1', INCUMBENT, 'https://b.example/x', '2026-01-02T00:00:00.000Z'),
    record('c1', CHALLENGE, 'https://one.example/page-a', '2026-06-01T00:00:00.000Z'),
    record('d1', CHALLENGE, 'https://one.example/page-b', '2026-06-02T00:00:00.000Z'),
  ];
  const bundle = bundleOf([
    { id: 'https://one.example/page-a', finalUrl: 'https://one.example/page-a', contentSha256: 'aa', author: 'One Writer' },
    { id: 'https://one.example/page-b', finalUrl: 'https://one.example/page-b', contentSha256: 'bb', author: 'One Writer' },
    { id: 'https://a.example/x', finalUrl: 'https://a.example/x', contentSha256: 'cc', author: 'A' },
    { id: 'https://b.example/x', finalUrl: 'https://b.example/x', contentSha256: 'dd', author: 'B' },
  ]);
  const audit = auditContradiction({ records, activeVersion: ACTIVE, challengeClaim: CHALLENGE, bundle });
  assert.equal(audit.intel.challenging.independentSources, 1, 'two pages of one publisher by one author are one source');
  assert.ok(audit.leadingResolutions.includes('shared-upstream-error'));
  assert.equal(audit.route, 'hold-challenge-pending-independent-corroboration');
  assert.equal(audit.perspective, null, 'no perspective is proposed on evidence that is not independent');
});

// "A new perspective with all available intel" - grounded in the data, offered as a hypothesis.
test('proposes a reconciling perspective only when the data itself shows a difference', () => {
  const records = [
    record('a1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'),
    record('b1', INCUMBENT, 'https://b.example/x', '2026-01-02T00:00:00.000Z'),
    record('c1', CHALLENGE, 'https://c.example/x', '2026-06-01T00:00:00.000Z'),
    record('d1', CHALLENGE, 'https://d.example/x', '2026-06-02T00:00:00.000Z'),
  ];
  const audit = auditContradiction({ records, activeVersion: ACTIVE, challengeClaim: CHALLENGE });
  assert.ok(audit.perspective, 'both sides independently backed, and every challenger is newer than every incumbent');
  assert.match(audit.perspective.hypothesis, /within narrower scopes/);
  assert.match(audit.perspective.groundedIn, /retrieved after/);
  assert.equal(audit.perspective.classification, 'Insufficient Evidence');
  assert.equal(audit.perspective.proofStageSatisfied, false);
  assert.equal(audit.perspective.requiresOwnerDeclaredScopes, true, 'the narrowed scopes are declared by the owner, never inferred');
  assert.equal(audit.route, 'propose-narrowed-scopes-for-owner-declaration');
});

test('no perspective is invented when the evidence shows no difference to ground one', () => {
  const interleaved = [
    record('a1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z'),
    record('b1', INCUMBENT, 'https://b.example/x', '2026-07-01T00:00:00.000Z'),
    record('c1', CHALLENGE, 'https://c.example/x', '2026-03-01T00:00:00.000Z'),
    record('d1', CHALLENGE, 'https://d.example/x', '2026-04-01T00:00:00.000Z'),
  ];
  const audit = auditContradiction({ records: interleaved, activeVersion: ACTIVE, challengeClaim: CHALLENGE });
  assert.equal(audit.difference, null, 'the retrieval windows overlap, so nothing recorded separates the two bodies');
  assert.equal(audit.perspective, null);
  assert.equal(audit.route, 'controlled-retest-within-the-same-boundary');
  assert.ok(audit.resolutions.every((item) => typeof item.settledBy === 'string' && item.settledBy.trim()), 'every resolution says what would settle it');
});

test('every resolution stays enumerated, including the ones not currently leading', () => {
  const audit = auditContradiction({
    records: [record('a1', INCUMBENT, 'https://a.example/x', '2026-01-01T00:00:00.000Z')],
    activeVersion: ACTIVE,
    challengeClaim: CHALLENGE,
  });
  assert.equal(audit.resolutions.length, RESOLUTIONS.length, 'the audit never narrows the possibilities away');
  assert.ok(audit.leadingResolutions.includes('undecidable-on-available-evidence'));
  assert.equal(audit.route, 'hold-challenge-pending-independent-corroboration');
  assert.equal(audit.classification, 'Crucible Issue');
});

test('the audit refuses to run on inputs it cannot audit', () => {
  assert.throws(() => auditContradiction({ records: [], activeVersion: null, challengeClaim: CHALLENGE }), /requires the active verified version/);
  assert.throws(() => auditContradiction({ records: [], activeVersion: ACTIVE, challengeClaim: '  ' }), /requires the contradicting claim/);
});
