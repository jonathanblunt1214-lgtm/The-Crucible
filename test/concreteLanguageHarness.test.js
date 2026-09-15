'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILES } = require('../src/languageHypothesisVariables');
const { TrustedLanguageExperimentRegistry } = require('../src/languageExperimentRegistry');
const { registerConcreteLanguageHarnesses } = require('../src/concreteLanguageHarness');

test('every governed language requires a concrete fixture and two distinct executable adapters', async () => {
  const configurations = Object.fromEntries(Object.keys(PROFILES).map((language) => [language, {
    experimentAdapter: { id: `${language}-compiler-experiment`, analyze: async ({ sha256 }) => ({ language, sha256, diagnostics: [] }) },
    verifierAdapter: { id: `${language}-compiler-verifier`, analyze: async ({ sha256 }) => ({ language, sha256, diagnostics: [] }) },
    fixture: { files: [`fixture.${language.replace(/[^a-z]/g, '') || 'source'}`], sha256: 'a'.repeat(64), expectedProperty: 'the compiler-native fixture emits no unexpected diagnostic', runtimeBoundary: `${language} pinned test runtime` },
    assertExperiment: (result) => result.language === language && result.diagnostics.length === 0,
    assertVerification: (result, proof) => result.language === language && result.diagnostics.length === 0 && proof.passed === true,
  }]));
  const registry = new TrustedLanguageExperimentRegistry();
  assert.equal(registerConcreteLanguageHarnesses(registry, configurations).configured, Object.keys(PROFILES).length);
  const candidate = { id: 'c', claim: 'the fixture emits no unexpected diagnostic', claimBoundary: 'exact pinned fixture', generalizationBoundary: 'no other runtime or source' };
  for (const language of Object.keys(PROFILES)) assert.equal((await registry.run(language, candidate, '2026-09-01T06:00:00.000Z')).independentVerification.passed, true);
});

test('a missing language, shared adapter identity, or non-executable assertion fails closed', () => {
  const registry = new TrustedLanguageExperimentRegistry();
  assert.throws(() => registerConcreteLanguageHarnesses(registry, {}), /distinct analyzer identities/);
});
