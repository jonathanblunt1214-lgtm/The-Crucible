require('./_testCadenceCore');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TEST_PROGRESS_INTERVAL_MS,
  TEST_PROGRESS_MAX_INTERVAL_MS,
  KNOWN_BUG_SEVERITY_ORDER,
  CATEGORY_CRITICALITY,
  SCHEDULED_CADENCE_TIERS,
  CATEGORY_CADENCE,
  scheduledCategoriesForTier,
  scheduledTestsForTier,
  runScheduledTier,
  TEST_MAIN_CATEGORIES,
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
  assert.deepEqual(CATEGORY_CRITICALITY, {
    security: 'critical',
    code: 'high',
    utility: 'medium',
    maintenance: 'low',
  });
  assert.equal(severityForMainCategories(['maintenance']), 'low');
  assert.equal(severityForMainCategories(['utility', 'security']), 'critical');
  assert.equal(severityForMainCategories(['code', 'utility']), 'high');
});

test('owner-defined category cadence keeps Code fastest and adds Security, Utility, and Maintenance only when due', () => {
  assert.deepEqual(SCHEDULED_CADENCE_TIERS, ['every-push', 'daily', 'twice-weekly', 'weekly', 'monthly']);
  assert.deepEqual(CATEGORY_CADENCE, {
    code: 'every-push',
    security: 'daily',
    utility: 'twice-weekly',
    maintenance: 'weekly',
  });
  assert.deepEqual(scheduledCategoriesForTier('every-push'), ['code']);
  assert.deepEqual(scheduledCategoriesForTier('daily'), ['code', 'security']);
  assert.deepEqual(scheduledCategoriesForTier('twice-weekly'), ['code', 'security', 'utility']);
  assert.deepEqual(scheduledCategoriesForTier('weekly'), ['code', 'security', 'utility', 'maintenance']);
  assert.deepEqual(scheduledCategoriesForTier('monthly'), ['code', 'security', 'utility', 'maintenance']);
});

test('scheduled category cadence is selected by the Orchestrator and remains cumulative', () => {
  assert.deepEqual(scheduledTestsForTier('every-push'), [...TEST_MAIN_CATEGORIES.code].sort());
  assert.deepEqual(scheduledTestsForTier('daily'), [...TEST_MAIN_CATEGORIES.code, ...TEST_MAIN_CATEGORIES.security].sort());
  assert.deepEqual(scheduledTestsForTier('twice-weekly'), [...TEST_MAIN_CATEGORIES.code, ...TEST_MAIN_CATEGORIES.security, ...TEST_MAIN_CATEGORIES.utility].sort());
  assert.deepEqual(scheduledTestsForTier('weekly'), Object.values(TEST_MAIN_CATEGORIES).flat().sort());
});

test('runScheduledTier executes one Orchestrator-owned test invocation for the categories due', () => {
  const calls = [];
  const result = runScheduledTier('twice-weekly', (executable, args) => {
    calls.push({ executable, args });
    return { status: 0 };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.categories, ['code', 'security', 'utility']);
  const testCalls = calls.filter((call) => call.args[0] === '--test');
  assert.equal(testCalls.length, 1);
  assert.deepEqual(testCalls[0].args.slice(1), scheduledTestsForTier('twice-weekly'));
});

test('failed category results are saved by criticality and cannot be checked off before a passing re-test', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-known-bugs-'));
  const ledgerPath = path.join(dir, 'KNOWN-BUGS.json');
  writeKnownBugLedger(emptyKnownBugLedger(), ledgerPath);

  const low = recordKnownBug({
    tests: ['test/workflow.test.js'],
    mainCategoryForTest,
    status: 1,
    ledgerPath,
    headSha: '11111111aaaa',
    now: '2026-08-28T00:01:00Z',
  });
  const critical = recordKnownBug({
    tests: ['test/security.test.js'],
    mainCategoryForTest,
    status: 1,
    ledgerPath,
    headSha: '22222222bbbb',
    now: '2026-08-28T00:02:00Z',
  });

  let ledger = readKnownBugLedger(ledgerPath);
  assert.deepEqual(ledger.bugs.map((bug) => bug.id), [critical.id, low.id]);
  assert.equal(ledger.bugs[0].severity, 'critical');
  assert.equal(ledger.bugs[0].checked, false);

  const failedRetest = verifyKnownBugFix(critical.id, {
    ledgerPath,
    run: () => ({ status: 1 }),
    now: '2026-08-28T00:03:00Z',
  });
  assert.equal(failedRetest.ok, false);
  ledger = readKnownBugLedger(ledgerPath);
  assert.equal(ledger.bugs.find((bug) => bug.id === critical.id).checked, false);
  assert.equal(ledger.bugs.find((bug) => bug.id === critical.id).status, 'open');

  const passingRetest = verifyKnownBugFix(critical.id, {
    ledgerPath,
    run: () => ({ status: 0 }),
    now: '2026-08-28T00:04:00Z',
  });
  assert.equal(passingRetest.ok, true);
  ledger = readKnownBugLedger(ledgerPath);
  const resolved = ledger.bugs.find((bug) => bug.id === critical.id);
  assert.equal(resolved.checked, true);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.retests.at(-1).ok, true);
});
