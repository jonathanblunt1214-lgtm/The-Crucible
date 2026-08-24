const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/config');

function fixture() {
  return {
    schemaVersion:1,
    project:{ name:'Fixture' },
    privacy:{ githubIdentity:'octocat' },
    commands:{ verify:[{ name:'Test', run:'node', args:['--test'] }] },
  };
}

test('validates and supplies bounded workload defaults', () => {
  const config = validateConfig(fixture());
  assert.deepEqual(config.workload, { workers:4, cycles:2, timeoutMinutes:4 });
  assert.equal(config.privacy.scanContactInformation, false);
  assert.deepEqual(config.privacy.allow, []);
  assert.equal(config.clutter.blockTrackedIgnored, false);
  assert.equal(config.commands.verify[0].run, 'node');
  assert.deepEqual(config.security, { enabled:true, allow:[], allowBinaries:[], maxTextBytes:1048576, dependencyAudit:[] });
});

test('validates narrow privacy path exemptions', () => {
  const value = fixture();
  value.privacy.allow = ['src/data/**'];
  assert.deepEqual(validateConfig(value).privacy.allow, ['src/data/**']);
  value.privacy.allow = [42];
  assert.throws(() => validateConfig(value), /privacy.allow/);
});

test('validates bounded shell-free Security Gate configuration', () => {
  const value = fixture();
  value.security = { allow:['fixtures/**'], allowBinaries:['vendor/tool.exe'], dependencyAudit:[{ name:'Audit', run:'npm', args:['audit'] }] };
  const config = validateConfig(value);
  assert.equal(config.security.dependencyAudit[0].run, 'npm');
  const unsafe = fixture();
  unsafe.security = { dependencyAudit:[{ name:'Unsafe', run:'../audit' }] };
  assert.throws(() => validateConfig(unsafe), /executable name/);
  const invalidToggle = fixture();
  invalidToggle.security = { enabled:'no' };
  assert.throws(() => validateConfig(invalidToggle), /must be a boolean/);
});

test('rejects shell-like executable paths and paths outside the repository', () => {
  const executablePath = fixture();
  executablePath.commands.verify[0].run = '../tool';
  assert.throws(() => validateConfig(executablePath), /executable name/);
  const cwdEscape = fixture();
  cwdEscape.commands.verify[0].cwd = '../outside';
  assert.throws(() => validateConfig(cwdEscape), /cannot escape/);
  const artifactEscape = fixture();
  artifactEscape.artifacts = ['../secret'];
  assert.throws(() => validateConfig(artifactEscape), /safe repository-relative/);
});

test('rejects missing verification and unbounded stress settings', () => {
  const missing = fixture();
  missing.commands.verify = [];
  assert.throws(() => validateConfig(missing), /at least one/);
  const unbounded = fixture();
  unbounded.workload = { workers:99 };
  assert.throws(() => validateConfig(unbounded), /1 through 8/);
});
