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
  assert.deepEqual(result.findings, [{ path: '.github/workflows/ci.yml', line: 4, key: 'administration', type: 'unknown permissions key "administration"' }]);
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
