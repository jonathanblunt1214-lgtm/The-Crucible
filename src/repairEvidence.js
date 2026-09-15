// The immune system reporting back to the learner.
//
// A defect found, repaired, and confirmed by a distinct verifier is a real observation about a
// language: this construct, in this boundary, behaved this way, and this change altered it. The
// owner's organism diagram carries an arrow for it. The pathway was missing a joint, not a
// design: `codeSecurityOrganism.repair()` already emits a non-promotable feedback candidate,
// but in an ad-hoc shape that no durable store accepts, so it went nowhere; and
// `learningExperience` already accepts a strict experience and turns it into real candidate
// evidence. This is the joint between them.
//
// What it deliberately does NOT do is turn a working repair into knowledge. A repair that held
// once is a single observation under one set of conditions - exactly the "one-off repair" the
// learning policy names as unable to promote. It enters custody as candidate evidence carrying
// `Insufficient Evidence`, and it must still pass the whole controlled pipeline like anything
// else: corroboration by an independent source, a declared scope, a controlled experiment, and
// a verifier with a distinct identity. A rolled-back repair is recorded too, as a failure -
// evidence that the change did not hold is worth as much as evidence that it did.
const crypto = require('node:crypto');
const { LearningExperienceRecorder } = require('./learningExperience');

const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

// Which repair outcomes are worth recording, and what each one observed. A repair that never
// ran - inhibited, blocked on a missing verifier - observed nothing and is not evidence.
const RECORDABLE = Object.freeze({
  verified: { outcome: 'succeeded', observed: 'the repair applied cleanly and an independent verifier confirmed it within the same boundary' },
  'rolled-back': { outcome: 'failed', observed: 'the repair applied but did not hold under independent verification, and the prior content was restored' },
});

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().replace(/\s+/g, ' ');
}

// The claim a repair supports, stated as an assertion about the construct rather than about the
// repair. "Repair 4c1f fixed a bug" is a claim about this project's history and is untestable
// anywhere else; what is testable is what the construct does.
function boundedClaimFor({ finding, plan, state }) {
  const construct = requireText(finding.kind, 'finding.kind');
  const language = requireText(finding.language, 'finding.language');
  const boundary = requireText(finding.boundary, 'finding.boundary');
  return state === 'verified'
    ? `In ${language}, the ${construct} construct within ${boundary} is altered by replacing ${sha256(plan.before).slice(0, 12)} with ${sha256(plan.after).slice(0, 12)}, and an independent verifier confirms the altered behaviour.`
    : `In ${language}, replacing ${sha256(plan.before).slice(0, 12)} with ${sha256(plan.after).slice(0, 12)} in the ${construct} construct within ${boundary} does not survive independent verification.`;
}

// A completed repair as a strict experience the learning store will accept. Every hash is over
// real material - the finding, the plan, the applied result - so a fabricated repair cannot
// produce a valid record.
function repairExperience({ projectId, finding, plan, result, actorId = 'code-security-organism', observedAt = new Date().toISOString() }) {
  if (!finding || !plan || !result) throw new Error('A finding, its plan, and the repair result are all required.');
  const recordable = RECORDABLE[result.state];
  if (!recordable) return null;

  const applied = result.applied || {};
  const resultSha256 = /^[a-f0-9]{64}$/.test(String(applied.resultSha256 || '')) ? applied.resultSha256 : sha256(result);

  return {
    schemaVersion: 1,
    projectId: requireText(projectId, 'projectId'),
    attemptId: `repair-${sha256({ finding, plan, state: result.state }).slice(0, 32)}`,
    boundedClaim: boundedClaimFor({ finding, plan, state: result.state }),
    claimBoundary: requireText(finding.boundary, 'finding.boundary'),
    // A repair observed one construct in one file. Saying so is the whole point: the boundary
    // is what stops a single fix reading as a general truth about the language.
    generalizationBoundary: `Observed once in ${requireText(finding.file, 'finding.file')}; not generalized to other files, versions, or runtimes.`,
    action: `bounded reversible repair of ${requireText(finding.kind, 'finding.kind')} with rollback available`,
    environment: `${requireText(finding.language, 'finding.language')} within ${requireText(finding.boundary, 'finding.boundary')}`,
    expectedOutcome: 'an independent verifier confirms the repaired construct within the same boundary',
    actualOutcome: recordable.observed,
    outcome: recordable.outcome,
    actionSha256: sha256(plan),
    environmentSha256: sha256({ language: finding.language, boundary: finding.boundary, file: finding.file, baseSha256: finding.baseSha256 }),
    resultSha256,
    artifactSha256: sha256({ dependencies: plan.dependencies || [], reversibleChange: plan.reversibleChange || null }),
    actorId: requireText(actorId, 'actorId'),
    observedAt,
  };
}

// Records a completed repair as candidate evidence. Returns what was recorded, or why nothing
// was - a repair that was inhibited or blocked observed nothing, and silence about that would
// be indistinguishable from a repair that succeeded.
function recordRepairEvidence({ store, projectId, finding, plan, result, actorId, observedAt, now = () => new Date().toISOString() }) {
  const experience = repairExperience({ projectId, finding, plan, result, actorId, observedAt: observedAt || now() });
  if (!experience) {
    return { recorded: false, reason: `a repair in state ${result && result.state} observed nothing, so it is not evidence`, candidateId: null, promotionAuthorized: false };
  }
  const recorder = new LearningExperienceRecorder({ store, projectId });
  const [record] = recorder.record([experience]);
  // The attempt id is content-addressed over the finding, the plan and the outcome, so the same
  // repair recorded twice is the same observation. The store accepts it once and returns
  // nothing the second time; that is not a failure, and it must not read as one.
  if (!record) {
    const existing = store.read().candidateRecords.find((item) => item.candidate.provenance.sourceId === experience.attemptId);
    return {
      recorded: false,
      alreadyInCustody: true,
      reason: 'this exact repair is already in candidate custody; the same observation is not evidence twice',
      candidateId: existing ? existing.candidate.id : null,
      outcome: experience.outcome,
      boundedClaim: experience.boundedClaim,
      classification: 'Insufficient Evidence',
      proofStageSatisfied: false,
      independentVerificationSatisfied: false,
      promotionAuthorized: false,
    };
  }
  return {
    recorded: true,
    alreadyInCustody: false,
    reason: null,
    candidateId: record.candidate.id,
    outcome: experience.outcome,
    boundedClaim: experience.boundedClaim,
    // Evidence, never knowledge. A repair that held once still has to pass everything else.
    classification: record.candidate.classification,
    proofStageSatisfied: false,
    independentVerificationSatisfied: false,
    promotionAuthorized: false,
  };
}

// A learningRecorder the code-security organism can be constructed with directly, so the
// pathway is wired at the point the repair happens rather than reconstructed afterwards.
function repairLearningRecorder({ store, projectId, now = () => new Date().toISOString() }) {
  return async (candidate) => {
    if (!candidate || candidate.promotable !== false) throw new Error('Only non-promotable repair feedback may be recorded as evidence.');
    // The actuator hands the outcome record and the evidence separately, so the organism carries
    // the finding and the plan on the candidate rather than on the record - which holds only
    // state, identity and an evidence hash. Reading them from the record alone meant every real
    // repair, verified or rolled back, reported that it had nothing to observe.
    const { record } = candidate;
    const finding = candidate.finding || (record && record.finding);
    const plan = candidate.plan || (record && record.plan);
    if (!record || !finding || !plan) return { recorded: false, reason: 'the feedback carried no finding and plan to observe', promotionAuthorized: false };
    return recordRepairEvidence({ store, projectId, finding, plan, result: record, now });
  };
}

module.exports = { RECORDABLE, boundedClaimFor, repairExperience, recordRepairEvidence, repairLearningRecorder };
