const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
const EXPERIMENTAL_PROOF_KEYS = PROOF_KEYS.filter((key) => key !== 'independentVerification');

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

function validateExperimentalProof(proof) {
  exactKeys(proof, EXPERIMENTAL_PROOF_KEYS, 'experimental proof');
  if (proof.schemaVersion !== 1) throw new Error('experimental proof.schemaVersion must be 1.');
  ['candidateId', 'projectId', 'hypothesis', 'testedProperty', 'experimentBoundary', 'scopeProof', 'generalizationResult', 'contradictionResult'].forEach((key) => text(proof[key], `experimental proof.${key}`));
  for (const key of ['controls', 'negativeTests', 'regressionTests']) if (!Array.isArray(proof[key]) || !proof[key].length || proof[key].some((x) => typeof x !== 'string' || !x)) throw new Error(`experimental proof.${key} must be a non-empty text array.`);
  exactKeys(proof.causalIsolation, ['method', 'result', 'correlationOnly'], 'experimental proof.causalIsolation');
  text(proof.causalIsolation.method, 'experimental proof.causalIsolation.method');
  text(proof.causalIsolation.result, 'experimental proof.causalIsolation.result');
  if (proof.causalIsolation.correlationOnly !== false) throw new Error('Correlation never satisfies causation.');
  iso(proof.completedAt, 'experimental proof.completedAt');
  return Object.freeze(structuredClone(proof));
}

function validateIndependentVerification(value, experimentalProof) {
  exactKeys(value, ['verifierId', 'independent', 'testedProperty', 'experimentBoundary', 'result', 'verifiedAt'], 'independent verification');
  text(value.verifierId, 'independent verification.verifierId');
  if (value.independent !== true) throw new Error('Independent verification is required.');
  if (value.testedProperty !== experimentalProof.testedProperty) throw new Error('Verification proves only the tested property.');
  if (value.experimentBoundary !== experimentalProof.experimentBoundary) throw new Error('Experimental results inherit experiment boundaries.');
  if (value.result !== 'passed') throw new Error('Independent verification must pass.');
  iso(value.verifiedAt, 'independent verification.verifiedAt');
  return Object.freeze(structuredClone(value));
}

function makeCandidate(input) { return validateCandidate({ schemaVersion:1, classification:'Insufficient Evidence', ...input }); }

function newRecord(candidate) {
  const value = validateCandidate(candidate);
  return { schemaVersion:1, candidate:value, state:'candidate', hypothesis:null, gates:Object.fromEntries(REQUIRED_GATES.map((gate) => [gate, false])), experimentalProof:null, independentVerification:null, proof:null, history:[{ from:null, to:'candidate', at:value.createdAt, reason:'strictly validated candidate evidence ingested' }] };
}

function transition(record, to, { at, reason, hypothesis, experimentalProof, independentVerification, gates } = {}) {
  object(record, 'record'); iso(at, 'transition.at'); text(reason, 'transition.reason');
  if (!STATES.includes(record.state) || !TRANSITIONS[record.state]?.includes(to)) throw new Error(`Forbidden learning transition ${record.state} -> ${to}.`);
  const next = structuredClone(record);
  if (gates) {
    exactKeys(gates, REQUIRED_GATES, 'transition.gates');
    for (const gate of REQUIRED_GATES) if (typeof gates[gate] !== 'boolean') throw new Error(`transition.gates.${gate} must be boolean.`);
    next.gates = { ...gates };
  }
  if (experimentalProof && to !== 'experimented') throw new Error('Experimental proof may only be produced by the experiment stage.');
  if (independentVerification && to !== 'independently-verified') throw new Error('Independent verification may only be produced by the independent-verification stage.');
  if (hypothesis && to !== 'hypothesis') throw new Error('A hypothesis may only be declared by the hypothesis stage.');
  if (to === 'hypothesis') { text(hypothesis, 'transition.hypothesis'); next.hypothesis = hypothesis; }
  if (to === 'experimented') {
    if (!experimentalProof) throw new Error('The experiment stage requires experimental proof.');
    next.experimentalProof = validateExperimentalProof(experimentalProof);
    if (next.experimentalProof.hypothesis !== next.hypothesis) throw new Error('Experimental proof must test the persisted hypothesis.');
  }
  if (to === 'causally-proven' && (!next.experimentalProof || next.experimentalProof.causalIsolation.correlationOnly)) throw new Error('Causal proof is required before causal promotion.');
  if (to === 'independently-verified') {
    if (!next.experimentalProof || !independentVerification) throw new Error('Independent verification is required.');
    next.independentVerification = validateIndependentVerification(independentVerification, next.experimentalProof);
  }
  if (to === 'verified') {
    if (PROHIBITED_PROMOTION_KINDS.includes(next.candidate.kind)) throw new Error(`${next.candidate.kind} can never be directly promoted.`);
    const missing = REQUIRED_GATES.filter((gate) => next.gates[gate] !== true);
    if (missing.length) throw new Error(`Verified promotion is fail-closed; missing gate(s): ${missing.join(', ')}.`);
    if (!next.experimentalProof || !next.independentVerification) throw new Error('Verified promotion requires proof from separate experiment and verification stages.');
    next.proof = validateProof({ ...next.experimentalProof, independentVerification:next.independentVerification });
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
    const prior = this.versions.findLast((item) => item.status === 'active' && item.claim === record.candidate.claim && item.boundary === record.proof.experimentBoundary);
    const previous = prior?.version || null; const version = { version:this.versions.length + 1, projectId:this.projectId, candidateId:record.candidate.id, claim:record.candidate.claim, boundary:record.proof.experimentBoundary, proofSha256:sha(record.proof), previousVersion:previous, createdAt:at, status:'active' };
    if (prior) prior.status = 'superseded';
    this.versions.push(version); this.activeVersion = version.version; return structuredClone(version);
  }
  rollback(targetVersion, at, reason) { iso(at, 'rollback.at'); text(reason, 'rollback.reason'); const target = this.versions.find((item) => item.version === targetVersion); if (!target) throw new Error('Rollback target does not exist.'); for (const item of this.versions) if (item.status === 'active' && item.claim === target.claim && item.boundary === target.boundary) item.status = 'rolled-back'; target.status = 'active'; target.rollback = { at, reason }; this.activeVersion = targetVersion; return structuredClone(target); }
}

function durablePayload(projectId, revision = 0) {
  return { schemaVersion:1, projectId, revision, candidateRecords:[], knowledgeVersions:[], activeVersion:null, auditLog:[] };
}

function validateDurablePayload(value, projectId) {
  exactKeys(value, ['schemaVersion', 'projectId', 'revision', 'candidateRecords', 'knowledgeVersions', 'activeVersion', 'auditLog'], 'durable learning payload');
  if (value.schemaVersion !== 1 || value.projectId !== projectId || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Durable learning payload identity or revision is invalid.');
  if (!Array.isArray(value.candidateRecords) || !Array.isArray(value.knowledgeVersions) || !Array.isArray(value.auditLog)) throw new Error('Durable learning payload collections are invalid.');
  const candidateIds = new Set();
  for (const record of value.candidateRecords) {
    object(record, 'durable candidate record');
    const candidate = validateCandidate(record.candidate);
    if (candidate.projectId !== projectId || candidateIds.has(candidate.id)) throw new Error('Durable candidate records are duplicated or cross-project.');
    candidateIds.add(candidate.id);
    if (!STATES.includes(record.state) || !Array.isArray(record.history)) throw new Error('Durable candidate record state is invalid.');
    if (record.state === 'candidate') { if (record.hypothesis !== null) throw new Error('Candidate state cannot contain a hypothesis.'); }
    else text(record.hypothesis, 'durable candidate hypothesis');
    exactKeys(record.gates, REQUIRED_GATES, 'durable candidate gates');
    for (const gate of REQUIRED_GATES) if (typeof record.gates[gate] !== 'boolean') throw new Error(`durable candidate gates.${gate} must be boolean.`);
    if (record.experimentalProof) validateExperimentalProof(record.experimentalProof);
    if (record.independentVerification) validateIndependentVerification(record.independentVerification, record.experimentalProof);
    if (record.proof) validateProof(record.proof);
  }
  const versions = new Set();
  for (const version of value.knowledgeVersions) {
    object(version, 'durable knowledge version');
    if (version.projectId !== projectId || !Number.isSafeInteger(version.version) || versions.has(version.version)) throw new Error('Durable knowledge versions are duplicated or cross-project.');
    versions.add(version.version);
    digest(version.proofSha256, 'durable knowledge proofSha256');
  }
  if (value.activeVersion !== null && !versions.has(value.activeVersion)) throw new Error('Durable active knowledge version does not exist.');
  return structuredClone(value);
}

class DurableScientificLearningStore {
  constructor({ root, projectId }) {
    text(projectId, 'projectId'); text(root, 'durable learning root');
    this.projectId = projectId;
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive:true });
    this.file = path.join(this.root, `${sha(projectId)}.learning.json`);
    this.lockFile = `${this.file}.lock`;
    if (!fs.existsSync(this.file)) this.writeEnvelope(durablePayload(projectId), false);
    this.read();
  }
  envelope(payload) { return { schemaVersion:1, payload, payloadSha256:sha(payload) }; }
  readEnvelope() {
    let envelope;
    try { envelope = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (error) { throw new Error(`Durable learning store is unreadable: ${error.message}`); }
    exactKeys(envelope, ['schemaVersion', 'payload', 'payloadSha256'], 'durable learning envelope');
    if (envelope.schemaVersion !== 1 || sha(envelope.payload) !== envelope.payloadSha256) throw new Error('Durable learning store integrity check failed.');
    return validateDurablePayload(envelope.payload, this.projectId);
  }
  read() { return this.readEnvelope(); }
  writeEnvelope(payload, requireExisting = true) {
    if (requireExisting && !fs.existsSync(this.file)) throw new Error('Durable learning store disappeared during transaction.');
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(this.envelope(payload), null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    try { fs.renameSync(temporary, this.file); }
    catch (error) { try { fs.rmSync(temporary, { force:true }); } catch {} throw error; }
  }
  transact(mutator, { at, action }) {
    iso(at, 'transaction.at'); text(action, 'transaction.action');
    let lock;
    try { lock = fs.openSync(this.lockFile, 'wx', 0o600); }
    catch { throw new Error('Durable learning store is locked; concurrent or interrupted mutation fails closed.'); }
    try {
      const payload = this.readEnvelope();
      const expectedRevision = payload.revision;
      const next = mutator(structuredClone(payload));
      if (this.readEnvelope().revision !== expectedRevision) throw new Error('Durable learning store revision changed concurrently.');
      next.revision = expectedRevision + 1;
      next.auditLog.push({ revision:next.revision, action, at });
      const checked = validateDurablePayload(next, this.projectId);
      this.writeEnvelope(checked);
      return structuredClone(checked);
    } finally { fs.closeSync(lock); fs.rmSync(this.lockFile, { force:true }); }
  }
  ingest(candidate) {
    const checked = validateCandidate(candidate);
    if (checked.projectId !== this.projectId) throw new Error('Cross-project candidate evidence is forbidden.');
    const payload = this.transact((next) => {
      if (next.candidateRecords.some((item) => item.candidate.id === checked.id)) throw new Error('Candidate id already exists.');
      next.candidateRecords.push(newRecord(checked)); return next;
    }, { at:checked.createdAt, action:`candidate:${checked.id}:ingest` });
    return structuredClone(payload.candidateRecords.find((item) => item.candidate.id === checked.id));
  }
  get(id) { const record = this.read().candidateRecords.find((item) => item.candidate.id === id); return record ? structuredClone(record) : null; }
  update(record, at, action = 'update') {
    const payload = this.transact((next) => {
      const index = next.candidateRecords.findIndex((item) => item.candidate.id === record.candidate.id);
      if (index < 0 || record.candidate.projectId !== this.projectId) throw new Error('Unknown or cross-project learning record.');
      next.candidateRecords[index] = structuredClone(record); return next;
    }, { at, action:`candidate:${record.candidate.id}:${action}` });
    return structuredClone(payload.candidateRecords.find((item) => item.candidate.id === record.candidate.id));
  }
  activeKnowledge() { return this.read().knowledgeVersions.filter((item) => item.status === 'active').map((item) => structuredClone(item)); }
  commit(record, at) {
    const payload = this.transact((next) => {
      if (record.state !== 'verified' || record.candidate.projectId !== this.projectId) throw new Error('Only same-project verified records may enter knowledge.');
      const prior = next.knowledgeVersions.findLast((item) => item.status === 'active' && item.claim === record.candidate.claim && item.boundary === record.proof.experimentBoundary);
      const previous = prior?.version || null;
      if (prior) prior.status = 'superseded';
      const version = { version:next.knowledgeVersions.length + 1, projectId:this.projectId, candidateId:record.candidate.id, claim:record.candidate.claim, boundary:record.proof.experimentBoundary, proofSha256:sha(record.proof), previousVersion:previous, createdAt:at, status:'active' };
      next.knowledgeVersions.push(version); next.activeVersion = version.version; return next;
    }, { at, action:`candidate:${record.candidate.id}:knowledge-commit` });
    return structuredClone(payload.knowledgeVersions.find((item) => item.version === payload.activeVersion));
  }
  rollback(targetVersion, at, reason) {
    text(reason, 'rollback.reason');
    const payload = this.transact((next) => {
      const target = next.knowledgeVersions.find((item) => item.version === targetVersion);
      if (!target) throw new Error('Rollback target does not exist.');
      for (const item of next.knowledgeVersions) if (item.status === 'active' && item.claim === target.claim && item.boundary === target.boundary) item.status = 'rolled-back';
      target.status = 'active'; target.rollback = { at, reason }; next.activeVersion = targetVersion; return next;
    }, { at, action:`knowledge:${targetVersion}:rollback` });
    return structuredClone(payload.knowledgeVersions.find((item) => item.version === targetVersion));
  }
  retrieve({ boundary } = {}) {
    if (boundary !== undefined) text(boundary, 'retrieval.boundary');
    return this.activeKnowledge().filter((item) => !boundary || item.boundary === boundary);
  }
  readiness() {
    try { const payload = this.read(); return { ready:true, projectId:this.projectId, revision:payload.revision, candidates:payload.candidateRecords.length, activeKnowledge:payload.knowledgeVersions.filter((item) => item.status === 'active').length }; }
    catch (error) { return { ready:false, projectId:this.projectId, error:error.message }; }
  }
}

class AutonomousScientificLearner {
  constructor({ store, experimentExecutor, independentVerifier, now = () => new Date().toISOString() }) {
    if (!(store instanceof DurableScientificLearningStore)) throw new Error('Autonomous learning requires a durable store.');
    for (const [label, executor] of [['experimentExecutor', experimentExecutor], ['independentVerifier', independentVerifier]]) {
      if (!executor || typeof executor.id !== 'string' || !executor.id || typeof executor.run !== 'function') throw new Error(`${label} requires a stable id and run function.`);
    }
    if (experimentExecutor.id === independentVerifier.id) throw new Error('Independent verification must use a distinct executor identity.');
    this.store = store; this.experimentExecutor = experimentExecutor; this.independentVerifier = independentVerifier; this.now = now;
  }
  async process(candidateId, hypothesis) {
    text(candidateId, 'candidateId'); text(hypothesis, 'hypothesis');
    let record = this.store.get(candidateId); if (!record) throw new Error('Unknown candidate evidence.');
    if (['verified', 'quarantined', 'rejected'].includes(record.state)) return record;
    if (record.state === 'candidate') {
      record = transition(record, 'hypothesis', { at:this.now(), reason:'autonomous learner recorded a falsifiable hypothesis', hypothesis });
      record = this.store.update(record, this.now(), 'hypothesis');
    }
    if (record.hypothesis !== hypothesis) throw new Error('Resumed processing must use the persisted hypothesis.');
    if (record.state === 'hypothesis') {
      const result = await this.experimentExecutor.run(structuredClone({ candidate:record.candidate, hypothesis }));
      const experimentalProof = validateExperimentalProof(result);
      if (experimentalProof.candidateId !== record.candidate.id || experimentalProof.projectId !== this.store.projectId || experimentalProof.hypothesis !== hypothesis || experimentalProof.testedProperty !== record.candidate.claim || experimentalProof.experimentBoundary !== record.candidate.claimBoundary) throw new Error('Experiment proof identity, property, or boundary mismatch.');
      const gates = { ...record.gates, falsifiableHypothesis:true, controlledReproduction:true, controlTesting:true, negativeTesting:true, regressionTesting:true, deterministicScopeProof:true, claimBoundaryCheck:true, generalizationCheck:true };
      record = transition(record, 'experimented', { at:this.now(), reason:`controlled experiment completed by ${this.experimentExecutor.id}`, experimentalProof, gates });
      record = this.store.update(record, this.now(), 'experimented');
    }
    if (record.state === 'experimented') {
      record = transition(record, 'causally-proven', { at:this.now(), reason:'causal isolation proved by controlled intervention', gates:{ ...record.gates, causalIsolation:true } });
      record = this.store.update(record, this.now(), 'causally-proven');
    }
    if (record.state === 'causally-proven') {
      const verification = await this.independentVerifier.run(structuredClone({ candidate:record.candidate, hypothesis, experimentalProof:record.experimentalProof, experimentExecutorId:this.experimentExecutor.id }));
      if (verification?.verifierId === this.experimentExecutor.id || verification?.verifierId !== this.independentVerifier.id) throw new Error('Independent verifier identity mismatch.');
      record = transition(record, 'independently-verified', { at:this.now(), reason:`independent verification completed by ${this.independentVerifier.id}`, independentVerification:verification, gates:{ ...record.gates, independentVerification:true } });
      record = this.store.update(record, this.now(), 'independently-verified');
    }
    if (record.state === 'independently-verified') {
      const contradiction = detectContradiction(record, this.store.activeKnowledge());
      if (contradiction.detected) {
        record.candidate = Object.freeze({ ...record.candidate, classification:'Crucible Issue' });
        record = transition(record, 'quarantined', { at:this.now(), reason:`contradiction with knowledge version ${contradiction.conflictingVersion}` });
        return this.store.update(record, this.now(), 'contradiction-quarantine');
      }
      record = transition(record, 'verified', { at:this.now(), reason:'all mandatory gates independently satisfied', gates:{ ...record.gates, contradictionAnalysis:true } });
      record = this.store.update(record, this.now(), 'verified');
      this.store.commit(record, this.now());
    }
    return record;
  }
  readiness() {
    const store = this.store.readiness();
    return { ...store, ready:store.ready && this.experimentExecutor.id !== this.independentVerifier.id, experimentExecutor:this.experimentExecutor.id, independentVerifier:this.independentVerifier.id };
  }
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

module.exports = { STATES, CLASSIFICATIONS, REQUIRED_GATES, PROHIBITED_PROMOTION_KINDS, validateCandidate, validateProof, validateExperimentalProof, validateIndependentVerification, makeCandidate, newRecord, transition, CandidateEvidenceStore, VerifiedKnowledgeStore, DurableScientificLearningStore, AutonomousScientificLearner, detectContradiction, verifyOidcIdentity, deriveProjectKey, encryptWeeklyEnvelope, decryptWeeklyEnvelope, sha };
