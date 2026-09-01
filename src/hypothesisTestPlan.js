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

function validateHypothesisTestPlan(value, candidate) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('hypothesis test plan must be an object.');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== [...KEYS].sort().join(',')) throw new Error('hypothesis test plan has unknown or missing fields.');
  if (value.schemaVersion !== 1) throw new Error('hypothesis test plan schemaVersion must be 1.');
  for (const key of KEYS.filter((key) => !['schemaVersion', 'controlledVariables', 'confounders'].includes(key))) text(value[key], `hypothesis test plan.${key}`);
  textArray(value.controlledVariables, 'hypothesis test plan.controlledVariables');
  textArray(value.confounders, 'hypothesis test plan.confounders');
  if (!Number.isFinite(Date.parse(value.createdAt))) throw new Error('hypothesis test plan.createdAt must be an ISO timestamp.');
  if (candidate) {
    if (value.claimBoundary !== candidate.claimBoundary || value.experimentBoundary !== candidate.claimBoundary) throw new Error('The experiment boundary must equal the candidate claim boundary.');
    if (value.generalizationBoundary !== candidate.generalizationBoundary) throw new Error('The test plan must preserve the candidate generalization boundary.');
  }
  return Object.freeze(structuredClone(value));
}

function hypothesisTestPlanSha256(value, candidate) { return hash(validateHypothesisTestPlan(value, candidate)); }

module.exports = { KEYS, validateHypothesisTestPlan, hypothesisTestPlanSha256 };
