const crypto = require('node:crypto');

const STATES = Object.freeze(['candidate', 'hypothesis', 'experimented', 'causally-proven', 'independently-verified', 'verified', 'quarantined', 'rejected']);
const CLASSIFICATIONS = Object.freeze(['Rejected Evidence', 'Insufficient Evidence', 'Crucible Issue']);
const REQUIRED_GATES = Object.freeze(['falsifiableHypothesis', 'controlledReproduction', 'causalIsolation', 'controlTesting', 'independentVerification', 'negativeTesting', 'regressionTesting', 'deterministicScopeProof', 'claimBoundaryCheck', 'generalizationCheck', 'contradictionAnalysis']);
const PROHIBITED_PROMOTION_KINDS = Object.freeze(['raw-telemetry', 'correlation', 'one-off-repair', 'repeated-observation', 'model-guess', 'incomplete-observation', 'untested-hypothesis', 'retrieval']);
const TRANSITIONS = Object.freeze({
  candidate: ['hypothesis', 'rejected', 'quarantined'],
  hypothesis: ['experimented', 'rejected', 'quarantined'],
  experimented: ['causally-proven', 'rejected', 'quarantined'],
  'causally-proven': ['independently-verified', 'rejected', 'quarantined'],
  'independently-verified': ['verified', 'rejected', 'quarantined'],
  verified: ['quarantined'], quarantined: [], rejected: [],
});

const CANDIDATE_KEYS = ['schemaVersion', 'id', 'projectId', 'claim', 'claimBoundary', 'generalizationBoundary', 'kind', 'provenance', 'classification', 'createdAt'];
const PROVENANCE_KEYS = ['sourceType', 'sourceId', 'retrievedAt', 'author', 'license', 'contentSha256'];
const PROOF_KEYS = ['schemaVersion', 'candidateId', 'projectId', 'hypothesis', 'testedProperty', 'experimentBoundary', 'controls', 'causalIsolation', 'negativeTests', 'regressionTests', 'scopeProof', 'generalizationResult', 'contradictionResult', 'independentVerification', 'completedAt'];

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}
function exactKeys(value, allowed, label) {
  object(value, label);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contains unknown field(s): ${extras.join(', ')}.`);
}
function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`); }
function iso(value, label) { text(value, label); if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`); }
function digest(value, label) { if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} must be a lowercase SHA-256 digest.`); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex'); }

function validateCandidate(candidate) {
  exactKeys(candidate, CANDIDATE_KEYS, 'candidate');
  if (candidate.schemaVersion !== 1) throw new Error('candidate.schemaVersion must be 1.');
  ['id', 'projectId', 'claim', 'claimBoundary', 'generalizationBoundary', 'kind', 'classification'].forEach((key) => text(candidate[key], `candidate.${key}`));
  if (!CLASSIFICATIONS.includes(candidate.classification)) throw new Error('candidate.classification is not allowed.');
  exactKeys(candidate.provenance, PROVENANCE_KEYS, 'candidate.provenance');
  ['sourceType', 'sourceId', 'author', 'license'].forEach((key) => text(candidate.provenance[key], `candidate.provenance.${key}`));
  iso(candidate.provenance.retrievedAt, 'candidate.provenance.retrievedAt');
  digest(candidate.provenance.contentSha256, 'candidate.provenance.contentSha256');
  iso(candidate.createdAt, 'candidate.createdAt');
  return Object.freeze(structuredClone(candidate));
}

function validateProof(proof) {
  exactKeys(proof, PROOF_KEYS, 'proof');
  if (proof.schemaVersion !== 1) throw new Error('proof.schemaVersion must be 1.');
  ['candidateId', 'projectId', 'hypothesis', 'testedProperty', 'experimentBoundary', 'scopeProof', 'generalizationResult', 'contradictionResult'].forEach((key) => text(proof[key], `proof.${key}`));
  for (const key of ['controls', 'negativeTests', 'regressionTests']) if (!Array.isArray(proof[key]) || !proof[key].length || proof[key].some((x) => typeof x !== 'string' || !x)) throw new Error(`proof.${key} must be a non-empty text array.`);
  exactKeys(proof.causalIsolation, ['method', 'result', 'correlationOnly'], 'proof.causalIsolation');
  text(proof.causalIsolation.method, 'proof.causalIsolation.method'); text(proof.causalIsolation.result, 'proof.causalIsolation.result');
  if (proof.causalIsolation.correlationOnly !== false) throw new Error('Correlation never satisfies causation.');
  exactKeys(proof.independentVerification, ['verifierId', 'independent', 'testedProperty', 'experimentBoundary', 'result', 'verifiedAt'], 'proof.independentVerification');
  text(proof.independentVerification.verifierId, 'proof.independentVerification.verifierId');
  if (proof.independentVerification.independent !== true) throw new Error('Independent verification is required.');
  if (proof.independentVerification.testedProperty !== proof.testedProperty) throw new Error('Verification proves only the tested property.');
  if (proof.independentVerification.experimentBoundary !== proof.experimentBoundary) throw new Error('Experimental results inherit experiment boundaries.');
  if (proof.independentVerification.result !== 'passed') throw new Error('Independent verification must pass.');
  iso(proof.independentVerification.verifiedAt, 'proof.independentVerification.verifiedAt'); iso(proof.completedAt, 'proof.completedAt');
  return Object.freeze(structuredClone(proof));
}

function makeCandidate(input) { return validateCandidate({ schemaVersion:1, classification:'Insufficient Evidence', ...input }); }

function newRecord(candidate) {
  const value = validateCandidate(candidate);
  return { schemaVersion:1, candidate:value, state:'candidate', gates:Object.fromEntries(REQUIRED_GATES.map((gate) => [gate, false])), proof:null, history:[{ from:null, to:'candidate', at:value.createdAt, reason:'strictly validated candidate evidence ingested' }] };
}

function transition(record, to, { at, reason, proof, gates } = {}) {
  object(record, 'record'); iso(at, 'transition.at'); text(reason, 'transition.reason');
  if (!STATES.includes(record.state) || !TRANSITIONS[record.state]?.includes(to)) throw new Error(`Forbidden learning transition ${record.state} -> ${to}.`);
  const next = structuredClone(record);
  if (gates) {
    exactKeys(gates, REQUIRED_GATES, 'transition.gates');
    for (const gate of REQUIRED_GATES) if (typeof gates[gate] !== 'boolean') throw new Error(`transition.gates.${gate} must be boolean.`);
    next.gates = { ...gates };
  }
  if (proof) next.proof = validateProof(proof);
  if (to === 'causally-proven' && (!next.proof || next.proof.causalIsolation.correlationOnly)) throw new Error('Causal proof is required before causal promotion.');
  if (to === 'independently-verified' && !next.proof?.independentVerification?.independent) throw new Error('Independent verification is required.');
  if (to === 'verified') {
    if (PROHIBITED_PROMOTION_KINDS.includes(next.candidate.kind)) throw new Error(`${next.candidate.kind} can never be directly promoted.`);
    const missing = REQUIRED_GATES.filter((gate) => next.gates[gate] !== true);
    if (missing.length) throw new Error(`Verified promotion is fail-closed; missing gate(s): ${missing.join(', ')}.`);
    if (!next.proof) throw new Error('Verified promotion requires proof.');
    if (next.proof.candidateId !== next.candidate.id || next.proof.projectId !== next.candidate.projectId) throw new Error('Proof identity must match candidate identity.');
    if (next.proof.experimentBoundary !== next.candidate.claimBoundary) throw new Error('Experimental results cannot exceed the candidate claim boundary.');
    if (next.proof.testedProperty !== next.candidate.claim) throw new Error('Verification proves only the exact tested claim.');
    if (next.proof.contradictionResult !== 'none') throw new Error('Contradictions require quarantine.');
  }
  next.history.push({ from:record.state, to, at, reason }); next.state = to;
  return next;
}

class CandidateEvidenceStore {
  constructor(projectId) { text(projectId, 'projectId'); this.projectId = projectId; this.records = new Map(); }
  ingest(candidate) { const checked = validateCandidate(candidate); if (checked.projectId !== this.projectId) throw new Error('Cross-project candidate evidence is forbidden.'); if (this.records.has(checked.id)) throw new Error('Candidate id already exists.'); const record = newRecord(checked); this.records.set(checked.id, record); return structuredClone(record); }
  get(id) { const record = this.records.get(id); return record ? structuredClone(record) : null; }
  update(record) { if (record.candidate.projectId !== this.projectId || !this.records.has(record.candidate.id)) throw new Error('Unknown or cross-project learning record.'); this.records.set(record.candidate.id, structuredClone(record)); return this.get(record.candidate.id); }
}

class VerifiedKnowledgeStore {
  constructor(projectId) { text(projectId, 'projectId'); this.projectId = projectId; this.versions = []; this.activeVersion = null; }
  commit(record, at) {
    iso(at, 'knowledge.at'); if (record.state !== 'verified' || record.candidate.projectId !== this.projectId) throw new Error('Only same-project verified records may enter knowledge.');
    const previous = this.activeVersion; const version = { version:this.versions.length + 1, projectId:this.projectId, candidateId:record.candidate.id, claim:record.candidate.claim, boundary:record.proof.experimentBoundary, proofSha256:sha(record.proof), previousVersion:previous, createdAt:at, status:'active' };
    if (previous) this.versions.find((item) => item.version === previous).status = 'superseded';
    this.versions.push(version); this.activeVersion = version.version; return structuredClone(version);
  }
  rollback(targetVersion, at, reason) { iso(at, 'rollback.at'); text(reason, 'rollback.reason'); const target = this.versions.find((item) => item.version === targetVersion); if (!target) throw new Error('Rollback target does not exist.'); for (const item of this.versions) if (item.status === 'active') item.status = 'rolled-back'; target.status = 'active'; target.rollback = { at, reason }; this.activeVersion = targetVersion; return structuredClone(target); }
}

function detectContradiction(record, activeKnowledge) {
  const conflict = activeKnowledge.find((item) => item.projectId === record.candidate.projectId && item.boundary === record.candidate.claimBoundary && item.claim !== record.candidate.claim);
  return conflict ? { detected:true, classification:'Crucible Issue', conflictingVersion:conflict.version } : { detected:false };
}

function b64urlDecode(value) { return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function verifyOidcIdentity(token, { jwks, issuer, audience, repository, ref, projectId, now = Date.now() }) {
  text(token, 'OIDC token'); const parts = token.split('.'); if (parts.length !== 3) throw new Error('OIDC token must be a compact JWT.');
  const header = JSON.parse(b64urlDecode(parts[0])); const claims = JSON.parse(b64urlDecode(parts[1]));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('OIDC token must use RS256 with kid.');
  const jwk = jwks?.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA'); if (!jwk) throw new Error('OIDC signing key is not trusted.');
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key:jwk, format:'jwk' }), b64urlDecode(parts[2]))) throw new Error('OIDC signature is invalid.');
  if (claims.iss !== issuer || claims.aud !== audience || claims.repository !== repository || claims.ref !== ref || claims.project_id !== projectId) throw new Error('OIDC identity is not bound to the expected project/repository/ref.');
  const seconds = Math.floor(now / 1000); if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > seconds + 60 || claims.exp <= seconds || claims.exp - claims.iat > 600) throw new Error('OIDC token lifetime is invalid.');
  return Object.freeze(claims);
}

function deriveProjectKey(masterKey, projectId) { if (!Buffer.isBuffer(masterKey) || masterKey.length < 32) throw new Error('masterKey must contain at least 32 bytes.'); text(projectId, 'projectId'); return Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.from(projectId), Buffer.from('the-crucible-weekly-learning-v1'), 32)); }
function encryptWeeklyEnvelope(payload, { masterKey, projectId, repository, week, oidcSubject }) {
  exactKeys(payload, ['schemaVersion', 'projectId', 'week', 'candidateEvidence', 'verifiedKnowledge'], 'weekly payload'); if (payload.schemaVersion !== 1 || payload.projectId !== projectId || payload.week !== week) throw new Error('Weekly payload identity mismatch.');
  if (!Array.isArray(payload.candidateEvidence) || !Array.isArray(payload.verifiedKnowledge)) throw new Error('Weekly payload collections must be arrays.');
  const aad = { schemaVersion:1, projectId, repository, week, oidcSubject }; Object.values(aad).forEach((value) => value === 1 || text(value, 'weekly envelope binding'));
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', deriveProjectKey(masterKey, projectId), iv); cipher.setAAD(Buffer.from(canonical(aad)));
  const ciphertext = Buffer.concat([cipher.update(canonical(payload)), cipher.final()]);
  return { ...aad, algorithm:'A256GCM-HKDF-SHA256', iv:iv.toString('base64url'), ciphertext:ciphertext.toString('base64url'), tag:cipher.getAuthTag().toString('base64url') };
}
function decryptWeeklyEnvelope(envelope, { masterKey, expectedProjectId, expectedRepository, expectedWeek, expectedOidcSubject }) {
  exactKeys(envelope, ['schemaVersion', 'projectId', 'repository', 'week', 'oidcSubject', 'algorithm', 'iv', 'ciphertext', 'tag'], 'weekly envelope');
  if (envelope.schemaVersion !== 1 || envelope.algorithm !== 'A256GCM-HKDF-SHA256' || envelope.projectId !== expectedProjectId || envelope.repository !== expectedRepository || envelope.week !== expectedWeek || envelope.oidcSubject !== expectedOidcSubject) throw new Error('Weekly envelope binding mismatch.');
  const aad = { schemaVersion:1, projectId:envelope.projectId, repository:envelope.repository, week:envelope.week, oidcSubject:envelope.oidcSubject };
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveProjectKey(masterKey, envelope.projectId), Buffer.from(envelope.iv, 'base64url')); decipher.setAAD(Buffer.from(canonical(aad))); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

module.exports = { STATES, CLASSIFICATIONS, REQUIRED_GATES, PROHIBITED_PROMOTION_KINDS, validateCandidate, validateProof, makeCandidate, newRecord, transition, CandidateEvidenceStore, VerifiedKnowledgeStore, detectContradiction, verifyOidcIdentity, deriveProjectKey, encryptWeeklyEnvelope, decryptWeeklyEnvelope, sha };
