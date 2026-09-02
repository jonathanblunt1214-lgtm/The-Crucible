'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DurableScientificLearningStore, makeCandidate } = require('../src/scientificLearning');

const at = '2026-01-01T00:00:00.000Z';
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const candidate = (id = 'c-1') => makeCandidate({
  id, projectId: 'project-a', claim: 'repair X causes test Y to pass', claimBoundary: 'node-22/windows/test-y',
  generalizationBoundary: 'no wider than node-22/windows/test-y', kind: 'controlled-experiment',
  provenance: { sourceType: 'conversation-research', sourceId: '6a92d5f9', retrievedAt: at, author: 'owner-and-assistant', license: 'private-candidate-evidence', contentSha256: sha('candidate source') },
  createdAt: at,
});
function freshStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-concurrency-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new DurableScientificLearningStore({ root, projectId: 'project-a' });
}

// The lost update as it actually happens, rather than as it is easy to imagine.
//
// transact refuses if the STORE revision moves between its own read and its own write, but that
// window is microseconds and is not where records are lost. A learner reads a record, awaits an
// experiment executor or an independent verifier - seconds, in another process - and only then
// writes back the copy it has been holding. A second learner that advanced the same record in
// that gap was simply overwritten, and because the store revision the first learner checked had
// changed and been re-read, nothing reported it.
test('a learner cannot overwrite newer progress with the snapshot it was holding', (t) => {
  const store = freshStore(t);
  store.ingest(candidate());

  // Two learners read the same record, exactly as two processes would.
  const learnerA = store.get('c-1');
  const learnerB = store.get('c-1');
  assert.equal(learnerA.recordRevision, learnerB.recordRevision, 'both hold the same revision');

  // B finishes first and advances the record.
  const advanced = store.update({ ...learnerB, hypothesis: 'B got here first', state: 'hypothesis' }, at, 'hypothesis');
  assert.equal(advanced.recordRevision, learnerB.recordRevision + 1, 'a successful update advances the record revision');

  // A now writes back the copy it read before B ran. This is the write that used to succeed and
  // silently discard B's work.
  assert.throws(
    () => store.update({ ...learnerA, hypothesis: 'A overwrites B', state: 'hypothesis' }, at, 'hypothesis'),
    /advanced from revision 0 to 1 while this update was being prepared.*stale snapshot/s,
  );

  // And B's work is still there, which is the point.
  assert.equal(store.get('c-1').hypothesis, 'B got here first');
});

// Promotion is the worst place to act on a stale snapshot: the 'verified' being read is the
// caller's memory, not what the store holds now.
test('a stale snapshot cannot commit knowledge', (t) => {
  const store = freshStore(t);
  store.ingest(candidate());
  const held = store.get('c-1');
  store.update({ ...held, hypothesis: 'someone else moved this record on', state: 'hypothesis' }, at, 'hypothesis');

  assert.throws(
    () => store.commit({ ...held, state: 'verified', proof: { experimentBoundary: 'node-22/windows/test-y' } }, at),
    /advanced from revision 0 to 1 while this knowledge commit was being prepared/,
  );
});

// The guard must not fire on ordinary sequential work, or every learner breaks.
test('threading the returned record forward keeps working, with no caller change', (t) => {
  const store = freshStore(t);
  store.ingest(candidate());
  let record = store.get('c-1');
  for (const [index, hypothesis] of ['first', 'second', 'third'].entries()) {
    record = store.update({ ...record, hypothesis, state: 'hypothesis' }, at, 'hypothesis');
    assert.equal(record.recordRevision, index + 1, 'each accepted update advances exactly one revision');
  }
  assert.equal(store.get('c-1').hypothesis, 'third');
});

// Durable state written before this field existed must keep working rather than failing closed
// on every record the store already holds.
test('records stored before the field existed are accepted and stamped on first update', (t) => {
  const store = freshStore(t);
  store.ingest(candidate());
  const legacy = store.get('c-1');
  delete legacy.recordRevision;

  const updated = store.update({ ...legacy, hypothesis: 'legacy record still writable', state: 'hypothesis' }, at, 'hypothesis');
  assert.equal(updated.recordRevision, 1, 'an unstamped record reads as revision 0 and is stamped on its first update');

  // And once stamped, the stale copy is refused like any other.
  assert.throws(() => store.update({ ...legacy, hypothesis: 'stale legacy write', state: 'hypothesis' }, at, 'hypothesis'), /stale snapshot/);
});
