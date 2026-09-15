'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateHypothesisTestPlan, hypothesisTestPlanSha256 } = require('../src/hypothesisTestPlan');

const candidate = { claimBoundary:'Node.js 22 on the bounded fixture', generalizationBoundary:'No other runtime, fixture, or version.' };
function plan(overrides={}) {
  return { schemaVersion:1, hypothesis:'Changing only X causes measured Y inside the boundary.', independentVariable:'X intervention', dependentVariable:'measured Y', controlledVariables:['runtime','fixture'], controlCondition:'same fixture without X', positiveControl:'known Y response', negativeControl:'irrelevant intervention does not cause Y', expectedOutcome:'Y changes only with X', falsificationCriterion:'Y fails to change with X or changes without X', measurementMethod:'deterministic assertion', fixtureBoundary:candidate.claimBoundary, claimBoundary:candidate.claimBoundary, experimentBoundary:candidate.claimBoundary, generalizationBoundary:candidate.generalizationBoundary, confounders:['runtime version','fixture setup'], createdAt:'2026-09-01T04:00:00.000Z', ...overrides };
}

test('hypothesis variables are strict, bounded, and deterministically hash-bound before execution', () => {
  const frozen = validateHypothesisTestPlan(plan(), candidate);
  const digest = hypothesisTestPlanSha256(frozen, candidate);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(hypothesisTestPlanSha256(structuredClone(frozen), candidate), digest);
  assert.throws(() => validateHypothesisTestPlan(plan({ experimentBoundary:'all runtimes' }), candidate), /boundary/);
  assert.throws(() => validateHypothesisTestPlan({ ...plan(), confidence:0.99 }, candidate), /unknown or missing/);
  assert.throws(() => validateHypothesisTestPlan(plan({ falsificationCriterion:'' }), candidate), /non-empty/);
});

test('changing a test variable changes custody and cannot masquerade as the frozen plan', () => {
  const original = hypothesisTestPlanSha256(plan(), candidate);
  const retrofitted = hypothesisTestPlanSha256(plan({ expectedOutcome:'a result rewritten after observation' }), candidate);
  assert.notEqual(retrofitted, original);
});
