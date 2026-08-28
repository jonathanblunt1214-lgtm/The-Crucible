const core = require('./testCadenceCore');
const {
  createGovernedRunner,
  verifyKnownBugFix,
  TEST_PROGRESS_INTERVAL_MS,
  TEST_PROGRESS_MAX_INTERVAL_MS,
  KNOWN_BUG_SEVERITY_ORDER,
  CATEGORY_CRITICALITY,
  DEFAULT_KNOWN_BUGS_PATH,
  emptyKnownBugLedger,
  severityRank,
  severityForMainCategories,
  validateKnownBugLedger,
  readKnownBugLedger,
  writeKnownBugLedger,
  recordKnownBug,
} = require('./testRunGovernance');

function productionRunner() {
  return createGovernedRunner({ mainCategoryForTest: core.mainCategoryForTest });
}

function withDefaultRunner(run) {
  return run || productionRunner();
}

function runTier(tier, run) {
  return core.runTier(tier, withDefaultRunner(run));
}

function runScheduledTier(tier, run) {
  return core.runScheduledTier(tier, withDefaultRunner(run));
}

function runError(trigger, run) {
  return core.runError(trigger, withDefaultRunner(run));
}

function runChanged(run, changedPaths = null) {
  return core.runChanged(withDefaultRunner(run), changedPaths);
}

function runAll(run) {
  return core.runAll(withDefaultRunner(run));
}

function runCategory(mainCategory, run) {
  return core.runCategory(mainCategory, withDefaultRunner(run));
}

function runRequested(request = 'orchestrator', category = '', run) {
  return core.runRequested(request, category, withDefaultRunner(run));
}

if (require.main === module) {
  const [mode, arg] = process.argv.slice(2);
  try {
    let result;
    let label;
    if (mode === 'on-error') { result = runError(arg); label = `on-error trigger "${arg}"`; }
    else if (mode === 'verify-bug') {
      result = verifyKnownBugFix(arg);
      label = `known bug "${arg}" re-test`;
      result.outcomes = [{ label, ok: result.ok }];
    }
    else if (mode === 'request') {
      const request = process.env.CRUCIBLE_TEST_REQUEST || 'orchestrator';
      const category = process.env.CRUCIBLE_TEST_CATEGORY || arg || '';
      result = runRequested(request, category);
      label = `governed test request "${core.extractTransportedRequest(request)}"`;
    }
    else if (mode === 'scheduled') { result = runScheduledTier(arg); label = `scheduled category cadence "${result.tier}"`; }
    else if (mode === 'category') { result = runCategory(arg); label = `main category "${arg}"`; }
    else if (mode === 'all') { result = runAll(); label = 'full-system proof'; }
    else if (mode === 'changed' || !mode) { result = runChanged(); label = 'change-impact test selection'; }
    else { result = runTier(mode); label = `cadence tier "${result.tier}"`; }
    console.log(`[The Crucible] ${label}: ${result.outcomes.length} check(s) run, ${result.outcomes.filter((item) => !item.ok).length} failed.`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[The Crucible] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ...core,
  TEST_PROGRESS_INTERVAL_MS,
  TEST_PROGRESS_MAX_INTERVAL_MS,
  KNOWN_BUG_SEVERITY_ORDER,
  CATEGORY_CRITICALITY,
  DEFAULT_KNOWN_BUGS_PATH,
  emptyKnownBugLedger,
  severityRank,
  severityForMainCategories,
  validateKnownBugLedger,
  readKnownBugLedger,
  writeKnownBugLedger,
  recordKnownBug,
  verifyKnownBugFix,
  runTier,
  runScheduledTier,
  runError,
  runChanged,
  runAll,
  runCategory,
  runRequested,
};
