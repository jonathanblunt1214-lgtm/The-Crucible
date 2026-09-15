const test = require('node:test');
const assert = require('node:assert/strict');
const { IMPEDIMENTS, toLearning, toDiagnostics, intakePathways } = require('../src/intakePathways');

const CLAIM = 'The map method returns a new array and does not modify the original array.';
const FURNITURE = 'Footer navigation Terms Privacy Security Status Community Docs Contact Manage cookies Do not share my personal information You can not perform that action at this time.';

const candidate = (id, claim, sourceId) => ({ state: 'candidate', candidate: { id, claim, provenance: { sourceId } } });
const source = (state, extra = {}) => ({ state, contentSha256: 'a'.repeat(64), durablePath: 'sources/a.txt', ...extra });

test('the learning pathway carries evidence, and says how much of it is usable', () => {
  const learning = toLearning([
    candidate('c-1', CLAIM, 's-1'),
    candidate('c-2', CLAIM, 's-2'),
    candidate('c-3', FURNITURE, 's-1'),
  ]);
  assert.equal(learning.pathway, 'intake-to-learning');
  assert.equal(learning.candidates, 3);
  assert.equal(learning.usableCandidates, 2);
  assert.equal(learning.excludedAsFurniture, 1);
  assert.equal(learning.distinctSources, 2);
  assert.equal(learning.classification, 'Insufficient Evidence', 'everything on this pathway awaits proof');
  assert.equal(learning.promotionAuthorized, false);
});

test('the diagnostic pathway carries health, and is explicitly not evidence', () => {
  const diagnostics = toDiagnostics([
    source('claim-extraction-complete'),
    source('retrieval-blocked'),
    source('retrieval-blocked'),
    source('claim-extraction-in-progress'),
    source('claim-extraction-forced-pending'),
    { state: 'research-approved-pending-retrieval' },
  ]);
  assert.equal(diagnostics.pathway, 'intake-to-diagnostics');
  assert.equal(diagnostics.isEvidence, false, 'digestion health is never a claim about the world');
  assert.equal(diagnostics.promotionAuthorized, false);
  assert.equal(diagnostics.sources, 6);
  assert.equal(diagnostics.states['retrieval-blocked'], 2);

  const named = diagnostics.signals.map((item) => item.signal);
  assert.ok(named.includes('retrieval-blocked'));
  assert.ok(named.includes('undigested-backlog'));
  assert.ok(named.includes('possible-stalled-extraction'), 'a source held in extraction may be a worker that died holding a lock');
  assert.ok(named.includes('sources-without-content'), 'a source with nothing stored can never become evidence');
  assert.equal(diagnostics.healthy, false);
  for (const impediment of diagnostics.impediments) assert.ok(IMPEDIMENTS[impediment.state], 'every impediment says what it means');
});

test('a corpus that is digesting cleanly reports healthy with no signals', () => {
  const diagnostics = toDiagnostics([source('claim-extraction-complete'), source('claim-extraction-complete')]);
  assert.equal(diagnostics.healthy, true);
  assert.deepEqual(diagnostics.signals, []);
  assert.deepEqual(diagnostics.impediments, []);
});

// The failure this separation exists to prevent, and one this repository has already lived
// through: reporting "nothing corroborated" when digestion stopped three steps earlier.
test('an impeded intake is named as the blockage rather than reported as an empty result', () => {
  const stopped = intakePathways({
    sources: [source('retrieval-blocked'), source('claim-extraction-forced-pending')],
    candidateRecords: [],
  });
  assert.match(stopped.blocked, /^intake-to-diagnostics/);
  assert.match(stopped.blocked, /says nothing about the corpus/);

  const digesting = intakePathways({
    sources: [source('claim-extraction-complete')],
    candidateRecords: [],
  });
  assert.match(digesting.blocked, /^intake-to-learning/, 'a healthy intake producing nothing is a different finding');

  const working = intakePathways({
    sources: [source('claim-extraction-complete')],
    candidateRecords: [candidate('c-1', CLAIM, 's-1')],
  });
  assert.equal(working.blocked, null);
  assert.equal(working.promotionAuthorized, false);
});

test('the two pathways are reported separately and never merged', () => {
  const both = intakePathways({ sources: [source('claim-extraction-complete')], candidateRecords: [candidate('c-1', CLAIM, 's-1')] });
  assert.notEqual(both.learning.pathway, both.diagnostics.pathway);
  assert.equal(both.learning.promotionAuthorized, false);
  assert.equal(both.diagnostics.isEvidence, false);
  assert.ok(!('candidates' in both.diagnostics), 'the diagnostic pathway carries no evidence counts');
  assert.ok(!('signals' in both.learning), 'the learning pathway carries no health signals');
});
