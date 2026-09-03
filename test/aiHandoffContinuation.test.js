const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveCurrentStep, awaitsOwner, freezeKind, inspectDevlog, inspectConflicts,
  inspectForContinuation, assertReadyToContinue, assertMutationAllowed,
} = require('../src/aiHandoffContinuation');

const OPENAI = { provider: 'openai', model: 'm', agent: 'session-a' };
const ANTHROPIC = { provider: 'anthropic', model: 'm', agent: 'session-b' };

function claim(taskId, owner, paths) {
  return { taskId, owner, scope: { paths }, purpose: 'p', status: 'active', acquiredAt: '2026-09-03T17:00:00Z', handedOffTo: null, releasedAt: null };
}

function conflict(id, overrides = {}) {
  return {
    id, status: 'open',
    contestedAction: 'Contested change.',
    rationaleSummary: 'Both sides preserved.',
    evidence: ['evidence item'],
    sides: [{ source: 'openai', instruction: 'a' }, { source: 'anthropic', instruction: 'b' }],
    alternatives: ['a', 'b'],
    ...overrides,
  };
}

// A fixture repository. Governance checks are stubbed through the report so the tests exercise
// the governance *semantics* rather than shelling out to npm.
function fixture(t, { claims = [], conflicts = [], devlog = '# Development log\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-continue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AI-HANDOFF.json'), JSON.stringify({ schemaVersion: 1, activePlan: { agent: 'x', objective: 'o', steps: ['first step', 'second step'] }, handoffNotes: { remaining: ['next thing'] }, mutationClaims: claims }));
  fs.writeFileSync(path.join(root, 'AI-CONFLICTS.json'), JSON.stringify({ schemaVersion: 1, conflicts }));
  fs.writeFileSync(path.join(root, 'DEVLOG.md'), devlog);
  return root;
}

// Governance verification is orthogonal to the scoping rules under test, so it is satisfied
// explicitly rather than by running the real gates.
function verified(report) {
  return { ...report, governance: { ...report.governance, ran: true, verified: true, allPassed: true }, governanceVerified: true, mayMutate: report.inspectionComplete && report.blockers.length === 0 };
}

test('a conflict on one scope freezes that scope and nothing else', (t) => {
  const root = fixture(t, {
    claims: [claim('auth-task', OPENAI, ['src/auth']), claim('docs-task', OPENAI, ['docs'])],
    conflicts: [conflict('auth-approach', { contestedScope: { paths: ['src/auth'] } })],
  });
  const report = verified(inspectForContinuation(root));

  // Repository-wide work is not stopped by a scoped conflict.
  assert.deepEqual(report.blockers, []);
  assert.equal(report.mayMutate, true);

  // The contested scope is frozen...
  assert.throws(
    () => assertMutationAllowed(report, { actor: OPENAI, paths: ['src/auth/login.js'] }),
    (error) => error.crucibleCode === 'CRU-0031' && /frozen by unresolved AI conflict auth-approach/.test(error.message),
  );
  // ...and an independently claimed, unrelated scope proceeds.
  assert.ok(assertMutationAllowed(report, { actor: OPENAI, paths: ['docs/readme.md'] }).allowed);
});

test('a conflict that names no scope is a repository-wide stop', (t) => {
  const root = fixture(t, { conflicts: [conflict('unscoped-dispute')] });
  const report = verified(inspectForContinuation(root));
  assert.equal(freezeKind(conflict('unscoped-dispute')), 'repository-wide');
  assert.equal(report.conflicts.repositoryWideStops.length, 1);
  assert.equal(report.mayMutate, false);
  assert.throws(() => assertReadyToContinue(report, { actor: OPENAI }), (error) => error.crucibleCode === 'CRU-0037' && /freezes the whole repository/.test(error.message));
});

test('an explicit repositoryWide flag stops everything even when a scope is named', (t) => {
  const root = fixture(t, { conflicts: [conflict('stop-everything', { contestedScope: { paths: ['src/auth'] }, repositoryWide: true })] });
  const report = verified(inspectForContinuation(root));
  assert.equal(report.conflicts.repositoryWideStops.length, 1);
  assert.equal(report.mayMutate, false);
});

test('ordinary open deliberation is not automatically awaiting the owner', () => {
  assert.equal(awaitsOwner(conflict('ordinary')), false);
  assert.equal(awaitsOwner(conflict('escalated', { escalatedToOwner: true })), true);
  assert.equal(awaitsOwner(conflict('via-corroboration', { deliberation: { corroboration: { outcome: 'unresolved-conflict', escalatedToOwner: true } } })), true);
  assert.equal(awaitsOwner(conflict('pending-decision', { resolution: { decision: 'Pending repository-owner decision.', decidedBy: null } })), true);
});

test('deliberation and owner escalation are reported separately', (t) => {
  const root = fixture(t, {
    conflicts: [
      conflict('still-arguing', { contestedScope: { paths: ['src/a.js'] } }),
      conflict('needs-owner', { contestedScope: { paths: ['src/b.js'] }, escalatedToOwner: true }),
    ],
  });
  const { conflicts } = inspectForContinuation(root);
  assert.deepEqual(conflicts.inDeliberation.map((item) => item.id), ['still-arguing']);
  assert.deepEqual(conflicts.awaitingOwner.map((item) => item.id), ['needs-owner']);
  assert.equal(conflicts.repositoryWideStops.length, 0);
});

test('skipped governance checks cannot authorize mutation, but reading stays allowed', (t) => {
  const root = fixture(t, { claims: [claim('task-a', OPENAI, ['src/a.js'])] });
  const report = inspectForContinuation(root, { runChecks: false });
  assert.equal(report.governance.ran, false);
  assert.equal(report.governanceVerified, false);
  assert.equal(report.mayMutate, false);
  assert.equal(report.mayInvestigate, true);
  assert.throws(
    () => assertMutationAllowed(report, { actor: OPENAI, paths: ['src/a.js'] }),
    (error) => error.crucibleCode === 'CRU-0037' && /governance checks were not verified/.test(error.message),
  );
});

test('failed governance checks cannot authorize mutation', (t) => {
  const root = fixture(t, { claims: [claim('task-a', OPENAI, ['src/a.js'])] });
  const base = inspectForContinuation(root);
  const failed = { ...base, governance: { ran: true, verified: false, allPassed: false, checks: [{ script: 'audit:coordination', ok: false }] }, governanceVerified: false, blockers: ['Governance checks failed: audit:coordination.'], mayMutate: false };
  assert.throws(() => assertMutationAllowed(failed, { actor: OPENAI, paths: ['src/a.js'] }), (error) => error.crucibleCode === 'CRU-0037');
});

test('an actor without a claim cannot mutate, and one with a matching claim can', (t) => {
  const root = fixture(t, { claims: [claim('task-a', OPENAI, ['src/a.js'])] });
  const report = verified(inspectForContinuation(root));
  assert.ok(assertMutationAllowed(report, { actor: OPENAI, taskId: 'task-a', paths: ['src/a.js'] }).allowed);
  assert.throws(
    () => assertMutationAllowed(report, { actor: OPENAI, paths: ['src/unclaimed.js'] }),
    (error) => error.crucibleCode === 'CRU-0030' && /not covered by any active mutation claim/.test(error.message),
  );
  // The claim must be the one being worked under, not merely any claim of this actor's.
  assert.throws(() => assertMutationAllowed(report, { actor: OPENAI, taskId: 'other-task', paths: ['src/a.js'] }), (error) => error.crucibleCode === 'CRU-0030' && /not other-task/.test(error.message));
});

test('another AI cannot mutate a claimed scope but may read, test and review it', (t) => {
  const root = fixture(t, { claims: [claim('task-a', OPENAI, ['src/a.js'])] });
  const report = verified(inspectForContinuation(root));
  assert.throws(
    () => assertMutationAllowed(report, { actor: ANTHROPIC, paths: ['src/a.js'] }),
    (error) => error.crucibleCode === 'CRU-0030' && /may read, test, review, critique and propose/.test(error.message),
  );
  // Read-only continuation readiness is unaffected by somebody else's claim.
  assert.deepEqual(assertReadyToContinue(report, { actor: ANTHROPIC }), { ready: true, resumeFrom: report.resumeFrom });
  assert.equal(report.mayInvestigate, true);
});

test('a predecessor\'s uncommitted work is protected on overlap and ignored when unrelated', (t) => {
  const root = fixture(t, { claims: [claim('task-a', OPENAI, ['src/a.js']), claim('task-b', OPENAI, ['src/b.js'])] });
  const base = verified(inspectForContinuation(root));
  const dirty = { ...base, uncommittedPaths: ['src/a.js'] };

  assert.throws(
    () => assertMutationAllowed(dirty, { actor: OPENAI, paths: ['src/a.js'] }),
    (error) => error.crucibleCode === 'CRU-0037' && /never discarded or reset/.test(error.message),
  );
  // Unrelated dirty work does not stop a separately claimed scope from proceeding.
  assert.ok(assertMutationAllowed(dirty, { actor: OPENAI, paths: ['src/b.js'] }).allowed);
});

test('the current step is the unfinished one, with the legacy string list still supported', () => {
  assert.deepEqual(resolveCurrentStep({ currentStep: 'explicitly here', steps: ['a', 'b'] }), { currentStep: 'explicitly here', source: 'explicit', stepCount: 2 });
  assert.deepEqual(
    resolveCurrentStep({ steps: [{ text: 'done one', status: 'done' }, { text: 'working on this', status: 'in-progress' }, { text: 'later', status: 'todo' }] }),
    { currentStep: 'working on this', source: 'in-progress', stepCount: 3 },
  );
  assert.deepEqual(
    resolveCurrentStep({ steps: [{ text: 'done one', status: 'done' }, { text: 'next up', status: 'todo' }] }),
    { currentStep: 'next up', source: 'first-unfinished', stepCount: 2 },
  );
  // Legacy: plain strings with no status, as this repository records them today.
  assert.deepEqual(resolveCurrentStep({ steps: ['first', 'second'] }), { currentStep: 'second', source: 'legacy-last-step', stepCount: 2 });
  assert.deepEqual(resolveCurrentStep({ steps: [] }), { currentStep: null, source: 'none', stepCount: 0 });
});

test('the legacy AI-HANDOFF schema in this repository still reads cleanly', () => {
  const root = path.join(__dirname, '..');
  const report = inspectForContinuation(root);
  assert.equal(report.handoff.present, true);
  assert.equal(report.handoff.currentStepSource, 'legacy-last-step');
  assert.ok(report.handoff.stepCount > 0);
  assert.ok(report.resumeFrom, 'the real repository reports a commit to resume from');
});

test('the DEVLOG latest session is chosen by timestamp, and this repository is newest-first', () => {
  const real = inspectDevlog(path.join(__dirname, '..'));
  assert.equal(real.present, true);
  assert.equal(real.order, 'newest-first');
  assert.ok(real.sessions > 1);

  // The same reader is correct if the convention is ever append-only instead.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-devlog-'));
  try {
    fs.writeFileSync(path.join(root, 'DEVLOG.md'), '### Session: older — 2026-01-01T00:00:00Z — A — mode:regular/default\n\n### Session: newer — 2026-06-01T00:00:00Z — B — mode:regular/default\n');
    const appended = inspectDevlog(root);
    assert.equal(appended.order, 'append-only');
    assert.match(appended.latest, /^newer/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a mutation must name the paths it will change', (t) => {
  const root = fixture(t, { claims: [claim('task-a', OPENAI, ['src/a.js'])] });
  const report = verified(inspectForContinuation(root));
  assert.throws(() => assertMutationAllowed(report, { actor: OPENAI, paths: [] }), (error) => error.crucibleCode === 'CRU-0030' && /must name the paths/.test(error.message));
});

test('a missing handoff file leaves the inspection incomplete', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const report = inspectForContinuation(root);
  assert.equal(report.inspectionComplete, false);
  assert.equal(report.mayMutate, false);
  assert.throws(() => assertReadyToContinue(report, { actor: OPENAI }), (error) => error.crucibleCode === 'CRU-0037');
});
