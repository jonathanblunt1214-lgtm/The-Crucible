const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { crucibleError } = require('./failureCodes');

// A create-exclusive lock that records who holds it, so a lock left behind by a
// forcibly interrupted process can be reclaimed - and only then.
//
// Before this existed, both durable locks in this repository were bare
// `openSync(file, 'wx')` calls. That is correct against concurrency and wrong
// against interruption: a SIGKILL leaves the lock file on disk forever, and the
// next run dies with a raw EEXIST that only a human deleting the file can clear.
// A forced-interruption recovery proof therefore could not pass.
//
// Reclamation never relaxes the concurrency guarantee. A lock is taken from its
// recorded owner only when every one of these holds, and fails closed otherwise:
//   - the lock file parses as an owner record this module wrote;
//   - the owner recorded the same host, because no host may judge whether a
//     process on another machine is still alive;
//   - the owner process is genuinely gone; and
//   - the lock is older than a bounded staleness floor, so a takeover rests on the
//     owner having been absent for a sustained period rather than on a single
//     liveness check sampled at one instant.
// Anything unreadable, foreign, live, or too recent is left exactly where it is.
//
// Be precise about what that floor does and does not cover, so it is neither trusted
// for protection it cannot give nor removed for the wrong reason. A recycled process
// id makes a dead owner look ALIVE, so the lock is simply left held - inconvenient,
// never unsafe - and the floor is irrelevant to that case. The dangerous direction is
// a liveness check that wrongly reports an owner GONE, which a process this one cannot
// see (a different pid namespace reporting the same hostname) can produce. The floor
// does not eliminate that either; it refuses to act on a momentary or racing negative,
// which is what makes a wrongful takeover unlikely in practice. The cost is bounded:
// nothing here retries that fast on its own - CI re-runs take minutes to reach the step
// and the scheduled learning tasks tick hourly - so only a hand-run restart immediately
// after a crash ever waits, and it is told exactly why.
//
// The owner set both of these on 2026-08-31: 30 seconds is the floor, and 60 seconds is
// the ceiling no agent may raise it past without the owner saying so in that request.
// A floor of zero is never permitted, because that is precisely the single-instant
// liveness check this exists to refuse.
const RECLAIM_STALE_AFTER_MS = 30 * 1000;
const MAX_RECLAIM_STALE_AFTER_MS = 60 * 1000;
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

function validStaleAfterMs(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('staleAfterMs must be a positive whole number of milliseconds; a zero floor would hand a lock over on a single liveness check.');
  if (value > MAX_RECLAIM_STALE_AFTER_MS) throw new Error(`staleAfterMs must not exceed the owner-set ceiling of ${MAX_RECLAIM_STALE_AFTER_MS}ms.`);
  return value;
}

function defaultIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; } // Owned by another user: alive as far as we can prove.
}

function readOwner(lockFile) {
  let raw;
  try { raw = fs.readFileSync(lockFile, 'utf8'); } catch { return null; }
  let owner;
  try { owner = JSON.parse(raw); } catch { return null; }
  if (!owner || owner.schemaVersion !== 1 || typeof owner.host !== 'string' || typeof owner.token !== 'string') return null;
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
  return owner;
}

// Explains, in the caller's terms, why a held lock may or may not be taken over.
function inspectLock(lockFile, { hostname = os.hostname(), isAlive = defaultIsAlive, staleAfterMs = RECLAIM_STALE_AFTER_MS, now = Date.now } = {}) {
  validStaleAfterMs(staleAfterMs);
  const owner = readOwner(lockFile);
  if (!owner) return { reclaimable: false, owner: null, reason: 'the lock file is missing, unreadable, or was not written by this lock; it is never removed on a guess' };
  if (owner.host !== hostname) return { reclaimable: false, owner, reason: `the lock is held by host ${owner.host}, and this host cannot prove a process on another machine has exited` };
  if (isAlive(owner.pid)) return { reclaimable: false, owner, reason: `process ${owner.pid} on this host is still running, so this is genuine concurrency, not an interruption` };
  let ageMs;
  try { ageMs = now() - fs.statSync(lockFile).mtimeMs; } catch { return { reclaimable: false, owner, reason: 'the lock file vanished while it was being inspected' }; }
  if (ageMs < staleAfterMs) return { reclaimable: false, owner, reason: `the lock is only ${Math.max(0, Math.round(ageMs))}ms old, below the ${staleAfterMs}ms floor required before a liveness check alone may hand it over` };
  return { reclaimable: true, owner, reason: `process ${owner.pid} on this host is gone and the lock has been idle for ${Math.round(ageMs)}ms`, ageMs };
}

function publishCompleteFile(file, content, { publish = fs.linkSync, mode = 0o600 } = {}) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.pending`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    // A hard link installs the already-complete inode at the canonical name and
    // fails if that name exists. The canonical path is therefore never visible
    // as the zero-byte interval produced by open('wx') followed by write().
    publish(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force:true });
  }
}

function writeLock(lockFile, owner, options = {}) {
  publishCompleteFile(lockFile, `${JSON.stringify(owner)}\n`, { publish:options.publishLock || fs.linkSync });
}

function fileFingerprint(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw crucibleError('CRU-0039', 'Legacy lock recovery accepts only a regular non-symbolic file.');
  return { size:stat.size, mtimeMs:stat.mtimeMs, dev:stat.dev, ino:stat.ino, sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}

function recoverLegacyZeroByteLock(lockFile, {
  projectId,
  ownerAuthorized = false,
  confirmedNoActiveWorker = false,
  expectedSha256,
  expectedMtimeMs,
  minimumAgeMs = MAX_RECLAIM_STALE_AFTER_MS,
  now = Date.now,
} = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw crucibleError('CRU-0039', 'Legacy lock recovery requires the repository-bound projectId.');
  if (ownerAuthorized !== true) throw crucibleError('CRU-0039', 'Legacy lock recovery requires explicit owner authorization.');
  if (confirmedNoActiveWorker !== true) throw crucibleError('CRU-0039', 'Legacy lock recovery requires confirmation that no extraction worker is active.');
  if (expectedSha256 !== EMPTY_SHA256) throw crucibleError('CRU-0039', `Legacy lock recovery requires the exact empty-file SHA-256 ${EMPTY_SHA256}.`);
  if (!Number.isFinite(expectedMtimeMs)) throw crucibleError('CRU-0039', 'Legacy lock recovery requires the observed lock mtime in milliseconds.');
  if (!Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < MAX_RECLAIM_STALE_AFTER_MS) throw crucibleError('CRU-0039', `Legacy lock recovery minimumAgeMs must be at least ${MAX_RECLAIM_STALE_AFTER_MS}ms.`);
  const file = path.resolve(lockFile);
  if (readOwner(file)) throw crucibleError('CRU-0039', 'This is a valid owner-recorded lock; use normal durable-lock reclamation instead.');
  const observed = fileFingerprint(file);
  if (observed.size !== 0 || observed.sha256 !== expectedSha256) throw crucibleError('CRU-0039', 'Legacy lock recovery is limited to the exact zero-byte lock fingerprint.');
  if (Math.abs(observed.mtimeMs - expectedMtimeMs) > 1) throw crucibleError('CRU-0039', 'Legacy lock changed since its owner-authorized fingerprint was recorded.');
  const ageMs = now() - observed.mtimeMs;
  if (!Number.isFinite(ageMs) || ageMs < minimumAgeMs) throw crucibleError('CRU-0039', `Legacy lock is below the ${minimumAgeMs}ms recovery age floor.`);

  const timestamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  const quarantineFile = `${file}.legacy-zero-byte.${timestamp}.${observed.sha256.slice(0, 12)}.quarantine`;
  const auditFile = `${quarantineFile}.json`;
  fs.linkSync(file, quarantineFile);
  try {
    const current = fileFingerprint(file); const quarantined = fileFingerprint(quarantineFile);
    if (current.dev !== observed.dev || current.ino !== observed.ino || quarantined.dev !== observed.dev || quarantined.ino !== observed.ino || current.sha256 !== observed.sha256) {
      throw crucibleError('CRU-0039', 'Legacy lock changed while quarantine was being prepared; the canonical lock was preserved.');
    }
    fs.rmSync(file);
    const record = { schemaVersion:1, action:'owner-authorized-legacy-zero-byte-lock-quarantine', projectId, lockFile:file, quarantineFile, observed:{ size:observed.size, sha256:observed.sha256, mtimeMs:observed.mtimeMs }, recoveredAt:new Date(now()).toISOString(), ageMs:Math.round(ageMs), ownerAuthorized:true, confirmedNoActiveWorker:true };
    try { publishCompleteFile(auditFile, `${JSON.stringify(record, null, 2)}\n`); }
    catch (error) {
      try { if (!fs.existsSync(file)) fs.linkSync(quarantineFile, file); } catch {}
      throw crucibleError('CRU-0039', `Legacy lock quarantine audit could not be persisted; the original lock was restored when possible. ${error.message}`);
    }
    return { ...record, auditFile };
  } catch (error) {
    if (fs.existsSync(file)) fs.rmSync(quarantineFile, { force:true });
    throw error;
  }
}

// Acquires lockFile, reclaiming it only from a provably dead owner on this host.
// Returns { release, reclaimedFrom }: reclaimedFrom is null on a clean acquire and
// otherwise names the interrupted owner, so recovery is reported, never silent.
function acquireDurableLock(lockFile, options = {}) {
  const {
    hostname = os.hostname(),
    pid = process.pid,
    isAlive = defaultIsAlive,
    staleAfterMs = RECLAIM_STALE_AFTER_MS,
    now = Date.now,
    description = 'durable lock',
    publishLock = fs.linkSync,
  } = options;
  validStaleAfterMs(staleAfterMs);
  const file = path.resolve(lockFile);
  const owner = { schemaVersion: 1, pid, host: hostname, token: crypto.randomUUID(), createdAt: new Date(now()).toISOString() };

  let reclaimedFrom = null;
  try { writeLock(file, owner, { publishLock }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const inspection = inspectLock(file, { hostname, isAlive, staleAfterMs, now });
    if (!inspection.reclaimable) throw new Error(`${description} is held and cannot be reclaimed: ${inspection.reason}.`);
    // Remove only the exact record just inspected, then re-acquire exclusively. A
    // competitor that wins this narrow window makes our create fail closed below.
    const current = readOwner(file);
    if (!current || current.token !== inspection.owner.token) throw new Error(`${description} changed hands while it was being reclaimed; failing closed rather than racing for it.`);
    fs.rmSync(file, { force: true });
    try { writeLock(file, owner, { publishLock }); }
    catch (raceError) {
      if (raceError.code === 'EEXIST') throw new Error(`${description} was taken by another process during reclamation; failing closed.`);
      throw raceError;
    }
    reclaimedFrom = { pid: inspection.owner.pid, host: inspection.owner.host, createdAt: inspection.owner.createdAt || null, idleMs: Math.round(inspection.ageMs) };
  }

  // Confirm we actually hold what we wrote before any caller mutates state behind it.
  const held = readOwner(file);
  if (!held || held.token !== owner.token) {
    throw new Error(`${description} was overwritten immediately after acquisition; failing closed without mutating anything.`);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const final = readOwner(file); // Never delete a lock that is no longer ours.
    if (final && final.token !== owner.token) return;
    fs.rmSync(file, { force: true });
  };
  return { release, reclaimedFrom, owner };
}

module.exports = { acquireDurableLock, inspectLock, recoverLegacyZeroByteLock, EMPTY_SHA256, RECLAIM_STALE_AFTER_MS, MAX_RECLAIM_STALE_AFTER_MS };
