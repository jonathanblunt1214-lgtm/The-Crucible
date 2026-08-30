const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REQUIRED_GATES, makeCandidate, newRecord, transition, CandidateEvidenceStore,
  VerifiedKnowledgeStore, DurableScientificLearningStore, AutonomousScientificLearner,
  detectContradiction, verifyOidcIdentity,
  encryptWeeklyEnvelope, decryptWeeklyEnvelope, sha,
} = require('../src/scientificLearning');
const { run:runLearningCli } = require('../src/scientificLearningCli');
const { LearningExperienceRecorder, experienceCandidate } = require('../src/learningExperience');

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
