const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('reusable workflow is read-only and uses the exact caller-supplied core ref', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), 'utf8');
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /ref: \$\{\{ inputs\.core_ref \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /contents: write|git push/);
  assert.match(workflow, /CRUCIBLE_REPORT_PATH: \$\{\{ github\.workspace \}\}\/\.the-crucible-report\.json/);
  assert.doesNotMatch(workflow, /runner\.temp/);
  assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /Run Security Gate[\s\S]*cli\.js security[\s\S]*Run verification and bounded workload/);
  assert.match(workflow, /overlapping open pull requests[\s\S]*cli\.js collisions/);
  assert.match(workflow, /Pre-check changed commit and code[\s\S]*cli\.js precheck/);
  assert.match(workflow, /cli\.js design-brief[\s\S]*cli\.js core-ref[\s\S]*cli\.js validate/);
  assert.match(workflow, /Scan the checked-out Crucible engine code for malicious patterns[\s\S]*CRUCIBLE_PROJECT_ROOT: \$\{\{ github\.workspace \}\}\/\.the-crucible-runtime[\s\S]*cli\.js security/);
  assert.match(workflow, /Create or update the Crucible failure issue[\s\S]*if: failure\(\)[\s\S]*cli\.js failure-issue/);
  assert.match(workflow, /malware_scan:[\s\S]*type: boolean/);
  assert.match(workflow, /Install ClamAV for the malware scan[\s\S]*if: inputs\.malware_scan[\s\S]*apt-get install -y clamav[\s\S]*Run Security Gate/);
  assert.match(workflow, /Save quarantined flagged files[\s\S]*if: failure\(\)[\s\S]*the-crucible-quarantine-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]*if-no-files-found: ignore/);
});

test('a severed design-brief link fails every check, unconditionally, before anything else', () => {
  const brief = fs.readFileSync(path.join(root, 'templates', 'the-crucible-design-brief.md'), 'utf8');
  const boundaries = fs.readFileSync(path.join(root, 'templates', 'agent-boundaries.md'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const doc of [brief, boundaries]) assert.match(doc, /not yours to delete/i);
  assert.match(readme, /Severing: what happens if the installed design brief is deleted/);
  assert.match(readme, /never installed in this repository's history at all/);
  assert.match(readme, /removing the caller workflow and `\.thecrucible\.json` entirely/);
});

test('caller template schedules daily clutter and weekly maintenance', () => {
  const workflow = fs.readFileSync(path.join(root, 'templates', 'caller-workflow.yml'), 'utf8');
  assert.match(workflow, /cron: '17 3 \* \* \*'/);
  assert.match(workflow, /cron: '47 4 \* \* 0'/);
  assert.match(workflow, /weekly_maintenance:.*47 4 \* \* 0/);
  assert.equal((workflow.match(/REPLACE_WITH_EXACT_COMMIT_SHA/g) || []).length, 2);
  assert.match(workflow, /issues: write/);
});

test('documentation explicitly covers behavior, limits, and non-goals', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const statement of ['Exactly what it does', 'Every 24 hours', 'Weekly', 'does not rebase', 'does not silently delete clutter', 'What it deliberately does not do']) assert.match(readme, new RegExp(statement, 'i'));
});

test('agent boundaries document forbids touching anything installed to run the Crucible, and self-repair', () => {
  const boundaries = fs.readFileSync(path.join(root, 'templates', 'agent-boundaries.md'), 'utf8');
  assert.match(boundaries, /never modify anything installed to run The Crucible/i);
  assert.match(boundaries, /core_ref/);
  assert.match(boundaries, /never self-repair/i);
  assert.match(boundaries, /human-reviewed pull request/i);
  assert.match(boundaries, /not this repository's bug/i);
  assert.match(boundaries, /untrusted input/i);
  assert.match(boundaries, /not a two-way link/i);
  assert.match(boundaries, /belongs to The Crucible\s*\n?\s*repository, not to this one/i);
  assert.match(boundaries, /not a collaborator/i);
  assert.match(boundaries, /zero access to The Crucible unless a check\s*\n?\s*is actively running/i);
  assert.match(boundaries, /severed the moment the check/i);
  assert.match(boundaries, /persist-credentials: false/);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /agent-boundaries\.md/);
  assert.match(readme, /persist-credentials: false.*ephemeral runner/);
});

test('connect workflow requires main and a development branch in its two-phase project bootstrap', () => {
  const workflow = fs.readFileSync(path.join(root, 'templates', 'connect-workflow.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\n\s*push:|\n\s*pull_request:|\n\s*schedule:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /options: \[install, activate\]/);
  assert.match(workflow, /default branch must be main/);
  assert.match(workflow, /test "\$DEFAULT_BRANCH" = main/);
  assert.match(workflow, /test "\$SELECTED_BRANCH" = main/);
  assert.match(workflow, /git ls-remote --exit-code --heads origin refs\/heads\/Development-branch/);
  assert.match(workflow, /HEAD:refs\/heads\/Development-branch/);
  assert.match(workflow, /Refusing to replace existing Development-branch/);
  assert.match(workflow, /Both required branches now exist: main and Development-branch/);
  assert.match(workflow, /THE-CRUCIBLE-DESIGN-BRIEF\.md/);
  assert.match(workflow, /AI-CONFLICTS\.json/);
  assert.match(workflow, /AI-HANDOFF\.json/);
  assert.match(workflow, /ai-conflict-governance\.yml/);
  assert.match(workflow, /ai-handoff-policy\.yml/);
  assert.match(workflow, /templates\/the-crucible-design-brief\.md/);
  assert.match(workflow, /git status --porcelain/);
  assert.match(workflow, /Refusing to commit/);
  assert.match(workflow, /ACTIVATE_CRUCIBLE_GOVERNANCE/);
  assert.match(workflow, /CRUCIBLE_ADMIN_TOKEN/);
  assert.match(workflow, /representative pull request/i);
  assert.match(workflow, /AI conflict governance/);
  assert.match(workflow, /AI handoff policy/);
  assert.match(workflow, /bypass_actors:\[\]/);
  assert.match(workflow, /~DEFAULT_BRANCH/);
  assert.match(workflow, /exclude:\["refs\/heads\/main","refs\/heads\/Development-branch"\]/);
  assert.equal((workflow.match(/REPLACE_WITH_EXACT_COMMIT_SHA/g) || []).length, 1);
});

test('installed design brief matches the agent-boundaries rules and explains the one-time write', () => {
  const brief = fs.readFileSync(path.join(root, 'templates', 'the-crucible-design-brief.md'), 'utf8');
  assert.match(brief, /never modify anything installed to run The Crucible/i);
  assert.match(brief, /never self-repair/i);
  assert.match(brief, /not your bug/i);
  assert.match(brief, /connect-workflow\.yml/);
  assert.match(brief, /it is spent/i);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /connect-workflow\.yml/);
  assert.match(readme, /delete `\.github\/workflows\/connect-the-crucible\.yml`/);
});

test('engine changes test across supported operating systems before adoption', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'self-test.yml'), 'utf8');
  const codeql = fs.readFileSync(path.join(root, '.github', 'workflows', 'codeql.yml'), 'utf8');
  assert.match(workflow, /push:\s*\n\s*branches: \[main, development\]/);
  assert.match(codeql, /push:\s*\n\s*branches: \[main, development\]/);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(workflow, /node: \[20, 22, 24\]/);
  assert.match(workflow, /npm test[\s\S]*npm run validate[\s\S]*npm run audit:clutter[\s\S]*npm run audit:security[\s\S]*npm run precheck[\s\S]*npm run run/);
});

test('hosted multi-repository integration remains manual and report-only', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'multi-repository-integration.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\n\s*push:|\n\s*pull_request:|\n\s*schedule:/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write/);
  assert.match(workflow, /Multi-repository integration report/);
  assert.match(workflow, /hostedMultiRepositoryIntegration\.js/);
});

test('canonical source is refreshed every 15 minutes only after verification', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'canonical-snapshot.yml'), 'utf8');
  assert.match(workflow, /cron: '\*\/15 \* \* \* \*'/);
  assert.match(workflow, /npm test[\s\S]*npm run validate[\s\S]*npm run audit:security/);
  assert.match(workflow, /HEAD:refs\/heads\/crucible-canonical/);
});

test('recovery from the canonical snapshot requires a human to manually dispatch it with the exact failing SHA', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'internal-recovery.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*workflow_run:|\n\s*schedule:|\n\s*push:/);
  assert.match(workflow, /failed_sha:[\s\S]*required: true/);
  assert.match(workflow, /invisible self-repair/i);
  assert.match(workflow, /git read-tree --reset -u origin\/crucible-canonical/);
  assert.match(workflow, /git commit -m "Recover Crucible/);
  assert.match(workflow, /RECOVERY_BRANCH: crucible-recovery-/);
  assert.match(workflow, /refs\/heads\/\$RECOVERY_BRANCH/);
  assert.match(workflow, /--force-with-lease=refs\/heads\/main/);
  assert.doesNotMatch(workflow, /repository_dispatch|issues:|pull_request_target/);
});

test('a dedicated check blocks only PR #7, the permanent do-not-merge CI-monitoring hook', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'block-pr-7.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*push:\s*\n\s*branches: \[development\]\s*\n\s*pull_request:\s*$/m);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /github\.event\.pull_request\.number.*=.*"7"/);
  assert.match(workflow, /must never be merged/i);
  assert.match(workflow, /Not PR #7 - nothing to block/);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /never merged or closed, under any circumstances/i);
  assert.match(agents, /no technical backstop/i);
  assert.match(agents, /block-pr-7\.yml/);
  assert.match(agents, /required status check on\s*\n\s*`main`/);
});

test('GitHub checks every development change and main PR for a current DEVLOG handoff', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'handoff-policy.yml'), 'utf8');
  assert.match(workflow, /name: AI handoff policy/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*base_sha:[\s\S]*required: true/);
  assert.match(workflow, /push:\s*\n\s*branches: \[development\]/);
  assert.match(workflow, /pull_request:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /HANDOFF_BASE_SHA:/);
  assert.match(workflow, /HANDOFF_HEAD_SHA:/);
  assert.match(workflow, /npm run audit:handoff/);
  assert.match(workflow, /takeover-ready AI development plan/);
});

test('AI conflict governance is unavoidable in the reusable workflow and monitored near real time', () => {
  const reusable = fs.readFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), 'utf8');
  const monitor = fs.readFileSync(path.join(root, '.github', 'workflows', 'ai-conflict-governance.yml'), 'utf8');
  const adopter = fs.readFileSync(path.join(root, 'templates', 'ai-conflict-monitor-workflow.yml'), 'utf8');
  assert.match(reusable, /name: AI conflict governance[\s\S]*cli\.js ai-conflicts/);
  for (const workflow of [monitor, adopter]) {
    assert.match(workflow, /name: AI conflict governance/);
    assert.match(workflow, /push:/);
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /pull_request_review:/);
    assert.match(workflow, /issue_comment:/);
    assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.match(workflow, /cli\.js ai-conflicts/);
    assert.doesNotMatch(workflow, /contents: write|git push/);
  }
});

test('the pre-push hook is tracked as executable and runs the fast offline verification set', () => {
  const tracked = execFileSync('git', ['ls-files', '-s', '.githooks/pre-push'], { cwd: root, encoding: 'utf8' });
  assert.match(tracked, /^100755 /, 'the pre-push hook must be tracked with the executable bit (mode 100755), or Git silently skips it');
  const hook = fs.readFileSync(path.join(root, '.githooks', 'pre-push'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh/);
  for (const script of ['lint:workflows', 'docs:check', 'audit:clutter', 'audit:privacy', 'audit:security']) {
    assert.match(hook, new RegExp(`npm run ${script.replace(':', '\\:')}`));
  }
  assert.match(hook, /npm test/);
});
