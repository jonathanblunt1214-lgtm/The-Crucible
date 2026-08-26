const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ENGINE_PROJECT_ID, ENGINE_GITHUB_IDENTITY, repairInternalChecks } = require('../src/repair');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-repair-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  return root;
}
function config(overrides = {}) {
  return {
    project: { name: 'The Crucible', projectId: ENGINE_PROJECT_ID },
    privacy: { githubIdentity: ENGINE_GITHUB_IDENTITY, scanContactInformation: true, allow: [] },
    ...overrides,
  };
}

test('refuses to run against a project that is not this engine repository', () => {
  const root = repository();
  assert.throws(() => repairInternalChecks(root, config({ project: { name: 'Other', projectId: 'someone-elses-project' } })), /only runs against The Crucible engine's own repository/);
});

test('refuses to run even if only the GitHub identity fails to match', () => {
  const root = repository();
  assert.throws(() => repairInternalChecks(root, config({ privacy: { githubIdentity: 'someone-else', scanContactInformation: true, allow: [] } })), /only runs against The Crucible engine's own repository/);
});

test('fixes trailing whitespace and personal identifiers in the working copy without staging or committing', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'app.js'), 'const value = 1;   \n');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'contact jane.doe@gmail.com for details\n');
  git(root, ['add', 'app.js', 'notes.txt']);
  const result = repairInternalChecks(root, config(), { ref: '--cached' });
  assert.deepEqual(result.changed.sort(), ['app.js', 'notes.txt']);
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'const value = 1;\n');
  assert.match(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), /REDACTED_EMAIL/);
  // Still only staged, never committed or pushed.
  assert.deepEqual(git(root, ['diff', '--cached', '--name-only']).trim().split('\n').sort(), ['app.js', 'notes.txt']);
});

test('skips the commit-gate fix and explains why when targeting already-committed history', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'app.js'), 'const value = 1;\n');
  git(root, ['add', 'app.js']);
  git(root, ['commit', '-m', 'fixture']);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const result = repairInternalChecks(root, config(), { ref: head });
  assert.match(result.skipReason, /Commit Gate auto-fix only applies to staged working-tree changes/);
});

test('reports remaining issues that cannot be auto-fixed', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'app.js'), '<<<<<<< ours\nconst value = 1;\n=======\nconst value = 2;\n>>>>>>> theirs\n');
  git(root, ['add', 'app.js']);
  const result = repairInternalChecks(root, config(), { ref: '--cached' });
  assert.ok(result.remaining.length > 0);
  assert.ok(result.remaining.every((item) => item.type === 'merge-conflict-marker'));
});
