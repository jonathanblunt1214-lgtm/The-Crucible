const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DurableScientificLearningStore } = require('../src/scientificLearning');
const { RECORDABLE, repairExperience, recordRepairEvidence, repairLearningRecorder } = require('../src/repairEvidence');
const { validateExperience } = require('../src/learningExperience');

const PROJECT = 'github:owner/repo';
const AT = '2026-09-01T00:00:00.000Z';

// A path-traversal finding rather than a command-execution one: the Security Gate reads
// literal exec-shaped strings in a fixture as dynamic code execution, and it is right to.
const FINDING = { kind: 'unvalidated-path-join', language: 'javascript', boundary: 'Node.js filesystem path resolution', file: 'src/thing.js', baseSha256: 'a'.repeat(64) };
const PLAN = { file: 'src/thing.js', baseSha256: 'a'.repeat(64), before: 'join(root, userInput)', after: 'resolveWithinRoot(root, userInput)', dependencies: [{ file: 'src/other.js', sha256: 'b'.repeat(64) }], reversibleChange: { beforeSha256: 'c'.repeat(64), afterSha256: 'd'.repeat(64) } };
const VERIFIED = { state: 'verified', applied: { resultSha256: 'e'.repeat(64), rollbackToken: 'rollback-1' } };

function store(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new DurableScientificLearningStore({ root, projectId: PROJECT });
}

test('a verified repair becomes a valid experience about the construct, not about the repair', () => {
  const experience = repairExperience({ projectId: PROJECT, finding: FINDING, plan: PLAN, result: VERIFIED, observedAt: AT });
  assert.doesNotThrow(() => validateExperience(experience), 'the learning store accepts it as it stands');
  assert.equal(experience.outcome, 'succeeded');
  assert.match(experience.boundedClaim, /In javascript/);
  assert.match(experience.boundedClaim, /unvalidated-path-join/);
  assert.ok(!/repair \w+ fixed/i.test(experience.boundedClaim), 'the claim is about the construct, not about this project history');
  assert.match(experience.generalizationBoundary, /Observed once in src\/thing\.js/);
  assert.match(experience.generalizationBoundary, /not generalized/);
});

// Evidence that a change did not hold is worth as much as evidence that it did.
test('a rolled-back repair is recorded as a failure rather than discarded', () => {
  const experience = repairExperience({ projectId: PROJECT, finding: FINDING, plan: PLAN, result: { state: 'rolled-back', applied: { resultSha256: 'f'.repeat(64) } }, observedAt: AT });
  assert.equal(experience.outcome, 'failed');
  assert.match(experience.boundedClaim, /does not survive independent verification/);
  assert.doesNotThrow(() => validateExperience(experience));
});

test('a repair that never ran observed nothing and is not evidence', (t) => {
  for (const state of ['inhibited', 'blocked', 'unknown']) {
    assert.equal(repairExperience({ projectId: PROJECT, finding: FINDING, plan: PLAN, result: { state }, observedAt: AT }), null);
    const outcome = recordRepairEvidence({ store: store(t), projectId: PROJECT, finding: FINDING, plan: PLAN, result: { state }, now: () => AT });
    assert.equal(outcome.recorded, false);
    assert.match(outcome.reason, /observed nothing/);
  }
  assert.deepEqual(Object.keys(RECORDABLE).sort(), ['rolled-back', 'verified']);
});

// The property that makes this pathway safe to have at all.
test('a repair enters custody as evidence and never as knowledge', (t) => {
  const durable = store(t);
  const outcome = recordRepairEvidence({ store: durable, projectId: PROJECT, finding: FINDING, plan: PLAN, result: VERIFIED, now: () => AT });

  assert.equal(outcome.recorded, true);
  assert.equal(outcome.classification, 'Insufficient Evidence');
  assert.equal(outcome.proofStageSatisfied, false);
  assert.equal(outcome.independentVerificationSatisfied, false);
  assert.equal(outcome.promotionAuthorized, false);

  const payload = durable.read();
  assert.equal(payload.knowledgeVersions.length, 0, 'a working repair promotes nothing');
  const record = payload.candidateRecords.find((item) => item.candidate.id === outcome.candidateId);
  assert.equal(record.state, 'candidate', 'it waits in candidate custody like any other evidence');
  assert.equal(record.candidate.provenance.sourceType, 'bounded-task-experience');
  assert.equal(record.candidate.classification, 'Insufficient Evidence');
});

test('the same repair recorded twice does not become two observations', (t) => {
  const durable = store(t);
  const first = recordRepairEvidence({ store: durable, projectId: PROJECT, finding: FINDING, plan: PLAN, result: VERIFIED, now: () => AT });
  const second = recordRepairEvidence({ store: durable, projectId: PROJECT, finding: FINDING, plan: PLAN, result: VERIFIED, now: () => AT });
  assert.equal(first.candidateId, second.candidateId, 'the attempt id is content-addressed over the finding, plan and outcome');
  assert.equal(first.alreadyInCustody, false);
  assert.equal(second.alreadyInCustody, true, 'the second is reported as already held, not as a failure');
  assert.match(second.reason, /not evidence twice/);
  assert.equal(second.promotionAuthorized, false);
  assert.equal(durable.read().candidateRecords.filter((item) => item.candidate.id === first.candidateId).length, 1);
});

test('the recorder the organism is wired with refuses anything marked promotable', (t) => {
  const recorder = repairLearningRecorder({ store: store(t), projectId: PROJECT, now: () => AT });
  assert.rejects(() => recorder({ promotable: true, record: { finding: FINDING, plan: PLAN, state: 'verified' } }), /Only non-promotable/);
});

test('the wired recorder records a real repair and reports one that carried nothing to observe', async (t) => {
  const durable = store(t);
  const recorder = repairLearningRecorder({ store: durable, projectId: PROJECT, now: () => AT });

  const recorded = await recorder({ promotable: false, record: { ...VERIFIED, finding: FINDING, plan: PLAN } });
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.promotionAuthorized, false);
  assert.equal(durable.read().candidateRecords.length, 1);

  const empty = await recorder({ promotable: false, record: { state: 'verified' } });
  assert.equal(empty.recorded, false);
  assert.match(empty.reason, /no finding and plan/);
});
