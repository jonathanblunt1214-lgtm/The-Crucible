const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(workflow, /cli\.js design-brief[\s\S]*cli\.js validate/);
  assert.match(workflow, /Create or update the Crucible failure issue[\s\S]*if: failure\(\)[\s\S]*cli\.js failure-issue/);
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

test('connect workflow is a one-time, human-triggered, single-file write with no other trigger', () => {
  const workflow = fs.readFileSync(path.join(root, 'templates', 'connect-workflow.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /\n\s*push:|\n\s*pull_request:|\n\s*schedule:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /THE-CRUCIBLE-DESIGN-BRIEF\.md/);
  assert.match(workflow, /templates\/the-crucible-design-brief\.md/);
  assert.match(workflow, /git status --porcelain/);
  assert.match(workflow, /Refusing to commit/);
  assert.match(workflow, /delete THIS WORKFLOW FILE/);
  assert.match(workflow, /Do not delete or revert the\s*\n#\s*THE-CRUCIBLE-DESIGN-BRIEF\.md commit/);
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
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(workflow, /node: \[20, 22, 24\]/);
  assert.match(workflow, /npm test[\s\S]*npm run validate[\s\S]*npm run audit:clutter[\s\S]*npm run audit:security[\s\S]*npm run precheck[\s\S]*npm run run/);
});

test('canonical source is refreshed every 15 minutes only after verification', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'canonical-snapshot.yml'), 'utf8');
  assert.match(workflow, /cron: '\*\/15 \* \* \* \*'/);
  assert.match(workflow, /npm test[\s\S]*npm run validate[\s\S]*npm run audit:security/);
  assert.match(workflow, /HEAD:refs\/heads\/crucible-canonical/);
});

test('only a failed internal main Self-Test triggers autonomous canonical recovery', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'internal-recovery.yml'), 'utf8');
  assert.match(workflow, /workflows: \['The Crucible Self-Test'\]/);
  assert.match(workflow, /workflow_run\.conclusion == 'failure'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /git read-tree --reset -u origin\/crucible-canonical/);
  assert.match(workflow, /git commit -m "Auto-recover Crucible/);
  assert.match(workflow, /RECOVERY_BRANCH: crucible-recovery-/);
  assert.match(workflow, /refs\/heads\/\$RECOVERY_BRANCH/);
  assert.match(workflow, /--force-with-lease=refs\/heads\/main/);
  assert.doesNotMatch(workflow, /repository_dispatch|issues:|pull_request_target/);
});
