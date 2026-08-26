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
