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
