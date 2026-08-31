// The execution half of R9. `soakGate.js` decides whether starting a soak would mean
// anything; this runs one and reaches a verdict, or refuses to.
//
// Owner decisions on 2026-08-31 shape the failure handling, and they are deliberately
// per-data-point rather than global:
//   - A failure resets the clock for the failed data point only. One bad record does not
//     throw away the observation already accumulated on every other one.
//   - Three failures and the data point is discarded and its source returned to the
//     collection pool, to be gathered again rather than written off.
//   - Three further failures after that and the data point is trash: bad data, recorded
//     permanently as such, and excluded from the population the verdict waits on.
//   - Sweeps run hourly.
//   - A source returned to the collection pool is gathered after new data, never before
//     it. Something that already failed three times has earned the back of the queue, and
//     fresh material is the better use of the next collection slot.
//
// Two readings of that spec are mine and are flagged as such, because the owner's rule
// speaks about data points and these are not data-point failures:
//   - A store-level failure (a corrupt envelope, cross-project contamination) is not any
//     single record's fault, so it is not put through the three-strike cycle. It fails the
//     whole soak immediately, because the store the soak is observing is not sound.
//   - A gap between sweeps longer than the interval plus its tolerance means the soak was
//     not observed across that time. "Continuous" cannot be claimed over unobserved hours,
//     so every non-trash clock restarts.
const { validateSoakHours, SOAK_MIN_HOURS } = require('./soakGate');

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const SWEEP_GRACE_MS = 5 * 60 * 1000;
const FAILURES_BEFORE_RECOLLECTION = 3;
const FAILURES_BEFORE_TRASH = 3;

const HOUR_MS = 60 * 60 * 1000;
const iso = (value, name) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp.`);
  return value;
};

function startSoak({ readiness, at, hours = SOAK_MIN_HOURS }) {
  iso(at, 'soak.at');
  validateSoakHours(hours);
  if (!readiness || readiness.state !== 'ready') {
    throw new Error(`A soak may not start while the gate is held: ${(readiness && readiness.blockers || ['no readiness decision was supplied']).join('; ')}.`);
  }
  return {
    schemaVersion: 1,
    startedAt: at,
    hours,
    sweepIntervalMs: SWEEP_INTERVAL_MS,
    lastSweepAt: at,
    sweeps: 0,
    // The window is frozen at the start so the verdict is about a fixed population.
    dataPoints: readiness.observed.map((item) => ({ id: item.id, kind: item.kind, phase: 'observing', failures: 0, clockStartedAt: at, recycledAt: null, trashedAt: null })),
    recollectionPool: [],
    trash: [],
    storeFailures: [],
    observationGaps: [],
    failed: false,
  };
}

function applyDataPointFailure(point, at) {
  point.failures += 1;
  point.clockStartedAt = at; // The failed data point's clock, and only its clock, restarts.
  if (point.phase === 'observing' && point.failures >= FAILURES_BEFORE_RECOLLECTION) {
    point.phase = 'recollected';
    point.failures = 0;
    point.recycledAt = at;
    return 'recollected';
  }
  if (point.phase === 'recollected' && point.failures >= FAILURES_BEFORE_TRASH) {
    point.phase = 'trash';
    point.trashedAt = at;
    return 'trash';
  }
  return 'reset';
}

// One hourly sweep. `dataPointFailures` names the observed ids that failed an integrity
// check; `storeFailures` names failures of the store itself, which no single record owns.
function recordSweep(soak, { at, dataPointFailures = [], storeFailures = [] } = {}) {
  iso(at, 'sweep.at');
  const elapsed = Date.parse(at) - Date.parse(soak.lastSweepAt);
  if (elapsed < 0) throw new Error('A sweep may not be recorded before the previous one.');
  const next = structuredClone(soak);
  next.sweeps += 1;
  next.lastSweepAt = at;

  if (elapsed > SWEEP_INTERVAL_MS + SWEEP_GRACE_MS) {
    next.observationGaps.push({ at, gapMs: elapsed });
    for (const point of next.dataPoints) if (point.phase !== 'trash') point.clockStartedAt = at;
  }

  if (storeFailures.length) {
    next.storeFailures.push(...storeFailures.map((reason) => ({ at, reason })));
    next.failed = true; // Not a data-point fault, so not recycled: the soak itself is void.
  }

  for (const id of dataPointFailures) {
    const point = next.dataPoints.find((item) => item.id === id);
    if (!point || point.phase === 'trash') continue;
    const outcome = applyDataPointFailure(point, at);
    if (outcome === 'recollected') next.recollectionPool.push({ id: point.id, kind: point.kind, returnedAt: at, priority: 'recirculated' });
    if (outcome === 'trash') next.trash.push({ id: point.id, kind: point.kind, trashedAt: at });
  }
  return next;
}

// The order the collection pool is drained in: every new source first, then anything
// recirculated, oldest return first. Deterministic, so a collection round can be replayed.
// This is a priority, not an exclusion - a recirculated source is still collected, just
// after fresh material rather than competing with it.
function collectionOrder(newSources = [], recollectionPool = []) {
  const normalize = (item) => (typeof item === 'string' ? { id: item } : item || {});
  const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const fresh = newSources.map(normalize).map((item) => ({ id: String(item.id), kind: item.kind || 'queued-source', priority: 'new' })).sort(byId);
  const recirculated = recollectionPool.map(normalize)
    .map((item) => ({ id: String(item.id), kind: item.kind || 'queued-source', priority: 'recirculated', returnedAt: item.returnedAt || null }))
    .sort((a, b) => (a.returnedAt === b.returnedAt ? byId(a, b) : String(a.returnedAt) < String(b.returnedAt) ? -1 : 1));
  return [...fresh, ...recirculated];
}

function soakStatus(soak, { at } = {}) {
  iso(at, 'status.at');
  const now = Date.parse(at);
  const required = soak.hours * HOUR_MS;
  const live = soak.dataPoints.filter((point) => point.phase !== 'trash');
  const cleared = live.filter((point) => now - Date.parse(point.clockStartedAt) >= required);
  const outstanding = live.filter((point) => now - Date.parse(point.clockStartedAt) < required);
  const sweepOverdue = now - Date.parse(soak.lastSweepAt) > SWEEP_INTERVAL_MS + SWEEP_GRACE_MS;
  const reasons = [];
  if (soak.failed) reasons.push(`the store itself failed during the soak, which no data point owns and no recollection can repair: ${soak.storeFailures.map((item) => item.reason).join('; ')}`);
  if (!live.length) reasons.push('every observed data point ended as trash, so the soak has no surviving population to have proven anything about');
  if (sweepOverdue) reasons.push(`the last sweep was ${Math.round((now - Date.parse(soak.lastSweepAt)) / 60000)} minutes ago, beyond the hourly interval, so observation is not currently continuous`);
  if (outstanding.length) reasons.push(`${outstanding.length} of ${live.length} surviving data points have not yet held ${soak.hours} continuous clean hours`);
  return {
    schemaVersion: 1,
    state: reasons.length ? (soak.failed ? 'failed' : 'running') : 'passed',
    hours: soak.hours,
    sweeps: soak.sweeps,
    observed: soak.dataPoints.length,
    surviving: live.length,
    cleared: cleared.length,
    outstanding: outstanding.length,
    recollected: soak.recollectionPool.length,
    trash: soak.trash.length,
    observationGaps: soak.observationGaps.length,
    reasons,
  };
}

module.exports = { SWEEP_INTERVAL_MS, SWEEP_GRACE_MS, FAILURES_BEFORE_RECOLLECTION, FAILURES_BEFORE_TRASH, startSoak, recordSweep, collectionOrder, soakStatus };
