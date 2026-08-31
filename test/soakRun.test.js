const test = require('node:test');
const assert = require('node:assert/strict');
const { SWEEP_INTERVAL_MS, FAILURES_BEFORE_RECOLLECTION, FAILURES_BEFORE_TRASH, startSoak, recordSweep, collectionOrder, soakStatus } = require('../src/soakRun');
const { soakReadiness } = require('../src/soakGate');

const START = '2026-09-01T00:00:00.000Z';
const at = (msFromStart) => new Date(Date.parse(START) + msFromStart).toISOString();
const HOUR = 60 * 60 * 1000;

const usable = (candidateCount = 3) => ({
  payload: {
    knowledgeVersions: [{ version: 'v-1' }],
    candidateRecords: Array.from({ length: candidateCount }, (unused, index) => ({ candidate: { id: `c-${index}` } })),
    activeVersion: 'v-1',
  },
  queue: { documents: [], links: [] },
});
const ready = (candidateCount) => soakReadiness({ ...usable(candidateCount), gatesGreen: true, hours: 72 });
const begin = (candidateCount = 3) => startSoak({ readiness: ready(candidateCount), at: START, hours: 72 });

// Sweeps land on the hour; without failures they simply keep observation continuous.
function sweepThrough(soak, hours, failuresByHour = {}, fromHour = 1) {
  let current = soak;
  for (let hour = fromHour; hour <= hours; hour += 1) {
    current = recordSweep(current, { at: at(hour * HOUR), dataPointFailures: failuresByHour[hour] || [] });
  }
  return current;
}

test('refuses to start while the gate is held, naming why', () => {
  const held = soakReadiness({ payload: { knowledgeVersions: [], candidateRecords: [], activeVersion: null }, queue: {}, gatesGreen: false });
  assert.throws(() => startSoak({ readiness: held, at: START, hours: 72 }), /may not start while the gate is held/);
  assert.throws(() => startSoak({ readiness: undefined, at: START, hours: 72 }), /no readiness decision/);
});

test('freezes the observed population at the start and passes only after the full duration', () => {
  const soak = begin(3);
  assert.equal(soak.dataPoints.length, 4); // one knowledge version plus three candidates
  assert.equal(soakStatus(soak, { at: at(HOUR) }).state, 'running');
  const swept = sweepThrough(soak, 72);
  const early = soakStatus(swept, { at: at(71 * HOUR) });
  assert.equal(early.state, 'running');
  assert.match(early.reasons.join(' '), /have not yet held 72 continuous clean hours/);
  const done = soakStatus(swept, { at: at(72 * HOUR) });
  assert.equal(done.state, 'passed');
  assert.deepEqual(done.reasons, []);
  assert.equal(done.cleared, 4);
});

test('a failure resets the clock for the failed data point only, not the whole soak', () => {
  const soak = begin(3);
  const swept = sweepThrough(soak, 10, { 10: ['c-0'] });
  const failed = swept.dataPoints.find((point) => point.id === 'c-0');
  const untouched = swept.dataPoints.find((point) => point.id === 'c-1');
  assert.equal(failed.failures, 1);
  assert.equal(failed.clockStartedAt, at(10 * HOUR), 'the failed point restarts');
  assert.equal(untouched.clockStartedAt, START, 'every other point keeps the time it has accumulated');
});

test('three failures discard the data point and return its source to the collection pool', () => {
  const soak = begin(3);
  const swept = sweepThrough(soak, 5, { 1: ['c-0'], 2: ['c-0'], 3: ['c-0'] });
  const point = swept.dataPoints.find((item) => item.id === 'c-0');
  assert.equal(FAILURES_BEFORE_RECOLLECTION, 3);
  assert.equal(point.phase, 'recollected');
  assert.equal(point.failures, 0, 'the count restarts for the recollected round');
  assert.equal(point.recycledAt, at(3 * HOUR));
  assert.deepEqual(swept.recollectionPool.map((item) => item.id), ['c-0']);
  assert.equal(swept.trash.length, 0, 'recollection is a second chance, not a write-off');
});

test('three further failures after recollection mark the data point trash', () => {
  const soak = begin(3);
  const swept = sweepThrough(soak, 8, { 1: ['c-0'], 2: ['c-0'], 3: ['c-0'], 4: ['c-0'], 5: ['c-0'], 6: ['c-0'] });
  const point = swept.dataPoints.find((item) => item.id === 'c-0');
  assert.equal(FAILURES_BEFORE_TRASH, 3);
  assert.equal(point.phase, 'trash');
  assert.equal(point.trashedAt, at(6 * HOUR));
  assert.deepEqual(swept.trash.map((item) => item.id), ['c-0']);
  const status = soakStatus(swept, { at: at(8 * HOUR) });
  assert.equal(status.trash, 1);
  assert.equal(status.surviving, 3, 'trash leaves the population the verdict waits on');
});

test('a trashed data point stops accumulating failures and never blocks the verdict', () => {
  const soak = begin(3);
  let swept = sweepThrough(soak, 6, { 1: ['c-0'], 2: ['c-0'], 3: ['c-0'], 4: ['c-0'], 5: ['c-0'], 6: ['c-0'] });
  swept = recordSweep(swept, { at: at(7 * HOUR), dataPointFailures: ['c-0'] });
  const point = swept.dataPoints.find((item) => item.id === 'c-0');
  assert.equal(point.phase, 'trash');
  assert.equal(swept.trash.length, 1, 'it is not trashed twice');
  const passed = soakStatus(sweepThrough(swept, 79, {}, 8), { at: at(79 * HOUR) });
  assert.equal(passed.state, 'passed', 'the surviving population can still complete the soak');
});

test('a soak whose entire population became trash has proven nothing', () => {
  const soak = begin(1); // one knowledge version and one candidate: the whole population
  const both = ['v-1', 'c-0'];
  const swept = sweepThrough(soak, 6, { 1: both, 2: both, 3: both, 4: both, 5: both, 6: both });
  assert.equal(swept.trash.length, 2);
  const status = soakStatus(swept, { at: at(7 * HOUR) });
  assert.equal(status.surviving, 0);
  assert.notEqual(status.state, 'passed');
  assert.match(status.reasons.join(' '), /no surviving population/);
});

test('a store-level failure voids the soak instead of entering the three-strike cycle', () => {
  const soak = begin(3);
  const swept = recordSweep(soak, { at: at(HOUR), storeFailures: ['durable learning store integrity check failed'] });
  assert.equal(swept.failed, true);
  assert.deepEqual(swept.recollectionPool, [], 'the store is not a data point and is not recycled');
  const status = soakStatus(swept, { at: at(200 * HOUR) });
  assert.equal(status.state, 'failed');
  assert.match(status.reasons.join(' '), /the store itself failed/);
});

test('an unobserved gap between sweeps restarts every surviving clock, because continuous means observed', () => {
  const soak = begin(3);
  const swept = recordSweep(soak, { at: at(4 * HOUR) });
  assert.equal(swept.observationGaps.length, 1);
  for (const point of swept.dataPoints) assert.equal(point.clockStartedAt, at(4 * HOUR));
  assert.equal(SWEEP_INTERVAL_MS, HOUR);
});

test('an overdue sweep keeps the verdict at running even once the duration has elapsed', () => {
  const swept = sweepThrough(begin(3), 72);
  assert.equal(soakStatus(swept, { at: at(72 * HOUR) }).state, 'passed');
  const stale = soakStatus(swept, { at: at(80 * HOUR) });
  assert.equal(stale.state, 'running');
  assert.match(stale.reasons.join(' '), /beyond the hourly interval/);
});

test('sweeps may not be recorded out of order', () => {
  const soak = begin(3);
  const swept = recordSweep(soak, { at: at(HOUR) });
  assert.throws(() => recordSweep(swept, { at: START }), /may not be recorded before the previous one/);
});

test('recirculated sources are collected after new data, never ahead of it', () => {
  const soak = begin(3);
  const swept = sweepThrough(soak, 3, { 1: ['c-0'], 2: ['c-0'], 3: ['c-0'] });
  assert.deepEqual(swept.recollectionPool.map((item) => item.priority), ['recirculated']);

  const order = collectionOrder(['s-new-b', 's-new-a'], swept.recollectionPool);
  assert.deepEqual(order.map((item) => item.priority), ['new', 'new', 'recirculated']);
  assert.deepEqual(order.map((item) => item.id), ['s-new-a', 's-new-b', 'c-0']);
});

test('recirculated sources are still collected, just last, oldest return first', () => {
  const pool = [
    { id: 'r-late', returnedAt: '2026-09-02T00:00:00.000Z' },
    { id: 'r-early', returnedAt: '2026-09-01T00:00:00.000Z' },
  ];
  assert.deepEqual(collectionOrder([], pool).map((item) => item.id), ['r-early', 'r-late'], 'lower priority is an ordering, not an exclusion');
  assert.deepEqual(collectionOrder(['n-1'], pool).map((item) => item.id), ['n-1', 'r-early', 'r-late']);
  assert.deepEqual(collectionOrder([], []), []);
});
