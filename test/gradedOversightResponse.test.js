const test = require('node:test');
const assert = require('node:assert/strict');
const { IMMEDIATE, recordFinding, assessFinding, repairOutcome, healthSignal } = require('../src/gradedOversightResponse');

const ordinary = () => recordFinding({ kind: 'stale-lock', organ: 'digestive', boundary: 'claim extraction queue', detail: 'a worker holds an extraction lock past the staleness floor', observedAt: '2026-09-01T00:00:00.000Z' });
const critical = () => recordFinding({ kind: 'boundary-breach', organ: 'immune', boundary: 'host isolation', detail: 'an execution host outside the opt-in list was reached', observedAt: '2026-09-01T00:00:00.000Z' });

test('an ordinary fault gets exactly one bounded, reversible, independently verified attempt', () => {
  const decision = assessFinding({ finding: ordinary() });
  assert.equal(decision.repairAllowed, true);
  assert.equal(decision.requestedOfOversight, 'permit-bounded-repair');
  assert.deepEqual(decision.bounds, { organ: 'digestive', boundary: 'claim extraction queue', reversible: true, mustBeIndependentlyVerified: true, attempts: 1 });
  assert.equal(decision.decidesStop, false, 'Crucible requests; oversight decides');
});

// Waiting is itself the harm.
test('a critical finding gets no repair window, and nothing here can grant one', () => {
  for (const kind of Object.keys(IMMEDIATE)) {
    const finding = recordFinding({ kind, organ: 'immune', boundary: 'b', detail: 'd' });
    assert.equal(finding.immediate, true);
    const decision = assessFinding({ finding });
    assert.equal(decision.repairAllowed, false, `${kind} must never buy a repair window`);
    assert.equal(decision.escalate, true);
    assert.equal(decision.requestedOfOversight, 'STOP');
    assert.match(decision.reason, /waiting for a repair is itself the harm/);
  }
});

// "We fixed it and checked ourselves" is not evidence.
test('an unverified repair is a failed repair, not a pending one', () => {
  const finding = ordinary();
  const history = [{ findingId: finding.findingId, attempted: true, independentlyVerified: null }];
  const decision = assessFinding({ finding, history });
  assert.equal(decision.repairAllowed, false);
  assert.equal(decision.escalate, true);
  assert.match(decision.reason, /never independently verified/);
});

test('Crucible cannot mark its own repair verified', () => {
  const finding = ordinary();
  const self = repairOutcome({ finding, attempted: true, result: { organ: 'digestive', boundary: 'claim extraction queue' }, independentVerification: { verifierId: 'crucible-self', passed: true } });
  assert.equal(self.independentlyVerified, null, 'a verifier that is the organism itself verifies nothing');
  assert.equal(self.requestedOfOversight, 'STOP');
  assert.equal(self.complianceRestored, 'oversight-decides');

  const independent = repairOutcome({ finding, attempted: true, result: { organ: 'digestive', boundary: 'claim extraction queue' }, independentVerification: { verifierId: 'oversight-verifier', passed: true } });
  assert.equal(independent.independentlyVerified, true);
  assert.equal(independent.requestedOfOversight, 'independent-verification-of-recovery');
  assert.equal(independent.decidesStop, false, 'even a verified repair does not clear anything on its own');
});

test('a repair that escapes its bounds escalates however well it went', () => {
  const finding = ordinary();
  const strayed = repairOutcome({ finding, attempted: true, result: { organ: 'learning', boundary: 'claim extraction queue' }, independentVerification: { verifierId: 'oversight-verifier', passed: true } });
  assert.equal(strayed.escapedScope, true);
  assert.equal(strayed.requestedOfOversight, 'STOP');
});

test('a fault that returns after a repair escalates rather than buying another window', () => {
  const finding = ordinary();
  const history = [{ findingId: finding.findingId, attempted: true, independentlyVerified: true }];
  const decision = assessFinding({ finding, history });
  assert.equal(decision.repairAllowed, false);
  assert.equal(decision.attemptsUsed, 1);
  assert.match(decision.reason, /a repair that does not hold is a different problem/);
});

// The finding survives the repair that fixed it.
test('the finding is recorded before anything is attempted and cannot be hidden by success', () => {
  const finding = ordinary();
  const outcome = repairOutcome({ finding, attempted: true, result: { organ: 'digestive', boundary: 'claim extraction queue' }, independentVerification: { verifierId: 'oversight-verifier', passed: true } });
  assert.deepEqual(outcome.finding, finding, 'the original finding travels with the outcome');
  assert.equal(outcome.findingId, finding.findingId);
  assert.equal(recordFinding({ kind: 'stale-lock', organ: 'digestive', boundary: 'claim extraction queue', detail: 'worded differently entirely' }).findingId, finding.findingId, 'the same fault is recognisably the same fault');
});

test('an already-inhibited organism is not offered a repair before a stop that already happened', () => {
  const decision = assessFinding({ finding: ordinary(), health: { state: 'inhibited' } });
  assert.equal(decision.repairAllowed, false);
  assert.equal(decision.escalate, false);
  assert.match(decision.reason, /already inhibited/);
});

test('live health travels on the bus as an observation, never as evidence', () => {
  const view = { state: 'degraded', oversight: { state: 'CLEAR' }, organs: { immune: { state: 'degraded', missingDependency: 'verifier unavailable' } }, exactMissingDependencies: [{ organ: 'immune', dependency: 'verifier unavailable' }], observedAt: '2026-09-01T00:00:00.000Z' };
  const signal = healthSignal({ projectId: 'p', health: view });
  assert.equal(signal.type, 'health');
  assert.equal(signal.isEvidence, false, 'the organism reporting its own condition is not a claim about the world');
  assert.equal(signal.decidesStop, false);
  assert.equal(signal.payload.exactMissingDependencies[0].dependency, 'verifier unavailable', 'the exact missing dependency travels, not just a state word');
  assert.match(signal.payloadSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => healthSignal({ projectId: 'p', health: null }), /continuous health view is required/);
});
