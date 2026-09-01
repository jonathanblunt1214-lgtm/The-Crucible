const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolveSpawn } = require('./runner');

const CADENCE_TIERS = ['every-push', 'daily', 'weekly', 'monthly'];
const MAIN_CATEGORIES = ['code', 'security', 'utility', 'maintenance'];
const TEST_MAIN_CATEGORIES = {
  code: [
    'test/code-check.test.js',
    'test/codeSecurityOrganism.test.js',
    'test/ciDiagnosticOrgan.test.js',
    'test/circulationLinkage.test.js',
    'test/contradictionAudit.test.js',
    'test/contradictionReopening.test.js',
    'test/documentFurniture.test.js',
    'test/findingLedger.test.js',
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
    'test/gradedOversightResponse.test.js',
    'test/organismCirculation.test.js',
    'test/oversightBrakeReach.test.js',
    'test/organismRuntime.test.js',
    'test/productionOrganism.test.js',
    'test/organismHealth.test.js',
    'test/organismFaultMatrix.test.js',
    'test/concreteLanguageHarness.test.js',
  ],
  security: [
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
  ],
  utility: [
    'test/commit.test.js',
    'test/config.test.js',
    'test/failureIssue.test.js',
    'test/installGitHooks.test.js',
    'test/repair.test.js',
    'test/report.test.js',
    'test/snapshot.test.js',
  ],
  maintenance: [
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
  ],
};
const TEST_CADENCE = {
  'test/hostedMultiRepositoryIntegration.test.js': 'daily',
  'test/globalRepositoryGovernance.test.js': 'weekly',
};
const AUDIT_CADENCE = {
  // audit:circulation runs on every push: fly-by-wire is only mandatory if the ratchet is
  // checked before a new organ-to-organ cable can land, not after.
  'every-push': ['validate', 'audit:commit', 'precheck', 'audit:clutter', 'audit:privacy', 'audit:security', 'audit:circulation', 'lint:workflows', 'docs:check', 'audit:ai-conflict-governance', 'audit:design-brief', 'audit:governance'],
  daily: ['audit:core-ref', 'audit:authenticity', 'audit:github-security'],
  weekly: ['audit:reproducibility', 'maintain', 'audit:collisions'],
  monthly: [],
};
const ERROR_TRIGGERS = {
  'self-test-failure': ['audit:core-ref', 'audit:github-security', 'audit:collisions'],
  'security-gate-failure': ['audit:github-security', 'audit:collisions'],
  'handoff-policy-failure': ['audit:ai-conflict-governance'],
};
const GOVERNANCE_TESTS = ['test/workflow.test.js', 'test/handoffPolicy.test.js', 'test/testCadence.test.js'];
const ORCHESTRATOR_TESTS = ['test/testCadence.test.js', 'test/workflow.test.js'];
const TEST_REQUEST_PREFIX = 'CRUCIBLE TEST REQUEST:';

function tierRank(tier) {
  const index = CADENCE_TIERS.indexOf(tier);
  if (index === -1) throw new Error(`Unknown cadence tier "${tier}". Valid tiers: ${CADENCE_TIERS.join(', ')}.`);
  return index;
}

function discoverTests() {
  const testDir = path.join(__dirname, '..', 'test');
  return fs.readdirSync(testDir).filter((name) => name.endsWith('.test.js')).map((name) => path.posix.join('test', name)).sort();
}

function categoryForTest(file) {
  return path.posix.basename(file).replace(/\.test\.js$/, '');
}

function mainCategoryForTest(file) {
  for (const mainCategory of MAIN_CATEGORIES) {
    if (TEST_MAIN_CATEGORIES[mainCategory].includes(file)) return mainCategory;
  }
  throw new Error(`Unclassified test "${file}". Every discovered test must belong to one of: ${MAIN_CATEGORIES.join(', ')}.`);
}

function validateTestClassification(files = discoverTests()) {
  const discovered = [...files].sort();
  const mapped = MAIN_CATEGORIES.flatMap((category) => TEST_MAIN_CATEGORIES[category] || []);
  const duplicates = mapped.filter((file, index) => mapped.indexOf(file) !== index);
  if (duplicates.length) throw new Error(`Tests mapped to more than one main category: ${[...new Set(duplicates)].join(', ')}.`);
  const stale = mapped.filter((file) => !discovered.includes(file));
  if (stale.length) throw new Error(`Main-category map references missing tests: ${stale.join(', ')}.`);
  const unmapped = discovered.filter((file) => !mapped.includes(file));
  if (unmapped.length) throw new Error(`Unclassified tests: ${unmapped.join(', ')}.`);
  return true;
}

function categorizedTests(files = discoverTests()) {
  validateTestClassification(files);
  return files.map((file) => ({
    file,
    mainCategory: mainCategoryForTest(file),
    category: categoryForTest(file),
    subcategory: categoryForTest(file),
    cadence: TEST_CADENCE[file] || 'every-push',
  }));
}

function collectTests(maxRank) {
  return categorizedTests().filter((item) => tierRank(item.cadence) <= maxRank).map((item) => item.file);
}

function auditsForTier(tier) {
  const maxRank = tierRank(tier);
  const scripts = [];
  for (const candidate of CADENCE_TIERS) {
    if (tierRank(candidate) > maxRank) break;
    scripts.push(...(AUDIT_CADENCE[candidate] || []));
  }
  return scripts;
}

function auditsForError(trigger) {
  const scripts = ERROR_TRIGGERS[trigger];
  if (!scripts) throw new Error(`Unknown on-error trigger "${trigger}". Known triggers: ${Object.keys(ERROR_TRIGGERS).join(', ')}.`);
  return scripts;
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

function selectionResult(tests, all, reason) {
  const sorted = [...tests].sort();
  return {
    tests: sorted,
    mainCategories: [...new Set(sorted.map(mainCategoryForTest))].sort(),
    categories: sorted.map(categoryForTest),
    fullSuite: sorted.length === all.length,
    reason,
  };
}

function selectTestsForCategory(mainCategory, files = discoverTests()) {
  const all = [...files].sort();
  validateTestClassification(all);
  if (!MAIN_CATEGORIES.includes(mainCategory)) {
    throw new Error(`Unknown main category "${mainCategory}". Valid categories: ${MAIN_CATEGORIES.join(', ')}.`);
  }
  const selected = TEST_MAIN_CATEGORIES[mainCategory].filter((file) => all.includes(file));
  return selectionResult(selected, all, `explicit governed category request: ${mainCategory}`);
}

function selectTestsForChanges(changedPaths, files = discoverTests()) {
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
      addKnown(selected, GOVERNANCE_TESTS, all);
      continue;
    }
    if (changedFile.startsWith('.github/workflows/') || changedFile.startsWith('.githooks/')) {
      addKnown(selected, ['test/workflow.test.js'], all);
      continue;
    }
    if (changedFile === 'package.json' || changedFile === 'package-lock.json') {
      addKnown(selected, ORCHESTRATOR_TESTS, all);
      continue;
    }

    const tokens = sourceReferenceTokens(changedFile);
    let matched = false;
    const changedStem = path.posix.basename(changedFile).replace(/\.js$/, '');
    for (const file of all) {
      const body = testBodies.get(file);
      if (categoryForTest(file) === changedStem || tokens.some((token) => body.includes(token))) {
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

function changedFilesFromGit(base = process.env.CRUCIBLE_BASE_SHA, head = process.env.CRUCIBLE_HEAD_SHA, run = spawnSync) {
  const args = base && head && !/^0+$/.test(base) ? ['diff', '--name-only', base, head] : ['diff', '--name-only', 'HEAD^', 'HEAD'];
  const result = run('git', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8', shell: false });
  if (result.status !== 0) return [];
  return String(result.stdout || '').split(/\r?\n/).map(normalizeChangedPath).filter(Boolean);
}

function runOne(label, invocation, run = spawnSync) {
  console.log(`[The Crucible] Orchestrator: running ${label}...`);
  const result = run(invocation.executable, invocation.args, { stdio: 'inherit', shell: false });
  const ok = result.status === 0;
  console.log(`[The Crucible] Orchestrator: ${label} ${ok ? 'passed' : 'FAILED'}.`);
  return ok;
}

function runTestSelection(selection, run = spawnSync) {
  console.log(`[The Crucible] Orchestrator: ${selection.reason}.`);
  console.log(`[The Crucible] Orchestrator: selected main categories: ${selection.mainCategories.join(', ') || '(none)'}.`);
  console.log(`[The Crucible] Orchestrator: selected ${selection.tests.length}/${discoverTests().length} test subcategories: ${selection.categories.join(', ') || '(none)'}.`);
  const ok = selection.tests.length === 0 || runOne('selected tests', { executable: process.execPath, args: ['--test', ...selection.tests] }, run);
  return { selection, outcomes: [{ label: `selected tests (${selection.tests.length} file(s))`, ok }], ok };
}

function runChanged(run = spawnSync, changedPaths = null) {
  const changed = changedPaths || changedFilesFromGit(undefined, undefined, run);
  console.log(`[The Crucible] Orchestrator: changed paths: ${changed.join(', ') || '(unavailable)'}.`);
  return runTestSelection(selectTestsForChanges(changed), run);
}

function runAll(run = spawnSync) {
  const tests = discoverTests();
  validateTestClassification(tests);
  return runTestSelection(selectionResult(tests, tests, 'explicit full-system proof'), run);
}

function runCategory(mainCategory, run = spawnSync) {
  return runTestSelection(selectTestsForCategory(mainCategory), run);
}

function extractTransportedRequest(request, source = process.env.CRUCIBLE_TEST_REQUEST_SOURCE || '') {
  const raw = String(request || '').trim();
  if (source === 'pull_request') return 'orchestrator';
  if (source === 'push') {
    const match = raw.match(/^CRUCIBLE TEST REQUEST:\s*(.+)$/im);
    return match ? match[1].trim() : 'orchestrator';
  }
  return raw || 'orchestrator';
}

function deterministicMainCategory(request, seed = process.env.CRUCIBLE_HEAD_SHA || '') {
  const digest = crypto.createHash('sha256').update(`${seed}\n${request}`).digest();
  return MAIN_CATEGORIES[digest.readUInt32BE(0) % MAIN_CATEGORIES.length];
}

function interpretTestRequest(request = 'orchestrator', category = '', source = process.env.CRUCIBLE_TEST_REQUEST_SOURCE || '') {
  const text = extractTransportedRequest(request, source);
  const normalized = text.toLowerCase();

  if (normalized === 'orchestrator') return { request: text, mode: 'orchestrator', category: '' };
  if (normalized === 'all' || /\b(?:run|test)\s+all\b/.test(normalized) || /\ball\s+(?:tests?|testing)\b/.test(normalized)) {
    return { request: text, mode: 'all', category: '' };
  }
  if (normalized === 'category') {
    if (!MAIN_CATEGORIES.includes(category)) throw new Error(`Unknown main category "${category}". Valid categories: ${MAIN_CATEGORIES.join(', ')}.`);
    return { request: text, mode: 'category', category };
  }
  if (/\brandom\b/.test(normalized) && /\bcategory\b/.test(normalized)) {
    return { request: text, mode: 'category', category: deterministicMainCategory(text) };
  }

  const mentioned = MAIN_CATEGORIES.filter((mainCategory) => new RegExp(`\\b${mainCategory}\\b`, 'i').test(text));
  if (mentioned.length === 1) return { request: text, mode: 'category', category: mentioned[0] };
  if (mentioned.length > 1) throw new Error(`Ambiguous governed test request "${text}" names multiple main categories: ${mentioned.join(', ')}.`);

  return { request: text, mode: 'orchestrator', category: '' };
}

function runRequested(request = 'orchestrator', category = '', run = spawnSync) {
  const decision = interpretTestRequest(request, category);
  console.log(`[The Crucible] Orchestrator: received test request: ${decision.request}.`);
  if (decision.mode === 'all') return runAll(run);
  if (decision.mode === 'category') {
    console.log(`[The Crucible] Orchestrator: request decision: category ${decision.category}.`);
    return runCategory(decision.category, run);
  }
  console.log('[The Crucible] Orchestrator: request decision: change-impact selection.');
  return runChanged(run);
}

function npmRunInvocation(script) {
  return resolveSpawn({ run: 'npm', args: ['run', script] });
}

function runTier(tier, run = spawnSync) {
  const tests = collectTests(tierRank(tier));
  const audits = auditsForTier(tier);
  const outcomes = [];
  if (tests.length) outcomes.push({ label: `unit tests (${tests.length} file(s) at or below "${tier}")`, ok: runOne('unit tests', { executable: process.execPath, args: ['--test', ...tests] }, run) });
  for (const script of audits) outcomes.push({ label: `npm run ${script}`, ok: runOne(`npm run ${script}`, npmRunInvocation(script), run) });
  return { tier, outcomes, ok: outcomes.every((item) => item.ok) };
}

function runError(trigger, run = spawnSync) {
  const scripts = auditsForError(trigger);
  const outcomes = scripts.map((script) => ({ label: `npm run ${script}`, ok: runOne(`npm run ${script}`, npmRunInvocation(script), run) }));
  return { trigger, outcomes, ok: outcomes.every((item) => item.ok) };
}

if (require.main === module) {
  const [mode, arg] = process.argv.slice(2);
  try {
    let result;
    let label;
    if (mode === 'on-error') { result = runError(arg); label = `on-error trigger "${arg}"`; }
    else if (mode === 'request') {
      const request = process.env.CRUCIBLE_TEST_REQUEST || 'orchestrator';
      const category = process.env.CRUCIBLE_TEST_CATEGORY || arg || '';
      result = runRequested(request, category);
      label = `governed test request "${extractTransportedRequest(request)}"`;
    }
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
  CADENCE_TIERS, MAIN_CATEGORIES, TEST_MAIN_CATEGORIES, TEST_CADENCE, AUDIT_CADENCE, ERROR_TRIGGERS,
  tierRank, discoverTests, categoryForTest, mainCategoryForTest, validateTestClassification, categorizedTests,
  testsForTier: (tier) => collectTests(tierRank(tier)), auditsForTier, auditsForError,
  selectTestsForCategory, selectTestsForChanges, changedFilesFromGit, extractTransportedRequest, deterministicMainCategory,
  interpretTestRequest, runTier, runError, runChanged, runAll, runCategory, runRequested,
};
