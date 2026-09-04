// Crucible's half of oversight's graduated response.
//
// A watchdog that only knows how to stop is one that gets switched off, so oversight gives the
// immune system a bounded chance to fix an ordinary fault before pulling the brake. This is the
// side of that bargain that runs inside Crucible: it decides whether a finding is the kind that
// may be repaired first, bounds the attempt, and hands oversight what it needs to judge the
// result independently.
//
// Four things Crucible may never do, and each is a rule here rather than an intention:
//   - hide the original finding: it is recorded before any repair is offered, and the record is
//     what oversight reads, so a successful repair cannot erase the fact that it was needed;
//   - verify its own repair: a repair without an independent verification is a failed repair,
//     not a pending one, because "we fixed it and checked ourselves" is not evidence;
//   - repeat its way out of trouble: a fault that returns after a repair escalates rather than
//     buying another window, since a repair that does not hold is a different problem;
//   - delay an emergency stop: a critical finding gets no repair window at all, and nothing in
//     this module can grant one.
//
// Oversight's half - the independent detection, the verification, the email, the STOP itself -
// lives outside this repository by design, and nothing here can substitute for it. What this
// produces is a request and an evidence package, never a decision.
const crypto = require('node:crypto');

// Conditions where waiting is itself the harm. A repair window is a bet that the organism is
// safe for the length of the attempt, and these are the cases where that bet cannot be made.
const IMMEDIATE = Object.freeze({
  'boundary-breach': 'a deny-by-default boundary was crossed, so the organism is already outside the limits that make it safe to run',
  'unauthorized-promotion': 'something was promoted without passing the gates, so the knowledge store can no longer be trusted to reflect proof',
  'evidence-tampering': 'stored evidence or its provenance was altered, so no later verification means anything',
  'oversight-evasion': 'the organism acted to avoid, delay, or alter independent oversight',
  'cross-project-leak': 'evidence crossed a project boundary, which cannot be undone by repairing the cause',
});

const MAX_ATTEMPTS_PER_FINDING = 1;
const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().replace(/\s+/g, ' ');
}

// The finding, recorded before anything is attempted. Content-addressed so the same fault
// recurring is recognisably the same fault, and so a record cannot be quietly rewritten.
function recordFinding({ kind, organ, boundary, detail, observedAt = new Date().toISOString() }) {
  const finding = {
    schemaVersion: 1,
    kind: requireText(kind, 'kind'),
    organ: requireText(organ, 'organ'),
    boundary: requireText(boundary, 'boundary'),
    detail: requireText(detail, 'detail'),
    observedAt,
    immediate: Object.prototype.hasOwnProperty.call(IMMEDIATE, kind),
  };
  return Object.freeze({ ...finding, findingId: `finding-${sha256({ kind: finding.kind, organ: finding.organ, boundary: finding.boundary }).slice(0, 32)}` });
}

// Whether this finding may have a bounded repair attempt before a stop is requested, and if not,
// exactly why. History is the record of what has already been tried for this same finding.
function assessFinding({ finding, history = [], health = null, maxAttempts = MAX_ATTEMPTS_PER_FINDING }) {
  if (!finding || !finding.findingId) throw new Error('A recorded finding is required; a finding is recorded before any repair is offered.');
  const prior = history.filter((item) => item.findingId === finding.findingId);
  const attempts = prior.filter((item) => item.attempted).length;
  const unverified = prior.filter((item) => item.attempted && item.independentlyVerified !== true);

  const deny = (reason, escalate) => ({
    findingId: finding.findingId,
    repairAllowed: false,
    attemptsUsed: attempts,
    escalate,
    reason,
    requestedOfOversight: escalate ? 'STOP' : 'record-and-report',
    // Crucible requests; oversight decides. Nothing here stops or clears anything.
    decidesStop: false,
    promotionAuthorized: false,
  });

  if (finding.immediate) return deny(`${finding.kind}: ${IMMEDIATE[finding.kind]}; waiting for a repair is itself the harm, so no repair window is offered`, true);
  if (unverified.length) return deny('a previous repair for this finding was never independently verified, and an unverified repair is a failed repair rather than a pending one', true);
  if (attempts >= maxAttempts) return deny(`this finding has already had ${attempts} bounded repair attempt(s) and returned; a repair that does not hold is a different problem from the one it was meant to fix`, true);
  if (health && health.state === 'inhibited') return deny('the organism is already inhibited, so there is nothing to repair before a stop that has already happened', false);

  return {
    findingId: finding.findingId,
    repairAllowed: true,
    attemptsUsed: attempts,
    attemptsRemaining: maxAttempts - attempts,
    escalate: false,
    reason: 'an ordinary fault with no prior attempt: the immune system may attempt one bounded, reversible repair before a stop is requested',
    requestedOfOversight: 'permit-bounded-repair',
    // The bounds the attempt must respect, stated up front so exceeding them is detectable.
    bounds: { organ: finding.organ, boundary: finding.boundary, reversible: true, mustBeIndependentlyVerified: true, attempts: 1 },
    decidesStop: false,
    promotionAuthorized: false,
  };
}

// What oversight is handed after an attempt. Crucible reports what it did and what happened; it
// does not report whether compliance was restored, because that is oversight's to establish.
function repairOutcome({ finding, attempted, result = null, independentVerification = null, observedAt = new Date().toISOString() }) {
  if (!finding || !finding.findingId) throw new Error('A recorded finding is required.');
  const escapedScope = Boolean(result && ((result.organ && result.organ !== finding.organ) || (result.boundary && result.boundary !== finding.boundary)));
  const verified = independentVerification && independentVerification.verifierId && independentVerification.verifierId !== 'crucible-self'
    ? independentVerification.passed === true
    : null;
  return Object.freeze({
    schemaVersion: 1,
    findingId: finding.findingId,
    finding,
    attempted: Boolean(attempted),
    observedAt,
    resultSha256: result ? sha256(result) : null,
    escapedScope,
    // null means nobody independent has looked yet. It is never true on Crucible's own say-so.
    independentlyVerified: verified,
    verifiedBy: verified === null ? null : independentVerification.verifierId,
    // The escalation Crucible is obliged to request when its own attempt did not settle matters.
    requestedOfOversight: !attempted ? 'record-and-report' : escapedScope || verified !== true ? 'STOP' : 'independent-verification-of-recovery',
    complianceRestored: 'oversight-decides',
    decidesStop: false,
    promotionAuthorized: false,
  });
}

// The live health signal, shaped for circulation. Oversight monitoring repository and
// configuration state is inspection; this is the organism reporting its own condition on the
// bus, which is what makes the monitoring continuous rather than periodic.
function healthSignal({ projectId, health, boundary = 'organism', sourceOrgan = 'nervous-system' }) {
  if (!health || !health.state) throw new Error('A continuous health view is required.');
  const payload = {
    state: health.state,
    oversight: health.oversight,
    organs: health.organs,
    exactMissingDependencies: health.exactMissingDependencies || [],
    observedAt: health.observedAt,
  };
  return {
    id: `health-${sha256(payload).slice(0, 24)}`,
    type: 'health',
    sourceOrgan,
    targetOrgan: 'reporting',
    boundary,
    projectId,
    payload,
    payloadSha256: sha256(payload),
    // A health report is an observation, never evidence about the world and never a decision.
    isEvidence: false,
    decidesStop: false,
    promotionAuthorized: false,
  };
}

module.exports = { IMMEDIATE, MAX_ATTEMPTS_PER_FINDING, recordFinding, assessFinding, repairOutcome, healthSignal };
