const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveSpawn } = require('./runner');

// Escalating tiers: each tier's real-world run includes every tier before
// it, so "weekly" gets everything "every-push" and "daily" already cover
// plus its own additions. This does NOT change what the required Self-Test
// workflow runs on every push - it stays the full suite. This registry is
// additive tooling for *new*, non-required scheduled/reactive runs; moving
// something out of "every-push" here never removes it from the existing
// required check. See AGENTS.md's "Test and audit cadence" section.
const CADENCE_TIERS = ['every-push', 'daily', 'weekly', 'monthly'];

// Unit test files (test/*.js), by the cadence a *new*, separate scheduled
// run should use them at. Defaults to 'every-push' for anything not listed
// below, which is the safe choice: an unlisted file is treated as needing
// the fastest cadence, never silently dropped from a scheduled run.
const TEST_CADENCE = {
  'test/hostedMultiRepositoryIntegration.test.js': 'daily',
  'test/globalRepositoryGovernance.test.js': 'weekly',
};

// The actual CLI gates (npm run <script>), by cadence. 'every-push' here
// matches what .github/workflows/self-test.yml already runs on every push -
// this registry does not change that workflow. The later tiers are for the
// additive scheduled-diagnostics workflow only.
// audit:required-check and audit:handoff are deliberately excluded from
// every tier: both take a specific per-invocation range/context
// (CRUCIBLE_ENFORCEMENT_MODE/DEFAULT_BRANCH/etc for the former, an exact
// HANDOFF_BASE_SHA/HANDOFF_HEAD_SHA commit range for the latter - see
// templates/required-check-rollout.md and .github/workflows/handoff-policy.yml)
// and fail by default with no standing configuration. Neither is meant to
// run unattended on a schedule with no range to check.
const AUDIT_CADENCE = {
  'every-push': ['validate', 'audit:commit', 'precheck', 'audit:clutter', 'audit:privacy', 'audit:security', 'lint:workflows', 'docs:check', 'audit:ai-conflict-governance', 'audit:design-brief', 'audit:governance'],
  daily: ['audit:core-ref', 'audit:authenticity', 'audit:github-security'],
  weekly: ['audit:reproducibility', 'maintain', 'audit:collisions'],
  monthly: [],
};

// Read-only diagnostic escalations run automatically when a specific check
// fails, to surface more context in the same CI run. Every entry here must
// be read-only (never repair/scrub/fix-commit/docs-sync) - this project's
// standing rule against invisible self-repair means an automated on-error
// trigger may look harder, but it may never fix anything unattended. A human
// still has to run `npm run repair` themselves and review the diff.
const ERROR_TRIGGERS = {
  'self-test-failure': ['audit:core-ref', 'audit:github-security', 'audit:collisions'],
  'security-gate-failure': ['audit:github-security', 'audit:collisions'],
  'handoff-policy-failure': ['audit:ai-conflict-governance'],
};

function tierRank(tier) {
  const index = CADENCE_TIERS.indexOf(tier);
  if (index === -1) throw new Error(`Unknown cadence tier "${tier}". Valid tiers: ${CADENCE_TIERS.join(', ')}.`);
  return index;
}

function collectTests(maxRank) {
  const testDir = path.join(__dirname, '..', 'test');
  const files = fs.readdirSync(testDir).filter((name) => name.endsWith('.test.js')).map((name) => path.posix.join('test', name));
  return files.filter((file) => tierRank(TEST_CADENCE[file] || 'every-push') <= maxRank).sort();
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

function runOne(label, invocation, run = spawnSync) {
  console.log(`[The Crucible] Cadence: running ${label}...`);
  const result = run(invocation.executable, invocation.args, { stdio: 'inherit', shell: false });
  const ok = result.status === 0;
  console.log(`[The Crucible] Cadence: ${label} ${ok ? 'passed' : 'FAILED'}.`);
  return ok;
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
  const failed = outcomes.filter((item) => !item.ok);
  return { tier, outcomes, ok: failed.length === 0 };
}

function runError(trigger, run = spawnSync) {
  const scripts = auditsForError(trigger);
  const outcomes = scripts.map((script) => ({ label: `npm run ${script}`, ok: runOne(`npm run ${script}`, npmRunInvocation(script), run) }));
  return { trigger, outcomes, ok: outcomes.every((item) => item.ok) };
}

if (require.main === module) {
  const [mode, arg] = process.argv.slice(2);
  try {
    const result = mode === 'on-error' ? runError(arg) : runTier(mode || 'every-push');
    const label = mode === 'on-error' ? `on-error trigger "${arg}"` : `cadence tier "${result.tier}"`;
    console.log(`[The Crucible] ${label}: ${result.outcomes.length} check(s) run, ${result.outcomes.filter((item) => !item.ok).length} failed.`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[The Crucible] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { CADENCE_TIERS, TEST_CADENCE, AUDIT_CADENCE, ERROR_TRIGGERS, tierRank, testsForTier: (tier) => collectTests(tierRank(tier)), auditsForTier, auditsForError, runTier, runError };
