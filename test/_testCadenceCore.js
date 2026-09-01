const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CADENCE_TIERS, MAIN_CATEGORIES, TEST_MAIN_CATEGORIES, TEST_CADENCE, AUDIT_CADENCE, ERROR_TRIGGERS,
  tierRank, discoverTests, categoryForTest, mainCategoryForTest, validateTestClassification, categorizedTests, testsForTier,
  auditsForTier, auditsForError, selectTestsForCategory, selectTestsForChanges, runTier, runError, runCategory, runRequested,
} = require('../src/testCadence');

test('cadence tiers escalate in the documented order', () => {
  assert.deepEqual(CADENCE_TIERS, ['every-push', 'daily', 'weekly', 'monthly']);
  assert.equal(tierRank('every-push'), 0);
  assert.equal(tierRank('monthly'), 3);
  assert.throws(() => tierRank('yearly'), /Unknown cadence tier "yearly"/);
});

test('Orchestrator has exactly the four owner-defined main categories', () => {
  assert.deepEqual(MAIN_CATEGORIES, ['code', 'security', 'utility', 'maintenance']);
  assert.deepEqual(Object.keys(TEST_MAIN_CATEGORIES), MAIN_CATEGORIES);
});

test('every current test belongs to exactly one main category', () => {
  const files = discoverTests();
  assert.equal(validateTestClassification(files), true);
  const mapped = MAIN_CATEGORIES.flatMap((category) => TEST_MAIN_CATEGORIES[category]);
  assert.equal(mapped.length, files.length);
  assert.deepEqual([...mapped].sort(), files);
  for (const file of files) assert.ok(MAIN_CATEGORIES.includes(mainCategoryForTest(file)));
});

test('current suite classification is stable across the four governed buckets', () => {
  assert.deepEqual(TEST_MAIN_CATEGORIES.code, [
    'test/code-check.test.js',
    'test/codeSecurityOrganism.test.js',
    'test/ciDiagnosticOrgan.test.js',
    'test/documentFurniture.test.js',
    'test/durableLock.test.js',
    'test/soakGate.test.js',
    'test/soakRun.test.js',
    'test/preSoakReadiness.test.js',
    'test/learningGovernance.test.js',
    'test/learningCycle.test.js',
    'test/engine.test.js',
    'test/ecosystem.test.js',
    'test/hostedMultiRepositoryIntegration.test.js',
    'test/repositoryOperation.test.js',
    'test/suiteSelection.test.js',
    'test/scientificLearning.test.js',
    'test/claimExtractionWorker.test.js',
    'test/monthlyKnowledgeRefresh.test.js',
    'test/languageCatalog.test.js',
    'test/semanticAnalysis.test.js',
    'test/offlineGpuGate.test.js',
    'test/hostIsolation.test.js',
    'test/hostedLearningProof.test.js',
    'test/pairedCorroboration.test.js',
    'test/intakePathways.test.js',
    'test/realCorpusSafety.test.js',
    'test/repairEvidence.test.js',
    'test/realSupersession.test.js',
    'test/realCorpusLearning.test.js',
    'test/semanticCorroboration.test.js',
    'test/sourceIndependence.test.js',
    'test/hostedSourceBundle.test.js',
    'test/externalAiFirewall.test.js',
    'test/knowledgeLifecycle.test.js',
    'test/hypothesisTestPlan.test.js',
    'test/languageExperimentRegistry.test.js',
    'test/languageHypothesisVariables.test.js',
    'test/organismCirculation.test.js',
    'test/organismRuntime.test.js',
    'test/productionOrganism.test.js',
    'test/organismHealth.test.js',
    'test/organismFaultMatrix.test.js',
    'test/concreteLanguageHarness.test.js',
  ]);
  assert.deepEqual(TEST_MAIN_CATEGORIES.security, [
    'test/automatedGoogleResearch.test.js',
    'test/apiGuard.test.js',
    'test/authenticity.test.js',
    'test/coreRefIntegrity.test.js',
    'test/githubRepoSecurity.test.js',
    'test/hardening.test.js',
    'test/malwareScan.test.js',
    'test/privacy.test.js',
    'test/quarantine.test.js',
    'test/requiredCheckBoundary.test.js',
    'test/safeInformationRetrieval.test.js',
    'test/security.test.js',
  ]);
  assert.deepEqual(TEST_MAIN_CATEGORIES.utility, [
    'test/commit.test.js',
    'test/config.test.js',
    'test/failureIssue.test.js',
    'test/installGitHooks.test.js',
    'test/repair.test.js',
    'test/report.test.js',
    'test/snapshot.test.js',
  ]);
  assert.deepEqual(TEST_MAIN_CATEGORIES.maintenance, [
    'test/aiConflictLedger.test.js',
    'test/aiConflictResolution.test.js',
    'test/collisions.test.js',
    'test/designBriefGate.test.js',
    'test/docSync.test.js',
    'test/folderTopology.test.js',
    'test/globalPolicy.test.js',
    'test/globalRepositoryGovernance.test.js',
    'test/handoffPolicy.test.js',
    'test/injectedBranchRelationships.test.js',
    'test/injectedGovernanceAdaptive.test.js',
    'test/testCadence.test.js',
    'test/workflow.test.js',
    'test/workflowLint.test.js',
  ]);
});

test('strict classification certification rejects unresolved future tests while execution may isolate them', () => {
  assert.throws(() => mainCategoryForTest('test/futureSubsystem.test.js'), /Unclassified test "test\/futureSubsystem\.test\.js"/);
  assert.throws(() => validateTestClassification([...discoverTests(), 'test/futureSubsystem.test.js']), /Unclassified test "test\/futureSubsystem\.test\.js"/);
  const report = validateTestClassification([...discoverTests(), 'test/futureSubsystem.test.js'], { allowUnresolved: true });
  assert.equal(report.ok, false);
  assert.equal(report.unresolved.length, 1);
  assert.equal(report.unresolved[0].file, 'test/futureSubsystem.test.js');
});

test('every test file listed in the cadence registry actually exists', () => {
  for (const file of Object.keys(TEST_CADENCE)) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} referenced in TEST_CADENCE does not exist`);
});

test('every test file listed in the cadence registry has a valid tier', () => {
  for (const [file, tier] of Object.entries(TEST_CADENCE)) assert.ok(CADENCE_TIERS.includes(tier), `${file} has invalid tier "${tier}"`);
});

test('every audit script listed in AUDIT_CADENCE is a real package.json script', () => {
  const scripts = require('../package.json').scripts;
  for (const tier of CADENCE_TIERS) for (const script of AUDIT_CADENCE[tier] || []) assert.ok(scripts[script], `AUDIT_CADENCE.${tier} references unknown script "${script}"`);
});

test('every on-error trigger only lists read-only audits, never a mutating fixer', () => {
  const forbidden = ['repair', 'fix-commit', 'scrub:privacy', 'docs:sync'];
  for (const [trigger, scripts] of Object.entries(ERROR_TRIGGERS)) for (const script of scripts) assert.ok(!forbidden.includes(script), `on-error trigger "${trigger}" must not run mutating script "${script}" unattended`);
});

test('Orchestrator automatically owns every current test file through discovery plus governed classification', () => {
  const files = discoverTests();
  const categorized = categorizedTests();
  assert.equal(categorized.length, files.length);
  assert.deepEqual(categorized.map((item) => item.file), files);
  for (const item of categorized) {
    assert.equal(item.category, categoryForTest(item.file));
    assert.equal(item.subcategory, categoryForTest(item.file));
    assert.equal(item.mainCategory, mainCategoryForTest(item.file));
    assert.ok(item.category.length > 0);
    assert.ok(MAIN_CATEGORIES.includes(item.mainCategory));
    assert.ok(CADENCE_TIERS.includes(item.cadence));
  }
});

test('explicit category requests are still selected entirely by the Orchestrator', () => {
  const all = discoverTests();
  for (const mainCategory of MAIN_CATEGORIES) {
    const selection = selectTestsForCategory(mainCategory);
    assert.deepEqual(selection.tests, [...TEST_MAIN_CATEGORIES[mainCategory]].sort());
    assert.deepEqual(selection.mainCategories, [mainCategory]);
    assert.equal(selection.fullSuite, selection.tests.length === all.length);
    for (const file of selection.tests) assert.equal(mainCategoryForTest(file), mainCategory);
  }
  assert.throws(() => selectTestsForCategory('other'), /Unknown main category "other"/);
});

test('category, all, and random-category requests execute only through Orchestrator-owned selections', () => {
  const categoryCalls = [];
  const categoryRun = (executable, args) => { categoryCalls.push({ executable, args }); return { status: 0 }; };
  const categoryResult = runCategory('security', categoryRun);
  assert.equal(categoryResult.ok, true);
  assert.deepEqual(categoryResult.selection.tests, [...TEST_MAIN_CATEGORIES.security].sort());
  assert.equal(categoryCalls.length, 1);
  assert.deepEqual(categoryCalls[0].args.slice(0, 1), ['--test']);
  assert.deepEqual(categoryCalls[0].args.slice(1), [...TEST_MAIN_CATEGORIES.security].sort());

  const previousTransportSource = process.env.CRUCIBLE_TEST_REQUEST_SOURCE;
  delete process.env.CRUCIBLE_TEST_REQUEST_SOURCE;
  try {
    const allCalls = [];
    const allResult = runRequested('all', '', (executable, args) => { allCalls.push({ executable, args }); return { status: 0 }; });
    assert.equal(allResult.ok, true);
    assert.equal(allResult.selection.fullSuite, true);
    assert.deepEqual(allResult.selection.tests, discoverTests());
    assert.equal(allCalls.length, 1);

    const randomCalls = [];
    const randomResult = runRequested('run a random test category', '', (executable, args) => { randomCalls.push({ executable, args }); return { status: 0 }; });
    assert.equal(randomResult.ok, true);
    assert.equal(randomResult.selection.mainCategories.length, 1);
    const chosen = randomResult.selection.mainCategories[0];
    assert.ok(MAIN_CATEGORIES.includes(chosen));
    assert.deepEqual(randomResult.selection.tests, [...TEST_MAIN_CATEGORIES[chosen]].sort());
    assert.equal(randomCalls.length, 1);
    assert.deepEqual(randomCalls[0].args.slice(0, 1), ['--test']);
    assert.deepEqual(randomCalls[0].args.slice(1), [...TEST_MAIN_CATEGORIES[chosen]].sort());
  } finally {
    if (previousTransportSource === undefined) delete process.env.CRUCIBLE_TEST_REQUEST_SOURCE;
    else process.env.CRUCIBLE_TEST_REQUEST_SOURCE = previousTransportSource;
  }
});

test('change-impact selection runs the matching subcategory instead of the whole suite when impact is provable', () => {
  const selection = selectTestsForChanges(['src/testCadence.js']);
  assert.equal(selection.fullSuite, false);
  assert.ok(selection.tests.includes('test/testCadence.test.js'));
  assert.ok(selection.categories.includes('testCadence'));
  assert.ok(selection.mainCategories.includes('maintenance'));
  assert.ok(selection.tests.length < discoverTests().length);
});

test('change-impact selection fails safe to the full suite when a runtime change cannot be mapped', () => {
  const unknown = ['src', `${'future'}UnknownSubsystem.js`].join('/');
  const selection = selectTestsForChanges([unknown]);
  assert.equal(selection.fullSuite, true);
  assert.deepEqual(selection.tests, discoverTests());
  assert.deepEqual(selection.mainCategories, [...MAIN_CATEGORIES].sort());
});

test('governance changes are routed to maintenance subcategories without forcing unrelated tests', () => {
  const selection = selectTestsForChanges(['AI-HANDOFF.json', 'DEVLOG.md']);
  assert.equal(selection.fullSuite, false);
  assert.deepEqual(selection.mainCategories, ['maintenance']);
  assert.ok(selection.tests.includes('test/workflow.test.js'));
  assert.ok(selection.tests.includes('test/handoffPolicy.test.js'));
  assert.ok(selection.tests.includes('test/testCadence.test.js'));
});

test('package metadata changes route through maintenance Orchestrator subcategories rather than forcing every unrelated test', () => {
  const selection = selectTestsForChanges(['package.json']);
  assert.equal(selection.fullSuite, false);
  assert.deepEqual(selection.mainCategories, ['maintenance']);
  assert.ok(selection.tests.includes('test/testCadence.test.js'));
  assert.ok(selection.tests.includes('test/workflow.test.js'));
});

test('testsForTier("every-push") includes every test file the registry does not explicitly move elsewhere', () => {
  const allFiles = discoverTests();
  const everyPush = testsForTier('every-push');
  const explicitlyMoved = Object.keys(TEST_CADENCE).filter((file) => TEST_CADENCE[file] !== 'every-push');
  for (const file of allFiles) {
    if (explicitlyMoved.includes(file)) assert.ok(!everyPush.includes(file), `${file} is tagged for a slower cadence but still appears in every-push`);
    else assert.ok(everyPush.includes(file), `${file} is untagged (defaults to every-push) but is missing from testsForTier('every-push')`);
  }
});

test('testsForTier is cumulative: a slower tier always includes everything a faster tier includes', () => {
  const everyPush = testsForTier('every-push');
  const daily = testsForTier('daily');
  const weekly = testsForTier('weekly');
  const monthly = testsForTier('monthly');
  for (const file of everyPush) assert.ok(daily.includes(file));
  for (const file of daily) assert.ok(weekly.includes(file));
  for (const file of weekly) assert.ok(monthly.includes(file));
  assert.ok(daily.includes('test/hostedMultiRepositoryIntegration.test.js'));
  assert.ok(!everyPush.includes('test/hostedMultiRepositoryIntegration.test.js'));
  assert.ok(weekly.includes('test/globalRepositoryGovernance.test.js'));
  assert.ok(!daily.includes('test/globalRepositoryGovernance.test.js'));
});

test('auditsForTier is cumulative across escalating tiers', () => {
  const everyPush = auditsForTier('every-push');
  const daily = auditsForTier('daily');
  const monthly = auditsForTier('monthly');
  for (const script of everyPush) assert.ok(daily.includes(script));
  assert.ok(daily.includes('audit:core-ref'));
  assert.ok(!everyPush.includes('audit:core-ref'));
  assert.ok(monthly.includes('audit:reproducibility'), 'monthly must still include weekly-tier audits');
});

test('auditsForError returns the mapped read-only diagnostics and rejects an unknown trigger', () => {
  assert.deepEqual(auditsForError('self-test-failure'), ['audit:core-ref', 'audit:github-security', 'audit:collisions']);
  assert.throws(() => auditsForError('made-up-trigger'), /Unknown on-error trigger "made-up-trigger"/);
});

test('runTier runs unit tests plus every audit for the tier and reports pass/fail per check', () => {
  const calls = [];
  const run = (executable, args) => { calls.push({ executable, args }); return { status: args.includes('audit:security') ? 1 : 0 }; };
  const result = runTier('every-push', run);
  assert.equal(result.tier, 'every-push');
  assert.ok(calls.some((call) => call.args[0] === '--test'));
  assert.equal(result.ok, false);
  assert.ok(result.outcomes.find((item) => item.label === 'npm run audit:security' && item.ok === false));
  assert.ok(result.outcomes.find((item) => item.label === 'npm run validate' && item.ok === true));
});

test('runTier runs exactly one unit-test invocation and one npm-run invocation per audit, never more', () => {
  const calls = [];
  const run = (executable, args) => { calls.push(args); return { status: 0 }; };
  const result = runTier('every-push', run);
  assert.equal(result.ok, true);
  const testInvocations = calls.filter((args) => args.includes('--test'));
  assert.equal(testInvocations.length, 1);
  assert.equal(calls.length, testInvocations.length + auditsForTier('every-push').length);
});

test('runError runs only the mapped diagnostics and never touches an audit outside the trigger\'s list', () => {
  const calls = [];
  const run = (executable, args) => { calls.push(args.join(' ')); return { status: 0 }; };
  const result = runError('handoff-policy-failure', run);
  assert.equal(result.trigger, 'handoff-policy-failure');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /audit:ai-conflict-governance/);
});
