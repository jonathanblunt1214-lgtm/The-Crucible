const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyClaims, digestFile } = require('../src/authenticity');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-authenticity-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed');
  git(root, ['add', 'seed.txt']);
  git(root, ['commit', '-m', 'seed']);
  return root;
}
function config(claims) {
  return { authenticity:{ claims, requireArtifacts:true }, workload:{ timeoutMinutes:1 } };
}

test('digestFile returns the sha256 of a file\'s exact contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-authenticity-digest-'));
  const target = path.join(root, 'file.txt');
  fs.writeFileSync(target, 'known content');
  assert.equal(digestFile(target), crypto.createHash('sha256').update('known content').digest('hex'));
});

test('runs each claim\'s command and records evidence with its digest and the current commit', async () => {
  const root = repository();
  const claim = {
    name:'Build produces output',
    run:process.execPath,
    args:['-e', "require('fs').writeFileSync('evidence.txt', 'proof')"],
    cwd:'.',
    evidence:['evidence.txt'],
  };
  const result = await verifyClaims(root, config([claim]));
  assert.equal(result.claims, 1);
  const record = result.records[0];
  assert.equal(record.claim, 'Build produces output');
  assert.equal(record.commit, git(root, ['rev-parse', 'HEAD']).trim());
  assert.deepEqual(record.evidence, [{ path:'evidence.txt', sha256:crypto.createHash('sha256').update('proof').digest('hex') }]);
  assert.ok(record.commandSha256);
  assert.ok(record.verifiedAt);
});

test('throws when a claim declares evidence its command never produced', async () => {
  const root = repository();
  const claim = { name:'Broken claim', run:process.execPath, args:['-e', "''"], cwd:'.', evidence:['missing.txt'] };
  await assert.rejects(verifyClaims(root, config([claim])), /did not produce evidence file missing\.txt/);
});

test('throws when requireArtifacts is set and a claim declares no evidence at all', async () => {
  const root = repository();
  const claim = { name:'No evidence', run:process.execPath, args:['-e', "''"], cwd:'.' };
  await assert.rejects(verifyClaims(root, config([claim])), /must declare at least one evidence artifact/);
});

test('refuses evidence paths that escape the project root', async () => {
  const root = repository();
  const claim = { name:'Escaping claim', run:process.execPath, args:['-e', "''"], cwd:'.', evidence:['../outside.txt'] };
  await assert.rejects(verifyClaims(root, config([claim])), /did not produce evidence file \.\.\/outside\.txt/);
});

test('runs multiple claims in order and returns one record per claim', async () => {
  const root = repository();
  const claims = [
    { name:'First', run:process.execPath, args:['-e', "require('fs').writeFileSync('first.txt', '1')"], cwd:'.', evidence:['first.txt'] },
    { name:'Second', run:process.execPath, args:['-e', "require('fs').writeFileSync('second.txt', '2')"], cwd:'.', evidence:['second.txt'] },
  ];
  const result = await verifyClaims(root, config(claims));
  assert.equal(result.claims, 2);
  assert.deepEqual(result.records.map((record) => record.claim), ['First', 'Second']);
});
