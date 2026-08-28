require('./_testCadenceCore');

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyTestByClosestFeature } = require('../src/testFeatureClassifier');
const {
  TEST_PROGRESS_INTERVAL_MS,
  TEST_PROGRESS_MAX_INTERVAL_MS,
  KNOWN_BUG_SEVERITY_ORDER,
  CATEGORY_CRITICALITY,
  SCHEDULED_CADENCE_TIERS,
  CATEGORY_CADENCE,
  DEVELOPMENT_TEST_STANDARD_RULE_KEYS,
  DEVELOPMENT_TEST_STANDARD_POLICY_SHA256,
  scheduledCategoriesForTier,
  orchestratorTestsForCategories,
  verifyCadenceSelection,
  scheduledTestsForTier,
  runScheduledTests,
  runScheduledTier,
  runTestSelection,
  TEST_MAIN_CATEGORIES,
  knownMainCategoryForTest,
  classificationForTest,
  emptyKnownBugLedger,
  severityForMainCategories,
  writeKnownBugLedger,
  readKnownBugLedger,
  recordKnownBug,
  verifyKnownBugFix,
  mainCategoryForTest,
} = require('../src/testCadence');

test('Orchestrator progress updates are fixed at one minute and never exceed the one-minute-thirty maximum', () => {
  assert.equal(TEST_PROGRESS_INTERVAL_MS, 60_000);
  assert.equal(TEST_PROGRESS_MAX_INTERVAL_MS, 90_000);
  assert.ok(TEST_PROGRESS_INTERVAL_MS >= 60_000);
  assert.ok(TEST_PROGRESS_INTERVAL_MS <= TEST_PROGRESS_MAX_INTERVAL_MS);
});

test('known-bug criticality is deterministic and ordered from critical through low', () => {
  assert.deepEqual(KNOWN_BUG_SEVERITY_ORDER, ['critical', 'high', 'medium', 'low']);
  assert.deepEqual(CATEGORY_CRITICALITY, { security: 'critical', code: 'high', utility: 'medium', maintenance: 'low' });
  assert.equal(severityForMainCategories(['maintenance']), 'low');
  assert.equal(severityForMainCategories(['utility', 'security']), 'critical');
  assert.equal(severityForMainCategories(['code', 'utility']), 'high');
});

test('cadence independently declares when categories are due without choosing test files', () => {
  assert.deepEqual(SCHEDULED_CADENCE_TIERS, ['every-push', 'daily', 'twice-weekly', 'weekly', 'monthly']);
  assert.deepEqual(CATEGORY_CADENCE, { code: 'every-push', security: 'daily', utility: 'twice-weekly', maintenance: 'weekly' });
  assert.deepEqual(scheduledCategoriesForTier('every-push'), ['code']);
  assert.deepEqual(scheduledCategoriesForTier('daily'), ['code', 'security']);
  assert.deepEqual(scheduledCategoriesForTier('twice-weekly'), ['code', 'security', 'utility']);
  assert.deepEqual(scheduledCategoriesForTier('weekly'), ['code', 'security', 'utility', 'maintenance']);
});

test('Orchestrator resolves due categories to concrete test paths and cadence checks the result', () => {
  const due = scheduledCategoriesForTier('twice-weekly');
  const selected = orchestratorTestsForCategories(due);
  assert.ok(selected.every((item) => typeof item === 'string' && item.endsWith('.test.js')));
  assert.deepEqual(selected, [...TEST_MAIN_CATEGORIES.code, ...TEST_MAIN_CATEGORIES.security, ...TEST_MAIN_CATEGORIES.utility].sort());
  const balance = verifyCadenceSelection({ tier: 'twice-weekly', dueCategories: due }, selected);
  assert.equal(balance.ok, true);
  assert.deepEqual(balance.dueCategories, due);
});

test('cadence rejects an Orchestrator selection that omits a category that is due', () => {
  const obligation = { tier: 'daily', dueCategories: ['code', 'security'] };
  const codeOnly = orchestratorTestsForCategories(['code']);
  assert.throws(() => verifyCadenceSelection(obligation, codeOnly), /missing due category security/);
});

test('independent closest-feature classifier proposes a unique category for an unmapped new test', () => {
  const bodies = {
    'test/newCredentialBoundary.test.js': "credential token authentication permission boundary",
    'test/security.test.js': "credential token authentication permission security",
    'test/engine.test.js': "engine parser execution workload",
  };
  const result = classifyTestByClosestFeature('test/newCredentialBoundary.test.js', {
    knownCategoryMap: { security: ['test/security.test.js'], code: ['test/engine.test.js'], utility: [], maintenance: [] },
    readFile: (file) => bodies[file],
  });
  assert.equal(result.category, 'security');
  assert.equal(result.source, 'closest-feature');
});

test('independent closest-feature classifier isolates tied evidence instead of guessing a category', () => {
  const bodies = {
    'test/newShared.test.js': 'shared boundary behavior',
    'test/security.test.js': 'shared boundary security',
    'test/engine.test.js': 'shared boundary engine',
  };
  const result = classifyTestByClosestFeature('test/newShared.test.js', {
    knownCategoryMap: { security: ['test/security.test.js'], code: ['test/engine.test.js'], utility: [], maintenance: [] },
    readFile: (file) => bodies[file],
  });
  assert.equal(result.category, null);
  assert.equal(result.source, 'unresolved');
  assert.match(result.reason, /tied|ambiguous/);
});

test('isolate ambiguity, continue safe tests, never fake complete coverage', () => {
  const calls = [];
  const selection = {
    tests: ['test/security.test.js'],
    unresolved: [{ file: 'test/newShared.test.js', category: null, source: 'unresolved', reason: 'closest-feature match is tied or ambiguous' }],
    coverageComplete: false,
    mainCategories: ['security'],
    categories: ['security'],
    fullSuite: false,
    reason: 'development-standard ambiguity isolation proof',
  };
  const result = runTestSelection(selection, (executable, args) => {
    calls.push({ executable, args });
    return { status: 0 };
  });
  assert.equal(calls.length, 1, 'safe tests must continue even when another test is unresolved');
  assert.deepEqual(calls[0].args.slice(1), ['test/security.test.js']);
  assert.equal(result.outcomes[0].ok, true, 'safe selected test may pass');
  assert.equal(result.coverageComplete, false, 'overall coverage must remain incomplete');
  assert.equal(result.ok, false, 'incomplete coverage must never be reported as a fully passing run');
  assert.equal(result.unresolved[0].file, 'test/newShared.test.js');
});

test('development testing standards gate rejects stale governed rules or obsolete test contracts automatically', () => {
  const root = path.join(__dirname, '..');
  const handoff = JSON.parse(fs.readFileSync(path.join(root, 'AI-HANDOFF.json'), 'utf8'));
  const policy = handoff.testCadencePolicy || {};
  const currentRules = {};
  for (const key of DEVELOPMENT_TEST_STANDARD_RULE_KEYS) {
    assert.equal(typeof policy[key], 'string', `current development testing rule ${key} is missing`);
    assert.ok(policy[key].trim().length > 0, `current development testing rule ${key} is empty`);
    currentRules[key] = policy[key];
  }
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(currentRules)).digest('hex');
  assert.equal(
    fingerprint,
    DEVELOPMENT_TEST_STANDARD_POLICY_SHA256,
    'governed testing rules changed without updating the implementation/maintenance standard; update the behavior and standing tests before accepting development',
  );

  const deprecatedContracts = [
    ['future tests fail closed until they are assigned', 'a main category'].join(' '),
    ['unresolved classification aborts', 'the whole suite'].join(' '),
    ['unknown classification stops', 'all tests'].join(' '),
  ];
  const testDir = path.join(root, 'test');
  for (const name of fs.readdirSync(testDir).filter((entry) => entry.endsWith('.js'))) {
    const body = fs.readFileSync(path.join(testDir, name), 'utf8');
    for (const obsolete of deprecatedContracts) {
      assert.equal(body.includes(obsolete), false, `${name} still contains obsolete development testing contract: ${obsolete}`);
    }
  }
});

test('explicit mappings stay authoritative and do not get reclassified by the independent matcher', () => {
  assert.equal(knownMainCategoryForTest('test/security.test.js'), 'security');
  const result = classificationForTest('test/security.test.js', { readFile: () => 'engine parser code' });
  assert.equal(result.category, 'security');
  assert.equal(result.source, 'explicit-map');
});

test('scheduled category cadence remains cumulative after independent Orchestrator selection', () => {
  assert.deepEqual(scheduledTestsForTier('every-push'), [...TEST_MAIN_CATEGORIES.code].sort());
  assert.deepEqual(scheduledTestsForTier('daily'), [...TEST_MAIN_CATEGORIES.code, ...TEST_MAIN_CATEGORIES.security].sort());
  assert.deepEqual(scheduledTestsForTier('weekly'), Object.values(TEST_MAIN_CATEGORIES).flat().sort());
});

test('every-push Code baseline runs only the Orchestrator-selected Code tests, not the scheduled audit stack', () => {
  const calls = [];
  const result = runScheduledTests('every-push', (executable, args) => { calls.push({ executable, args }); return { status: 0 }; });
  assert.equal(result.ok, true);
  assert.equal(result.balance.ok, true);
  assert.deepEqual(result.categories, ['code']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], '--test');
  assert.deepEqual(calls[0].args.slice(1), [...TEST_MAIN_CATEGORIES.code].sort());
});

test('runScheduledTier executes one Orchestrator-owned test invocation after cadence balance', () => {
  const calls = [];
  const result = runScheduledTier('twice-weekly', (executable, args) => { calls.push({ executable, args }); return { status: 0 }; });
  assert.equal(result.ok, true);
  assert.equal(result.balance.ok, true);
  assert.deepEqual(result.categories, ['code', 'security', 'utility']);
  const testCalls = calls.filter((call) => call.args[0] === '--test');
  assert.equal(testCalls.length, 1);
  assert.deepEqual(testCalls[0].args.slice(1), scheduledTestsForTier('twice-weekly'));
});

test('failed category results are saved by criticality and cannot be checked off before a passing re-test', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-known-bugs-'));
  const ledgerPath = path.join(dir, 'KNOWN-BUGS.json');
  writeKnownBugLedger(emptyKnownBugLedger(), ledgerPath);
  const low = recordKnownBug({ tests: ['test/workflow.test.js'], mainCategoryForTest, status: 1, ledgerPath, headSha: '11111111aaaa', now: '2026-08-28T00:01:00Z' });
  const critical = recordKnownBug({ tests: ['test/security.test.js'], mainCategoryForTest, status: 1, ledgerPath, headSha: '22222222bbbb', now: '2026-08-28T00:02:00Z' });
  let ledger = readKnownBugLedger(ledgerPath);
  assert.deepEqual(ledger.bugs.map((bug) => bug.id), [critical.id, low.id]);
  assert.equal(ledger.bugs[0].severity, 'critical');
  assert.equal(ledger.bugs[0].checked, false);
  const failedRetest = verifyKnownBugFix(critical.id, { ledgerPath, run: () => ({ status: 1 }), now: '2026-08-28T00:03:00Z' });
  assert.equal(failedRetest.ok, false);
  ledger = readKnownBugLedger(ledgerPath);
  assert.equal(ledger.bugs.find((bug) => bug.id === critical.id).checked, false);
  assert.equal(ledger.bugs.find((bug) => bug.id === critical.id).status, 'open');
  const passingRetest = verifyKnownBugFix(critical.id, { ledgerPath, run: () => ({ status: 0 }), now: '2026-08-28T00:04:00Z' });
  assert.equal(passingRetest.ok, true);
  ledger = readKnownBugLedger(ledgerPath);
  const resolved = ledger.bugs.find((bug) => bug.id === critical.id);
  assert.equal(resolved.checked, true);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.retests.at(-1).ok, true);
});

test('closest-feature classifier resists misleading filenames and remains unresolved when evidence disappears', () => {
  const bodies = {
    'test/securityLookingName.test.js': 'workflow governance cadence policy reconciliation handoff branch release audit',
    'test/maintenanceReference.test.js': 'workflow governance cadence policy reconciliation handoff branch release audit maintenance',
    'test/securityReference.test.js': 'security credential token authentication malware secret',
  };
  const result = classifyTestByClosestFeature('test/securityLookingName.test.js', {
    knownCategoryMap: { maintenance:['test/maintenanceReference.test.js'], security:['test/securityReference.test.js'], code:[], utility:[] },
    readFile: (file) => bodies[file],
  });
  assert.equal(result.category, 'maintenance');
  assert.equal(result.source, 'closest-feature');
  const unresolved = classifyTestByClosestFeature('test/unknown.test.js', {
    knownCategoryMap: { maintenance:['test/maintenanceReference.test.js'], security:['test/securityReference.test.js'], code:[], utility:[] },
    readFile: (file) => file === 'test/unknown.test.js' ? 'quantum unrelated zephyr' : bodies[file],
  });
  assert.equal(unresolved.category, null);
  assert.equal(unresolved.source, 'unresolved');
  assert.match(unresolved.reason, /no matching feature evidence/);
});

test('standing category cadence cannot drift from the owner-defined frequency thresholds', () => {
  const expected = { code:'every-push', security:'daily', utility:'twice-weekly', maintenance:'weekly' };
  assert.deepEqual(CATEGORY_CADENCE, expected);
  const tierIndex = new Map(SCHEDULED_CADENCE_TIERS.map((tier, index) => [tier, index]));
  for (const [category, frequency] of Object.entries(expected)) {
    for (const tier of SCHEDULED_CADENCE_TIERS) {
      const due = scheduledCategoriesForTier(tier).includes(category);
      assert.equal(due, tierIndex.get(tier) >= tierIndex.get(frequency), `${category} cadence drifted at ${tier}`);
    }
    for (const file of TEST_MAIN_CATEGORIES[category]) assert.equal(mainCategoryForTest(file), category, `${file} drifted out of ${category}`);
  }
});

test('CI bypass guard keeps required testing on the Orchestrator path and promotion behind release checks', () => {
  const root = path.join(__dirname, '..');
  const selfTest = fs.readFileSync(path.join(root, '.github/workflows/self-test.yml'), 'utf8');
  const promote = fs.readFileSync(path.join(root, '.github/workflows/promote-release.yml'), 'utf8');
  const block = fs.readFileSync(path.join(root, '.github/workflows/block-pr-7.yml'), 'utf8');
  assert.match(selfTest, /node src\/testCadence\.js scheduled-tests every-push/);
  assert.match(selfTest, /node src\/testCadence\.js request/);
  assert.doesNotMatch(selfTest, /^\s*-\s*run:\s*node\s+--test\b/m, 'workflow must not bypass the Orchestrator with direct node --test');
  assert.match(promote, /branches:\s*\[release\]/);
  assert.match(promote, /--head release --base main/);
  assert.match(promote, /gh pr checks .*--watch/);
  assert.match(promote, /gh pr merge/);
  assert.match(block, /LOCKED_PR_NUMBERS:\s*"7 9 11"/);
  assert.match(block, /pull_request:/);
});
