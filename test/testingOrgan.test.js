'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRequestedTests, createTestingOrgan } = require('../src/testingOrgan');
const { GOVERNED_ORGANS, systemOf } = require('../src/circulationLinkage');

const AVAILABLE = ['test/alpha.test.js', 'test/beta.test.js', 'test/gamma.test.js'];
const envelope = { sourceOrgan: 'immune', targetOrgan: 'testing', boundary: 'b-1' };
// A runner that records what it was asked to execute instead of spawning it, so these tests
// observe the organ's decisions rather than the suite's results.
function recordingRunner(status = 0) {
  const calls = [];
  return { calls, run: (executable, args) => { calls.push({ executable, args }); return { status }; } };
}

test('the testing suite is a governed organ, so an organism cannot start without wiring it', () => {
  assert.ok(GOVERNED_ORGANS.includes('testing'), 'a signal to an unwired organ never arrives and nothing reports its absence');
  assert.equal(systemOf('testingOrgan'), 'nerves', 'it belongs with the suite it drives');
});

// The property that separates "use existing tests" from "write its own". An organ that could
// author the test that judges its own repair is self-certification, which is the thing this
// project's whole proof boundary exists to prevent. Naming a file that does not exist must be
// refused loudly, never treated as an empty run that trivially passes.
test('refuses to run a test that does not exist, by name', () => {
  assert.throws(
    () => selectRequestedTests({ tests: ['test/alpha.test.js', 'test/invented.test.js'] }, AVAILABLE),
    /do not exist: test\/invented\.test\.js.*never writes them/s,
  );
});

test('runs existing tests when every named file is already on disk', () => {
  const selection = selectRequestedTests({ tests: ['test/beta.test.js'] }, AVAILABLE);
  assert.deepEqual(selection.tests, ['test/beta.test.js']);
});

test('a request that names nothing to select on is refused rather than guessed at', () => {
  assert.throws(() => selectRequestedTests({}, AVAILABLE), /must name changed paths, a main category, or explicit existing tests/);
});

test('the organ reports what it observed and never claims proof or promotion', async () => {
  const { run, calls } = recordingRunner(0);
  const organ = createTestingOrgan({ run, available: AVAILABLE });
  const outcome = await organ({ payload: { request: { tests: ['test/alpha.test.js'] } }, envelope });

  assert.equal(outcome.result.passed, true);
  assert.deepEqual(outcome.result.tests, ['test/alpha.test.js']);
  assert.equal(outcome.result.requestedBy, 'immune', 'the record says who asked');
  assert.equal(outcome.result.classification, 'Insufficient Evidence');
  assert.equal(outcome.result.authoredAnyTest, false);
  assert.equal(outcome.proofStageSatisfied, false, 'a passing test is an observation, not a proof stage');
  assert.equal(outcome.promotionAuthorized, false);
  assert.ok(calls.some((call) => call.args.includes('test/alpha.test.js')), 'it really ran the requested test');
});

// A green run must not be able to launder itself into permission. This is the same assertion as
// above from the other side: the organ says so, and circulation refuses it independently.
test('a passing run is still not promotion authority', async () => {
  const organ = createTestingOrgan({ run: recordingRunner(0).run, available: AVAILABLE });
  const passed = await organ({ payload: { request: { tests: ['test/alpha.test.js'] } }, envelope });
  const failed = await createTestingOrgan({ run: recordingRunner(1).run, available: AVAILABLE })({ payload: { request: { tests: ['test/alpha.test.js'] } }, envelope });
  assert.equal(passed.result.passed, true);
  assert.equal(failed.result.passed, false, 'a failing run is reported as failing rather than swallowed');
  for (const outcome of [passed, failed]) {
    assert.equal(outcome.proofStageSatisfied, false);
    assert.equal(outcome.promotionAuthorized, false);
  }
});
