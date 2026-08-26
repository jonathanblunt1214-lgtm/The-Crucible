const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAIConflict } = require('../src/aiConflictResolution');

test('allows work when no AI conflict exists', () => {
  assert.equal(evaluateAIConflict({ conflictDetected: false }).decision, 'proceed');
});

test('requires both sides to be preserved in the shared handoff', () => {
  const result = evaluateAIConflict({ conflictDetected: true, contestedMutation: false, handoffUpdated: false });
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'preserve-and-escalate');
});

test('blocks a contested mutation without an explicit owner resolution', () => {
  const result = evaluateAIConflict({ conflictDetected: true, contestedMutation: true, handoffUpdated: true, ownerResolution: '' });
  assert.equal(result.ok, false);
  assert.match(result.message, /repository owner explicitly resolves/);
});

test('permits reporting an unresolved conflict without mutating contested state', () => {
  const result = evaluateAIConflict({ conflictDetected: true, contestedMutation: false, handoffUpdated: true, ownerResolution: '' });
  assert.equal(result.ok, true);
  assert.equal(result.decision, 'report-only');
});

test('accepts the repository owner explicit resolution after the conflict is recorded', () => {
  const result = evaluateAIConflict({ conflictDetected: true, contestedMutation: true, handoffUpdated: true, ownerResolution: 'Promote policy.yml to main, then require Policy check.' });
  assert.equal(result.ok, true);
  assert.equal(result.decision, 'owner-resolved');
});
