const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveSpawn } = require('./runner');

const CADENCE_TIERS = ['every-push', 'daily', 'weekly', 'monthly'];
const TEST_CADENCE = {
  'test/hostedMultiRepositoryIntegration.test.js': 'daily',
  'test/globalRepositoryGovernance.test.js': 'weekly',
};
const AUDIT_CADENCE = {
  'every-push': ['validate', 'audit:commit', 'precheck', 'audit:clutter', 'audit:privacy', 'audit:security', 'lint:workflows', 'docs:check', 'audit:ai-conflict-governance', 'audit:design-brief', 'audit:governance'],
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

function categorizedTests(files = discoverTests()) {
  return files.map((file) => ({ file, category: categoryForTest(file), cadence: TEST_CADENCE[file] || 'every-push' }));
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

function selectTestsForChanges(changedPaths, files = discoverTests()) {
  const all = [...files].sort();
  const changed = [...new Set((changedPaths || []).map(normalizeChangedPath).filter(Boolean))];
  if (!changed.length) return { tests: all, categories: all.map(categoryForTest), fullSuite: true, reason: 'no change range available; fail-safe full suite' };

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

  if (uncertain || !selected.size) return { tests: all, categories: all.map(categoryForTest), fullSuite: true, reason: uncertain ? 'unmapped runtime impact; fail-safe full suite' : 'no impacted category found; fail-safe full suite' };
  const tests = [...selected].sort();
  return { tests, categories: tests.map(categoryForTest), fullSuite: tests.length === all.length, reason: 'impacted categories only' };
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
  console.log(`[The Crucible] Orchestrator: selected ${selection.tests.length}/${discoverTests().length} test file categories: ${selection.categories.join(', ') || '(none)'}.`);
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
  return runTestSelection({ tests, categories: tests.map(categoryForTest), fullSuite: true, reason: 'explicit full-system proof' }, run);
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
  CADENCE_TIERS, TEST_CADENCE, AUDIT_CADENCE, ERROR_TRIGGERS,
  tierRank, discoverTests, categoryForTest, categorizedTests,
  testsForTier: (tier) => collectTests(tierRank(tier)), auditsForTier, auditsForError,
  selectTestsForChanges, changedFilesFromGit, runTier, runError, runChanged, runAll,
};