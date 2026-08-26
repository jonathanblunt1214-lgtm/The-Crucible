const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DESIGN_BRIEF_FILENAME, auditDesignBrief, formatSeveredNotice, publishSeveredNotice } = require('../src/designBriefGate');

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-design-brief-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  return root;
}

test('does not sever when the design brief is present', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, DESIGN_BRIEF_FILENAME), 'brief\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'add brief']);
  assert.deepEqual(auditDesignBrief(root), { severed: false });
});

test('does not sever when the design brief was never installed', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'app.js'), 'const x = 1;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'unrelated commit']);
  assert.deepEqual(auditDesignBrief(root), { severed: false });
});

test('severs when the design brief was committed and then deleted', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, DESIGN_BRIEF_FILENAME), 'brief\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'add brief']);
  fs.unlinkSync(path.join(root, DESIGN_BRIEF_FILENAME));
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'remove brief']);
  assert.deepEqual(auditDesignBrief(root), { severed: true });
});

test('is not fooled by a deletion later restored', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, DESIGN_BRIEF_FILENAME), 'brief\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'add brief']);
  fs.unlinkSync(path.join(root, DESIGN_BRIEF_FILENAME));
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'remove brief']);
  fs.writeFileSync(path.join(root, DESIGN_BRIEF_FILENAME), 'brief again\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'restore brief']);
  assert.deepEqual(auditDesignBrief(root), { severed: false });
});

test('severed notice explains what happened and how to restore or end the connection', () => {
  const notice = formatSeveredNotice('octocat/example');
  assert.match(notice, /THE CRUCIBLE LINK IS SEVERED/);
  assert.match(notice, /octocat\/example/);
  assert.match(notice, /THE-CRUCIBLE-DESIGN-BRIEF\.md/);
  assert.match(notice, /connect-workflow\.yml/);
  assert.match(notice, /remove the caller workflow/i);
});

test('severed notice falls back gracefully without a repository name', () => {
  const notice = formatSeveredNotice(undefined);
  assert.match(notice, /this repository/);
});

test('publishSeveredNotice appends to the GitHub Actions job summary when present', () => {
  const summaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-summary-')), 'summary.md');
  fs.writeFileSync(summaryPath, '');
  const published = publishSeveredNotice('notice body', { GITHUB_STEP_SUMMARY: summaryPath });
  assert.equal(published, true);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /## The Crucible link severed[\s\S]*notice body/);
});

test('publishSeveredNotice is a no-op outside GitHub Actions', () => {
  assert.equal(publishSeveredNotice('notice body', {}), false);
});
