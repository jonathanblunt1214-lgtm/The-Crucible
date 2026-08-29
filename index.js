'use strict';

const PLUGIN_ID = 'the-crucible';
const PLUGIN_NAME = 'The Crucible';
const VERSION = '0.1.0';
const GOVERNANCE_ROOT = 'governingDocuments';
const REFERENCE_MANIFEST = `${GOVERNANCE_ROOT}/CRUCIBLE-REFERENCES.json`;
const BRANCH_LINK_MANIFEST = `${GOVERNANCE_ROOT}/BRANCH-LINKS.json`;
const CANONICAL_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';
const CANONICAL_BRANCH = 'main';
const LEARNING_ROOT = `${GOVERNANCE_ROOT}/.crucible-learning`;
const LEARNING_STATES = Object.freeze(['candidate', 'hypothesis', 'experimented', 'causally-proven', 'independently-verified', 'verified', 'quarantined', 'rejected']);
const REQUIRED_LEARNING_GATES = Object.freeze(['falsifiableHypothesis', 'controlledReproduction', 'causalIsolation', 'controlTesting', 'independentVerification', 'negativeTesting', 'regressionTesting', 'deterministicScopeProof', 'claimBoundaryCheck', 'generalizationCheck', 'contradictionAnalysis']);
const PROHIBITED_PROMOTION_KINDS = Object.freeze(['raw-telemetry', 'correlation', 'one-off-repair', 'repeated-observation', 'model-guess', 'incomplete-observation', 'untested-hypothesis', 'retrieval']);
const CANDIDATE_KEYS = Object.freeze(['schemaVersion', 'id', 'projectId', 'claim', 'claimBoundary', 'generalizationBoundary', 'kind', 'provenance', 'createdAt']);
const PROVENANCE_KEYS = Object.freeze(['sourceType', 'sourceId', 'retrievedAt', 'author', 'license', 'contentSha256']);

const CANONICAL_DOCUMENTS = Object.freeze([
  'AGENTS.md',
  'README.md',
  'templates/ai-conflict-resolution.md',
  'templates/required-check-rollout.md',
  'templates/agent-boundaries.md',
  'governingDocuments/branch-linking-policy.md',
  'governingDocuments/scientific-learning-policy.md',
  'governingDocuments/BRANCH-LINKS.json',
  'governingDocuments/templates/injection-prerequisites.md',
  'governingDocuments/templates/injection-monitoring.md',
  'governingDocuments/templates/injection-monitor-task.md',
  'governingDocuments/templates/injection-native-validation.md',
  'governingDocuments/templates/injection-credential-scope.md',
  'governingDocuments/templates/INJECTION-PREREQUISITES.example.json'
]);

function canonicalUrl(path) {
  return `https://github.com/${CANONICAL_REPOSITORY}/blob/${CANONICAL_BRANCH}/${path}`;
}

function canonicalReferenceManifest() {
  return {
    schemaVersion: 1,
    source: {
      repository: CANONICAL_REPOSITORY,
      branch: CANONICAL_BRANCH,
      policy: 'reference-shared-content-from-default-branch'
    },
    documents: CANONICAL_DOCUMENTS.map((path) => ({ path, url: canonicalUrl(path) })),
    localOverlayRoot: GOVERNANCE_ROOT,
    branchLinkManifest: BRANCH_LINK_MANIFEST,
    note: 'Shared Crucible governance is referenced from the default branch. Branch relationships are project data, not inferred from example names.'
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function requireObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function requireExactKeys(value, allowed, label) {
  requireObject(value, label);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contains unknown field(s): ${extras.join(', ')}.`);
}
function requireText(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`); return value.trim(); }
function requireIso(value, label) { requireText(value, label); if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`); }
function requireDigest(value, label) { if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} must be a lowercase SHA-256 digest.`); }
function requireProjectId(value) { const id = requireText(value, 'projectId'); if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw new Error('projectId must use only letters, digits, dot, underscore, or hyphen.'); return id; }
function requireTextArray(value, label) { if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be a non-empty text array.`); }
function learningPath(projectId, name) { return `${LEARNING_ROOT}/${requireProjectId(projectId)}/${name}.json`; }

function validateLearningCandidate(value) {
  requireExactKeys(value, CANDIDATE_KEYS, 'candidate');
  if (value.schemaVersion !== 1) throw new Error('candidate.schemaVersion must be 1.');
  for (const key of ['id', 'projectId', 'claim', 'claimBoundary', 'generalizationBoundary', 'kind']) requireText(value[key], `candidate.${key}`);
  requireProjectId(value.projectId);
  requireExactKeys(value.provenance, PROVENANCE_KEYS, 'candidate.provenance');
  for (const key of ['sourceType', 'sourceId', 'author', 'license']) requireText(value.provenance[key], `candidate.provenance.${key}`);
  requireIso(value.provenance.retrievedAt, 'candidate.provenance.retrievedAt');
  requireDigest(value.provenance.contentSha256, 'candidate.provenance.contentSha256');
  requireIso(value.createdAt, 'candidate.createdAt');
  return clone({ ...value, classification: 'Insufficient Evidence' });
}

function emptyGates() { return Object.fromEntries(REQUIRED_LEARNING_GATES.map((gate) => [gate, false])); }
function appendHistory(record, to, at, reason) {
  requireIso(at, 'transition.at'); requireText(reason, 'transition.reason');
  record.history.push({ from: record.state, to, at, reason }); record.state = to;
}
function requireState(record, expected, action) { if (record.state !== expected) throw new Error(`${action} requires ${expected} state; found ${record.state}.`); }
function validateExperiment(value, candidate) {
  const keys = ['hypothesis', 'testedProperty', 'experimentBoundary', 'controls', 'causalIsolation', 'negativeTests', 'regressionTests', 'scopeProof', 'generalizationResult', 'contradictionResult', 'completedAt'];
  requireExactKeys(value, keys, 'experiment');
  for (const key of ['hypothesis', 'testedProperty', 'experimentBoundary', 'scopeProof', 'generalizationResult', 'contradictionResult']) requireText(value[key], `experiment.${key}`);
  for (const key of ['controls', 'negativeTests', 'regressionTests']) requireTextArray(value[key], `experiment.${key}`);
  requireExactKeys(value.causalIsolation, ['method', 'result', 'correlationOnly'], 'experiment.causalIsolation');
  requireText(value.causalIsolation.method, 'experiment.causalIsolation.method'); requireText(value.causalIsolation.result, 'experiment.causalIsolation.result');
  if (value.causalIsolation.correlationOnly !== false) throw new Error('Correlation never satisfies causation.');
  requireIso(value.completedAt, 'experiment.completedAt');
  if (value.testedProperty !== candidate.claim) throw new Error('An experiment may test only the candidate claim.');
  if (value.experimentBoundary !== candidate.claimBoundary) throw new Error('Experimental results inherit the candidate claim boundary.');
  return clone(value);
}

async function readJsonOr(path, fallback) {
  try { return JSON.parse(await readWorkspaceText(path)); }
  catch (error) { if (/not found/i.test(String(error?.message || ''))) return clone(fallback); throw error; }
}
async function writeJson(path, value) {
  return nexus.call('workspace:write', { operation: 'write', overwrite: true, files: [{ path, content: `${JSON.stringify(value, null, 2)}\n`, encoding: 'utf-8' }] });
}
async function loadLearning(projectId) {
  const id = requireProjectId(projectId);
  const candidates = await readJsonOr(learningPath(id, 'candidates'), { schemaVersion: 1, projectId: id, revision: 0, records: [] });
  const knowledge = await readJsonOr(learningPath(id, 'verified-knowledge'), { schemaVersion: 1, projectId: id, revision: 0, activeVersion: null, versions: [] });
  if (candidates.schemaVersion !== 1 || candidates.projectId !== id || !Array.isArray(candidates.records)) throw new Error('Candidate store identity or schema is invalid.');
  if (knowledge.schemaVersion !== 1 || knowledge.projectId !== id || !Array.isArray(knowledge.versions)) throw new Error('Verified-knowledge store identity or schema is invalid.');
  return { candidates, knowledge };
}
function findRecord(store, candidateId) { const record = store.records.find((item) => item.candidate.id === candidateId); if (!record) throw new Error('Candidate record does not exist in this project.'); return record; }
async function saveCandidates(store) { store.revision += 1; await writeJson(learningPath(store.projectId, 'candidates'), store); }
async function saveKnowledge(store) { store.revision += 1; await writeJson(learningPath(store.projectId, 'verified-knowledge'), store); }
function learningTelemetry(actionId, projectId, state) { nexus.emitTelemetry('crucible.learning.action', { version: VERSION, actionId, projectId, state, evidentiary: false }); }

async function learningAction(payload) {
  const projectId = requireProjectId(payload.projectId ?? payload.candidate?.projectId);
  const { candidates, knowledge } = await loadLearning(projectId);
  if (payload.actionId === 'crucible-learning-ingest') {
    const candidate = validateLearningCandidate(payload.candidate);
    if (candidate.projectId !== projectId) throw new Error('Cross-project candidate evidence is forbidden.');
    if (candidates.records.some((item) => item.candidate.id === candidate.id)) throw new Error('Candidate id already exists.');
    const record = { schemaVersion: 1, candidate, state: 'candidate', gates: emptyGates(), experiment: null, independentVerification: null, proofSha256: null, history: [{ from: null, to: 'candidate', at: candidate.createdAt, reason: 'strictly validated candidate evidence ingested' }] };
    candidates.records.push(record); await saveCandidates(candidates); learningTelemetry(payload.actionId, projectId, record.state); return { ok: true, record: clone(record) };
  }
  if (payload.actionId === 'crucible-learning-retrieve') return { ok: true, projectId, candidates: clone(candidates.records), knowledge: clone(knowledge) };
  if (payload.actionId === 'crucible-learning-rollback') {
    requireIso(payload.at, 'rollback.at'); requireText(payload.reason, 'rollback.reason');
    if (!Number.isInteger(payload.targetVersion) || payload.targetVersion < 1) throw new Error('rollback.targetVersion must be a positive integer.');
    const target = knowledge.versions.find((item) => item.version === payload.targetVersion); if (!target) throw new Error('Rollback target does not exist.');
    for (const item of knowledge.versions) if (item.status === 'active') item.status = 'rolled-back';
    target.status = 'active'; target.rollback = { at: payload.at, reason: payload.reason }; knowledge.activeVersion = target.version;
    await saveKnowledge(knowledge); learningTelemetry(payload.actionId, projectId, 'rolled-back'); return { ok: true, knowledge: clone(knowledge) };
  }
  const record = findRecord(candidates, requireText(payload.candidateId, 'candidateId'));
  if (payload.actionId === 'crucible-learning-hypothesis') {
    requireState(record, 'candidate', 'hypothesis declaration'); requireText(payload.hypothesis, 'hypothesis'); requireIso(payload.at, 'transition.at');
    record.hypothesis = payload.hypothesis.trim(); record.gates.falsifiableHypothesis = true; appendHistory(record, 'hypothesis', payload.at, 'falsifiable hypothesis declared separately from experiment evidence');
  } else if (payload.actionId === 'crucible-learning-experiment') {
    requireState(record, 'hypothesis', 'experiment recording'); const experiment = validateExperiment(payload.experiment, record.candidate);
    if (experiment.hypothesis !== record.hypothesis) throw new Error('Experiment hypothesis must match the separately declared hypothesis.');
    record.experiment = experiment;
    for (const gate of ['controlledReproduction', 'controlTesting', 'negativeTesting', 'regressionTesting', 'deterministicScopeProof', 'claimBoundaryCheck', 'generalizationCheck', 'contradictionAnalysis']) record.gates[gate] = true;
    appendHistory(record, 'experimented', experiment.completedAt, 'controlled experiment recorded; later proof stages remain unsatisfied');
  } else if (payload.actionId === 'crucible-learning-causal-confirm') {
    requireState(record, 'experimented', 'causal confirmation'); if (!record.experiment || record.experiment.causalIsolation.correlationOnly !== false) throw new Error('Causal isolation proof is required.');
    requireIso(payload.at, 'transition.at'); record.gates.causalIsolation = true; appendHistory(record, 'causally-proven', payload.at, 'causal isolation independently confirmed from experiment record');
  } else if (payload.actionId === 'crucible-learning-independent-verify') {
    requireState(record, 'causally-proven', 'independent verification'); const verification = payload.verification;
    requireExactKeys(verification, ['verifierId', 'independent', 'testedProperty', 'experimentBoundary', 'result', 'verifiedAt', 'proofSha256'], 'verification');
    requireText(verification.verifierId, 'verification.verifierId'); if (verification.independent !== true) throw new Error('Independent verification is required.');
    if (verification.verifierId === record.candidate.provenance.author || verification.verifierId === record.candidate.provenance.sourceId) throw new Error('Verifier is not independent from candidate provenance.');
    if (verification.testedProperty !== record.candidate.claim) throw new Error('Verification proves only the tested property.');
    if (verification.experimentBoundary !== record.candidate.claimBoundary) throw new Error('Experimental results inherit experiment boundaries.');
    if (verification.result !== 'passed') throw new Error('Independent verification must pass.'); requireIso(verification.verifiedAt, 'verification.verifiedAt'); requireDigest(verification.proofSha256, 'verification.proofSha256');
    record.independentVerification = clone(verification); record.proofSha256 = verification.proofSha256; record.gates.independentVerification = true; appendHistory(record, 'independently-verified', verification.verifiedAt, 'separate independent verification passed');
  } else if (payload.actionId === 'crucible-learning-promote') {
    requireState(record, 'independently-verified', 'verified promotion'); requireIso(payload.at, 'transition.at');
    if (PROHIBITED_PROMOTION_KINDS.includes(record.candidate.kind)) throw new Error(`${record.candidate.kind} can never be promoted.`);
    const missing = REQUIRED_LEARNING_GATES.filter((gate) => record.gates[gate] !== true); if (missing.length) throw new Error(`Verified promotion is fail-closed; missing gate(s): ${missing.join(', ')}.`);
    if (record.experiment.contradictionResult !== 'none') throw new Error('Contradictions require quarantine.');
    const conflict = knowledge.versions.find((item) => item.status === 'active' && item.boundary === record.candidate.claimBoundary && item.claim !== record.candidate.claim);
    if (conflict) {
      record.candidate.classification = 'Crucible Issue'; record.contradiction = { conflictingVersion: conflict.version };
      appendHistory(record, 'quarantined', payload.at, 'contradiction with active verified knowledge detected');
      await saveCandidates(candidates); learningTelemetry(payload.actionId, projectId, record.state); return { ok: false, quarantined: true, record: clone(record), knowledge: clone(knowledge) };
    }
    appendHistory(record, 'verified', payload.at, 'all mandatory scientific proof gates passed');
    const previousVersion = knowledge.activeVersion; if (previousVersion) knowledge.versions.find((item) => item.version === previousVersion).status = 'superseded';
    const version = { version: knowledge.versions.length + 1, projectId, candidateId: record.candidate.id, claim: record.candidate.claim, boundary: record.experiment.experimentBoundary, proofSha256: record.proofSha256, previousVersion, createdAt: payload.at, status: 'active' };
    knowledge.versions.push(version); knowledge.activeVersion = version.version; await saveKnowledge(knowledge);
  } else if (payload.actionId === 'crucible-learning-quarantine' || payload.actionId === 'crucible-learning-reject') {
    if (['verified', 'quarantined', 'rejected'].includes(record.state)) throw new Error(`Cannot ${payload.actionId} a terminal learning record.`);
    requireIso(payload.at, 'transition.at'); requireText(payload.reason, 'transition.reason'); const to = payload.actionId.endsWith('quarantine') ? 'quarantined' : 'rejected'; record.candidate.classification = to === 'quarantined' ? 'Crucible Issue' : 'Rejected Evidence'; appendHistory(record, to, payload.at, payload.reason);
  } else throw new Error(`Unknown learning action: ${payload.actionId}`);
  await saveCandidates(candidates); learningTelemetry(payload.actionId, projectId, record.state); return { ok: true, record: clone(record), knowledge: clone(knowledge) };
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isGovernancePath(value) {
  const normalized = normalizePath(value);
  if (!normalized.startsWith(`${GOVERNANCE_ROOT}/`)) return false;
  const relative = normalized.slice(GOVERNANCE_ROOT.length + 1);
  return Boolean(relative) && !relative.split('/').some((part) => !part || part === '.' || part === '..');
}

function requireGovernancePath(value) {
  const normalized = normalizePath(value);
  if (!isGovernancePath(normalized)) throw new Error('Governance operations are restricted to files inside governingDocuments/.');
  return normalized;
}

function normalizeBranchName(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty branch name.`);
  return value.trim();
}

function normalizeRequiredPaths(link) {
  const raw = link.requiredPaths ?? link.requiredMainPaths ?? [];
  if (!Array.isArray(raw)) throw new Error('canonical-reference required paths must be an array.');
  return raw.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error('canonical-reference required paths must be non-empty strings.');
    return normalizePath(item);
  });
}

function classifyBranchLinks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('BRANCH-LINKS.json must contain an object.');
  if (raw.schemaVersion !== 1) throw new Error('BRANCH-LINKS.json schemaVersion must be 1.');
  if (!Array.isArray(raw.links)) throw new Error('BRANCH-LINKS.json links must be an array.');

  const canonicalReferences = [];
  const pairedRelationships = [];
  for (const link of raw.links) {
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error('BRANCH-LINKS.json link entries must be objects.');
    const relationship = link.relationship || link.type;
    if (relationship === 'canonical-reference') {
      const sourceBranch = normalizeBranchName(link.branch ?? link.sourceBranch, 'canonical-reference source branch');
      const targetBranch = normalizeBranchName(link.dependsOn ?? link.targetBranch ?? raw.canonicalBranch, 'canonical-reference target branch');
      canonicalReferences.push({
        relationship: 'canonical-reference',
        sourceBranch,
        targetBranch,
        requiredPaths: normalizeRequiredPaths(link),
        automaticRepair: link.automaticRepair || null
      });
      continue;
    }
    if (relationship === 'paired' || relationship === 'lifecycle-pair') {
      const rawBranches = link.branches || [link.branch, link.pairedWith].filter(Boolean);
      if (!Array.isArray(rawBranches) || rawBranches.length < 2) throw new Error('paired relationship must declare at least two branches.');
      const branches = rawBranches.map((entry, index) => {
        if (typeof entry === 'string') return { branch: normalizeBranchName(entry, `paired branch ${index + 1}`), role: null };
        if (!entry || typeof entry !== 'object') throw new Error('paired relationship branch entries must be strings or objects.');
        return { branch: normalizeBranchName(entry.branch ?? entry.name, `paired branch ${index + 1}`), role: typeof entry.role === 'string' ? entry.role : null };
      });
      pairedRelationships.push({ relationship: 'paired', branches });
      continue;
    }
    throw new Error(`Unsupported branch relationship: ${String(relationship)}`);
  }
  return { schemaVersion: 1, canonicalReferences, pairedRelationships };
}

function action(id, label, description, extra = {}) {
  return Object.freeze({ id, label, description, ...extra });
}

async function listLocalGovernance() {
  const result = await nexus.call('workspace:read', { operation: 'list', path: GOVERNANCE_ROOT, recursive: true, textOnly: true });
  return (result?.files || [])
    .map((item) => typeof item === 'string' ? item : item.path)
    .filter((item) => isGovernancePath(item))
    .sort();
}

async function readWorkspaceText(path) {
  const result = await nexus.call('workspace:read', { operation: 'read', path, encoding: 'utf-8' });
  return String(result?.content || '');
}

async function readBranchRelationships() {
  try {
    const parsed = JSON.parse(await readWorkspaceText(BRANCH_LINK_MANIFEST));
    return { ok: true, declared: true, manifestPath: BRANCH_LINK_MANIFEST, ...classifyBranchLinks(parsed) };
  } catch (error) {
    if (/not found/i.test(String(error?.message || ''))) {
      return { ok: true, declared: false, manifestPath: BRANCH_LINK_MANIFEST, schemaVersion: 1, canonicalReferences: [], pairedRelationships: [] };
    }
    return { ok: false, declared: true, manifestPath: BRANCH_LINK_MANIFEST, error: String(error?.message || error) };
  }
}

async function readLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  return { ok: true, path, content: await readWorkspaceText(path) };
}

async function writeLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  if (path === REFERENCE_MANIFEST && payload.allowReferenceManifestEdit !== true) {
    throw new Error('CRUCIBLE-REFERENCES.json is managed by Auto Inject. Use explicit reference-manifest override only when intentionally replacing canonical references.');
  }
  if (typeof payload.content !== 'string') throw new Error('Governance content must be text.');
  const result = await nexus.call('workspace:write', {
    operation: 'write',
    overwrite: payload.overwrite === true,
    files: [{ path, content: payload.content, encoding: 'utf-8' }]
  });
  nexus.emitTelemetry('crucible.governance.write', { version: VERSION, path, overwrite: payload.overwrite === true });
  return { ok: true, path, result };
}

async function deleteLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  if (payload.confirmed !== true) return { ok: false, requiresConfirmation: true, path };
  const result = await nexus.call('workspace:write', { operation: 'delete', paths: [path] });
  nexus.emitTelemetry('crucible.governance.delete', { version: VERSION, path });
  return { ok: true, path, result };
}

async function moveLocalGovernance(payload) {
  const from = requireGovernancePath(payload.from);
  const to = requireGovernancePath(payload.to);
  if (payload.confirmed !== true) return { ok: false, requiresConfirmation: true, from, to };
  const result = await nexus.call('workspace:write', {
    operation: 'move',
    overwrite: payload.overwrite === true,
    moves: [{ from, to }]
  });
  nexus.emitTelemetry('crucible.governance.move', { version: VERSION, from, to, overwrite: payload.overwrite === true });
  return { ok: true, from, to, result };
}

async function previewAutoInject() {
  let exists = false;
  try { await readWorkspaceText(REFERENCE_MANIFEST); exists = true; } catch (_) {}
  return {
    ok: true,
    selectedByDefault: false,
    requiresConfirmation: true,
    writes: [{ path: REFERENCE_MANIFEST, exists, defaultOverwrite: false }],
    canonicalDocuments: canonicalReferenceManifest().documents,
    branchRelationshipRule: 'Project-specific branch names and dependency paths come from governingDocuments/BRANCH-LINKS.json; examples are never treated as naming rules.'
  };
}

async function autoInject(payload) {
  if (payload.selected !== true || payload.confirmed !== true) {
    return { ok: false, requiresSelection: true, requiresConfirmation: true, message: 'Auto Inject is off by default and requires explicit selection plus confirmation.' };
  }
  const manifest = `${JSON.stringify(canonicalReferenceManifest(), null, 2)}\n`;
  const result = await nexus.call('workspace:write', {
    operation: 'write',
    overwrite: payload.overwrite === true,
    files: [{ path: REFERENCE_MANIFEST, content: manifest, encoding: 'utf-8' }]
  });
  nexus.emitTelemetry('crucible.plugin.auto-injected', { version: VERSION, referenceCount: CANONICAL_DOCUMENTS.length });
  return {
    ok: true,
    written: [REFERENCE_MANIFEST],
    canonicalRepository: CANONICAL_REPOSITORY,
    canonicalBranch: CANONICAL_BRANCH,
    branchLinkManifest: BRANCH_LINK_MANIFEST,
    message: 'The Crucible reference manifest was installed. Branch relationships remain project-specific and are read from governingDocuments/BRANCH-LINKS.json when present.',
    result
  };
}

async function projectAction(payload = {}) {
  if (typeof payload.actionId === 'string' && payload.actionId.startsWith('crucible-learning-')) return learningAction(payload);
  switch (payload.actionId) {
    case 'crucible-auto-inject-preview': return previewAutoInject();
    case 'crucible-auto-inject': return autoInject(payload);
    case 'crucible-branch-links-read': return readBranchRelationships();
    case 'crucible-governance-list': return { ok: true, localFiles: await listLocalGovernance(), canonical: canonicalReferenceManifest().documents };
    case 'crucible-governance-read': return readLocalGovernance(payload);
    case 'crucible-governance-write': return writeLocalGovernance(payload);
    case 'crucible-governance-delete': return deleteLocalGovernance(payload);
    case 'crucible-governance-move': return moveLocalGovernance(payload);
    default:
      return {
        plugin: PLUGIN_NAME,
        pluginId: PLUGIN_ID,
        version: VERSION,
        canonicalSource: { repository: CANONICAL_REPOSITORY, branch: CANONICAL_BRANCH },
        configuration: {
          type: 'governance-reference-and-overlay',
          referenceManifest: REFERENCE_MANIFEST,
          branchLinkManifest: BRANCH_LINK_MANIFEST,
          branchRelationshipTypes: ['canonical-reference', 'paired'],
          branchNamesAreProjectData: true,
          sharedDocumentsAreReadOnlyReferences: true,
          localOverlayRoot: GOVERNANCE_ROOT,
          localOperations: ['list', 'read', 'create', 'update', 'move', 'delete'],
          destructiveOperationsRequireConfirmation: true
          ,scientificLearning: {
            enabled: true,
            storageRoot: LEARNING_ROOT,
            projectIsolated: true,
            telemetryIsEvidence: false,
            prohibitedDirectPromotionKinds: PROHIBITED_PROMOTION_KINDS,
            requiredGates: REQUIRED_LEARNING_GATES,
            weeklyTransport: 'unavailable-until-host-provides-trusted-cryptography-and-oidc'
          }
        },
        actions: [
          action('crucible-auto-inject', 'Auto Inject The Crucible', 'Install canonical references after explicit confirmation.', { selectable: true, selectedByDefault: false, requiresConfirmation: true }),
          action('crucible-branch-links-read', 'Inspect branch relationships', 'Identify project-declared paired and canonical-reference relationships without relying on example branch names.'),
          action('crucible-configure-governance', 'Configure project governance', 'Manage project-specific governance overlays without copying canonical Crucible policy files.', { opensConfiguration: true }),
          action('crucible-open-canonical', 'Open canonical Crucible governance', 'Use the default Crucible branch as the shared source of truth.', { references: canonicalReferenceManifest().documents })
          ,action('crucible-learning-ingest', 'Learning: Ingest candidate evidence', 'Validate and store project-isolated candidate evidence as Insufficient Evidence.')
          ,action('crucible-learning-hypothesis', 'Learning: Declare hypothesis', 'Declare a falsifiable hypothesis without satisfying any experiment or proof stage.')
          ,action('crucible-learning-experiment', 'Learning: Record controlled experiment', 'Record bounded controlled experiment evidence; later causal and verification stages remain separate.')
          ,action('crucible-learning-causal-confirm', 'Learning: Confirm causal isolation', 'Confirm causal isolation; correlation is never accepted as causation.')
          ,action('crucible-learning-independent-verify', 'Learning: Independently verify', 'Record a separate independent verifier result for exactly the tested property and boundary.')
          ,action('crucible-learning-promote', 'Learning: Promote verified knowledge', 'Promote only after every mandatory gate passes; fail closed otherwise.')
          ,action('crucible-learning-retrieve', 'Learning: Retrieve project knowledge', 'Retrieve isolated candidates and versioned verified knowledge; retrieval is not proof.')
          ,action('crucible-learning-rollback', 'Learning: Roll back knowledge', 'Restore a prior verified-knowledge version with a timestamped reason.')
        ]
      };
  }
}

register({
  onActivate() { nexus.emitTelemetry('crucible.plugin.activated', { version: VERSION }); },
  onDeactivate() { nexus.emitTelemetry('crucible.plugin.deactivated', { version: VERSION }); },
  slots: {
    'project-actions': projectAction,
    'inspector-panel': async () => ({
      title: PLUGIN_NAME,
      pluginId: PLUGIN_ID,
      version: VERSION,
      canonicalSource: { repository: CANONICAL_REPOSITORY, branch: CANONICAL_BRANCH },
      referenceManifest: REFERENCE_MANIFEST,
      branchLinkManifest: BRANCH_LINK_MANIFEST,
      branchRelationships: await readBranchRelationships(),
      localGovernanceFiles: await listLocalGovernance().catch(() => []),
      canonicalDocuments: canonicalReferenceManifest().documents,
      autoInject: { selectedByDefault: false, requiresConfirmation: true }
      ,scientificLearning: { enabled: true, storageRoot: LEARNING_ROOT, telemetryIsEvidence: false, weeklyTransport: 'host-cryptography-and-oidc-required' }
    }),
    'command-palette': async () => ({
      commands: [
        action('crucible.inject', 'Crucible: Auto Inject references', 'Install the reference manifest after explicit confirmation.', { selectable: true, selectedByDefault: false }),
        action('crucible.links', 'Crucible: Inspect branch relationships', 'Read project-specific branch-link governance without assuming naming conventions.'),
        action('crucible.configure', 'Crucible: Configure local governance', 'Manage project-specific governance overlays.'),
        action('crucible.canonical', 'Crucible: Open canonical governance', 'Open shared governance from the default Crucible branch.', { references: canonicalReferenceManifest().documents })
        ,action('crucible.learning', 'Crucible: Scientific learning', 'Open project-isolated candidate, experiment, verification, promotion, and knowledge retrieval actions.')
      ]
    })
  }
});
