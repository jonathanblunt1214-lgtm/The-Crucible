const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { HOOKS_DIR, installGitHooks } = require('../src/installGitHooks');

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); }
function repository(withHooks = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-git-hooks-'));
  git(root, ['init']);
  if (withHooks) {
    fs.mkdirSync(path.join(root, HOOKS_DIR));
    fs.writeFileSync(path.join(root, HOOKS_DIR, 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  }
  return root;
}

test('makes every hook file executable and points core.hooksPath at .githooks', () => {
  const root = repository();
  const result = installGitHooks(root);
  assert.equal(result.installed, true);
  assert.deepEqual(result.hooks, ['pre-push']);
  const mode = fs.statSync(path.join(root, HOOKS_DIR, 'pre-push')).mode & 0o777;
  assert.equal(mode, 0o755);
  assert.equal(git(root, ['config', 'core.hooksPath']).trim(), HOOKS_DIR);
});

test('is a no-op, not a failure, when the repository has no .githooks directory', () => {
  const root = repository(false);
  const result = installGitHooks(root);
  assert.equal(result.installed, false);
  assert.match(result.reason, /not found/);
});

test('fails closed with a reason instead of throwing when Git is unavailable', () => {
  const root = repository();
  const result = installGitHooks(root, { exec: () => { throw new Error('no git'); } });
  assert.equal(result.installed, false);
  assert.match(result.reason, /Git/);
});

test('re-chmods a hook that lost its executable bit, so the gate self-heals', () => {
  const root = repository();
  fs.chmodSync(path.join(root, HOOKS_DIR, 'pre-push'), 0o644);
  installGitHooks(root);
  const mode = fs.statSync(path.join(root, HOOKS_DIR, 'pre-push')).mode & 0o777;
  assert.equal(mode, 0o755);
});
