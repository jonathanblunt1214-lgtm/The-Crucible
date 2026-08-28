const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHandoffChanges, validateHandoffPlan, validateDevlogChainOfCustody, checkHandoffRange, MAX_ARCHIVE_SESSIONS, MAX_ARCHIVE_AGE_DAYS } = require('../src/handoffPolicy');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const PLAN = { schemaVersion:1, activePlan:{ agent:'Codex', objective:'Test handoff', currentPrompt:'The owner asked to test handoff', executionMode:{ mode:'regular/default', agent:'Codex', purpose:'Handle a focused task without long-running Work-mode orchestration.', selectionReason:'The task is bounded and routine.', distinction:'Execution mode is independent from agent identity and workflow; another agent must preserve the required mode.' }, steps:['Run tests'], status:'active', startedAt:'2026-08-26T00:00:00Z', lastUpdatedAt:'2026-08-26T00:00:00Z' }, handoffNotes:{ completed:[], verification:[], remaining:['Finish'] } };

function devlogWithSessions(count) {
  const sessions = Array.from({ length: count }, (_, i) => [
    `### Session: sha${i} — 2026-08-27T00:0${i}:00Z — Codex — mode:regular/default`,
    '',
    `- \`npm test\` — started 2026-08-27T00:0${i}:00Z, finished 2026-08-27T00:0${i}:05Z, exit 0`,
    ''
  ].join('\n'));
  return [
    '# Development log',
    '',
    '## Shared AI handoff',
    '',
    '- Dev plan: see AI-HANDOFF.json activePlan.currentPrompt and handoffNotes.',
    '',
    '## Command log archive (last 10 sessions, newest first)',
    '',
    ...sessions,
    '## 2026-08-27',
    ''
  ].join('\n');
}

const DEVLOG_OK = devlogWithSessions(1);

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

test('rejects a git range whose DEVLOG.md lacks the chain-of-custody command log archive', () => {
  const result = checkHandoffRange(SHA_A, SHA_B, (command, args) => {
    if (args[0] === 'diff') return { status:0, stdout:'DEVLOG.md\nAI-HANDOFF.json\n', stderr:'' };
    if (args[1] === `${SHA_B}:AI-HANDOFF.json`) return { status:0, stdout:JSON.stringify(PLAN), stderr:'' };
    return { status:0, stdout:'# Development log\n\n## Shared AI handoff\n\nSee AI-HANDOFF.json for the dev plan, but nothing else.\n', stderr:'' };
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Command log archive/);
});

test('rejects a git range whose DEVLOG.md archive holds more than the 10-session cap', () => {
  const result = checkHandoffRange(SHA_A, SHA_B, (command, args) => {
    if (args[0] === 'diff') return { status:0, stdout:'DEVLOG.md\nAI-HANDOFF.json\n', stderr:'' };
    if (args[1] === `${SHA_B}:AI-HANDOFF.json`) return { status:0, stdout:JSON.stringify(PLAN), stderr:'' };
    return { status:0, stdout:devlogWithSessions(MAX_ARCHIVE_SESSIONS + 1), stderr:'' };
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /prune the oldest/);
});

test('rejects a git range whose DEVLOG.md archive has a session older than the 180-day backup limit', () => {
  const oldDevlog = [
    '# Development log', '', '## Shared AI handoff', '',
    '- Dev plan: see AI-HANDOFF.json activePlan.currentPrompt and handoffNotes.', '',
    '## Command log archive (last 10 sessions, newest first)', '',
    '### Session: shaOld — 2020-01-01T00:00:00Z — Codex — mode:regular/default', '',
    '- `npm test` — started 2020-01-01T00:00:00Z, finished 2020-01-01T00:00:05Z, exit 0', '',
    '## 2026-08-27', ''
  ].join('\n');
  const result = checkHandoffRange(SHA_A, SHA_B, (command, args) => {
    if (args[0] === 'diff') return { status:0, stdout:'DEVLOG.md\nAI-HANDOFF.json\n', stderr:'' };
    if (args[1] === `${SHA_B}:AI-HANDOFF.json`) return { status:0, stdout:JSON.stringify(PLAN), stderr:'' };
    return { status:0, stdout:oldDevlog, stderr:'' };
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /180-day backup limit/);
});

test('section extraction is not fooled by the heading text appearing earlier in ordinary prose (regression for a real bug found this session)', () => {
  const trapDevlog = [
    '# Development log', '',
    '## Shared AI handoff', '',
    '- Dev plan: see AI-HANDOFF.json activePlan.currentPrompt and handoffNotes. Mentions the literal heading "## Command log archive" right here in prose, which an earlier version of the parser split on by plain string search and got the wrong slice.',
    '',
    '## Command log archive (last 10 sessions, newest first)', '',
    '### Session: sha0 — 2026-08-27T00:00:00Z — Codex — mode:regular/default', '',
    '- `npm test` — started 2026-08-27T00:00:00Z, finished 2026-08-27T00:00:05Z, exit 0', '',
    '## 2026-08-27', ''
  ].join('\n');
  const result = validateDevlogChainOfCustody(trapDevlog);
  assert.equal(result.ok, true, result.message);
});

test('rejects an incomplete development plan that another AI could not take over', () => {
  assert.equal(validateHandoffPlan(PLAN).ok, true);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, steps:[] } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, currentPrompt:'' } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, executionMode:null } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, executionMode:{ ...PLAN.activePlan.executionMode, agent:'Claude' } } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, activePlan:{ ...PLAN.activePlan, executionMode:{ ...PLAN.activePlan.executionMode, distinction:'Same thing.' } } }).ok, false);
  assert.equal(validateHandoffPlan({ ...PLAN, handoffNotes:{ completed:[], verification:[] } }).ok, false);
});

test('DEVLOG chain-of-custody validation requires a dev-plan reference and a bounded command log archive with start/finish times', () => {
  assert.equal(validateDevlogChainOfCustody(DEVLOG_OK).ok, true);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\nNo handoff section.\n').ok, false);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\n## Shared AI handoff\n\nNo dev plan reference here.\n\n## 2026-08-27\n').ok, false);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\n## Shared AI handoff\n\nSee AI-HANDOFF.json for the dev plan, but no archive at all.\n\n## 2026-08-27\n').ok, false);
  assert.equal(validateDevlogChainOfCustody('# Development log\n\n## Shared AI handoff\n\nSee AI-HANDOFF.json for the dev plan.\n\n## Command log archive\n\nNo session entries here.\n\n## 2026-08-27\n').ok, false);
  const noStartFinish = '# Development log\n\n## Shared AI handoff\n\nSee AI-HANDOFF.json for the dev plan.\n\n## Command log archive\n\n### Session: sha0 — t0 — Codex\n\nran npm test, it finished.\n\n## 2026-08-27\n';
  assert.equal(validateDevlogChainOfCustody(noStartFinish).ok, false);
  const tooMany = devlogWithSessions(MAX_ARCHIVE_SESSIONS + 1);
  const tooManyResult = validateDevlogChainOfCustody(tooMany);
  assert.equal(tooManyResult.ok, false);
  assert.match(tooManyResult.message, /prune the oldest/);
  assert.equal(validateDevlogChainOfCustody(devlogWithSessions(MAX_ARCHIVE_SESSIONS)).ok, true);
  const missingMode = DEVLOG_OK.replace(' — mode:regular/default', '');
  assert.match(validateDevlogChainOfCustody(missingMode).message, /execution mode remains part of the chain of custody/);
});

test('the 180-day backup limit prunes an old session even when the archive is well within the 10-session cap', () => {
  const oneSessionDevlog = devlogWithSessions(1);
  const now = new Date('2026-08-27T00:00:00Z');
  assert.equal(validateDevlogChainOfCustody(oneSessionDevlog, now).ok, true);
  const farFuture = new Date(now.getTime() + (MAX_ARCHIVE_AGE_DAYS + 1) * 24 * 60 * 60 * 1000);
  const aged = validateDevlogChainOfCustody(oneSessionDevlog, farFuture);
  assert.equal(aged.ok, false);
  assert.match(aged.message, new RegExp(`${MAX_ARCHIVE_AGE_DAYS}-day backup limit`));
  const justUnderLimit = new Date(now.getTime() + (MAX_ARCHIVE_AGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  assert.equal(validateDevlogChainOfCustody(oneSessionDevlog, justUnderLimit).ok, true);
});

test('rejects untrusted commit range input before invoking git', () => {
  let invoked = false;
  const result = checkHandoffRange('HEAD; echo unsafe', SHA_B, () => {
    invoked = true;
  });
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});
