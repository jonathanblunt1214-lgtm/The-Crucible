const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest, checkRequiredCheckBoundary } = require('../src/requiredCheckBoundary');

const request = { mode: 'activate', defaultBranch: 'main', workflowPath: '.github/workflows/policy.yml', checkName: 'Policy check', promotionConfirmed: true };

test('report mode permits development reporting without inspecting or changing the default branch', () => {
  let invoked = false;
  const result = checkRequiredCheckBoundary({ ...request, mode: 'report', promotionConfirmed: false }, () => { invoked = true; });
  assert.equal(result.ok, true);
  assert.equal(invoked, false);
  assert.match(result.message, /Do not require/);
});

test('activation fails before explicit promotion is confirmed', () => {
  const result = validateRequest({ ...request, promotionConfirmed: false });
  assert.equal(result.ok, false);
  assert.match(result.message, /explicit promotion/);
});

test('activation fails when the workflow is absent from the remote default branch', () => {
  const result = checkRequiredCheckBoundary(request, () => ({ status: 1 }));
  assert.equal(result.ok, false);
  assert.match(result.message, /does not exist on refs\/remotes\/origin\/main/);
});

test('activation passes only after the promoted workflow exists on the remote default branch', () => {
  let invocation;
  const result = checkRequiredCheckBoundary(request, (command, args, options) => { invocation = { command, args, options }; return { status: 0 }; });
  assert.equal(result.ok, true);
  assert.deepEqual(invocation.args, ['cat-file', '-e', 'refs/remotes/origin/main:.github/workflows/policy.yml']);
  assert.equal(invocation.options.shell, false);
});

test('rejects unsafe branch input before invoking git', () => {
  let invoked = false;
  const result = checkRequiredCheckBoundary({ ...request, defaultBranch: 'main; unsafe' }, () => { invoked = true; });
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});
