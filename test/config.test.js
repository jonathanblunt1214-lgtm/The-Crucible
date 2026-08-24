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
  assert.equal(config.commands.verify[0].run, 'node');
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
