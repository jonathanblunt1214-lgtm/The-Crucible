const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  REQUIRED_GATES, makeCandidate, newRecord, transition, CandidateEvidenceStore,
  VerifiedKnowledgeStore, DurableScientificLearningStore, AutonomousScientificLearner,
  detectContradiction, verifyOidcIdentity,
  encryptWeeklyEnvelope, decryptWeeklyEnvelope, sha,
} = require('../src/scientificLearning');
const { run:runLearningCli } = require('../src/scientificLearningCli');
const { LearningExperienceRecorder, experienceCandidate } = require('../src/learningExperience');
const { routeThreeWayComparison, ClaimComparisonLedger } = require('../src/claimComparison');
const { ControlledClaimEvaluationWorker } = require('../src/claimEvaluationWorker');
const { CriticalClaimReviewer } = require('../src/criticalClaimReview');
const { LogicalReasoningProblemSolver, ReasoningLedger } = require('../src/reasoningProblemSolving');
const { CreativeDecisionAdaptationEngine, CognitiveStrategyLedger } = require('../src/creativeDecisionAdaptation');
const { LearningOrchestratorLedger, CrucibleLearningOrchestrator } = require('../src/learningOrchestrator');

const at = '2026-08-29T18:20:00.000Z';
function candidate(overrides = {}) {
  return makeCandidate({ id:'c-1', projectId:'project-a', claim:'repair X causes test Y to pass', claimBoundary:'node-22/windows/test-y', generalizationBoundary:'no wider than node-22/windows/test-y', kind:'controlled-experiment', provenance:{ sourceType:'conversation-research', sourceId:'6a92d5f9', retrievedAt:at, author:'owner-and-assistant', license:'private-candidate-evidence', contentSha256:sha('candidate source') }, createdAt:at, ...overrides });
}
function proof(overrides = {}) {
  return { schemaVersion:1, candidateId:'c-1', projectId:'project-a', hypothesis:'repair X is falsifiably responsible for test Y', testedProperty:'repair X causes test Y to pass', experimentBoundary:'node-22/windows/test-y', controls:['no-repair control fails', 'irrelevant repair control fails'], causalIsolation:{ method:'single-variable intervention and reversal', result:'only repair X changes Y', correlationOnly:false }, negativeTests:['X does not change Z'], regressionTests:['existing suite remains green'], scopeProof:'diff and artifact proof limited to test-y', generalizationResult:'not generalized beyond experiment boundary', contradictionResult:'none', independentVerification:{ verifierId:'independent-runner-2', independent:true, testedProperty:'repair X causes test Y to pass', experimentBoundary:'node-22/windows/test-y', result:'passed', verifiedAt:at }, completedAt:at, ...overrides };
}
function experimentalProof(overrides = {}) { const value = proof(overrides); delete value.independentVerification; return value; }
function verification(overrides = {}) { return { ...proof().independentVerification, ...overrides }; }
function gates(value = true) { return Object.fromEntries(REQUIRED_GATES.map((gate) => [gate, value])); }
function verifiedRecord(input = candidate()) {
  const recordProof = proof({
    candidateId:input.id,
    testedProperty:input.claim,
    experimentBoundary:input.claimBoundary,
    independentVerification:{ ...proof().independentVerification, testedProperty:input.claim, experimentBoundary:input.claimBoundary },
  });
  let record = newRecord(input);
  record = transition(record, 'hypothesis', { at, reason:'falsifiable hypothesis declared', hypothesis:recordProof.hypothesis, gates:gates(false) });
  const experiment = { ...recordProof }; delete experiment.independentVerification;
  record = transition(record, 'experimented', { at, reason:'controlled experiment completed', experimentalProof:experiment, gates:{ ...gates(false), falsifiableHypothesis:true, controlledReproduction:true, controlTesting:true, negativeTesting:true, regressionTesting:true, deterministicScopeProof:true, claimBoundaryCheck:true, generalizationCheck:true, contradictionAnalysis:true } });
  record = transition(record, 'causally-proven', { at, reason:'causal isolation passed', gates:{ ...record.gates, causalIsolation:true } });
  record = transition(record, 'independently-verified', { at, reason:'independent verifier passed', independentVerification:recordProof.independentVerification, gates:gates(true) });
  return transition(record, 'verified', { at, reason:'all mandatory gates passed' });
}

test('candidate ingestion is strict, project-isolated, and never pre-approved', () => {
  const store = new CandidateEvidenceStore('project-a');
  const record = store.ingest(candidate());
  assert.equal(record.state, 'candidate'); assert.equal(record.candidate.classification, 'Insufficient Evidence');
  assert.throws(() => store.ingest(candidate({ id:'c-2', projectId:'project-b' })), /Cross-project/);
  assert.throws(() => makeCandidate({ ...candidate(), confidence:0.99 }), /unknown field.*confidence/);
});

test('state machine fails closed against skipping, missing gates, and proof-stage self-satisfaction', () => {
  const record = newRecord(candidate());
  assert.throws(() => transition(record, 'verified', { at, reason:'weighted confidence says yes', gates:gates(true), proof:proof() }), /Forbidden/);
  const hypothesis = transition(record, 'hypothesis', { at, reason:'candidate produced hypothesis input', hypothesis:proof().hypothesis });
  assert.equal(hypothesis.gates.falsifiableHypothesis, false, 'producing a later stage input cannot satisfy that proof stage');
  assert.throws(() => transition(hypothesis, 'causally-proven', { at, reason:'skip experiment' }), /Forbidden/);
});

test('raw telemetry, correlations, retrieval, repetition, guesses, and one-off repairs never promote', () => {
  for (const kind of ['raw-telemetry','correlation','retrieval','repeated-observation','model-guess','incomplete-observation','untested-hypothesis','one-off-repair']) {
    let record = newRecord(candidate({ kind }));
    record = transition(record, 'hypothesis', { at, reason:'investigate only', hypothesis:proof().hypothesis });
    record = transition(record, 'experimented', { at, reason:'input collected', experimentalProof:experimentalProof(), gates:gates(true) });
    record = transition(record, 'causally-proven', { at, reason:'synthetic path' });
    record = transition(record, 'independently-verified', { at, reason:'synthetic verification', independentVerification:verification() });
    assert.throws(() => transition(record, 'verified', { at, reason:'attempt shortcut' }), /never be directly promoted/);
  }
  assert.throws(() => transition(transition(newRecord(candidate()), 'hypothesis', {at,reason:'x',hypothesis:proof().hypothesis}), 'experimented', {at,reason:'x',experimentalProof:experimentalProof({ causalIsolation:{ method:'frequency', result:'many', correlationOnly:true } })}), /Correlation never/);
});

test('verification proves only its tested property and inherits experiment boundaries', () => {
  let record = transition(newRecord(candidate()), 'hypothesis', {at,reason:'x',hypothesis:proof().hypothesis});
  record = transition(record, 'experimented', {at,reason:'x',experimentalProof:experimentalProof()});
  record = transition(record, 'causally-proven', {at,reason:'x'});
  assert.throws(() => transition(record, 'independently-verified', {at,reason:'x',independentVerification:verification({ testedProperty:'broader claim' })}), /only the tested property/);
  assert.throws(() => transition(record, 'independently-verified', {at,reason:'x',independentVerification:verification({ experimentBoundary:'all-platforms' })}), /inherit experiment boundaries/);
});

test('verified knowledge is versioned, rollbackable, and contradictions quarantine instead of overwrite', () => {
  const store = new VerifiedKnowledgeStore('project-a');
  const first = store.commit(verifiedRecord(), at); assert.equal(first.version, 1);
  const conflictRecord = verifiedRecord(candidate({ id:'c-2', claim:'repair X does not cause test Y to pass' }));
  const contradiction = detectContradiction(conflictRecord, store.versions); assert.deepEqual(contradiction, { detected:true, classification:'Crucible Issue', conflictingVersion:1 });
  const quarantined = transition(conflictRecord, 'quarantined', { at, reason:'contradiction detected' }); assert.equal(quarantined.state, 'quarantined');
  const second = store.commit(verifiedRecord(candidate({ id:'c-3' })), at); assert.equal(second.previousVersion, 1);
  assert.equal(store.rollback(1, at, 'regression discovered').status, 'active');
});

test('unrelated verified claims keep independent active version lineages', () => {
  const store = new VerifiedKnowledgeStore('project-a');
  const first = store.commit(verifiedRecord(), at);
  const unrelatedCandidate = candidate({ id:'c-4', claim:'repair Q causes test R to pass', claimBoundary:'node-22/windows/test-r', generalizationBoundary:'no wider than node-22/windows/test-r' });
  const second = store.commit(verifiedRecord(unrelatedCandidate), at);
  assert.equal(first.previousVersion, null); assert.equal(second.previousVersion, null);
  assert.deepEqual(store.versions.filter((item) => item.status === 'active').map((item) => item.version), [1, 2]);
  store.rollback(1, at, 'reselect first lineage');
  assert.equal(store.versions.find((item) => item.version === 2).status, 'active');
});

test('durable autonomous learning survives restart and retrieves only active verified knowledge', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-learning-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new DurableScientificLearningStore({ root, projectId:'project-a' });
  store.ingest(candidate());
  const experimentExecutor = { id:'experiment-runner-1', run:async ({ candidate:input, hypothesis }) => experimentalProof({ candidateId:input.id, projectId:input.projectId, hypothesis, testedProperty:input.claim, experimentBoundary:input.claimBoundary }) };
  const independentVerifier = { id:'independent-runner-2', run:async ({ candidate:input, experimentalProof:experiment }) => verification({ testedProperty:input.claim, experimentBoundary:experiment.experimentBoundary }) };
  const learner = new AutonomousScientificLearner({ store, experimentExecutor, independentVerifier, now:() => at });
  assert.deepEqual(store.retrieve(), [], 'candidate evidence is never retrievable as knowledge');
  assert.equal((await learner.process('c-1', proof().hypothesis)).state, 'verified');
  const reopened = new DurableScientificLearningStore({ root, projectId:'project-a' });
  assert.equal(reopened.readiness().ready, true); assert.equal(reopened.get('c-1').state, 'verified');
  assert.equal(reopened.retrieve({ boundary:'node-22/windows/test-y' }).length, 1);
  assert.equal(reopened.retrieve({ boundary:'all-platforms' }).length, 0);
});

test('durable store fails closed on corruption, lock contention, and cross-project evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-learning-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new DurableScientificLearningStore({ root, projectId:'project-a' });
  assert.throws(() => store.ingest(candidate({ projectId:'project-b' })), /Cross-project/);
  fs.writeFileSync(store.lockFile, 'occupied', { flag:'wx' });
  assert.throws(() => store.ingest(candidate()), /locked/); fs.rmSync(store.lockFile);
  const envelope = JSON.parse(fs.readFileSync(store.file, 'utf8')); envelope.payload.revision = 99;
  fs.writeFileSync(store.file, JSON.stringify(envelope));
  assert.equal(store.readiness().ready, false); assert.throws(() => store.read(), /integrity check failed/);
});

test('autonomous learning requires distinct executors and resumes only the persisted hypothesis', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-learning-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new DurableScientificLearningStore({ root, projectId:'project-a' }); store.ingest(candidate());
  const executor = { id:'same-runner', run:async () => experimentalProof() };
  assert.throws(() => new AutonomousScientificLearner({ store, experimentExecutor:executor, independentVerifier:executor }), /distinct executor/);
  let record = transition(store.get('c-1'), 'hypothesis', { at, reason:'persist before restart', hypothesis:proof().hypothesis });
  store.update(record, at, 'hypothesis');
  const learner = new AutonomousScientificLearner({ store, experimentExecutor:{ id:'experiment-runner-1', run:async () => experimentalProof() }, independentVerifier:{ id:'independent-runner-2', run:async () => verification() }, now:() => at });
  await assert.rejects(() => learner.process('c-1', 'a different hypothesis'), /persisted hypothesis/);
});

test('operator readiness and ingestion require explicit durable project configuration', (t) => {
  assert.throws(() => runLearningCli(['readiness'], {}), /PROJECT_ID is required/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-learning-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const file = path.join(root, 'candidate.json'); fs.writeFileSync(file, JSON.stringify(candidate()));
  const environment = { CRUCIBLE_LEARNING_PROJECT_ID:'project-a', CRUCIBLE_LEARNING_ROOT:path.join(root, 'store') };
  assert.equal(runLearningCli(['readiness'], environment).readyForTrainingEvidence, true);
  assert.deepEqual(runLearningCli(['ingest', file], environment), { accepted:true, candidateId:'c-1', state:'candidate', classification:'Insufficient Evidence' });
  assert.deepEqual(runLearningCli(['retrieve'], environment), { verifiedKnowledge:[] });
});

test('durable candidate batches commit atomically and deduplicate restart-safe ids', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-learning-batch-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new DurableScientificLearningStore({ projectId:'project-a', root }); const first = candidate(); const second = { ...candidate(), id:'c-2', claim:'A second bounded claim' };
  assert.equal(store.ingestMany([first, second]).length, 2); assert.equal(store.ingestMany([first, second]).length, 0); assert.equal(store.read().candidateRecords.length, 2);
  assert.throws(() => store.ingestMany([first, first]), /duplicate ids/); assert.throws(() => store.ingestMany([{ ...second, id:'c-3', projectId:'project-b' }]), /Cross-project/);
});

test('learning by doing records success and failure as candidate evidence without promotion', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-experience-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new DurableScientificLearningStore({ projectId:'project-a', root });
  const recorder = new LearningExperienceRecorder({ store, projectId:'project-a' });
  const base = { schemaVersion:1, projectId:'project-a', attemptId:'attempt-1', boundedClaim:'action X produces bounded result Y', claimBoundary:'node-22/windows/task-y', generalizationBoundary:'no wider than node-22/windows/task-y', action:'execute action X', environment:'node 22 on Windows', expectedOutcome:'result Y', actualOutcome:'result Y', outcome:'succeeded', actionSha256:sha('action'), environmentSha256:sha('environment'), resultSha256:sha('result'), artifactSha256:sha('artifact'), actorId:'task-runner-1', observedAt:at };
  const failure = { ...base, attemptId:'attempt-2', actualOutcome:'result Y was absent', outcome:'failed', resultSha256:sha('failed result') };
  assert.equal(recorder.record([base, failure]).length, 2);
  assert.equal(recorder.record([base, failure]).length, 0, 'restart-safe repeat creates no duplicate evidence');
  for (const record of store.read().candidateRecords) {
    assert.equal(record.state, 'candidate'); assert.equal(record.candidate.classification, 'Insufficient Evidence'); assert.equal(record.candidate.kind, 'experience-observation');
    let current = transition(record, 'hypothesis', { at, reason:'investigate experience', hypothesis:'falsifiably test the bounded observation' });
    const observedProof = experimentalProof({ candidateId:record.candidate.id, testedProperty:record.candidate.claim, experimentBoundary:record.candidate.claimBoundary, hypothesis:'falsifiably test the bounded observation' });
    current = transition(current, 'experimented', { at, reason:'controlled input', experimentalProof:observedProof, gates:gates(true) });
    current = transition(current, 'causally-proven', { at, reason:'synthetic path' });
    current = transition(current, 'independently-verified', { at, reason:'independent input', independentVerification:verification({ testedProperty:record.candidate.claim, experimentBoundary:record.candidate.claimBoundary }) });
    assert.throws(() => transition(current, 'verified', { at, reason:'attempt direct experience promotion' }), /never be directly promoted/);
  }
});

test('learning by doing fails closed on missing custody proof, unknown fields, and cross-project stores', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-experience-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new DurableScientificLearningStore({ projectId:'project-a', root });
  const valid = { schemaVersion:1, projectId:'project-a', attemptId:'attempt-1', boundedClaim:'bounded claim', claimBoundary:'one runtime', generalizationBoundary:'one runtime only', action:'run action', environment:'bounded environment', expectedOutcome:'expected', actualOutcome:'actual', outcome:'failed', actionSha256:sha('a'), environmentSha256:sha('e'), resultSha256:sha('r'), artifactSha256:sha('t'), actorId:'runner', observedAt:at };
  assert.throws(() => experienceCandidate({ ...valid, artifactSha256:undefined }), /artifactSha256/);
  assert.throws(() => experienceCandidate({ ...valid, confidence:1 }), /unknown field.*confidence/);
  assert.throws(() => new LearningExperienceRecorder({ store, projectId:'project-b' }), /same project identity/);
});

test('weekly learning transport is encrypted, authenticated, and project bound', () => {
  const masterKey = crypto.randomBytes(32); const payload = { schemaVersion:1, projectId:'project-a', week:'2026-W35', candidateEvidence:[{ id:'c-1' }], verifiedKnowledge:[] };
  const envelope = encryptWeeklyEnvelope(payload, { masterKey, projectId:'project-a', repository:'owner/repo-a', week:'2026-W35', oidcSubject:'repo:owner/repo-a:ref:refs/heads/development' });
  assert.doesNotMatch(envelope.ciphertext, /c-1/);
  assert.deepEqual(decryptWeeklyEnvelope(envelope, { masterKey, expectedProjectId:'project-a', expectedRepository:'owner/repo-a', expectedWeek:'2026-W35', expectedOidcSubject:'repo:owner/repo-a:ref:refs/heads/development' }), payload);
  assert.throws(() => decryptWeeklyEnvelope(envelope, { masterKey, expectedProjectId:'project-b', expectedRepository:'owner/repo-a', expectedWeek:'2026-W35', expectedOidcSubject:'repo:owner/repo-a:ref:refs/heads/development' }), /binding mismatch/);
  const tamperedBytes = Buffer.from(envelope.ciphertext, 'base64url'); tamperedBytes[0] ^= 1;
  const tampered = { ...envelope, ciphertext:tamperedBytes.toString('base64url') };
  assert.throws(() => decryptWeeklyEnvelope(tampered, { masterKey, expectedProjectId:'project-a', expectedRepository:'owner/repo-a', expectedWeek:'2026-W35', expectedOidcSubject:'repo:owner/repo-a:ref:refs/heads/development' }));
});

test('OIDC transport identity requires trusted signature and exact project/repository/ref claims', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength:2048 }); const jwk = publicKey.export({ format:'jwk' }); jwk.kid = 'key-1'; jwk.alg = 'RS256';
  const now = Math.floor(Date.now()/1000); const header = Buffer.from(JSON.stringify({ alg:'RS256', kid:'key-1' })).toString('base64url');
  const claims = { iss:'https://token.actions.githubusercontent.com', aud:'crucible-learning', repository:'owner/repo-a', ref:'refs/heads/development', project_id:'project-a', sub:'repo:owner/repo-a:ref:refs/heads/development', iat:now-5, exp:now+300 };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url'); const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url'); const token = `${header}.${body}.${signature}`;
  assert.equal(verifyOidcIdentity(token, { jwks:{keys:[jwk]}, issuer:claims.iss, audience:claims.aud, repository:claims.repository, ref:claims.ref, projectId:claims.project_id }).project_id, 'project-a');
  assert.throws(() => verifyOidcIdentity(token, { jwks:{keys:[jwk]}, issuer:claims.iss, audience:claims.aud, repository:claims.repository, ref:claims.ref, projectId:'project-b' }), /not bound/);
});

test('three-way comparison routes agreement, contradiction, novelty, and bounded scope without satisfying proof', (t) => {
  const base={ sourceId:'source-a', claim:'Array map returns a new array.', claimBoundary:'ECMAScript 2026 ordinary arrays', generalizationBoundary:'ordinary arrays only' };
  const second={ ...base, sourceId:'source-b' }; const knowledge=[{ version:4, projectId:'project-a', claim:base.claim, boundary:base.claimBoundary, status:'active' }];
  const compare=(overrides={})=>routeThreeWayComparison({ projectId:'project-a', candidateId:'candidate-a', sourceA:base, sourceB:second, activeKnowledge:knowledge, comparedAt:at, ...overrides });
  const agreed=compare(); assert.equal(agreed.route,'corroboration-recorded'); assert.equal(agreed.nextAction,'controlled-regression-test-without-relearning');
  assert.equal(agreed.proofStageSatisfied,false); assert.equal(agreed.independentVerificationSatisfied,false); assert.equal(agreed.promotionAllowed,false);
  assert.equal(compare({ activeKnowledge:[] }).route,'new-claim-evaluation');
  assert.equal(compare({ activeKnowledge:[{ ...knowledge[0], claim:'Array map mutates the original array.' }] }).route,'possible-knowledge-update-quarantine');
  assert.equal(compare({ sourceB:{ ...second, claim:'Array map mutates the original array.' } }).route,'contradiction-review');
  assert.equal(compare({ sourceB:{ ...second, claimBoundary:'ECMAScript 2020 ordinary arrays' } }).route,'bounded-scope-or-version-update');
  assert.throws(()=>compare({ sourceB:{ ...second, sourceId:'source-a' } }),/independently identified/);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'claim-comparison-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const ledger=new ClaimComparisonLedger({root,projectId:'project-a'});assert.equal(ledger.record(agreed).created,true);assert.equal(ledger.record(agreed).created,false);assert.equal(ledger.read().decisions.length,1);
});

test('scientific-learning CLI persists three-way routing without mutating candidate or knowledge state', (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'comparison-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'comparison.json');
  const bounded={ sourceId:'source-a', claim:'A function returns a value to its caller.', claimBoundary:'runtime-a', generalizationBoundary:'runtime-a only' };
  fs.writeFileSync(file,JSON.stringify({ candidateId:'candidate-a', comparedAt:at, sourceA:bounded, sourceB:{...bounded,sourceId:'source-b'} }));
  const environment={ CRUCIBLE_LEARNING_PROJECT_ID:'project-a', CRUCIBLE_LEARNING_ROOT:root };const before=runLearningCli(['readiness'],environment);const result=runLearningCli(['compare',file],environment);const after=runLearningCli(['readiness'],environment);
  assert.equal(result.created,true);assert.equal(result.decision.route,'new-claim-evaluation');assert.equal(result.decision.promotionAllowed,false);assert.deepEqual(after,before);
});

test('controlled evaluator completes a real JavaScript claim through separate execution, verification, promotion, and retrieval', async (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'controlled-evaluator-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new DurableScientificLearningStore({root,projectId:'project-a'});
  const claim='Array.prototype.map returns a distinct array without changing the input array.';const boundary='Node.js ordinary dense arrays of numbers';const generalizationBoundary='Does not cover sparse arrays, proxies, subclasses, or host objects.';
  const source=(id,sourceId)=>makeCandidate({id,projectId:'project-a',claim,claimBoundary:boundary,generalizationBoundary,kind:'extracted-source-assertion',provenance:{sourceType:'retrieved-web-document',sourceId,retrievedAt:at,author:'bounded test source',license:'terms recorded',contentSha256:sha(sourceId)},createdAt:at});store.ingest(source('js-map-a','source-a'));store.ingest(source('js-map-b','source-b'));
  const execute=()=>{execFileSync(process.execPath,['-e',`const input=[1,2,3];const output=input.map(x=>x*2);if(output===input||JSON.stringify(input)!=='[1,2,3]'||JSON.stringify(output)!=='[2,4,6]')process.exit(1);const negative=[].map(x=>x);if(!Array.isArray(negative)||negative.length!==0)process.exit(2);`],{stdio:'pipe',windowsHide:true});};
  const experiment={id:'javascript-controlled-runner',run:async({candidate,hypothesis,testPlanSha256,testPlan})=>{execute();return {schemaVersion:1,candidateId:candidate.id,projectId:candidate.projectId,hypothesis,testedProperty:candidate.claim,experimentBoundary:(testPlan&&testPlan.experimentBoundary)||candidate.claimBoundary,controls:['identity reference comparison','unchanged input snapshot'],causalIsolation:{method:'single operation with reference and input-state controls',result:'map alone created the distinct output',correlationOnly:false},negativeTests:['empty input returns a distinct empty array'],regressionTests:['input values remain unchanged'],scopeProof:'Node.js ordinary dense numeric arrays only',generalizationResult:'not generalized beyond the declared boundary',contradictionResult:'none',completedAt:at,testPlanSha256};}};
  const verifier={id:'javascript-independent-runner',run:async({candidate,experimentalProof,testPlanSha256, testPlan})=>{execute();return {verifierId:'javascript-independent-runner',independent:true,testedProperty:candidate.claim,experimentBoundary:experimentalProof.experimentBoundary,result:'passed',verifiedAt:at,testPlanSha256};}};
  const worker=new ControlledClaimEvaluationWorker({store,comparisonLedger:new ClaimComparisonLedger({root,projectId:'project-a'}),criticalReviewer:new CriticalClaimReviewer(),reasoningProblemSolver:new LogicalReasoningProblemSolver(),reasoningLedger:new ReasoningLedger({root,projectId:'project-a'}),strategyEngine:new CreativeDecisionAdaptationEngine(),strategyLedger:new CognitiveStrategyLedger({root,projectId:'project-a'}),experimentHarnesses:{javascript:experiment},verifierHarnesses:{javascript:verifier},now:()=>at});const result=await worker.process({candidateId:'js-map-a',corroboratingCandidateId:'js-map-b',language:'javascript'});
  assert.equal(result.decision.route,'new-claim-evaluation');assert.equal(result.criticalReview.route,'ready-for-controlled-testing');assert.equal(result.criticalReview.proofStageSatisfied,false);assert.equal(result.reasoningPlan.route,'ready-for-controlled-testing');assert.equal(result.strategy.decision.action,'test');assert.equal(result.strategy.hypotheses.length,3);assert.equal(result.postTestReasoning.route,'result-logically-supports-independent-verification');assert.equal(result.postTestDecision.decision.action,'send-to-independent-verifier');assert.equal(result.postTestDecision.promotionAllowed,false);assert.equal(result.record.state,'verified');assert.equal(result.usedKnowledge.length,1);assert.equal(result.usedKnowledge[0].claim,claim);assert.equal(store.retrieve()[0].status,'active');
});

test('critical review narrows ambiguity and cannot satisfy proof or override contradiction routing',()=>{const reviewer=new CriticalClaimReviewer();const base=candidate();const review=reviewer.review({candidate:{...base,claim:'This is usually better and causes a faster result.'},corroboratingCandidate:{...base,id:'c-2'},comparison:{route:'new-claim-evaluation',classification:'Insufficient Evidence',nextAction:'test'},reviewedAt:at});assert.equal(review.route,'narrow-or-clarify-claim');assert.equal(review.proofStageSatisfied,false);assert.equal(review.independentVerificationSatisfied,false);assert.equal(review.promotionAllowed,false);});

test('a favorable adversarial review cannot override a failed experiment or impersonate verification',async(t)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'critical-fail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new DurableScientificLearningStore({root,projectId:'project-a'});const first=candidate({id:'critical-a',provenance:{...candidate().provenance,sourceId:'source-a'}});const second=candidate({id:'critical-b',provenance:{...candidate().provenance,sourceId:'source-b'}});store.ingest(first);store.ingest(second);const reviewer=new CriticalClaimReviewer();const failing={id:'controlled-failure',run:async()=>{throw new Error('negative control failed');}};const verifier={id:'separate-verifier',run:async()=>reviewer.review({candidate:first,corroboratingCandidate:second,comparison:{route:'new-claim-evaluation',classification:'Insufficient Evidence',nextAction:'test'},reviewedAt:at})};const strategyLedger=new CognitiveStrategyLedger({root,projectId:'project-a'});const worker=new ControlledClaimEvaluationWorker({store,comparisonLedger:new ClaimComparisonLedger({root,projectId:'project-a'}),criticalReviewer:reviewer,reasoningProblemSolver:new LogicalReasoningProblemSolver(),reasoningLedger:new ReasoningLedger({root,projectId:'project-a'}),strategyEngine:new CreativeDecisionAdaptationEngine(),strategyLedger,experimentHarnesses:{javascript:failing},verifierHarnesses:{javascript:verifier},now:()=>at});await assert.rejects(()=>worker.process({candidateId:'critical-a',corroboratingCandidateId:'critical-b',language:'javascript'}),/negative control failed/);assert.equal(store.get('critical-a').state,'hypothesis');assert.equal(store.activeKnowledge().length,0);const reviews=new ReasoningLedger({root,projectId:'project-a'}).read().reviews;assert.equal(reviews.at(-1).route,'revise-hypothesis-or-test-after-failure');assert.equal(reviews.at(-1).promotionAllowed,false);const strategy=strategyLedger.read().records.at(-1);assert.equal(strategy.decision.action,'retry');assert.equal(strategy.adaptation.preserveOriginalClaim,first.claim);assert.equal(strategy.adaptation.mayRemoveRequiredGate,false);});

test('learning orchestrator provides executive control without becoming a truth source',async(t)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'learning-orchestrator-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new DurableScientificLearningStore({root,projectId:'project-a'});store.ingest(candidate({id:'attention-candidate'}));store.ingest(candidate({id:'attention-hypothesis'}));let record=store.get('attention-hypothesis');record=transition(record,'hypothesis',{at,reason:'bounded planning',hypothesis:'test bounded claim'});store.update(record,at,'hypothesis');const evaluator={process:async(request)=>({candidateId:request.candidateId,state:'coordinated-not-proven'})};const recorder={record:(items)=>items.map((item)=>({item}))};const orchestrator=new CrucibleLearningOrchestrator({store,ledger:new LearningOrchestratorLedger({root,projectId:'project-a'}),extractor:{run:()=>[{sourceId:'source-a'}]},evaluator,experienceRecorder:recorder,now:()=>at});const plan=orchestrator.plan();assert.equal(plan[0].candidateId,'attention-hypothesis');assert.deepEqual(plan[0].dependencies,['falsifiable hypothesis','critical review','reasoning plan']);assert.equal(orchestrator.inhibit({projectId:'project-a',action:'promote',classification:'Insufficient Evidence',boundary:'bounded'}).allowed,false);assert.equal(orchestrator.inhibit({projectId:'project-b',action:'evaluate',classification:'Insufficient Evidence',boundary:'bounded'}).allowed,false);const cycle=await orchestrator.coordinate({runExtraction:true,evaluations:[{projectId:'project-a',candidateId:'attention-candidate',boundary:'bounded'}]});assert.equal(cycle.event.promotionAuthorized,false);assert.equal(cycle.event.proofStageSatisfied,false);assert.equal(cycle.results[0].state,'coordinated-not-proven');assert.equal(cycle.metacognition.orchestratorIsProofSource,false);assert.equal(orchestrator.feedback([{attemptId:'a'}]).length,1);assert.equal(store.activeKnowledge().length,0);});

// The extraction worker is synchronous today, so awaiting it changes nothing now. It is awaited
// because `coordinate` is async and nothing holds `run` to a synchronous contract: an async
// extractor would have made `extracted` undefined and returned an unresolved promise as if it
// were the extraction, with no error to say so.
test('coordinate awaits its extraction worker, so an async extractor is counted rather than lost', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-await-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new DurableScientificLearningStore({ root, projectId: 'project-a' });
  const events = [];
  const ledger = new LearningOrchestratorLedger({ root, projectId: 'project-a' });
  const recording = { projectId: 'project-a', record: (event) => { events.push(event); return ledger.record(event); } };
  const orchestrator = new CrucibleLearningOrchestrator({ store, ledger: recording, extractor: { run: async () => [{ sourceId: 'a' }, { sourceId: 'b' }, { sourceId: 'c' }] }, now: () => at });
  const cycle = await orchestrator.coordinate({ runExtraction: true });
  assert.deepEqual(cycle.extraction, [{ sourceId: 'a' }, { sourceId: 'b' }, { sourceId: 'c' }], 'the extraction is the resolved value, not a pending promise');
  assert.equal(events.at(-1).extracted, 3, 'the recorded count is the real one, not undefined');
  assert.equal(events.at(-1).promotionAuthorized, false);
  assert.equal(events.at(-1).proofStageSatisfied, false);
});

// The scope is declared once, when the hypothesis is recorded. A worker that restarts and resumes
// the record was reading its own constructor value instead, so a plain restart with nothing declared
// tested within the candidate's provenance boundary rather than the scope the record is committed
// to - and the verified gate reads the persisted value, so the mismatch surfaced later, elsewhere.
test('a resumed learner tests within the scope the record was hypothesised under, not its own', async (t) => {
  const SCOPE = 'node-22/linux/scoped-boundary';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-learning-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new DurableScientificLearningStore({ root, projectId:'project-a' }); store.ingest(candidate());
  // Recorded under an owner-declared scope, then the worker that declared it goes away.
  store.update(transition(store.get('c-1'), 'hypothesis', { at, reason:'declared under an owner scope', hypothesis:proof().hypothesis, claimScope:SCOPE }), at, 'hypothesis');
  assert.equal(store.get('c-1').claimScope, SCOPE);

  const seen = [];
  const experimentExecutor = { id:'experiment-runner-1', run:async ({ claimScope }) => { seen.push(['experiment', claimScope]); return experimentalProof({ experimentBoundary:SCOPE }); } };
  const independentVerifier = { id:'independent-runner-2', run:async ({ claimScope }) => { seen.push(['verify', claimScope]); return verification({ experimentBoundary:SCOPE }); } };
  // A fresh worker with no scope of its own - the ordinary restart.
  const resumed = new AutonomousScientificLearner({ store, experimentExecutor, independentVerifier, now:() => at });
  assert.equal(resumed.claimScope, null);
  assert.equal((await resumed.process('c-1', proof().hypothesis)).state, 'verified');
  assert.deepEqual(seen, [['experiment', SCOPE], ['verify', SCOPE]], 'both stages were told the recorded scope');
  assert.equal(store.get('c-1').proof.experimentBoundary, SCOPE);

  // Declaring a different scope for an already-scoped record is a contradiction, refused the same
  // way a different hypothesis is, rather than quietly retested within the wrong boundary.
  const other = new DurableScientificLearningStore({ root:fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-learning-')), projectId:'project-a' });
  other.ingest(candidate());
  other.update(transition(other.get('c-1'), 'hypothesis', { at, reason:'declared under an owner scope', hypothesis:proof().hypothesis, claimScope:SCOPE }), at, 'hypothesis');
  const conflicting = new AutonomousScientificLearner({ store:other, experimentExecutor, independentVerifier, claimScope:'node-22/windows/somewhere-else', now:() => at });
  await assert.rejects(() => conflicting.process('c-1', proof().hypothesis), /claim scope the hypothesis was recorded under/);
});
