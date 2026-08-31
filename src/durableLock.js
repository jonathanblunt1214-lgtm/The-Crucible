const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

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
//   - the lock is older than a bounded staleness floor, which is what keeps a
//     recycled PID from being mistaken for the original dead owner.
// Anything unreadable, foreign, live, or too recent is left exactly where it is.
const RECLAIM_STALE_AFTER_MS = 60 * 1000;

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
  const owner = readOwner(lockFile);
  if (!owner) return { reclaimable: false, owner: null, reason: 'the lock file is missing, unreadable, or was not written by this lock; it is never removed on a guess' };
  if (owner.host !== hostname) return { reclaimable: false, owner, reason: `the lock is held by host ${owner.host}, and this host cannot prove a process on another machine has exited` };
  if (isAlive(owner.pid)) return { reclaimable: false, owner, reason: `process ${owner.pid} on this host is still running, so this is genuine concurrency, not an interruption` };
  let ageMs;
  try { ageMs = now() - fs.statSync(lockFile).mtimeMs; } catch { return { reclaimable: false, owner, reason: 'the lock file vanished while it was being inspected' }; }
  if (ageMs < staleAfterMs) return { reclaimable: false, owner, reason: `the lock is only ${Math.max(0, Math.round(ageMs))}ms old, below the ${staleAfterMs}ms floor that rules out a recycled process id` };
  return { reclaimable: true, owner, reason: `process ${owner.pid} on this host is gone and the lock has been idle for ${Math.round(ageMs)}ms`, ageMs };
}

function writeLock(lockFile, owner) {
  const descriptor = fs.openSync(lockFile, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, 'utf8'); }
  finally { fs.closeSync(descriptor); }
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
  } = options;
  const file = path.resolve(lockFile);
  const owner = { schemaVersion: 1, pid, host: hostname, token: crypto.randomUUID(), createdAt: new Date(now()).toISOString() };

  let reclaimedFrom = null;
  try { writeLock(file, owner); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const inspection = inspectLock(file, { hostname, isAlive, staleAfterMs, now });
    if (!inspection.reclaimable) throw new Error(`${description} is held and cannot be reclaimed: ${inspection.reason}.`);
    // Remove only the exact record just inspected, then re-acquire exclusively. A
    // competitor that wins this narrow window makes our create fail closed below.
    const current = readOwner(file);
    if (!current || current.token !== inspection.owner.token) throw new Error(`${description} changed hands while it was being reclaimed; failing closed rather than racing for it.`);
    fs.rmSync(file, { force: true });
    try { writeLock(file, owner); }
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

module.exports = { acquireDurableLock, inspectLock, RECLAIM_STALE_AFTER_MS };
