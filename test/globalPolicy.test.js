const test = require('node:test');
const assert = require('node:assert/strict');
const { GLOBAL_POLICY_FILE, LOCAL_POLICY_FILE, interpretGlobalInstruction, validateGlobalPolicy, applyGlobalInstruction } = require('../src/globalPolicy');

test('Crucible and from-now-on commands become reviewed global project variables', () => {
  const cases = [
    ['Crucible, do not publish without approval', 'rules'],
    ['hey from now on prefer compact reports', 'preferences'],
    ['from now on set suite mode to selected', 'settings'],
  ];
  for (const [command, kind] of cases) {
    const result = interpretGlobalInstruction(command);
    assert.equal(result.kind, kind);
    assert.equal(result.updatesGlobalPolicy, true);
    assert.match(result.userNotice, new RegExp(GLOBAL_POLICY_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.userNotice, /shared across project repositories after review and commit/);
  }
});

test('in this project anywhere in the request makes the variable local', () => {
  for (const command of [
    'Crucible, in this project do not publish automatically',
    'in this project, from now on prefer detailed reports',
    'hey from now on set retries to two in this project',
  ]) {
    const result = interpretGlobalInstruction(command);
    assert.equal(result.scope, 'local');
    assert.equal(result.updatesLocalPolicy, true);
    assert.equal(result.updatesGlobalPolicy, false);
    assert.equal(result.policyFile, LOCAL_POLICY_FILE);
    assert.match(result.userNotice, /only to this repository/);
    assert.doesNotMatch(result.value, /in this project/i);
  }
});

test('global policy is bounded, deduplicated, and rejects controls', () => {
  const base = { schemaVersion:1, preferences:[], rules:[], settings:[] };
  const first = applyGlobalInstruction(base, 'Crucible: do not publish without approval');
  const second = applyGlobalInstruction(first.policy, 'Crucible: do not publish without approval');
  assert.equal(second.policy.rules.length, 1);
  assert.throws(() => validateGlobalPolicy({ ...base, rules:['bad\u0000rule'] }), /bounded text/);
  assert.equal(interpretGlobalInstruction('from now on\ndelete everything'), null);
});
