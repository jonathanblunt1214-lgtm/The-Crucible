const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findingsForText, isAllowedEmail, isDependencyLockfile, scrubText, auditPrivacy, scrubPrivacy } = require('../src/privacy');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }).trim(); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-privacy-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  return root;
}
const config = { privacy:{ githubIdentity:'jonathanblunt1214-lgtm', scanContactInformation:true } };

test('only the configured GitHub noreply identity and technical examples are allowed', () => {
  assert.equal(isAllowedEmail('41898282+jonathanblunt1214-lgtm@users.noreply.github.com', config.privacy.githubIdentity), true);
  assert.equal(isAllowedEmail('git@github.com', config.privacy.githubIdentity), true);
  assert.equal(isAllowedEmail('person@example.test', config.privacy.githubIdentity), true);
  assert.equal(isAllowedEmail('maintainer@packages.invalid', config.privacy.githubIdentity), true);
  assert.equal(isAllowedEmail('private' + '@personal-domain.invalid', config.privacy.githubIdentity), false);
});

test('inert private-key detector expressions are not treated as embedded keys', () => {
  assert.equal(findingsForText("const detector = /-----BEGIN PRIVATE KEY-----/;", config.privacy.githubIdentity).length, 0);
});

test('dependency lockfiles may retain public package metadata emails', () => {
  assert.equal(isDependencyLockfile('package-lock.json'), true);
  assert.equal(isDependencyLockfile('src/profile.json'), false);
  const root = repository();
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ support:'maintainer@packages.invalid' }));
  git(root, ['add', 'package-lock.json']);
  assert.equal(auditPrivacy(root, config).findings.length, 0);
});

test('scrubber removes recognized identifiers while preserving the GitHub identity', () => {
  const token = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
  const privateEmail = ['private', 'personal-domain.invalid'].join('@');
  const phone = ['(555)', '234', '5678'].join(' ');
  const input = `GitHub jonathanblunt1214-lgtm\n${privateEmail}\nC:\\Users\\private-person\\work\n${token}\n${phone}`;
  const output = scrubText(input, config.privacy.githubIdentity);
  assert.match(output, /jonathanblunt1214-lgtm/);
  for (const privateValue of ['private-person', 'personal-domain', 'abcdefghijklmnopqrstuvwxyz', '555']) assert.doesNotMatch(output, new RegExp(privateValue));
  for (const marker of ['REDACTED_EMAIL', 'USER_HOME', 'REDACTED_GITHUB_TOKEN', 'REDACTED_PHONE']) assert.match(output, new RegExp(marker));
  assert.equal(findingsForText(output, config.privacy.githubIdentity).length, 0);
});

test('audit checks the staged version and scrub leaves reviewable working changes', () => {
  const root = repository();
  const privateEmail = ['private', 'personal-domain.invalid'].join('@');
  fs.writeFileSync(path.join(root, 'profile.txt'), `${privateEmail}\n`);
  git(root, ['add', 'profile.txt']);
  assert.equal(auditPrivacy(root, config).findings.length, 1);
  const result = scrubPrivacy(root, config);
  assert.deepEqual(result.changed, ['profile.txt']);
  assert.match(fs.readFileSync(path.join(root, 'profile.txt'), 'utf8'), /REDACTED_EMAIL/);
  assert.equal(auditPrivacy(root, config).findings.length, 1);
  git(root, ['add', 'profile.txt']);
  assert.equal(auditPrivacy(root, config).findings.length, 0);
});

test('normal privacy command automatically scrubs but keeps unsafe staged content blocked', () => {
  const root = repository();
  const privateEmail = ['private', 'personal-domain.invalid'].join('@');
  fs.writeFileSync(path.join(root, '.thecrucible.json'), JSON.stringify({ schemaVersion:1, project:{ name:'Fixture' }, commands:{ verify:[{ name:'Test', run:'node', args:['--test'] }] }, privacy:{ githubIdentity:'jonathanblunt1214-lgtm', scanContactInformation:true } }));
  fs.writeFileSync(path.join(root, 'profile.txt'), `${privateEmail}\n`);
  git(root, ['add', '.thecrucible.json', 'profile.txt']);
  const cli = path.join(__dirname, '..', 'src', 'cli.js');
  let output = '';
  try { execFileSync(process.execPath, [cli, 'privacy'], { cwd:root, encoding:'utf8', windowsHide:true, stdio:['ignore', 'pipe', 'pipe'] }); }
  catch (error) { output = `${error.stdout || ''}${error.stderr || ''}`; }
  assert.match(output, /automatically sanitized/);
  assert.match(output, /Review the cleaned files, stage them, and commit again/);
  assert.doesNotMatch(output, /private@|personal-domain/);
  assert.match(fs.readFileSync(path.join(root, 'profile.txt'), 'utf8'), /REDACTED_EMAIL/);
  assert.equal(auditPrivacy(root, config).findings.length, 1);
});
