const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHandoffChanges, validateHandoffPlan, validateDevlogChainOfCustody, checkHandoffRange } = require('../src/handoffPolicy');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const PLAN = { schemaVersion:1, activePlan:{ agent:'Codex', objective:'Test handoff', currentPrompt:'The owner asked to test handoff', steps:['Run tests'], status:'active', startedAt:'2026-08-26T00:00:00Z', lastUpdatedAt:'2026-08-26T00:00:00Z' }, handoffNotes:{ completed:[], verification:[], remaining:['Finish'] } };

const DEVLOG_OK = [
  '# Development log',
  '',
  '## Shared AI handoff',
  '',
  '- Dev plan: see AI-HANDOFF.json activePlan.currentPrompt and handoffNotes.',
  '- Command log:',
  '  - `npm test` — started 2026-08-27T00:00:00Z, finished 2026-08-27T00:00:05Z, exit 0',
  '',
  '## 2026-08-27',
  ''
].join('\n');

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
    if (args[0] === 'diff') return { status:0, stdout:'AGENTS.md\nDEVLOG.md\nAI-HANDOFF.json\n', stderr:'' };
    if (args[1] === `${SHA_B}:AI-HANDOFF.json`) return { status:0, stdout:JSON.stringify(PLAN), stderr:'' };
    if (args[1] === `${SHA_B}:DEVLOG.md`) return { status:0, stdout:DEVLOG_OK, stderr:'' };
    throw new Error(`unexpected invocation: ${args.join(' ')}`);
  });
  assert.equal(result.ok, true);
  assert.deepEqual(invocations[0].args, ['diff', '--name-only', SHA_A, SHA_B]);
  assert.deepEqual(invocations[1].args, ['show', `${SHA_B}:AI-HANDOFF.json`]);
  assert.deepEqual(invocations[2].args, ['show', `${SHA_B}:DEVLOG.md`]);
  assert.equal(invocations.every((item) => item.options.shell === false), true);
});

test('rejects a git range whose DEVLOG.md lacks the chain-of-custody command log', () => {
  const result = checkHandoffRange(SHA_A, SHA_B, (command, args) => {
    if (args[0] === 'diff') return { status:0, stdout:'DEVLOG.md\nAI-HANDOFF.json\n', stderr:'' };
    if (args[1] === `${SHA_B}:AI-HANDOFF.json`) return { status:0, stdout:JSON.stringify(PLAN), stderr:'' };
    return { status:0, stdout:'# Development log\n\n## Shared AI handoff\n\nSee AI-HANDOFF.json for the dev plan, but nothing else.\n', stderr:'' };
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Command log/);
});

test('rejects an incomplete development plan that another AI could not take over', () => {
  assert.equal(validateHandoffPlan(PLAN).ok, true);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, steps:[] } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, currentPrompt:'' } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, handoffNotes:{ completed:[], verification:[] } }).ok, false);
});

test('DEVLOG chain-of-custody validation requires a dev-plan reference and a command log with start/finish times', () => {
  assert.equal(validateDevlogChainOfCustody(DEVLOG_OK).ok, true);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\nNo handoff section.\n').ok, false);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\n## Shared AI handoff\n\nNo dev plan reference here.\n\n## 2026-08-27\n').ok, false);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\n## Shared AI handoff\n\nSee AI-HANDOFF.json for the dev plan, but no log of what ran.\n\n## 2026-08-27\n').ok, false);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\n## Shared AI handoff\n\nSee AI-HANDOFF.json for the dev plan. Command log: ran npm test, it finished.\n\n## 2026-08-27\n').ok, false);
});

test('rejects untrusted commit range input before invoking git', () => {
  let invoked = false;
  const result = checkHandoffRange('HEAD; echo unsafe', SHA_B, () => {
    invoked = true;
  });
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});
