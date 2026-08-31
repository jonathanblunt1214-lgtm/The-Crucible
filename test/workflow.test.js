const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadConfig } = require('../src/config');
const { auditClutter } = require('../src/clutter');

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
  assert.match(workflow, /Diagnose opted-in project failure[\s\S]*CRUCIBLE_PROJECT_ID: github:\$\{\{ github\.repository \}\}/);
  assert.match(workflow, /ciDiagnosticOrgan\.js diagnose-local/);
  assert.match(workflow, /the-crucible-ci-diagnosis-/);
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

test('connect workflow install/branch-creation steps are resumable after a partial failure, never stuck half-applied', () => {
  const workflow = fs.readFileSync(path.join(root, 'templates', 'connect-workflow.yml'), 'utf8');
  // If a prior run committed governance files to main but then failed before
  // creating Development-branch, re-running install must finish the job
  // instead of refusing an already-correct "nothing changed" diff.
  assert.match(workflow, /if \[ "\$count" -eq 0 \]/);
  assert.match(workflow, /already installed and unchanged/);
  // ls-remote's exit code must be inspected, not just treated as boolean:
  // exit 2 means "branch doesn't exist" (safe to create), any other nonzero
  // is a real failure that must not be silently treated the same way.
  assert.match(workflow, /status=\$\?/);
  assert.match(workflow, /if \[ "\$status" -eq 0 \]/);
  assert.match(workflow, /elif \[ "\$status" -ne 2 \]/);
  assert.match(workflow, /Could not confirm whether Development-branch exists/);
  // The original fail-closed behaviors must survive unchanged.
  assert.match(workflow, /git ls-remote --exit-code --heads origin refs\/heads\/Development-branch/);
  assert.match(workflow, /Refusing to replace existing Development-branch/);
  assert.match(workflow, /git status --porcelain/);
  assert.match(workflow, /Refusing to commit/);
});

test('connect workflow installs the governingDocuments templates it references, only when not already present', () => {
  const workflow = fs.readFileSync(path.join(root, 'templates', 'connect-workflow.yml'), 'utf8');
  assert.match(workflow, /\[ -f templates\/ai-conflict-resolution\.md \] \|\| cp \.the-crucible-runtime\/templates\/ai-conflict-resolution\.md templates\/ai-conflict-resolution\.md/);
  assert.match(workflow, /\[ -f templates\/required-check-rollout\.md \] \|\| cp \.the-crucible-runtime\/templates\/required-check-rollout\.md templates\/required-check-rollout\.md/);
  // -uall is mandatory here: a brand-new `templates/` directory is entirely
  // untracked, and plain `git status --porcelain` collapses a wholly-new
  // directory into one "?? templates/" line instead of listing the files
  // inside it, which would silently defeat the exact-file verification below.
  assert.match(workflow, /git status --porcelain -uall/);
  const handoff = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'ai-handoff.example.json'), 'utf8'));
  assert.ok(handoff.governingDocuments, 'the adopter AI-HANDOFF.json template must declare governingDocuments');
  for (const doc of ['AI-HANDOFF.json', 'AI-CONFLICTS.json', 'THE-CRUCIBLE-DESIGN-BRIEF.md', 'templates/ai-conflict-resolution.md', 'templates/required-check-rollout.md', '.github/workflows/ai-conflict-governance.yml', '.github/workflows/ai-handoff-policy.yml']) {
    assert.ok(typeof handoff.governingDocuments[doc] === 'string' && handoff.governingDocuments[doc].trim(), `governingDocuments must describe ${doc}`);
    // Every governingDocuments entry must name a file the one-time install
    // step actually installs (or that already exists in every adopter
    // repository, like AI-HANDOFF.json itself) - a governing document that
    // does not exist in the adopting repository is not something its own
    // AI agents could ever actually re-read.
    const installed = doc === 'AI-HANDOFF.json' || doc === 'AI-CONFLICTS.json' || doc === 'THE-CRUCIBLE-DESIGN-BRIEF.md' || workflow.includes(doc);
    assert.ok(installed, `${doc} is declared in governingDocuments but the connect workflow never installs it`);
  }
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
  assert.match(workflow, /os: \[ubuntu-latest, windows-2022, macos-latest\]/);
  assert.match(workflow, /node: \[20, 22, 24\]/);
  assert.match(workflow, /npm test[\s\S]*npm run validate[\s\S]*npm run audit:clutter[\s\S]*npm run audit:security[\s\S]*npm run precheck[\s\S]*npm run run/);
});

test('GitHub hosts encrypted restart-safe R4-R8 proof without production authority', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'hosted-learning-proof.yml'), 'utf8');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- development/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/development'/);
  assert.match(workflow, /actions\/cache\/restore@0057852bfaa89a56745cba8c7296529d2fc39830/);
  assert.match(workflow, /CRUCIBLE_HOSTED_STORE_KEY: \$\{\{ secrets\.CRUCIBLE_HOSTED_STORE_KEY \}\}/);
  assert.match(workflow, /node src\/hostedLearningProof\.js/);
  assert.match(workflow, /actions\/cache\/save@0057852bfaa89a56745cba8c7296529d2fc39830/);
  assert.match(workflow, /retention-days: 90/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write/);
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

test('a dedicated check blocks every locked monitoring PR, past and present, and no other', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'block-pr-7.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*push:\s*\n\s*branches: \[development\]\s*\n\s*pull_request:\s*$/m);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /LOCKED_PR_NUMBERS:\s*"7 9 11"/);
  assert.match(workflow, /must never be merged/i);
  assert.match(workflow, /Not a locked monitoring PR - nothing to block/);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /never merged or closed, under any circumstances/i);
  assert.match(agents, /no technical backstop/i);
  assert.match(agents, /block-pr-7\.yml/);
  assert.match(agents, /required status check on\s+`main`/);
  assert.match(agents, /PR #9/);
  assert.match(agents, /PR #11/);
});

test('the monitoring branch syncs development content via distinct commits, never by reusing development\'s real commits', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'sync-ci-monitor.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*push:\s*\n\s*branches: \[development\]\s*$/m);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /ref: ci-monitor/);
  assert.match(workflow, /git checkout origin\/development -- \./);
  assert.match(workflow, /git push origin HEAD:refs\/heads\/ci-monitor/);
  assert.match(workflow, /never change this workflow to merge, rebase, or/i);
  assert.match(workflow, /fast-forward ci-monitor from development directly/i);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /auto-merged and auto-closed by GitHub/);
  assert.match(agents, /never `development`'s actual commit\s*\n\s*objects/);
  assert.match(agents, /sync-ci-monitor\.yml/);
  assert.match(agents, /ci-monitor.*is an explicit exception to the no-new-branches rule/s);
});

test('the ci-monitor pull request is automatically reopened if closed without being merged', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'guard-ci-monitor-pr.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*pull_request:\s*\n\s*types: \[closed\]\s*$/m);
  assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: write/);
  assert.match(workflow, /if: github\.event\.pull_request\.head\.ref == 'ci-monitor' && github\.event\.pull_request\.merged == false/);
  assert.match(workflow, /gh pr reopen "\$number" --repo "\$REPOSITORY"/);
  assert.match(workflow, /does NOT try to silently open a replacement/);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /guard-ci-monitor-pr\.yml.*reopens PR #11\s*\n\s*automatically/s);
  assert.match(agents, /invisible self-repair/);
  assert.match(agents, /Never deliberately close or merge PR #11 to "test"/);
});

test('release to main promotion is automated: opens or reuses a pull request, waits for every check, then merges', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'promote-release.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*push:\s*\n\s*branches: \[release\]\s*$/m);
  assert.match(workflow, /permissions:\s*\n\s*contents: write\s*\n\s*pull-requests: write/);
  assert.match(workflow, /gh pr list --repo "\$REPOSITORY" --head release --base main/);
  assert.match(workflow, /gh pr create --repo "\$REPOSITORY" --head release --base main/);
  assert.match(workflow, /No commits between/);
  assert.match(workflow, /gh pr checks "\$number" --repo "\$REPOSITORY" --watch/);
  assert.match(workflow, /gh pr merge "\$number" --repo "\$REPOSITORY" --merge/);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Never push directly to `main`, even with that explicit instruction/);
  assert.match(agents, /promote-release\.yml/);
  assert.match(agents, /release.*is an exception/s);
});

test('GitHub checks every development change and main PR for a current DEVLOG handoff', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'handoff-policy.yml'), 'utf8');
  assert.match(workflow, /name: AI handoff policy/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*base_sha:[\s\S]*required: true/);
  assert.match(workflow, /push:\s*\n\s*branches: \[development, main\]/);
  assert.match(workflow, /pull_request:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /HANDOFF_BASE_SHA:/);
  assert.match(workflow, /HANDOFF_HEAD_SHA:/);
  assert.match(workflow, /npm run audit:handoff/);
  assert.match(workflow, /takeover-ready AI development plan/);
});

test('governingDocuments must be rechecked at the start of every session, same or different agent, after any 10+ minute gap', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Recheck `governingDocuments` at the start of every session/);
  assert.match(agents, /no matter which agent or tool is\s*\n\s*running it/);
  assert.match(agents, /more than 10 minutes have passed/);
  assert.match(agents, /even if it is the same agent continuing the\s*\n\s*same conversation/);
  assert.match(agents, /sessionPolicy\.lastActionAt/);
  const handoff = JSON.parse(fs.readFileSync(path.join(root, 'AI-HANDOFF.json'), 'utf8'));
  assert.ok(handoff.sessionPolicy, 'AI-HANDOFF.json must have a top-level sessionPolicy object');
  assert.match(handoff.sessionPolicy.recheckGoverningDocuments, /more than 10 minutes/);
  assert.match(handoff.sessionPolicy.recheckGoverningDocuments, /even if it is the same agent/);
  assert.ok(!Number.isNaN(Date.parse(handoff.sessionPolicy.lastActionAt)), 'sessionPolicy.lastActionAt must be a parseable timestamp');
});

test('DEVLOG.md is required to work as a chain of custody: dev-plan reference plus a command log archive capped at 10 sessions and 180 days', () => {
  const { validateDevlogChainOfCustody, MAX_ARCHIVE_SESSIONS, MAX_ARCHIVE_AGE_DAYS } = require('../src/handoffPolicy');
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /`DEVLOG\.md` is a chain of custody/);
  assert.match(agents, /Reference the dev\s*\n\s*plan instead of restating it/);
  assert.match(agents, /activePlan`:\s*`currentPrompt`/);
  assert.match(agents, /## Command log archive/);
  assert.match(agents, /capped at the 10 most recent sessions/);
  assert.match(agents, /180-day backup limit/);
  assert.match(agents, /started TIMESTAMP, finished TIMESTAMP, exit CODE/);
  assert.match(agents, /no\s*\n\s*more than 10 `### Session:` entries and none older than 180 days/);
  assert.match(agents, /validateDevlogChainOfCustody/);
  const devlog = fs.readFileSync(path.join(root, 'DEVLOG.md'), 'utf8');
  const result = validateDevlogChainOfCustody(devlog);
  assert.equal(result.ok, true, result.message);
  const archiveSection = /^## Command log archive.*$/m.exec(devlog);
  assert.ok(archiveSection, 'DEVLOG.md must have a Command log archive section');
  const archiveBody = devlog.slice(archiveSection.index + archiveSection[0].length).split(/\n##\s/)[0];
  const sessionEntries = archiveBody.match(/^### Session: /gm) || [];
  assert.ok(sessionEntries.length >= 1, 'Command log archive must have at least one Session entry');
  assert.ok(sessionEntries.length <= MAX_ARCHIVE_SESSIONS, `Command log archive must hold at most ${MAX_ARCHIVE_SESSIONS} sessions (found ${sessionEntries.length})`);
  const newestEntry = archiveBody.split(/^### Session: /m)[1] || '';
  assert.match(newestEntry, /\bstart(?:ed)?\b[\s\S]*?\bfinish(?:ed)?\b/i);
  assert.equal(MAX_ARCHIVE_AGE_DAYS, 180);
  const handoff = JSON.parse(fs.readFileSync(path.join(root, 'AI-HANDOFF.json'), 'utf8'));
  assert.equal(typeof handoff.activePlan.currentPrompt, 'string');
  assert.ok(handoff.activePlan.currentPrompt.trim().length > 0);
  assert.ok(['regular/default', 'work'].includes(handoff.activePlan.executionMode.mode));
  assert.equal(handoff.activePlan.executionMode.agent, handoff.activePlan.agent);
  assert.match(handoff.activePlan.executionMode.distinction, /agent/i);
  assert.match(handoff.activePlan.executionMode.distinction, /workflow/i);
  assert.ok(handoff.governingDocuments['src/handoffPolicy.js'], 'governingDocuments must reference src/handoffPolicy.js, the code that enforces the chain-of-custody requirement it just added');
  assert.match(handoff.governingDocuments['src/handoffPolicy.js'], /validateDevlogChainOfCustody/);
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
  assert.match(hook, /git rev-parse --local-env-vars/, 'the pre-push hook must isolate temporary-repository tests from the live push repository');
  assert.match(hook, /^#!\/bin\/sh/);
  for (const script of ['lint:workflows', 'docs:check', 'audit:clutter', 'audit:privacy', 'audit:security']) {
    assert.match(hook, new RegExp(`npm run ${script.replace(':', '\\:')}`));
  }
  assert.match(hook, /npm test/);
});

test('the clutter audit passes against this repository\'s own real, current tracked snapshot', () => {
  // `npm test` and `npm run audit:clutter` are separate commands - it's easy to run only
  // the former, see "196/196 pass," and ship a commit that never actually cleared the
  // latter (this exact gap let a duplicate-content finding reach a pushed commit once
  // already). Running the real audit against the real repo here, inside `npm test` itself,
  // closes that gap for any environment that runs the test suite at all.
  const config = loadConfig(root);
  const result = auditClutter(root, config);
  assert.deepEqual(result.findings, []);
});

test('scheduled diagnostics run cadence tiers on a schedule without ever becoming a required check', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'scheduled-diagnostics.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.match(workflow, /cron: '0 7 \* \* \*'/);
  assert.match(workflow, /cron: '0 8 \* \* 1'/);
  assert.match(workflow, /cron: '0 9 1 \* \*'/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /node src\/testCadence\.js "\$\{\{ steps\.tier\.outputs\.tier \}\}"/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
});

test('the required Self-Test job runs an additive, non-blocking on-error diagnostic step on failure', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'self-test.yml'), 'utf8');
  assert.match(workflow, /if: failure\(\)\s*\n\s*continue-on-error: true\s*\n\s*run: node src\/testCadence\.js on-error self-test-failure/);
  // The existing required steps (npm test, the audits, etc.) must be untouched.
  assert.match(workflow, /- run: npm test\r?\n/);
  assert.match(workflow, /- run: npm run validate\r?\n/);
  assert.match(workflow, /node src\/ciDiagnosticOrgan\.js capture-npm-ci/);
  assert.match(workflow, /node src\/ciDiagnosticOrgan\.js diagnose-local/);
  assert.match(workflow, /crucible-ci-diagnosis-/);
  assert.match(workflow, /os: \[ubuntu-latest, windows-2022, macos-latest\]/);
});

test('the cadence registry itself is documented in AGENTS.md, including the no-invisible-self-repair boundary for on-error triggers', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /## Test and audit cadence/);
  assert.match(agents, /src\/testCadence\.js/);
  assert.match(agents, /never\s+changes what the required Self-Test workflow runs\s+on every\s+push/i);
  assert.match(agents, /On-error triggers may never fix or repair anything unattended/i);
});
