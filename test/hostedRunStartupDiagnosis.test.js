const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnoseRun, diagnoseJob, VERDICTS } = require('../src/hostedRunStartupDiagnosis');

// The fixtures below are the real API payloads from the 2026-09-13 block, kept as data rather
// than paraphrased, so the assertions are about what GitHub actually returned.
const refusedWindowsJob = {
  id: 104176006120,
  name: 'extract',
  conclusion: 'failure',
  labels: ['windows-latest'],
  runner_id: 0,
  runner_name: '',
  started_at: '2026-09-14T22:24:00Z',
  completed_at: '2026-09-14T22:24:02Z',
  steps: [],
};
const refusedWindowsUsage = { billable: { WINDOWS: { total_ms: 0, jobs: 1, job_runs: [{ job_id: 104176006120, duration_ms: 0 }] } } };

const refusedUbuntuJob = {
  id: 103778565818,
  name: 'check',
  conclusion: 'failure',
  labels: ['ubuntu-latest'],
  runner_id: 0,
  runner_name: '',
  started_at: '2026-09-13T19:25:19Z',
  completed_at: '2026-09-13T19:25:22Z',
  steps: [],
};
const refusedUbuntuUsage = { billable: { UBUNTU: { total_ms: 0, jobs: 1, job_runs: [{ job_id: 103778565818, duration_ms: 0 }] } } };

// The hosted learning proof at exact tip 40c9836: it really ran, on a real runner, and really
// failed on the restored queue hash mismatch. Its failure IS evidence about the code.
const executedJob = {
  id: 103680665463,
  name: 'Prove R4-R8 on encrypted durable state',
  conclusion: 'failure',
  labels: ['ubuntu-latest'],
  runner_id: 12,
  runner_name: 'GitHub Actions 42',
  started_at: '2026-09-13T05:44:26Z',
  completed_at: '2026-09-13T05:44:48Z',
  steps: [
    { name: 'Set up job', conclusion: 'success' },
    { name: 'Decrypt vetted custody and verify every restored hash', conclusion: 'failure' },
  ],
};
const executedUsage = { billable: { UBUNTU: { total_ms: 22000, jobs: 1, job_runs: [{ job_id: 103680665463, duration_ms: 22000 }] } } };

test('a job refused before startup is named as such and carries no verdict on the code', () => {
  const report = diagnoseRun({ jobs: [refusedWindowsJob], usage: refusedWindowsUsage });
  assert.equal(report.verdict, VERDICTS.refused);
  assert.equal(report.allJobsRefused, true);
  assert.equal(report.jobs[0].carriesNoVerdictOnTheCode, true);
  assert.deepEqual(report.jobs[0].reasons, ['no runner was assigned', 'nothing was billed', 'no step executed']);
  // The remedy has to name the owner action, because nothing in the repository can fix it.
  assert.match(report.detail, /billing/i);
  assert.match(report.jobs[0].remedy, /spending limit|included minutes|payment method/);
});

test('the refusal is not a Windows artefact: an ubuntu job in a private repository reads identically', () => {
  const windows = diagnoseRun({ jobs: [refusedWindowsJob], usage: refusedWindowsUsage });
  const ubuntu = diagnoseRun({ jobs: [refusedUbuntuJob], usage: refusedUbuntuUsage });
  assert.equal(ubuntu.verdict, VERDICTS.refused);
  // Same verdict and same reasons across platforms is exactly what rules out a runner-label
  // explanation and leaves the account-level one.
  assert.deepEqual(ubuntu.jobs[0].reasons, windows.jobs[0].reasons);
  assert.equal(ubuntu.jobs[0].labels[0], 'ubuntu-latest');
  assert.equal(windows.jobs[0].labels[0], 'windows-latest');
});

test('a run that really executed and really failed is never excused as infrastructure', () => {
  const report = diagnoseRun({ jobs: [executedJob], usage: executedUsage });
  assert.equal(report.verdict, VERDICTS.executed);
  assert.equal(report.allJobsRefused, false);
  assert.equal(report.anyJobRefused, false);
  assert.equal(report.jobs[0].carriesNoVerdictOnTheCode, false);
  assert.match(report.detail, /evidence about the code/);
});

test('a zero billing record does not make a real run look refused', () => {
  // This is the case that disproves "nothing was billed" as evidence of refusal: run
  // 34711532796 ran for 124 seconds on a real Windows runner and still reports total_ms 0.
  const realSuccess = {
    id: 103601063061,
    name: 'extract',
    conclusion: 'success',
    labels: ['windows-latest'],
    runner_id: 4,
    runner_name: 'GitHub Actions 4',
    started_at: '2026-09-12T18:32:58Z',
    completed_at: '2026-09-12T18:35:02Z',
    steps: [{ name: 'Run deterministic encrypted hosted extraction', conclusion: 'success' }],
  };
  const report = diagnoseRun({
    jobs: [realSuccess],
    usage: { billable: { WINDOWS: { total_ms: 0, jobs: 1, job_runs: [{ job_id: 103601063061, duration_ms: 0 }] } } },
  });
  assert.equal(report.verdict, VERDICTS.executed);
  assert.equal(report.anyJobRefused, false);
  assert.equal(report.jobs[0].billedMilliseconds, 0);
  // Same zero, opposite verdict: the runner and the step are what decide.
  assert.equal(report.jobs[0].carriesNoVerdictOnTheCode, false);
});

test('each of the three signals alone is not enough to call a refusal', () => {
  // Billed zero but a runner was assigned: a cancellation in the first second, not a refusal.
  const cancelledOnRunner = diagnoseJob(
    { ...refusedUbuntuJob, runner_id: 7, runner_name: 'runner-7' },
    refusedUbuntuUsage,
  );
  assert.equal(cancelledOnRunner.verdict, VERDICTS.executed);

  // No runner and nothing billed, but a step did run: the evidence contradicts itself, so it is
  // not a refusal either.
  const stepRan = diagnoseJob(
    { ...refusedUbuntuJob, steps: [{ name: 'Set up job', conclusion: 'success' }] },
    refusedUbuntuUsage,
  );
  assert.equal(stepRan.verdict, VERDICTS.executed);

  // A successful job is never a refusal however sparse its record.
  const succeeded = diagnoseJob({ ...refusedUbuntuJob, conclusion: 'success' }, refusedUbuntuUsage);
  assert.notEqual(succeeded.verdict, VERDICTS.refused);
});

test('missing evidence reads as indeterminate rather than borrowing a refusal excuse', () => {
  // No steps array and no billing record: the shape of a refusal is absent, not proven.
  const report = diagnoseRun({ jobs: [{ id: 1, name: 'extract', conclusion: 'failure', runner_id: 0, runner_name: '' }] });
  assert.equal(report.verdict, VERDICTS.indeterminate);
  assert.equal(report.allJobsRefused, false);
  assert.match(report.jobs[0].reasons.join(' '), /steps array|billing record/);
  assert.match(report.jobs[0].remedy, /undiagnosed run is not an excused run/);
});

test('one refused job among executing jobs is not reported as an account-wide block', () => {
  const report = diagnoseRun({
    jobs: [refusedUbuntuJob, executedJob],
    usage: { billable: { UBUNTU: { total_ms: 22000, jobs: 2, job_runs: [{ job_id: 103778565818, duration_ms: 0 }, { job_id: 103680665463, duration_ms: 22000 }] } } },
  });
  assert.equal(report.anyJobRefused, true);
  assert.equal(report.allJobsRefused, false);
  assert.notEqual(report.verdict, VERDICTS.refused);
  assert.match(report.detail, /not an account-wide block/);
});

test('the diagnosis authorizes no gate change in any direction', () => {
  for (const fixture of [
    { jobs: [refusedWindowsJob], usage: refusedWindowsUsage },
    { jobs: [executedJob], usage: executedUsage },
    { jobs: [] },
  ]) {
    assert.equal(diagnoseRun(fixture).authorizesGateChange, false);
  }
});

test('malformed input fails closed with a diagnosable code instead of guessing', () => {
  assert.throws(() => diagnoseRun({}), /CRU-0046/);
  assert.throws(() => diagnoseRun({ jobs: 'extract' }), /CRU-0046/);
  assert.throws(() => diagnoseJob(null, null), /CRU-0046/);
});
