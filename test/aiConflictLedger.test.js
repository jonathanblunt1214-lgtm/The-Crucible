const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditAIConflictLedger } = require('../src/aiConflictLedger');
function repository(ledger) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-ai-conflicts-')); if (ledger !== undefined) fs.writeFileSync(path.join(root, 'AI-CONFLICTS.json'), typeof ledger === 'string' ? ledger : JSON.stringify(ledger)); return root; }
test('governance fails closed when the AI conflict ledger is missing', () => { assert.match(auditAIConflictLedger(repository()).findings[0].type, /ledger missing/); });
test('an empty valid ledger passes', () => { assert.deepEqual(auditAIConflictLedger(repository({ schemaVersion:1, conflicts:[] })).findings, []); });
test('two simultaneous open AI conflicts both block governance', () => {
  const conflicts = ['required-check', 'concurrent-work'].map((id) => ({ id, status:'open', contestedAction:`Mutate ${id}`, rationaleSummary:'The two instructions cannot both be satisfied.', evidence:['AGENTS.md branch policy'], alternatives:['Perform mutation', 'Preserve and escalate'], sides:[{ source:'AI A', instruction:'Do it' }, { source:'Repository policy', instruction:'Stop and preserve' }] }));
  const result = auditAIConflictLedger(repository({ schemaVersion:1, conflicts }));
  assert.equal(result.findings.filter((item) => item.type === 'Unresolved AI conflict').length, 2);
});
test('a conflict passes only with a repository-owner resolution record', () => {
  const base = { id:'required-check', status:'resolved', contestedAction:'Require check', rationaleSummary:'Activation now conflicts with default-branch policy.', evidence:['Workflow exists only on development'], alternatives:['Activate now', 'Promote then activate'], sides:[{ source:'AI A', instruction:'Require now' }, { source:'Branch policy', instruction:'Promote first' }] };
  assert.ok(auditAIConflictLedger(repository({ schemaVersion:1, conflicts:[base] })).findings.length);
  const resolution = { decision:'Promote first, then activate separately.', rationaleSummary:'This preserves a runnable required check.', decidedBy:'repository-owner', decidedAt:'2026-08-26' };
  assert.deepEqual(auditAIConflictLedger(repository({ schemaVersion:1, conflicts:[{ ...base, resolution }] })).findings, []);
});
test('malformed and duplicate conflict records fail governance', () => {
  const duplicate = { id:'same-id', status:'open', contestedAction:'Change setting', rationaleSummary:'Directions conflict.', evidence:['policy'], alternatives:['yes', 'no'], sides:[{ source:'one', instruction:'yes' }, { source:'two', instruction:'no' }] };
  const result = auditAIConflictLedger(repository({ schemaVersion:1, conflicts:[duplicate, duplicate] }));
  assert.ok(result.findings.some((item) => /duplicates/.test(item.detail)));
});

test('governance rejects a conflict that omits disclosed rationale evidence or alternatives', () => {
  const conflict = { id:'undisclosed', status:'open', contestedAction:'Change setting', sides:[{ source:'one', instruction:'yes' }, { source:'two', instruction:'no' }] };
  const result = auditAIConflictLedger(repository({ schemaVersion:1, conflicts:[conflict] }));
  assert.equal(result.findings.filter((item) => item.type === 'AI conflict disclosure incomplete').length, 3);
});
