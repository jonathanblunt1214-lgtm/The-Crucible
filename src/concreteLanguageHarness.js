'use strict';
const crypto = require('node:crypto');
const { PROFILES } = require('./languageHypothesisVariables');

const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`); return value.trim(); };

function concreteHarnessConfiguration(language, configuration) {
  const key = String(language || '').toLowerCase();
  if (!PROFILES[key]) throw new Error('Language is not governed.');
  const { experimentAdapter, verifierAdapter, fixture, assertExperiment, assertVerification } = configuration || {};
  if (!experimentAdapter?.analyze || !verifierAdapter?.analyze || !experimentAdapter.id || !verifierAdapter.id || experimentAdapter.id === verifierAdapter.id) throw new Error(`Concrete ${key} harness requires distinct analyzer identities.`);
  if (!fixture || !Array.isArray(fixture.files) || fixture.files.length < 1 || typeof assertExperiment !== 'function' || typeof assertVerification !== 'function') throw new Error(`Concrete ${key} fixture and result assertions are required.`);
  const contract = { schemaVersion: 1, language: key, experimentAdapter: experimentAdapter.id, verifierAdapter: verifierAdapter.id, files: fixture.files, fixtureSha256: text(fixture.sha256, 'fixture.sha256'), expectedProperty: text(fixture.expectedProperty, 'fixture.expectedProperty'), runtimeBoundary: text(fixture.runtimeBoundary, 'fixture.runtimeBoundary') };
  const contractSha256 = sha(contract);
  const planBuilder = () => ({
    independentVariable: `exact ${key} fixture ${fixture.sha256} with one declared mutation`,
    dependentVariable: `adapter diagnostics and ${fixture.expectedProperty}`,
    controlledVariables: [`runtime boundary ${fixture.runtimeBoundary}`, `fixture hash ${fixture.sha256}`, `adapter contract ${contractSha256}`],
    controlCondition: `unchanged ${key} fixture ${fixture.sha256}`,
    positiveControl: `known-valid ${key} fixture must satisfy ${fixture.expectedProperty}`,
    negativeControl: `known-invalid ${key} fixture must fail ${fixture.expectedProperty}`,
    expectedOutcome: fixture.expectedProperty,
    falsificationCriterion: `any control drift, unexpected diagnostic, boundary mismatch, or failure of ${fixture.expectedProperty}`,
    measurementMethod: `content-addressed ${experimentAdapter.id} output checked by explicit executable assertions`,
    fixtureBoundary: `files ${fixture.files.join(', ')} at ${fixture.sha256}`,
    confounders: ['runtime or compiler drift', 'dependency drift', 'fixture mutation', 'adapter contract drift'],
  });
  const experiment = { id: experimentAdapter.id, run: async ({ testPlanSha256, contractSha256: supplied }) => { if (supplied !== contractSha256) throw new Error('Experiment contract custody mismatch.'); const result = await experimentAdapter.analyze({ ...fixture, files: [...fixture.files] }); if (await assertExperiment(result) !== true) throw new Error('Concrete experiment assertion failed.'); return { passed: true, testPlanSha256, contractSha256, resultSha256: sha(result) }; } };
  const verifier = { id: verifierAdapter.id, run: async ({ testPlanSha256, contractSha256: supplied, experimentalProof, experimentExecutorId }) => { if (supplied !== contractSha256 || experimentExecutorId === verifierAdapter.id) throw new Error('Independent verifier custody mismatch.'); const result = await verifierAdapter.analyze({ ...fixture, files: [...fixture.files] }); if (await assertVerification(result, experimentalProof) !== true) throw new Error('Independent verification assertion failed.'); return { passed: true, verifierId: verifierAdapter.id, testPlanSha256, contractSha256, resultSha256: sha(result) }; } };
  return { planBuilder, experiment, verifier, contractSha256 };
}

function registerConcreteLanguageHarnesses(registry, configurations) {
  for (const language of Object.keys(PROFILES)) registry.register(language, concreteHarnessConfiguration(language, configurations?.[language]));
  const readiness = registry.readiness();
  if (!readiness.ready) throw new Error(`Concrete language harnesses remain unavailable: ${readiness.missing.join(', ')}.`);
  return readiness;
}

module.exports = { concreteHarnessConfiguration, registerConcreteLanguageHarnesses };
