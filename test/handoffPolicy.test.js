const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHandoffChanges, validateHandoffPlan, checkHandoffRange } = require('../src/handoffPolicy');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const PLAN = { schemaVersion:1, activePlan:{ agent:'Codex', objective:'Test handoff', steps:['Run tests'], status:'active', startedAt:'2026-08-26T00:00:00Z', lastUpdatedAt:'2026-08-26T00:00:00Z' }, handoffNotes:{ completed:[], verification:[], remaining:['Finish'] } };

test('passes only when a project change updates both handoff surfaces', () => {
  assert.equal(evaluateHandoffChanges(['src/app.js', 'DEVLOG.md', 'AI-HANDOFF.json']).ok, true);
  assert.equal(evaluateHandoffChanges(['src/app.js', 'DEVLOG.md']).ok, false);
});

test('fails when project files change without a DEVLOG.md handoff', () => {
  const result = evaluateHandoffChanges(['src/app.js', 'README.md']);
  assert.equal(result.ok, false);
  assert.match(result.message, /must update both DEVLOG\.md and AI-HANDOFF\.json/);
});

test('checks an exact git range without a shell', () => {
  const invocations = [];
  const result = checkHandoffRange(SHA_A, SHA_B, (command, args, options) => {
    invocations.push({ command, args, options });
    return args[0] === 'diff' ? { status:0, stdout:'AGENTS.md\nDEVLOG.md\nAI-HANDOFF.json\n', stderr:'' } : { status:0, stdout:JSON.stringify(PLAN), stderr:'' };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(invocations[0].args, ['diff', '--name-only', SHA_A, SHA_B]);
  assert.deepEqual(invocations[1].args, ['show', `${SHA_B}:AI-HANDOFF.json`]);
  assert.equal(invocations.every((item) => item.options.shell === false), true);
});

test('rejects an incomplete development plan that another AI could not take over', () => {
  assert.equal(validateHandoffPlan(PLAN).ok, true);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, steps:[] } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, handoffNotes:{ completed:[], verification:[] } }).ok, false);
});

test('rejects untrusted commit range input before invoking git', () => {
  let invoked = false;
  const result = checkHandoffRange('HEAD; echo unsafe', SHA_B, () => {
    invoked = true;
  });
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});
