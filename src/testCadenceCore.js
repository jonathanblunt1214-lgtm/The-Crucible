const { spawnSync } = require('node:child_process');
const legacy = require('./testCadenceCoreLegacy');
const { resolveSpawn } = require('./runner');

const SCHEDULED_CADENCE_TIERS = ['every-push', 'daily', 'twice-weekly', 'weekly', 'monthly'];
const CATEGORY_CADENCE = Object.freeze({
  code: 'every-push',
  security: 'daily',
  utility: 'twice-weekly',
  maintenance: 'weekly',
});

function scheduledTierRank(tier) {
  const index = SCHEDULED_CADENCE_TIERS.indexOf(tier);
  if (index === -1) {
    throw new Error(`Unknown scheduled cadence tier "${tier}". Valid tiers: ${SCHEDULED_CADENCE_TIERS.join(', ')}.`);
  }
  return index;
}

function scheduledCategoriesForTier(tier) {
  const maxRank = scheduledTierRank(tier);
  return legacy.MAIN_CATEGORIES.filter((category) => scheduledTierRank(CATEGORY_CADENCE[category]) <= maxRank);
}

function scheduledTestsForTier(tier) {
  const categories = scheduledCategoriesForTier(tier);
  return categories.flatMap((category) => legacy.TEST_MAIN_CATEGORIES[category]).sort();
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

function runScheduledTier(tier, run = spawnSync) {
  const categories = scheduledCategoriesForTier(tier);
  const tests = scheduledTestsForTier(tier);
  const audits = scheduledAuditsForTier(tier);
  const outcomes = [];

  console.log(`[The Crucible] Orchestrator: scheduled cadence ${tier}; categories due: ${categories.join(', ') || '(none)'}.`);
  if (tests.length) {
    outcomes.push({
      label: `scheduled tests (${tests.length} file(s), ${categories.join(', ')})`,
      ok: runOne('scheduled tests', { executable: process.execPath, args: ['--test', ...tests] }, run),
    });
  }
  for (const script of audits) {
    outcomes.push({ label: `npm run ${script}`, ok: runOne(`npm run ${script}`, npmRunInvocation(script), run) });
  }
  return { tier, categories, tests, outcomes, ok: outcomes.every((item) => item.ok) };
}

module.exports = {
  ...legacy,
  SCHEDULED_CADENCE_TIERS,
  CATEGORY_CADENCE,
  scheduledTierRank,
  scheduledCategoriesForTier,
  scheduledTestsForTier,
  scheduledAuditsForTier,
  runScheduledTier,
};
