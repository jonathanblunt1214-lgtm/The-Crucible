require('./_testCadenceCore');

const test = require('node:test');
const assert = require('node:assert/strict');
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
  scheduledCategoriesForTier,
  orchestratorTestsForCategories,
  verifyCadenceSelection,
  scheduledTestsForTier,
  runScheduledTests,
  runScheduledTier,
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

test('independent closest-feature classifier fails closed when closest feature evidence is tied', () => {
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
