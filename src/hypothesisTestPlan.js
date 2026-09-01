'use strict';

const crypto = require('node:crypto');

const KEYS = Object.freeze([
  'schemaVersion', 'hypothesis', 'independentVariable', 'dependentVariable',
  'controlledVariables', 'controlCondition', 'positiveControl', 'negativeControl',
  'expectedOutcome', 'falsificationCriterion', 'measurementMethod',
  'fixtureBoundary', 'claimBoundary', 'experimentBoundary',
  'generalizationBoundary', 'confounders', 'createdAt',
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`); }
function textArray(value, label) { if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be a non-empty text array.`); }

// `claimScope` is the owner-declared boundary the claim was actually tested within. It is
// optional and, when absent, everything below behaves exactly as before.
//
// The distinction matters because `claimBoundary` carries provenance: extraction builds it from
// the source document, so two documents never share one. Requiring the experiment boundary to
// equal it means a second independent source re-testing the same claim always lands on its own
// lineage and can never supersede the first - R7 becomes unreachable on real multi-source
// evidence, which is why both the hosted proof and the supersession tests had to strip the plan
// binding on exactly that path. A plan enforced everywhere except where it cannot be satisfied
// is not enforced.
//
// So the plan keeps both facts rather than conflating them: `claimBoundary` still records which
// document asserted the claim, and `experimentBoundary` records where it was tested - the
// declared scope when the owner has declared one. The invariant is unchanged in substance: an
// experiment must be conducted within the boundary the claim is claimed for.
function validateHypothesisTestPlan(value, candidate, { claimScope = null } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('hypothesis test plan must be an object.');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== [...KEYS].sort().join(',')) throw new Error('hypothesis test plan has unknown or missing fields.');
  if (value.schemaVersion !== 1) throw new Error('hypothesis test plan schemaVersion must be 1.');
  for (const key of KEYS.filter((key) => !['schemaVersion', 'controlledVariables', 'confounders'].includes(key))) text(value[key], `hypothesis test plan.${key}`);
  textArray(value.controlledVariables, 'hypothesis test plan.controlledVariables');
  textArray(value.confounders, 'hypothesis test plan.confounders');
  if (!Number.isFinite(Date.parse(value.createdAt))) throw new Error('hypothesis test plan.createdAt must be an ISO timestamp.');
  if (candidate) {
    const scope = typeof claimScope === 'string' && claimScope.trim() ? claimScope.trim().replace(/\s+/g, ' ') : null;
    const testedWithin = scope || candidate.claimBoundary;
    if (value.claimBoundary !== candidate.claimBoundary) throw new Error('The test plan must preserve the candidate claim boundary.');
    if (value.experimentBoundary !== testedWithin) {
      throw new Error(scope
        ? 'The experiment boundary must equal the owner-declared claim scope the claim was tested within.'
        : 'The experiment boundary must equal the candidate claim boundary when no scope is declared.');
    }
    if (value.generalizationBoundary !== candidate.generalizationBoundary) throw new Error('The test plan must preserve the candidate generalization boundary.');
  }
  return Object.freeze(structuredClone(value));
}

function hypothesisTestPlanSha256(value, candidate, options = {}) { return hash(validateHypothesisTestPlan(value, candidate, options)); }

module.exports = { KEYS, validateHypothesisTestPlan, hypothesisTestPlanSha256 };
