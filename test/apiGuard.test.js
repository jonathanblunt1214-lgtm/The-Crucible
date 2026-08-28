const test = require('node:test');
const assert = require('node:assert/strict');
const { assertWellFormedApiUrl, assertSafeRepository, assertSafeCommitSha } = require('../src/apiGuard');

test('accepts a well-formed HTTPS URL', () => {
  assert.doesNotThrow(() => assertWellFormedApiUrl('https://api.github.com/repos/octocat/example'));
});

test('accepts a GitHub Enterprise Server API host', () => {
  assert.doesNotThrow(() => assertWellFormedApiUrl('https://github.example.com/api/v3/repos/octocat/example'));
});

test('rejects a non-HTTPS URL', () => {
  assert.throws(() => assertWellFormedApiUrl('http://api.github.com/repos/octocat/example'), /non-HTTPS/);
});

test('rejects a malformed URL', () => {
  assert.throws(() => assertWellFormedApiUrl('not a url'), /malformed API URL/);
});

test('accepts a plain owner/repo identifier', () => {
  assert.equal(assertSafeRepository('jonathanblunt1214-lgtm/The-Crucible'), 'jonathanblunt1214-lgtm/The-Crucible');
  assert.equal(assertSafeRepository('jonathanblunt1214-lgtm/Nexus-'), 'jonathanblunt1214-lgtm/Nexus-');
});

test('rejects a repository identifier with no owner/repo separator', () => {
  assert.throws(() => assertSafeRepository('not-a-repository'), /unsafe repository identifier/);
});

test('rejects a repository identifier carrying a scheme or host, not just owner/repo', () => {
  for (const bad of ['https://evil.com/owner/repo', 'owner/repo/../../etc', 'owner/repo?x=1', 'owner repo/x', 'owner-/repo']) {
    assert.throws(() => assertSafeRepository(bad), `expected rejection for ${bad}`);
  }
});

test('rejects a non-string repository value', () => {
  assert.throws(() => assertSafeRepository(undefined));
  assert.throws(() => assertSafeRepository(42));
});

test('accepts full and abbreviated commit SHAs', () => {
  assert.equal(assertSafeCommitSha('a'.repeat(40)), 'a'.repeat(40));
  assert.equal(assertSafeCommitSha('abc1234'), 'abc1234');
});

test('rejects anything that is not a plain hex SHA', () => {
  for (const bad of ['main', 'refs/heads/main', 'a'.repeat(41), 'zzzzzzz', '../../etc/passwd', 'https://evil.com', '']) {
    assert.throws(() => assertSafeCommitSha(bad), `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('security input fuzz corpus rejects malformed repository, SHA, and URL shapes without throwing the wrong way', () => {
  const repositoryCorpus = ['', '.', '..', 'owner', '/repo', 'owner/', 'owner//repo', 'owner/repo/extra', 'owner/../repo', 'owner/repo?x=1', 'owner/repo#frag', ' owner/repo', 'owner/repo ', 'owner\n/repo', 'owner\t/repo', 'https://host/owner/repo', 'owner\\repo', 'øwner/repo'];
  for (const value of repositoryCorpus) assert.throws(() => assertSafeRepository(value), /unsafe repository identifier/, `repository fuzz value should be rejected: ${JSON.stringify(value)}`);
  const shaCorpus = ['', '123456', 'g123456', 'abcdef!', '../abcdef0', 'abcdef0/extra', 'refs/heads/main', 'A'.repeat(41), ' deadbee', 'deadbee\n'];
  for (const value of shaCorpus) assert.throws(() => assertSafeCommitSha(value), /plain commit SHA/, `SHA fuzz value should be rejected: ${JSON.stringify(value)}`);
  for (const value of ['ftp://api.github.com/x', 'file:///etc/passwd', 'javascript:alert(1)', '://missing', '\u0000']) {
    assert.throws(() => assertWellFormedApiUrl(value), /malformed API URL|non-HTTPS/, `URL fuzz value should be rejected: ${JSON.stringify(value)}`);
  }
});

test('supply-chain dependency policy blocks git, URL, local, unapproved registry, and denied-license inputs', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const { auditDependencyPolicy } = require('../src/dependencies');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-supply-chain-'));
  execFileSync('git', ['init'], { cwd:root, stdio:'ignore', windowsHide:true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies:{ gitdep:'github:owner/repo', urldep:'https://evil.example/pkg.tgz', localdep:'file:../outside' } }), 'utf8');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages:{
    'node_modules/gitdep':{ resolved:'https://evil.example/gitdep.tgz', license:'MIT' },
    'node_modules/urldep':{ resolved:'https://registry.npmjs.org/urldep/-/urldep.tgz', license:'GPL-3.0' },
  } }), 'utf8');
  execFileSync('git', ['add', 'package.json', 'package-lock.json'], { cwd:root, stdio:'ignore', windowsHide:true });
  const result = auditDependencyPolicy(root, { security:{ dependencyPolicy:{ enabled:true, denyGit:true, denyHttp:true, denyLocal:true, allowedRegistryHosts:['registry.npmjs.org'], denyLicenses:['GPL-3.0'] } } });
  const types = result.findings.map((item) => item.type);
  assert.ok(types.includes('Git dependency is forbidden'));
  assert.ok(types.includes('URL dependency is forbidden'));
  assert.ok(types.includes('local dependency is forbidden'));
  assert.ok(types.includes('unapproved dependency registry'));
  assert.ok(types.includes('prohibited license GPL-3.0'));
});
