const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  REQUIRED_GATES, makeCandidate, newRecord, transition, CandidateEvidenceStore,
  VerifiedKnowledgeStore, detectContradiction, verifyOidcIdentity,
  encryptWeeklyEnvelope, decryptWeeklyEnvelope, sha,
} = require('../src/scientificLearning');

const at = '2026-08-29T18:20:00.000Z';
function candidate(overrides = {}) {
  return makeCandidate({ id:'c-1', projectId:'project-a', claim:'repair X causes test Y to pass', claimBoundary:'node-22/windows/test-y', generalizationBoundary:'no wider than node-22/windows/test-y', kind:'controlled-experiment', provenance:{ sourceType:'conversation-research', sourceId:'6a92d5f9', retrievedAt:at, author:'owner-and-assistant', license:'private-candidate-evidence', contentSha256:sha('candidate source') }, createdAt:at, ...overrides });
}
function proof(overrides = {}) {
  return { schemaVersion:1, candidateId:'c-1', projectId:'project-a', hypothesis:'repair X is falsifiably responsible for test Y', testedProperty:'repair X causes test Y to pass', experimentBoundary:'node-22/windows/test-y', controls:['no-repair control fails', 'irrelevant repair control fails'], causalIsolation:{ method:'single-variable intervention and reversal', result:'only repair X changes Y', correlationOnly:false }, negativeTests:['X does not change Z'], regressionTests:['existing suite remains green'], scopeProof:'diff and artifact proof limited to test-y', generalizationResult:'not generalized beyond experiment boundary', contradictionResult:'none', independentVerification:{ verifierId:'independent-runner-2', independent:true, testedProperty:'repair X causes test Y to pass', experimentBoundary:'node-22/windows/test-y', result:'passed', verifiedAt:at }, completedAt:at, ...overrides };
}
function gates(value = true) { return Object.fromEntries(REQUIRED_GATES.map((gate) => [gate, value])); }
function verifiedRecord(input = candidate()) {
  const recordProof = proof({
    candidateId:input.id,
    testedProperty:input.claim,
    independentVerification:{ ...proof().independentVerification, testedProperty:input.claim },
  });
  let record = newRecord(input);
  record = transition(record, 'hypothesis', { at, reason:'falsifiable hypothesis declared', gates:gates(false) });
  record = transition(record, 'experimented', { at, reason:'controlled experiment completed', proof:recordProof, gates:{ ...gates(false), falsifiableHypothesis:true, controlledReproduction:true, controlTesting:true, negativeTesting:true, regressionTesting:true, deterministicScopeProof:true, claimBoundaryCheck:true, generalizationCheck:true, contradictionAnalysis:true } });
  record = transition(record, 'causally-proven', { at, reason:'causal isolation passed', gates:{ ...record.gates, causalIsolation:true } });
  record = transition(record, 'independently-verified', { at, reason:'independent verifier passed', gates:gates(true) });
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
  const hypothesis = transition(record, 'hypothesis', { at, reason:'candidate produced hypothesis input' });
  assert.equal(hypothesis.gates.falsifiableHypothesis, false, 'producing a later stage input cannot satisfy that proof stage');
  assert.throws(() => transition(hypothesis, 'causally-proven', { at, reason:'skip experiment' }), /Forbidden/);
});

test('raw telemetry, correlations, retrieval, repetition, guesses, and one-off repairs never promote', () => {
  for (const kind of ['raw-telemetry','correlation','retrieval','repeated-observation','model-guess','incomplete-observation','untested-hypothesis','one-off-repair']) {
    let record = newRecord(candidate({ kind }));
    record = transition(record, 'hypothesis', { at, reason:'investigate only' });
    record = transition(record, 'experimented', { at, reason:'input collected', proof:proof(), gates:gates(true) });
    record = transition(record, 'causally-proven', { at, reason:'synthetic path' });
    record = transition(record, 'independently-verified', { at, reason:'synthetic verification' });
    assert.throws(() => transition(record, 'verified', { at, reason:'attempt shortcut' }), /never be directly promoted/);
  }
  assert.throws(() => proof({ causalIsolation:{ method:'frequency', result:'10000 correlated projects', correlationOnly:true } }) && transition(transition(transition(newRecord(candidate()), 'hypothesis', {at,reason:'x'}), 'experimented', {at,reason:'x',proof:proof({ causalIsolation:{ method:'frequency', result:'many', correlationOnly:true } })}), 'causally-proven', {at,reason:'x'}), /Correlation never/);
});

test('verification proves only its tested property and inherits experiment boundaries', () => {
  assert.throws(() => transition(transition(newRecord(candidate()), 'hypothesis', {at,reason:'x'}), 'experimented', {at,reason:'x',proof:proof({ independentVerification:{ ...proof().independentVerification, testedProperty:'broader claim' } })}), /only the tested property/);
  assert.throws(() => transition(transition(newRecord(candidate()), 'hypothesis', {at,reason:'x'}), 'experimented', {at,reason:'x',proof:proof({ independentVerification:{ ...proof().independentVerification, experimentBoundary:'all-platforms' } })}), /inherit experiment boundaries/);
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
