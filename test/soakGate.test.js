const test = require('node:test');
const assert = require('node:assert/strict');
const { SOAK_OBSERVATION_CEILING, SOAK_MIN_HOURS, SOAK_MAX_HOURS, population, unobservableFailures, observationWindow, validateSoakHours, soakReadiness } = require('../src/soakGate');

const candidates = (count, prefix = 'c') => Array.from({ length: count }, (unused, index) => ({ candidate: { id: `${prefix}-${String(index).padStart(5, '0')}` } }));
const sources = (count) => Array.from({ length: count }, (unused, index) => ({ id: `s-${String(index).padStart(5, '0')}` }));
const versions = (count) => Array.from({ length: count }, (unused, index) => ({ version: `v-${String(index).padStart(5, '0')}` }));
// A store that can actually exhibit every failure R9 names.
const usable = () => ({ payload: { knowledgeVersions: versions(2), candidateRecords: candidates(10), activeVersion: 'v-00000' }, queue: { documents: [], links: sources(5) } });

test('holds the soak when the current data would return no result', () => {
  const empty = soakReadiness({ payload: { knowledgeVersions: [], candidateRecords: [], activeVersion: null }, queue: {}, gatesGreen: true });
  assert.equal(empty.state, 'held');
  assert.equal(empty.soakPassed, false, 'an empty population never reads as a pass');
  assert.equal(empty.dataPoints, 0);
  assert.match(empty.blockers.join(' '), /zero verified knowledge versions/);
  assert.match(empty.blockers.join(' '), /no active version is set/);
  assert.match(empty.blockers.join(' '), /no candidate records or queued sources/);
});

test('holds the soak while R2-R8 are not simultaneously green, whatever the data looks like', () => {
  const result = soakReadiness({ ...usable(), gatesGreen: false });
  assert.equal(result.state, 'held');
  assert.match(result.blockers[0], /R2-R8 are not simultaneously green/);
});

test('names each R9 failure the current data cannot exhibit, one at a time', () => {
  const base = usable();
  const noVersions = unobservableFailures({ ...base.payload, knowledgeVersions: [] }, base.queue);
  assert.equal(noVersions.length, 1);
  assert.match(noVersions[0], /unauthorized and supersession transitions are unobservable/);

  const noActive = unobservableFailures({ ...base.payload, activeVersion: null }, base.queue);
  assert.equal(noActive.length, 1);
  assert.match(noActive[0], /verified-only retrieval is unobservable/);

  assert.deepEqual(unobservableFailures(base.payload, base.queue), [], 'a usable population blocks nothing');
});

test('starts only when the population can exhibit the failures the gate is looking for', () => {
  const result = soakReadiness({ ...usable(), gatesGreen: true });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.dataPoints, 17);
  assert.deepEqual(result.population, { knowledgeVersions: 2, candidateRecords: 10, queuedSources: 5 });
  assert.equal(result.soakPassed, false, 'readiness is never itself a pass');
});

test('observes at most the owner-set ceiling of 1000 data points at once', () => {
  const payload = { knowledgeVersions: versions(3), candidateRecords: candidates(1500), activeVersion: 'v-00000' };
  const queue = { documents: [], links: sources(200) };
  const result = soakReadiness({ payload, queue, gatesGreen: true });
  assert.equal(SOAK_OBSERVATION_CEILING, 1000);
  assert.equal(result.dataPoints, 1703);
  assert.equal(result.observedDataPoints, 1000);
  assert.equal(result.heldDataPoints, 703);
});

test('holding is a wait, never a discard: observed plus held is always the whole population', () => {
  for (const [candidateCount, sourceCount, versionCount] of [[0, 0, 0], [5, 5, 1], [1500, 200, 3], [2400, 0, 0]]) {
    const payload = { knowledgeVersions: versions(versionCount), candidateRecords: candidates(candidateCount), activeVersion: versionCount ? 'v-00000' : null };
    const queue = { documents: [], links: sources(sourceCount) };
    const { observed, held } = observationWindow(payload, queue);
    const total = population(payload, queue).total;
    assert.equal(observed.length + held.length, total, `nothing is dropped at ${total} data points`);
    assert.ok(observed.length <= SOAK_OBSERVATION_CEILING);
  }
});

test('fills the window deterministically, transition-bearing records first, so it can be replayed', () => {
  const payload = { knowledgeVersions: versions(2), candidateRecords: candidates(3), activeVersion: 'v-00000' };
  const queue = { documents: [], links: sources(2) };
  const first = observationWindow(payload, queue);
  const again = observationWindow(payload, queue);
  assert.deepEqual(first.observed, again.observed, 'the same population yields the same window');
  assert.deepEqual(first.observed.slice(0, 2).map((item) => item.kind), ['knowledge-version', 'knowledge-version']);
  assert.deepEqual(first.observed.map((item) => item.kind), ['knowledge-version', 'knowledge-version', 'candidate', 'candidate', 'candidate', 'queued-source', 'queued-source']);
});

test('rejects a duration outside the owner-set 72-96 hour band, and a ceiling above 1000', () => {
  assert.equal(SOAK_MIN_HOURS, 72);
  assert.equal(SOAK_MAX_HOURS, 96);
  assert.equal(validateSoakHours(72), 72);
  assert.equal(validateSoakHours(96), 96);
  for (const rejected of [71.9, 0, -1, 97, Number.NaN, Infinity]) assert.throws(() => validateSoakHours(rejected), /72-96 hour band/);
  for (const rejected of [0, -1, 2.5, SOAK_OBSERVATION_CEILING + 1]) {
    assert.throws(() => soakReadiness({ ...usable(), gatesGreen: true, ceiling: rejected }), /ceiling/);
  }
});
