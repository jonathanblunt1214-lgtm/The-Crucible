const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runCommand } = require('./runner');
const { DurableScientificLearningStore, sha } = require('./scientificLearning');
const { LearningExperienceRecorder } = require('./learningExperience');

function digestFile(target) { return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'); }
function configuredExperienceRecorder(environment) {
  const projectId = environment.CRUCIBLE_LEARNING_PROJECT_ID;
  const learningRoot = environment.CRUCIBLE_LEARNING_ROOT;
  if (!projectId && !learningRoot) return null;
  if (!projectId || !learningRoot) throw new Error('Suite learning requires both CRUCIBLE_LEARNING_PROJECT_ID and CRUCIBLE_LEARNING_ROOT.');
  const store = new DurableScientificLearningStore({ root:learningRoot, projectId });
  if (!store.readiness().ready) throw new Error('Suite learning durable store is not ready.');
  return new LearningExperienceRecorder({ store, projectId });
}

async function recordExperience(recorder, claim, record, { outcome, actualOutcome, resultSha256, observedAt, actorId }) {
  if (!recorder || !claim.learning) return { eligible:Boolean(claim.learning), recorded:false, reason:claim.learning ? 'durable-learning-not-configured' : 'claim-not-eligible' };
  const boundedEnvironment = `${claim.learning.environment}; runtime=${process.platform}/${process.version}; commit=${record.commit}`;
  const experience = {
    schemaVersion:1,
    projectId:recorder.projectId,
    attemptId:`${record.commit}:${record.commandSha256}:${observedAt}`,
    boundedClaim:record.claim,
    claimBoundary:claim.learning.claimBoundary,
    generalizationBoundary:claim.learning.generalizationBoundary,
    action:`${claim.run} ${claim.args.join(' ')}`.trim(),
    environment:boundedEnvironment,
    expectedOutcome:claim.learning.expectedOutcome,
    actualOutcome,
    outcome,
    actionSha256:record.commandSha256,
    environmentSha256:sha(boundedEnvironment),
    resultSha256,
    artifactSha256:sha(record.evidence),
    actorId,
    observedAt,
  };
  let ingested;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { ingested = recorder.record([experience]); break; }
    catch (error) {
      if (!/store is locked/.test(error.message) || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return { eligible:true, recorded:ingested.length === 1, candidateId:`experience-${sha(experience)}` };
}

function learningGuidance(recorder, claim) {
  if (!claim.learning) return { eligible:false, activeKnowledge:[], nextAction:'run-configured-test-without-learning' };
  if (!recorder) return { eligible:true, activeKnowledge:[], nextAction:'run-bounded-test-learning-custody-unavailable' };
  const activeKnowledge=recorder.store.retrieve({boundary:claim.learning.claimBoundary}).map(({version,candidateId,claim:verifiedClaim,boundary,proofSha256,createdAt})=>({version,candidateId,claim:verifiedClaim,boundary,proofSha256,createdAt}));
  return { eligible:true, activeKnowledge, nextAction:activeKnowledge.length?'use-active-knowledge-as-bounded-regression-context':'run-bounded-test-and-submit-candidate-evidence', knowledgeIsProofForCurrentRun:false, maySkipTest:false };
}

async function verifyClaims(root, config, environment = process.env) {
  const records = [];
  const learning = [];
  const learningGuidanceRecords = [];
  const recorder = configuredExperienceRecorder(environment);
  const actorId = environment.CRUCIBLE_EXPERIENCE_ACTOR_ID || 'crucible-authenticity-gate';
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd:root, encoding:'utf8', windowsHide:true }).trim();
  for (const claim of config.authenticity.claims) {
    learningGuidanceRecords.push(learningGuidance(recorder,claim));
    const commandSha256 = crypto.createHash('sha256').update(JSON.stringify({ run:claim.run, args:claim.args, cwd:claim.cwd })).digest('hex');
    try {
      await runCommand(root, claim, config.workload.timeoutMinutes * 60_000, ' [claim evidence]');
    } catch (error) {
      const observedAt = new Date().toISOString();
      const record = { claim:claim.name, commandSha256, commit, verifiedAt:observedAt, evidence:[] };
      learning.push(await recordExperience(recorder, claim, record, { outcome:'failed', actualOutcome:'configured evidence command failed', resultSha256:sha(String(error?.message || 'command failed')), observedAt, actorId }));
      throw error;
    }
    const evidence = (claim.evidence || []).map((relative) => {
      const target = path.resolve(root, relative);
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`${claim.name} did not produce evidence file ${relative}.`);
      return { path:relative, sha256:digestFile(target) };
    });
    if (config.authenticity.requireArtifacts && !evidence.length) throw new Error(`${claim.name} must declare at least one evidence artifact.`);
    const record = { claim:claim.name, commandSha256, commit, verifiedAt:new Date().toISOString(), evidence };
    records.push(record);
    learning.push(await recordExperience(recorder, claim, record, { outcome:'succeeded', actualOutcome:'configured evidence command completed and declared artifacts were present', resultSha256:sha(record), observedAt:record.verifiedAt, actorId }));
    console.log(`[The Crucible] Evidence: ${JSON.stringify(record)}`);
  }
  return { claims:records.length, records, learning, learningGuidance:learningGuidanceRecords };
}

module.exports = { verifyClaims, digestFile, configuredExperienceRecorder, recordExperience, learningGuidance };
