const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHandoffChanges, checkHandoffRange } = require('../src/handoffPolicy');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('passes when a project change updates DEVLOG.md', () => {
  assert.equal(evaluateHandoffChanges(['src/app.js', 'DEVLOG.md']).ok, true);
});

test('fails when project files change without a DEVLOG.md handoff', () => {
  const result = evaluateHandoffChanges(['src/app.js', 'README.md']);
  assert.equal(result.ok, false);
  assert.match(result.message, /must update DEVLOG\.md/);
});

test('checks an exact git range without a shell', () => {
  let invocation;
  const result = checkHandoffRange(SHA_A, SHA_B, (command, args, options) => {
    invocation = { command, args, options };
    return { status: 0, stdout: 'AGENTS.md\nDEVLOG.md\n', stderr: '' };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(invocation.args, ['diff', '--name-only', SHA_A, SHA_B]);
  assert.equal(invocation.options.shell, false);
});

test('rejects untrusted commit range input before invoking git', () => {
  let invoked = false;
  const result = checkHandoffRange('HEAD; echo unsafe', SHA_B, () => {
    invoked = true;
  });
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});
