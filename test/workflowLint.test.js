const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditWorkflowPermissions, fixWorkflowPermissions } = require('../src/workflowLint');

function repository() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-workflow-lint-'));
}

function writeWorkflow(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

test('flags an unrecognized permissions key', () => {
  const root = repository();
  writeWorkflow(root, '.github/workflows/ci.yml', [
    'name: CI',
    'permissions:',
    '  contents: read',
    '  administration: read',
    'jobs: {}',
    '',
  ].join('\n'));
  const result = auditWorkflowPermissions(root);
  assert.equal(result.files, 1);
  // `rule` names which of the linter's rules produced the finding. It is what fixWorkflowPermissions
  // keys off to decide the finding is safe to repair by deleting a line, so it is asserted here
  // rather than being allowed to drift.
  assert.deepEqual(result.findings, [{ rule: 'permissions-key', path: '.github/workflows/ci.yml', line: 4, key: 'administration', type: 'unknown permissions key "administration"' }]);
});

test('accepts every documented GITHUB_TOKEN permission key', () => {
  const root = repository();
  writeWorkflow(root, '.github/workflows/ci.yml', [
    'permissions:',
    '  contents: read',
    '  pull-requests: read',
    '  security-events: write',
    '  id-token: write',
    'jobs: {}',
    '',
  ].join('\n'));
  assert.deepEqual(auditWorkflowPermissions(root).findings, []);
});

test('ignores the scalar read-all/write-all form', () => {
  const root = repository();
  writeWorkflow(root, '.github/workflows/ci.yml', 'permissions: read-all\njobs: {}\n');
  assert.deepEqual(auditWorkflowPermissions(root).findings, []);
});

test('checks a job-level permissions block, not only the top-level one', () => {
  const root = repository();
  writeWorkflow(root, '.github/workflows/ci.yml', [
    'jobs:',
    '  build:',
    '    permissions:',
    '      contents: read',
    '      not-a-real-scope: read',
    '',
  ].join('\n'));
  const result = auditWorkflowPermissions(root);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].key, 'not-a-real-scope');
});

test('also scans an explicitly passed extra directory', () => {
  const root = repository();
  writeWorkflow(root, 'templates/caller-workflow.yml', 'permissions:\n  contents: read\n  administration: read\n');
  assert.deepEqual(auditWorkflowPermissions(root).findings, []);
  const result = auditWorkflowPermissions(root, ['templates']);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, 'templates/caller-workflow.yml');
});

test('fixWorkflowPermissions removes only the offending line, nothing else', () => {
  const root = repository();
  writeWorkflow(root, '.github/workflows/ci.yml', [
    'name: CI',
    'permissions:',
    '  contents: read',
    '  administration: read',
    '  pull-requests: read',
    'jobs: {}',
    '',
  ].join('\n'));
  const result = fixWorkflowPermissions(root);
  assert.deepEqual(result.changed, ['.github/workflows/ci.yml']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].key, 'administration');
  const after = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.equal(after, ['name: CI', 'permissions:', '  contents: read', '  pull-requests: read', 'jobs: {}', ''].join('\n'));
  assert.deepEqual(auditWorkflowPermissions(root).findings, []);
});

test('fixWorkflowPermissions is a no-op when nothing is invalid', () => {
  const root = repository();
  writeWorkflow(root, '.github/workflows/ci.yml', 'permissions:\n  contents: read\njobs: {}\n');
  const result = fixWorkflowPermissions(root);
  assert.deepEqual(result, { changed: [], removed: [] });
});

// The defect this rule exists for, reproduced exactly. On 2026-09-02 the self-test workflow
// gained `CRUCIBLE_FAILURE_LOG: ${{ runner.temp }}/crucible-failure.log` in a job-level env
// block. The `runner` context does not exist there. GitHub did not warn or substitute an empty
// string - it refused to compile the file, so two commits produced runs with ZERO jobs and the
// entire nine-job Self-Test matrix silently vanished. The permissions linter passed throughout,
// because it only ever looked at permission keys.
test('a context that does not exist in a job-level env block is refused', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-workflow-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'broken.yml'), [
    'name: Broken',
    'on: [push]',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      GOOD: ${{ github.sha }}',
    '      ALSO_GOOD: ${{ secrets.TOKEN }}',
    '      BAD: ${{ runner.temp }}/somewhere.log',
    '    steps:',
    '      - name: a step may use runner, because there it exists',
    '        env:',
    '          FINE: ${{ runner.temp }}/step.log',
    '        run: echo hi',
    '',
  ].join('\n'));

  const result = auditWorkflowPermissions(root);
  const contextFindings = result.findings.filter((item) => item.context);
  assert.equal(contextFindings.length, 1, `expected exactly one context finding, got ${JSON.stringify(result.findings)}`);
  assert.equal(contextFindings[0].context, 'runner');
  assert.equal(contextFindings[0].key, 'BAD');
  assert.match(contextFindings[0].type, /not available in a job-level env block/);
});

// The step-level env in the fixture above uses the same expression legally. A rule that flagged
// it would push people to remove a context that works, which is worse than the defect.
test('the same context is left alone where it is legal', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-workflow-legal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fine.yml'), [
    'name: Fine',
    'on: [push]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - env:',
    '          TEMP_DIR: ${{ runner.temp }}',
    '        run: echo hi',
    '',
  ].join('\n'));
  assert.deepEqual(auditWorkflowPermissions(root).findings.filter((item) => item.context), []);
});

// This repository's own workflows, checked against the rule rather than against a fixture.
test('every workflow in this repository survives the context rule', () => {
  const result = auditWorkflowPermissions(process.cwd(), ['templates']);
  assert.deepEqual(result.findings, [], `workflows GitHub would reject: ${JSON.stringify(result.findings, null, 2)}`);
});

// The defect the owner logged on 2026-09-03: an on-error step allowed to decide the job's
// result. The `if-no-files-found: error` upload is the worst of the family, because the report
// is missing exactly when the run died early - so the reader is told the evidence is absent
// instead of being told what actually broke.
test('an on-error step that can decide the job result is refused', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-workflow-onerror-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'diagnose.yml'), [
    'name: Diagnose',
    'on: [push]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: the real work',
    '        run: npm run run',
    '      - name: Preserve the diagnosis',
    '        if: failure()',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          path: ci-diagnostic-report.json',
    '          if-no-files-found: error',
    '',
  ].join('\n'));

  const findings = auditWorkflowPermissions(root).findings.filter((item) => item.rule === 'on-error-additive');
  assert.equal(findings.length, 1, `expected exactly one on-error finding, got ${JSON.stringify(findings)}`);
  assert.equal(findings[0].key, 'Preserve the diagnosis');
  assert.match(findings[0].type, /without continue-on-error: true/);
});

// The rule must not fire on the additive form, or it would push people to delete the diagnosis
// rather than make it additive - and it must not fire on `always()`, which is a different thing.
test('an additive on-error step, and an always() step, are left alone', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-workflow-additive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fine.yml'), [
    'name: Fine',
    'on: [push]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: additive diagnosis',
    '        if: failure()',
    '        continue-on-error: true',
    '        run: node src/ciDiagnosticOrgan.js diagnose-local',
    '      - name: always uploads the report',
    '        if: always()',
    '        uses: actions/upload-artifact@v4',
    '',
  ].join('\n'));
  assert.deepEqual(auditWorkflowPermissions(root).findings.filter((item) => item.rule === 'on-error-additive'), []);
});

// A finding this linter cannot safely repair must never be repaired. The auto-fixer deletes
// lines, and the line it would reach for here is the `if: failure()` that makes the step a
// diagnostic at all - deleting it would run the diagnosis on every green build.
test('the auto-fixer refuses to touch an on-error finding', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-workflow-nofix-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'diagnose.yml');
  const original = [
    'name: Diagnose',
    'on: [push]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Preserve the diagnosis',
    '        if: failure()',
    '        run: echo diagnose',
    '',
  ].join('\n');
  fs.writeFileSync(file, original);
  const result = fixWorkflowPermissions(root);
  assert.deepEqual(result.changed, []);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

// This repository's own workflows, and the reusable one shipped to opted-in projects, checked
// against the rule rather than a fixture. A consumer project inherits our on-error steps, so a
// non-additive one here would replace THEIR real failure with our diagnostic's.
test('every workflow in this repository keeps on-error diagnosis additive', () => {
  const findings = auditWorkflowPermissions(process.cwd(), ['templates']).findings.filter((item) => item.rule === 'on-error-additive');
  assert.deepEqual(findings, [], `on-error steps that could decide a job's result: ${JSON.stringify(findings, null, 2)}`);
});
