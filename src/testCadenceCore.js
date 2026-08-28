const { spawnSync } = require('node:child_process');
const legacy = require('./testCadenceCoreLegacy');
const cadence = require('./testCadencePolicy');
const { resolveSpawn } = require('./runner');

const SCHEDULED_CADENCE_TIERS = cadence.CADENCE_TIERS;
const CATEGORY_CADENCE = cadence.CATEGORY_CADENCE;

function scheduledTierRank(tier) {
  return cadence.tierRank(tier);
}

function scheduledCategoriesForTier(tier) {
  return cadence.cadenceObligation(tier, legacy.MAIN_CATEGORIES).dueCategories;
}

function orchestratorTestsForCategories(categories) {
  return categories.flatMap((category) => legacy.selectTestsForCategory(category)).sort();
}

function verifyCadenceSelection(obligation, tests) {
  const selectedCategories = new Set(tests.map((testFile) => legacy.mainCategoryForTest(testFile)));
  const missingCategories = obligation.dueCategories.filter((category) => !selectedCategories.has(category));
  if (missingCategories.length) {
    throw new Error(`Cadence check rejected Orchestrator selection: missing due categor${missingCategories.length === 1 ? 'y' : 'ies'} ${missingCategories.join(', ')} for ${obligation.tier}.`);
  }
  return Object.freeze({
    tier: obligation.tier,
    dueCategories: obligation.dueCategories,
    selectedCategories: Object.freeze([...selectedCategories].sort()),
    ok: true,
  });
}

function scheduledTestsForTier(tier) {
  const obligation = cadence.cadenceObligation(tier, legacy.MAIN_CATEGORIES);
  const tests = orchestratorTestsForCategories(obligation.dueCategories);
  verifyCadenceSelection(obligation, tests);
  return tests;
}

function scheduledAuditsForTier(tier) {
  scheduledTierRank(tier);
  if (tier === 'twice-weekly') return legacy.auditsForTier('daily');
  return legacy.auditsForTier(tier);
}

function runOne(label, invocation, run = spawnSync) {
  console.log(`[The Crucible] Orchestrator: running ${label}...`);
  const result = run(invocation.executable, invocation.args, { stdio: 'inherit', shell: false });
  const ok = result.status === 0;
  console.log(`[The Crucible] Orchestrator: ${label} ${ok ? 'passed' : 'FAILED'}.`);
  return ok;
}

function npmRunInvocation(script) {
  return resolveSpawn({ run: 'npm', args: ['run', script] });
}

function runScheduledTests(tier, run = spawnSync) {
  const obligation = cadence.cadenceObligation(tier, legacy.MAIN_CATEGORIES);
  const tests = orchestratorTestsForCategories(obligation.dueCategories);
  const balance = verifyCadenceSelection(obligation, tests);
  const outcomes = [];

  console.log(`[The Crucible] Cadence check: ${tier}; categories due: ${obligation.dueCategories.join(', ') || '(none)'}.`);
  console.log(`[The Crucible] Orchestrator: independently selected ${tests.length} test file(s); cadence balance passed.`);
  if (tests.length) {
    outcomes.push({
      label: `scheduled tests (${tests.length} file(s), ${obligation.dueCategories.join(', ')})`,
      ok: runOne('scheduled tests', { executable: process.execPath, args: ['--test', ...tests] }, run),
    });
  }

  return { tier, categories: obligation.dueCategories, tests, obligation, balance, outcomes, ok: outcomes.every((item) => item.ok) };
}

function runScheduledTier(tier, run = spawnSync) {
  const testResult = runScheduledTests(tier, run);
  const audits = scheduledAuditsForTier(tier);
  const outcomes = [...testResult.outcomes];

  for (const script of audits) {
    outcomes.push({ label: `npm run ${script}`, ok: runOne(`npm run ${script}`, npmRunInvocation(script), run) });
  }

  return {
    tier,
    categories: testResult.categories,
    tests: testResult.tests,
    obligation: testResult.obligation,
    balance: testResult.balance,
    audits,
    outcomes,
    ok: outcomes.every((item) => item.ok),
  };
}

module.exports = {
  ...legacy,
  SCHEDULED_CADENCE_TIERS,
  CATEGORY_CADENCE,
  scheduledTierRank,
  scheduledCategoriesForTier,
  orchestratorTestsForCategories,
  verifyCadenceSelection,
  scheduledTestsForTier,
  scheduledAuditsForTier,
  runScheduledTests,
  runScheduledTier,
};
