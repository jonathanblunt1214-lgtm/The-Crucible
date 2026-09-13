const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CORROBORATION_OUTCOMES, validateDeliberation, assertConsensusDoesNotAuthorize,
  independentReviewers, assertIndependentlyReviewed,
} = require('../src/multiAiDeliberation');
const { auditAIConflictLedger } = require('../src/aiConflictLedger');

function ledgerFixture(t, ledger) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-deliberation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AI-CONFLICTS.json'), JSON.stringify(ledger));
  return root;
}

function baseConflict(overrides = {}) {
  return {
    id: 'competing-extractor-designs',
    status: 'open',
    contestedAction: 'Rewriting src/extractor.js while two providers disagree.',
    rationaleSummary: 'Both proposals are plausible; the contested mutation is frozen.',
    evidence: ['test/extractor.test.js passes under both'],
    sides: [{ source: 'openai', instruction: 'read-time' }, { source: 'anthropic', instruction: 'write-time' }],
    alternatives: ['Normalise at read time.', 'Normalise at write time.'],
    ...overrides,
  };
}

const FULL_DELIBERATION = {
  proposals: [
    { provider: 'openai', model: 'm', summary: 'Normalise at read time.', evidence: ['no migration needed'] },
    { provider: 'anthropic', model: 'm', summary: 'Normalise at write time.', evidence: ['read path stays hot'] },
  ],
  positions: [{ provider: 'perplexity', position: 'Read-time is safer first.', evidence: ['reversible'] }],
  responses: [{ provider: 'nvidia-nim', respondsTo: 'anthropic', stance: 'partial', response: 'Needs a migration plan.' }],
  corroboration: { outcome: 'partial-agreement', rationaleSummary: 'Three lean read-time, one partial.', escalatedToOwner: false },
};

test('the outcome vocabulary is exactly the five governed results', () => {
  assert.deepEqual([...CORROBORATION_OUTCOMES].sort(), ['consensus', 'insufficient-evidence', 'partial-agreement', 'test-verified', 'unresolved-conflict']);
});

test('AI-CONFLICTS.json accepts multi-party proposals, positions, responses and evidence', () => {
  assert.deepEqual(validateDeliberation(FULL_DELIBERATION), []);
});

test('there is no AI-DELIBERATION.json: the ledger alone carries the discussion', (t) => {
  const root = ledgerFixture(t, { schemaVersion: 1, conflicts: [baseConflict({ status: 'resolved', deliberation: FULL_DELIBERATION, resolution: { decision: 'Take read-time.', rationaleSummary: 'Owner ruled.', decidedBy: 'repository-owner', decidedAt: '2026-09-03' } })] });
  assert.equal(fs.existsSync(path.join(root, 'AI-DELIBERATION.json')), false);
  const result = auditAIConflictLedger(root);
  assert.deepEqual(result.findings, []);
});

test('an unresolved conflict fails the governance gate', (t) => {
  const root = ledgerFixture(t, { schemaVersion: 1, conflicts: [baseConflict({ deliberation: FULL_DELIBERATION })] });
  const result = auditAIConflictLedger(root);
  const unresolved = result.findings.filter((item) => item.type === 'Unresolved AI conflict');
  assert.equal(unresolved.length, 1);
});

test('a resolved conflict retains its full audit history', (t) => {
  const conflict = baseConflict({ status: 'resolved', deliberation: FULL_DELIBERATION, resolution: { decision: 'Read-time.', rationaleSummary: 'Owner ruled.', decidedBy: 'repository-owner', decidedAt: '2026-09-03' } });
  const root = ledgerFixture(t, { schemaVersion: 1, conflicts: [conflict] });
  assert.deepEqual(auditAIConflictLedger(root).findings, []);
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'AI-CONFLICTS.json'), 'utf8')).conflicts[0];
  assert.equal(stored.deliberation.proposals.length, 2);
  assert.equal(stored.sides.length, 2);
  assert.equal(stored.alternatives.length, 2);
});

test('a conflict may freeze a named scope, and a malformed one is refused', (t) => {
  const ok = ledgerFixture(t, { schemaVersion: 1, conflicts: [baseConflict({ contestedScope: { paths: ['src/extractor.js'] } })] });
  assert.equal(auditAIConflictLedger(ok).findings.filter((item) => item.type === 'AI conflict record invalid').length, 0);
  const bad = ledgerFixture(t, { schemaVersion: 1, conflicts: [baseConflict({ contestedScope: { paths: [] } })] });
  assert.ok(auditAIConflictLedger(bad).findings.some((item) => /contestedScope must name at least one/.test(item.detail)));
});

test('model consensus alone cannot mark a change owner-approved', () => {
  const findings = validateDeliberation({ ...FULL_DELIBERATION, corroboration: { outcome: 'consensus', rationaleSummary: 'All four agreed.', ownerApproved: true } });
  assert.ok(findings.some((item) => /ownerApproved must not be set by an AI/.test(item)));
  assert.throws(
    () => assertConsensusDoesNotAuthorize({ outcome: 'consensus', ownerApproved: true }),
    (error) => error.crucibleCode === 'CRU-0032' && /evidence, not proof/.test(error.message),
  );
  // Even a test-verified outcome is evidence about the code, not owner approval.
  assert.throws(() => assertConsensusDoesNotAuthorize({ outcome: 'test-verified', ownerApproved: true }), (error) => error.crucibleCode === 'CRU-0032');
  assert.equal(assertConsensusDoesNotAuthorize({ outcome: 'consensus' }).authorized, false);
});

test('consensus requires at least two independent voices', () => {
  const solo = { proposals: [{ provider: 'openai', summary: 'Do it my way.', evidence: ['because'] }], corroboration: { outcome: 'consensus', rationaleSummary: 'Nobody objected.' } };
  assert.ok(validateDeliberation(solo).some((item) => /Consensus requires at least two independent positions/.test(item)));
});

test('an unresolved conflict must be escalated to the owner, never quietly dropped', () => {
  const findings = validateDeliberation({ ...FULL_DELIBERATION, corroboration: { outcome: 'unresolved-conflict', rationaleSummary: 'No overlap.', escalatedToOwner: false } });
  assert.ok(findings.some((item) => /escalatedToOwner must be true/.test(item)));
  assert.deepEqual(validateDeliberation({ ...FULL_DELIBERATION, corroboration: { outcome: 'unresolved-conflict', rationaleSummary: 'No overlap.', escalatedToOwner: true } }), []);
});

test('an AI may not be the only reviewer of its own material change', () => {
  assert.deepEqual(independentReviewers({ positions: [{ provider: 'openai', position: 'mine is right' }] }, 'openai'), []);
  assert.throws(
    () => assertIndependentlyReviewed({ positions: [{ provider: 'openai', position: 'mine is right' }] }, 'openai'),
    (error) => error.crucibleCode === 'CRU-0032' && /only recorded reviewer of its own material change/.test(error.message),
  );
  assert.deepEqual(assertIndependentlyReviewed(FULL_DELIBERATION, 'openai').reviewers.sort(), ['nvidia-nim', 'perplexity']);
});

test('the deliberation block is optional so records predating it still validate', () => {
  assert.deepEqual(validateDeliberation(undefined), []);
  assert.deepEqual(validateDeliberation(null), []);
});
