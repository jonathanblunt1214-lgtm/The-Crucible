const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { stagedSnapshot } = require('../src/snapshot');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-snapshot-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  return root;
}

test('captures every staged file with its exact size and sha256 digest', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello world');
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'b.txt'), 'nested content');
  git(root, ['add', '.']);
  const snapshot = stagedSnapshot(root);
  assert.deepEqual(snapshot.files.sort(), ['a.txt', 'nested/b.txt'].sort());
  const expectedA = crypto.createHash('sha256').update('hello world').digest('hex');
  assert.equal(snapshot.entries.get('a.txt').sha256, expectedA);
  assert.equal(snapshot.entries.get('a.txt').size, Buffer.byteLength('hello world'));
  assert.ok(Buffer.isBuffer(snapshot.entries.get('a.txt').buffer));
  assert.equal(snapshot.entries.get('a.txt').buffer.toString('utf8'), 'hello world');
  const expectedB = crypto.createHash('sha256').update('nested content').digest('hex');
  assert.equal(snapshot.entries.get('nested/b.txt').sha256, expectedB);
});

test('reflects only what is actually staged, not the working tree', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'staged version');
  git(root, ['add', 'tracked.txt']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'unstaged edit');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'never added');
  const snapshot = stagedSnapshot(root);
  assert.deepEqual(snapshot.files, ['tracked.txt']);
  assert.equal(snapshot.entries.get('tracked.txt').buffer.toString('utf8'), 'staged version');
  assert.equal(snapshot.entries.has('untracked.txt'), false);
});

test('returns an empty snapshot for a repository with nothing staged', () => {
  const root = repository();
  const snapshot = stagedSnapshot(root);
  assert.deepEqual(snapshot.files, []);
  assert.equal(snapshot.entries.size, 0);
});

test('handles binary content without corrupting the digest', () => {
  const root = repository();
  const binary = Buffer.from([0, 1, 2, 253, 254, 255]);
  fs.writeFileSync(path.join(root, 'binary.dat'), binary);
  git(root, ['add', 'binary.dat']);
  const snapshot = stagedSnapshot(root);
  const expected = crypto.createHash('sha256').update(binary).digest('hex');
  assert.equal(snapshot.entries.get('binary.dat').sha256, expected);
  assert.deepEqual(snapshot.entries.get('binary.dat').buffer, binary);
});
