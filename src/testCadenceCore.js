const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const legacy = require('./testCadenceCoreLegacy');
const cadence = require('./testCadencePolicy');
const featureClassifier = require('./testFeatureClassifier');
const { resolveSpawn } = require('./runner');

const SCHEDULED_CADENCE_TIERS = cadence.CADENCE_TIERS;
const CATEGORY_CADENCE = cadence.CATEGORY_CADENCE;

function knownMainCategoryForTest(file) {
  for (const category of legacy.MAIN_CATEGORIES) {
    if ((legacy.TEST_MAIN_CATEGORIES[category] || []).includes(file)) return category;
  }
  return null;
}

function classificationForTest(file, options = {}) {
  const known = knownMainCategoryForTest(file);
  if (known) return Object.freeze({ file, category: known, source: 'explicit-map', reason: 'explicit main-category map' });
  return featureClassifier.classifyTestByClosestFeature(file, {
    knownCategoryMap: legacy.TEST_MAIN_CATEGORIES,
    ...options,
  });
}

function mainCategoryForTest(file, options = {}) {
  const result = classificationForTest(file, options);
  if (result.category) return result.category;
  throw new Error(`Unclassified test "${file}". Independent closest-feature classifier could not safely categorize it: ${result.reason}.`);
}

function validateTestClassification(files = legacy.discoverTests(), options = {}) {
  const discovered = [...files].sort();
  const mapped = legacy.MAIN_CATEGORIES.flatMap((category) => legacy.TEST_MAIN_CATEGORIES[category] || []);
  const duplicates = mapped.filter((file, index) => mapped.indexOf(file) !== index);
  if (duplicates.length) throw new Error(`Tests mapped to more than one main category: ${[...new Set(duplicates)].join(', ')}.`);
  const stale = mapped.filter((file) => !discovered.includes(file));
  if (stale.length) throw new Error(`Main-category map references missing tests: ${stale.join(', ')}.`);
  for (const file of discovered) mainCategoryForTest(file, options);
  return true;
}

function categorizedTests(files = legacy.discoverTests()) {
  validateTestClassification(files);
  return files.map((file) => ({
    file,
    mainCategory: mainCategoryForTest(file),
    category: legacy.categoryForTest(file),
    subcategory: legacy.categoryForTest(file),
    cadence: legacy.TEST_CADENCE[file] || 'every-push',
    classificationSource: classificationForTest(file).source,
  }));
}

function selectionResult(tests, all, reason) {
  const sorted = [...new Set(tests)].sort();
  return {
    tests: sorted,
    mainCategories: [...new Set(sorted.map((file) => mainCategoryForTest(file)))].sort(),
    categories: sorted.map((file) => legacy.categoryForTest(file)),
    fullSuite: sorted.length === all.length,
    reason,
  };
}

function selectTestsForCategory(mainCategory, files = legacy.discoverTests()) {
  const all = [...files].sort();
  validateTestClassification(all);
  if (!legacy.MAIN_CATEGORIES.includes(mainCategory)) {
    throw new Error(`Unknown main category "${mainCategory}". Valid categories: ${legacy.MAIN_CATEGORIES.join(', ')}.`);
  }
  return selectionResult(all.filter((file) => mainCategoryForTest(file) === mainCategory), all, `explicit governed category request: ${mainCategory}`);
}

function scheduledTierRank(tier) {
  return cadence.tierRank(tier);
}

function scheduledCategoriesForTier(tier) {
  return cadence.cadenceObligation(tier, legacy.MAIN_CATEGORIES).dueCategories;
}

function orchestratorTestsForCategories(categories) {
  return categories.flatMap((category) => selectTestsForCategory(category).tests).sort();
}

function verifyCadenceSelection(obligation, tests) {
  const selectedCategories = new Set(tests.map((testFile) => mainCategoryForTest(testFile)));
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

function normalizeChangedPath(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function sourceReferenceTokens(changed) {
  const normalized = normalizeChangedPath(changed);
  const noExt = normalized.replace(/\.js$/, '');
  const base = path.posix.basename(noExt);
  const tokens = new Set([normalized, noExt, base]);
  if (normalized.startsWith('src/')) {
    tokens.add(`../${noExt}`);
    tokens.add(`../${normalized}`);
  }
  return [...tokens].filter(Boolean);
}

function addKnown(selected, candidates, all) {
  for (const file of candidates) if (all.includes(file)) selected.add(file);
}

function selectTestsForChanges(changedPaths, files = legacy.discoverTests()) {
  const all = [...files].sort();
  validateTestClassification(all);
  const changed = [...new Set((changedPaths || []).map(normalizeChangedPath).filter(Boolean))];
  if (!changed.length) return selectionResult(all, all, 'no change range available; fail-safe full suite');

  const selected = new Set();
  let uncertain = false;
  const root = path.join(__dirname, '..');
  const testBodies = new Map(all.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));

  for (const changedFile of changed) {
    if (changedFile.startsWith('test/') && changedFile.endsWith('.test.js')) {
      if (all.includes(changedFile)) selected.add(changedFile);
      continue;
    }
    if (/^(AGENTS\.md|CLAUDE\.md|AI-HANDOFF\.json|DEVLOG\.md|AI-CONFLICTS\.json)$/.test(changedFile)) {
      addKnown(selected, ['test/workflow.test.js', 'test/handoffPolicy.test.js', 'test/testCadence.test.js'], all);
      continue;
    }
    if (changedFile.startsWith('.github/workflows/') || changedFile.startsWith('.githooks/')) {
      addKnown(selected, ['test/workflow.test.js'], all);
      continue;
    }
    if (changedFile === 'package.json' || changedFile === 'package-lock.json') {
      addKnown(selected, ['test/testCadence.test.js', 'test/workflow.test.js'], all);
      continue;
    }

    const tokens = sourceReferenceTokens(changedFile);
    const changedStem = path.posix.basename(changedFile).replace(/\.js$/, '');
    let matched = false;
    for (const file of all) {
      const body = testBodies.get(file);
      if (legacy.categoryForTest(file) === changedStem || tokens.some((token) => body.includes(token))) {
        selected.add(file);
        matched = true;
      }
    }
    if (!matched && !/\.(md|txt)$/.test(changedFile)) uncertain = true;
  }

  if (uncertain || !selected.size) {
    return selectionResult(all, all, uncertain ? 'unmapped runtime impact; fail-safe full suite' : 'no impacted category found; fail-safe full suite');
  }
  return selectionResult([...selected], all, 'impacted categories only');
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

function runTestSelection(selection, run = spawnSync) {
  console.log(`[The Crucible] Orchestrator: ${selection.reason}.`);
  console.log(`[The Crucible] Orchestrator: selected main categories: ${selection.mainCategories.join(', ') || '(none)'}.`);
  console.log(`[The Crucible] Orchestrator: selected ${selection.tests.length}/${legacy.discoverTests().length} test subcategories: ${selection.categories.join(', ') || '(none)'}.`);
  const ok = selection.tests.length === 0 || runOne('selected tests', { executable: process.execPath, args: ['--test', ...selection.tests] }, run);
  return { selection, outcomes: [{ label: `selected tests (${selection.tests.length} file(s))`, ok }], ok };
}

function runChanged(run = spawnSync, changedPaths = null) {
  const changed = changedPaths || legacy.changedFilesFromGit(undefined, undefined, run);
  console.log(`[The Crucible] Orchestrator: changed paths: ${changed.join(', ') || '(unavailable)'}.`);
  return runTestSelection(selectTestsForChanges(changed), run);
}

function runAll(run = spawnSync) {
  const tests = legacy.discoverTests();
  validateTestClassification(tests);
  return runTestSelection(selectionResult(tests, tests, 'explicit full-system proof'), run);
}

function runCategory(mainCategory, run = spawnSync) {
  return runTestSelection(selectTestsForCategory(mainCategory), run);
}

function runRequested(request = 'orchestrator', category = '', run = spawnSync) {
  const decision = legacy.interpretTestRequest(request, category);
  console.log(`[The Crucible] Orchestrator: received test request: ${decision.request}.`);
  if (decision.mode === 'all') return runAll(run);
  if (decision.mode === 'category') {
    console.log(`[The Crucible] Orchestrator: request decision: category ${decision.category}.`);
    return runCategory(decision.category, run);
  }
  console.log('[The Crucible] Orchestrator: request decision: change-impact selection.');
  return runChanged(run);
}

function runScheduledTests(tier, run = spawnSync) {
  const obligation = cadence.cadenceObligation(tier, legacy.MAIN_CATEGORIES);
  const tests = orchestratorTestsForCategories(obligation.dueCategories);
  const balance = verifyCadenceSelection(obligation, tests);
  const outcomes = [];
  console.log(`[The Crucible] Cadence check: ${tier}; categories due: ${obligation.dueCategories.join(', ') || '(none)'}.`);
  console.log(`[The Crucible] Orchestrator: independently selected ${tests.length} test file(s); cadence balance passed.`);
  if (tests.length) outcomes.push({ label: `scheduled tests (${tests.length} file(s), ${obligation.dueCategories.join(', ')})`, ok: runOne('scheduled tests', { executable: process.execPath, args: ['--test', ...tests] }, run) });
  return { tier, categories: obligation.dueCategories, tests, obligation, balance, outcomes, ok: outcomes.every((item) => item.ok) };
}

function runScheduledTier(tier, run = spawnSync) {
  const testResult = runScheduledTests(tier, run);
  const audits = scheduledAuditsForTier(tier);
  const outcomes = [...testResult.outcomes];
  for (const script of audits) outcomes.push({ label: `npm run ${script}`, ok: runOne(`npm run ${script}`, npmRunInvocation(script), run) });
  return { tier, categories: testResult.categories, tests: testResult.tests, obligation: testResult.obligation, balance: testResult.balance, audits, outcomes, ok: outcomes.every((item) => item.ok) };
}

module.exports = {
  ...legacy,
  SCHEDULED_CADENCE_TIERS,
  CATEGORY_CADENCE,
  knownMainCategoryForTest,
  classificationForTest,
  mainCategoryForTest,
  validateTestClassification,
  categorizedTests,
  selectTestsForCategory,
  selectTestsForChanges,
  scheduledTierRank,
  scheduledCategoriesForTier,
  orchestratorTestsForCategories,
  verifyCadenceSelection,
  scheduledTestsForTier,
  scheduledAuditsForTier,
  runTestSelection,
  runChanged,
  runAll,
  runCategory,
  runRequested,
  runScheduledTests,
  runScheduledTier,
};
