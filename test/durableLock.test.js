const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { acquireDurableLock, inspectLock, RECLAIM_STALE_AFTER_MS } = require('../src/durableLock');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { DurableScientificLearningStore } = require('../src/scientificLearning');

const AT = '2026-08-31T17:00:00.000Z';
function sampleCandidate(projectId) {
  return { schemaVersion: 1, id: 'c-lock-1', projectId, claim: 'the durable store records how it recovered a lock', claimBoundary: 'this store instance only', generalizationBoundary: 'no wider than this store instance', kind: 'extracted-source-assertion', provenance: { sourceType: 'test-fixture', sourceId: 'lock-recovery', retrievedAt: AT, author: 'not declared', license: 'not declared', contentSha256: crypto.createHash('sha256').update('lock recovery fixture').digest('hex') }, classification: 'Insufficient Evidence', createdAt: AT };
}

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// A process id nothing is using: spawn a child, wait for it to exit, and reuse its id.
function reapedPid() {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(result.status, 0);
  return result.pid;
}

function ageLockFile(file, ms) {
  const when = new Date(Date.now() - ms);
  fs.utimesSync(file, when, when);
}

test('acquires, holds exclusively, and releases a durable lock', (t) => {
  const file = path.join(workspace(t), 'a.lock');
  const held = acquireDurableLock(file);
  assert.equal(held.reclaimedFrom, null);
  assert.ok(fs.existsSync(file));
  assert.throws(() => acquireDurableLock(file), /cannot be reclaimed/);
  held.release();
  assert.equal(fs.existsSync(file), false);
  held.release(); // Releasing twice is a no-op, not a second removal.
});

test('refuses to reclaim a lock whose owner process is still running', (t) => {
  const file = path.join(workspace(t), 'b.lock');
  acquireDurableLock(file, { pid: 4242, isAlive: () => true });
  ageLockFile(file, RECLAIM_STALE_AFTER_MS * 2);
  assert.throws(() => acquireDurableLock(file, { isAlive: () => true }), /still running, so this is genuine concurrency/);
  assert.ok(fs.existsSync(file), 'a live owner keeps its lock');
});

test('refuses to reclaim a lock recorded by another host', (t) => {
  const file = path.join(workspace(t), 'c.lock');
  acquireDurableLock(file, { hostname: 'other-machine', pid: reapedPid() });
  ageLockFile(file, RECLAIM_STALE_AFTER_MS * 2);
  assert.throws(() => acquireDurableLock(file, { hostname: 'this-machine', isAlive: () => false }), /another machine/);
  assert.ok(fs.existsSync(file));
});

test('refuses to reclaim a lock it did not write, rather than deleting on a guess', (t) => {
  const file = path.join(workspace(t), 'd.lock');
  fs.writeFileSync(file, 'not a lock record');
  assert.throws(() => acquireDurableLock(file, { isAlive: () => false }), /not written by this lock/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'not a lock record');
});

test('refuses to reclaim inside the staleness floor that rules out a recycled process id', (t) => {
  const file = path.join(workspace(t), 'e.lock');
  acquireDurableLock(file, { pid: reapedPid() });
  const inspection = inspectLock(file, { isAlive: () => false });
  assert.equal(inspection.reclaimable, false);
  assert.match(inspection.reason, /below the \d+ms floor/);
  assert.throws(() => acquireDurableLock(file, { isAlive: () => false }), /recycled process id/);
});

test('reclaims only from a provably dead owner on this host and reports the recovery', (t) => {
  const file = path.join(workspace(t), 'f.lock');
  const dead = reapedPid();
  acquireDurableLock(file, { pid: dead });
  ageLockFile(file, RECLAIM_STALE_AFTER_MS * 2);
  const held = acquireDurableLock(file, { isAlive: () => false });
  assert.equal(held.reclaimedFrom.pid, dead);
  assert.equal(held.reclaimedFrom.host, os.hostname());
  assert.ok(held.reclaimedFrom.idleMs >= RECLAIM_STALE_AFTER_MS);
  held.release();
});

test('release never removes a lock that has since changed hands', (t) => {
  const file = path.join(workspace(t), 'g.lock');
  const held = acquireDurableLock(file);
  fs.rmSync(file);
  const other = acquireDurableLock(file);
  held.release();
  assert.ok(fs.existsSync(file), 'the current holder keeps its lock');
  other.release();
});

test('the durable learning store reclaims an interrupted lock and records the recovery durably', (t) => {
  const root = path.join(workspace(t), 'store');
  const projectId = 'github:owner/repo';
  const store = new DurableScientificLearningStore({ root, projectId });

  // A live or unverifiable holder still stops the store dead, exactly as before.
  fs.writeFileSync(store.lockFile, 'occupied', { flag: 'wx' });
  assert.throws(() => store.ingest(sampleCandidate(projectId)), /locked/);
  fs.rmSync(store.lockFile);

  // What a forcibly interrupted mutation leaves: a real lock owned by a process that is gone.
  acquireDurableLock(store.lockFile, { pid: reapedPid() });
  ageLockFile(store.lockFile, RECLAIM_STALE_AFTER_MS * 2);

  store.ingest(sampleCandidate(projectId));
  assert.ok(store.lastLockReclamation, 'the store reports the interrupted owner it recovered from');
  assert.equal(fs.existsSync(store.lockFile), false);

  const entry = store.read().auditLog.at(-1);
  assert.match(entry.action, /recovered from forced interruption: pid \d+ on .+, idle \d+ms/);
  assert.match(entry.action, /^candidate:/, 'the original transaction is still named, not replaced');
});

test('the extraction worker resumes after a forced interruption without losing or duplicating candidates', (t) => {
  const directory = workspace(t);
  const projectId = 'github:owner/repo';
  const learningRoot = path.join(directory, 'store');
  const queueFile = path.join(directory, 'queue.json');
  const durablePath = path.join(directory, 'source.txt');
  const body = 'The map method creates a new array populated with the results of calling a function on every element. It does not modify the array it is called on.';
  fs.writeFileSync(durablePath, body);
  const contentSha256 = crypto.createHash('sha256').update(body).digest('hex');
  fs.writeFileSync(queueFile, `${JSON.stringify({
    schemaVersion: 1,
    projectId,
    updatedAt: '2026-08-31T17:00:00.000Z',
    documents: [],
    links: [{ id: 'src-1', state: 'claim-extraction-in-progress', url: 'https://example.edu/a', finalUrl: 'https://example.edu/a', contentType: 'text/plain', contentSha256, durablePath, retrievedAt: '2026-08-31T17:00:00.000Z', claimExtraction: { attempts: 1, candidateIds: [], classification: 'Insufficient Evidence', sourceContentSha256: contentSha256, windows: [] } }],
  }, null, 2)}\n`);

  // Exactly what a SIGKILL mid-transaction leaves behind: the interrupted source still
  // in-progress, and the queue lock still on disk owned by a process that no longer exists.
  const lockFile = `${queueFile}.claim-extraction.lock`;
  acquireDurableLock(lockFile, { pid: reapedPid() });
  ageLockFile(lockFile, RECLAIM_STALE_AFTER_MS * 2);

  const build = () => new ClaimExtractionWorker({ queueFile, projectId, learningRoot });
  const worker = build();
  const outcomes = worker.run();
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].state, 'claim-extraction-complete');
  assert.ok(worker.lastLockReclamation, 'recovery from a forced interruption is reported, never silent');
  assert.equal(fs.existsSync(lockFile), false, 'the reclaimed lock is released');

  const source = JSON.parse(fs.readFileSync(queueFile, 'utf8')).links[0];
  assert.equal(source.state, 'claim-extraction-complete');
  assert.equal(source.claimExtraction.attempts, 2, 'the interrupted attempt is still counted');
  assert.ok(source.claimExtraction.candidateIds.length >= 1);

  const storeFile = path.join(learningRoot, `${crypto.createHash('sha256').update(projectId).digest('hex')}.learning.json`);
  const after = JSON.parse(fs.readFileSync(storeFile, 'utf8')).payload.candidateRecords;
  assert.equal(new Set(after.map((item) => item.candidate.id)).size, after.length, 'no duplicate candidates survive recovery');

  const repeat = build();
  assert.deepEqual(repeat.run(), [], 'a completed source is not re-extracted');
  assert.equal(repeat.lastLockReclamation, null, 'a clean run reports no reclamation');
  const unchanged = JSON.parse(fs.readFileSync(storeFile, 'utf8')).payload.candidateRecords;
  assert.equal(unchanged.length, after.length, 'recovery is idempotent');
});
