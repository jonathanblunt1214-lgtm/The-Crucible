// Telling "the run failed" apart from "the run was never allowed to start".
//
// These two look identical in every place a person or a review actually looks: a red check, a
// `conclusion: failure`, a notification email. They are not remotely the same thing. One is
// evidence about this repository's code. The other is evidence about an account's billing, and
// carries no information about the code at all.
//
// That confusion is not hypothetical here. Between 2026-09-12T18:32:56Z and 2026-09-13T05:03Z
// every job in every *private* repository of this account began failing in two to four seconds
// while the public repository's jobs kept passing. No runner was ever assigned and nothing was
// ever billed, on Windows and on Ubuntu alike. Those runs carried no verdict on the code, yet
// the rolling review recorded the consequences as custody and gate regressions - which is how a
// billing lapse spent days being re-diagnosed as a learning-pipeline defect.
//
// The signature is mechanical, so it can be checked rather than recognised by eye:
//
//   - no runner was ever assigned (`runner_id` 0 / empty `runner_name`), and
//   - no step ever executed, and
//   - nothing was billed (`billable.<PLATFORM>.total_ms` is 0).
//
// The first two are what actually discriminate. The third is deliberately kept, and deliberately
// listed last, because it is *not* probative on this account: the successful runs report
// `total_ms: 0` as well (runs 34711532796 and 34705000605, which each really ran for around two
// minutes on a real Windows runner). An earlier reading of this evidence leaned on "nothing was
// billed" as though it proved refusal; it does not, and the comment says so rather than leaving
// the next reader to rediscover it.
//
// Requiring all three anyway only ever makes this more conservative, which is the safe direction:
// a non-discriminating condition can withhold a refusal verdict but can never manufacture one.
// The cost is one known gap - a refused job with no billing record at all yields a null rather
// than a zero and reads as `indeterminate` instead of refused. That fails closed, so it stays.
//
// This module reports. It decides no gate, writes nothing, and calls nothing over the network.
const { crucibleError } = require('./failureCodes');

// A refused job is rejected by the control plane, not by a runner, so it ends almost instantly.
// This is a corroborating bound, never the deciding one: a slow refusal is still a refusal, and
// a fast genuine failure is still a failure. It exists so the report can say how consistent the
// evidence was rather than implying a threshold decided it.
const REFUSAL_DURATION_CEILING_MS = 15_000;

const VERDICTS = Object.freeze({
  refused: 'actions-refused-at-startup',
  executed: 'executed',
  indeterminate: 'indeterminate',
});

const OWNER_REMEDY = 'Only the repository owner can clear this: check GitHub billing for a reached spending limit, exhausted included minutes, or a failed payment method. No repository change can start these jobs, and no gate may be recorded as regressed on the strength of a run that never executed.';

function millisecondsBetween(startedAt, completedAt) {
  const started = Date.parse(startedAt || '');
  const completed = Date.parse(completedAt || '');
  if (Number.isNaN(started) || Number.isNaN(completed)) return null;
  return completed - started;
}

// `billable` is keyed by platform (UBUNTU, WINDOWS, MACOS), each with total_ms and a job_runs
// list. A job absent from every platform has no billing record at all, which is not the same as
// a recorded zero: it is missing evidence, and it reads as unknown rather than as free.
function billedMillisecondsFor(jobId, usage) {
  const billable = usage && typeof usage === 'object' ? usage.billable : null;
  if (!billable || typeof billable !== 'object') return null;
  let found = null;
  for (const platform of Object.values(billable)) {
    const runs = Array.isArray(platform?.job_runs) ? platform.job_runs : [];
    for (const run of runs) {
      if (String(run?.job_id) === String(jobId)) found = (found || 0) + Number(run.duration_ms || 0);
    }
  }
  return found;
}

function diagnoseJob(job, usage) {
  if (!job || typeof job !== 'object') {
    throw crucibleError('CRU-0046', 'Startup diagnosis requires the job objects as GitHub returned them; a missing job cannot be diagnosed, and guessing one would invent evidence.');
  }
  const steps = Array.isArray(job.steps) ? job.steps : null;
  const executedSteps = steps ? steps.filter((step) => step?.conclusion && step.conclusion !== 'skipped').length : null;
  const runnerAssigned = Boolean(job.runner_name) || Number(job.runner_id || 0) > 0;
  const billedMs = billedMillisecondsFor(job.id, usage);
  const durationMs = millisecondsBetween(job.started_at, job.completed_at);
  const failed = job.conclusion === 'failure' || job.conclusion === 'cancelled';

  const reasons = [];
  if (!runnerAssigned) reasons.push('no runner was assigned');
  if (billedMs === 0) reasons.push('nothing was billed');
  if (executedSteps === 0) reasons.push('no step executed');

  // All three, or it is not a refusal. Stated positively so a future reader can see that the
  // conjunction is the point rather than an accident of how the ifs fell out.
  const refused = failed && !runnerAssigned && billedMs === 0 && executedSteps === 0;
  if (refused) {
    return {
      jobId: job.id ?? null,
      name: job.name || null,
      labels: Array.isArray(job.labels) ? [...job.labels] : [],
      verdict: VERDICTS.refused,
      reasons,
      billedMilliseconds: billedMs,
      durationMilliseconds: durationMs,
      withinRefusalDurationCeiling: durationMs === null ? null : durationMs <= REFUSAL_DURATION_CEILING_MS,
      carriesNoVerdictOnTheCode: true,
      remedy: OWNER_REMEDY,
    };
  }

  // Everything that is not a proven refusal is either a real execution or missing evidence, and
  // the two are never merged: an unproven refusal must not borrow a refusal's excuse.
  const executed = runnerAssigned || (billedMs !== null && billedMs > 0) || (executedSteps !== null && executedSteps > 0);
  const missing = [];
  if (!steps) missing.push('the job carried no steps array, so step execution is unknown');
  if (billedMs === null) missing.push('no billing record names this job, so billed time is unknown');
  return {
    jobId: job.id ?? null,
    name: job.name || null,
    labels: Array.isArray(job.labels) ? [...job.labels] : [],
    verdict: executed ? VERDICTS.executed : VERDICTS.indeterminate,
    reasons: executed ? [] : missing,
    billedMilliseconds: billedMs,
    durationMilliseconds: durationMs,
    withinRefusalDurationCeiling: durationMs === null ? null : durationMs <= REFUSAL_DURATION_CEILING_MS,
    carriesNoVerdictOnTheCode: false,
    ...(executed ? {} : { remedy: 'Supply the job steps and the run usage record before drawing any conclusion; an undiagnosed run is not an excused run.' }),
  };
}

// A whole run. `allJobsRefused` is the field a reviewer should act on, because one refused job in
// an otherwise executing run is a capacity hiccup, while every job refused is the account-level
// block this module exists to name.
function diagnoseRun({ jobs, usage = null } = {}) {
  if (!Array.isArray(jobs)) {
    throw crucibleError('CRU-0046', 'Startup diagnosis requires an array of the run\'s jobs; without them a run cannot be told apart from a refused one.');
  }
  if (!jobs.length) {
    return { schemaVersion: 1, verdict: VERDICTS.indeterminate, jobs: [], allJobsRefused: false, anyJobRefused: false, detail: 'the run reported no jobs, so nothing can be diagnosed', authorizesGateChange: false };
  }
  const diagnosed = jobs.map((job) => diagnoseJob(job, usage));
  const refused = diagnosed.filter((item) => item.verdict === VERDICTS.refused);
  const allJobsRefused = refused.length === diagnosed.length;
  const verdict = allJobsRefused ? VERDICTS.refused : (diagnosed.some((item) => item.verdict === VERDICTS.indeterminate) ? VERDICTS.indeterminate : VERDICTS.executed);
  return {
    schemaVersion: 1,
    verdict,
    jobs: diagnosed,
    allJobsRefused,
    anyJobRefused: refused.length > 0,
    detail: allJobsRefused
      ? `all ${diagnosed.length} job(s) were refused before startup: ${refused[0].reasons.join(', ')}. ${OWNER_REMEDY}`
      : refused.length
        ? `${refused.length} of ${diagnosed.length} job(s) were refused before startup; the rest executed, so this is not an account-wide block`
        : `${diagnosed.length} job(s) executed, so their result is evidence about the code`,
    // Reporting only. A refusal never marks a gate passed, and never marks one regressed either.
    authorizesGateChange: false,
  };
}

module.exports = { diagnoseRun, diagnoseJob, VERDICTS, REFUSAL_DURATION_CEILING_MS, OWNER_REMEDY };
