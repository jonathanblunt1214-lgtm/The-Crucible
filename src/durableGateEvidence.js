'use strict';

// Hosted gate evidence that outlives an Actions cache, and never outlives its own code.
//
// R6, R7 and R8 all depend on state surviving between runs. R7 in particular needs a real
// promoted version to supersede, which it can only ever have if an earlier run's version is
// still there. That state used to persist only in an `actions/cache` entry, and GitHub evicts
// caches LRU against a repository quota and deletes any cache untouched for seven days. So the
// store could silently reset, R7 could never accumulate its prior version, and the gate read
// "pending live proof" for a storage reason that looked like a scientific one.
//
// This module is the record that replaces it, written to a durable state repository rather than
// a cache. It holds two things per gate: the outcome a run observed, and a fingerprint of the
// code that decided it.
//
// The fingerprint is the point. Evidence that outlives the implementation which produced it is
// worse than no evidence, because it reads as current. So each gate names the source files that
// decide it, the fingerprint is taken over those files' contents, and a recorded outcome whose
// fingerprint no longer matches is dropped to `unproven` with the moved files named. A gate
// cannot coast on a proof from before its own logic changed.
//
// GATE_DECIDERS is declared rather than inferred. Deriving "which files decide R7" from imports
// would quietly widen with every refactor, and a fingerprint that changes for unrelated reasons
// invalidates good evidence until somebody loosens it - which is how a ratchet dies. A reviewer
// can read this map and disagree with it; that is the intent.
//
// This module records and invalidates. It never promotes, never marks a gate passed, and never
// decides a gate itself - preSoakReadiness does that, and it reads the store rather than this.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// failureCodes lives in circulation, the wire rather than the cable, so looking a code up is
// not a new direct organ-to-organ connection.
const { crucibleError } = require('./failureCodes');

const GATES = Object.freeze(['R4', 'R5', 'R6', 'R7', 'R8']);

const GATE_DECIDERS = Object.freeze({
  R4: Object.freeze(['realCorpusLearning.js', 'pairedCorroboration.js', 'sourceIndependence.js']),
  R5: Object.freeze(['scientificLearning.js', 'hypothesisTestPlan.js', 'languageExperimentRegistry.js', 'scopePreRegistration.js']),
  R6: Object.freeze(['knowledgeLifecycle.js']),
  R7: Object.freeze(['realSupersession.js']),
  R8: Object.freeze(['realCorpusSafety.js']),
});

const STATES = Object.freeze(['satisfied', 'unsatisfied', 'unproven', 'manual-evidence-required', 'pending', 'unknown']);

function canonical(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw crucibleError('CRU-0049', `${label} must be non-empty text.`);
  return value;
}

// Taken over file contents rather than mtimes or a version string, because content is the only
// thing that actually decides behaviour. A missing decider is an error and not an empty hash: a
// gate whose implementation has been deleted or renamed must be noticed, not fingerprinted as
// though it were unchanged.
function gateFingerprint(gateId, sourceRoot) {
  const deciders = GATE_DECIDERS[gateId];
  if (!deciders) throw crucibleError('CRU-0049', `No decider files are declared for gate ${gateId}. Declared gates are ${GATES.join(', ')}.`);
  const parts = deciders.map((name) => {
    const file = path.join(path.resolve(sourceRoot), name);
    if (!fs.existsSync(file)) throw crucibleError('CRU-0049', `Gate ${gateId} declares decider ${name}, which does not exist under ${sourceRoot}. A renamed or deleted decider must be reconciled rather than fingerprinted around.`);
    return { name, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  });
  return { gateId, deciders: parts, fingerprint: hash(parts) };
}

function allFingerprints(sourceRoot) {
  return Object.fromEntries(GATES.map((gate) => [gate, gateFingerprint(gate, sourceRoot)]));
}

function emptyEvidence(projectId) {
  return { schemaVersion: 1, projectId, revision: 0, gates: {}, history: [] };
}

class DurableGateEvidenceStore {
  constructor({ root, projectId }) {
    this.root = path.resolve(text(root, 'root'));
    this.projectId = text(projectId, 'projectId');
    this.file = path.join(this.root, 'gate-evidence.json');
    fs.mkdirSync(this.root, { recursive: true });
  }

  read() {
    if (!fs.existsSync(this.file)) return emptyEvidence(this.projectId);
    const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (envelope?.sha256 !== hash(envelope.payload) || envelope.payload?.schemaVersion !== 1 || envelope.payload.projectId !== this.projectId || !envelope.payload.gates || typeof envelope.payload.gates !== 'object') {
      throw crucibleError('CRU-0049', 'Durable gate-evidence integrity or project binding failed.');
    }
    return structuredClone(envelope.payload);
  }

  write(payload) {
    payload.revision += 1;
    const envelope = { payload, sha256: hash(payload) };
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, this.file);
    return structuredClone(payload);
  }

  // Records what a run observed, bound to the fingerprint of the code that observed it.
  record({ gateStates, sourceRoot, runId, at }) {
    if (!Array.isArray(gateStates)) throw crucibleError('CRU-0049', 'Gate states must be an array as the readiness reporter returns them.');
    const fingerprints = allFingerprints(sourceRoot);
    const payload = this.read();
    for (const gate of gateStates) {
      const id = text(gate?.id, 'gate.id');
      if (!GATES.includes(id)) continue;
      if (!STATES.includes(gate.state)) throw crucibleError('CRU-0049', `Gate ${id} reported state "${gate.state}", which is not one of ${STATES.join(', ')}.`);
      payload.gates[id] = {
        state: gate.state,
        detail: gate.detail || null,
        fingerprint: fingerprints[id].fingerprint,
        deciders: fingerprints[id].deciders,
        observedAt: at,
        runId: String(runId),
      };
    }
    return this.write(payload);
  }
}

// Drops any recorded gate whose deciders have changed since it was recorded, naming the files
// that moved. Returns the surviving evidence and the invalidations, so a run can say which
// gates lost their proof and why rather than quietly showing fewer.
function invalidateStaleGates(payload, sourceRoot, at) {
  const kept = {};
  const invalidated = [];
  for (const [id, entry] of Object.entries(payload.gates || {})) {
    if (!GATES.includes(id)) continue;
    const current = gateFingerprint(id, sourceRoot);
    if (entry.fingerprint === current.fingerprint) { kept[id] = entry; continue; }
    const before = new Map((entry.deciders || []).map((item) => [item.name, item.sha256]));
    const moved = current.deciders.filter((item) => before.get(item.name) !== item.sha256).map((item) => item.name);
    const missing = [...before.keys()].filter((name) => !current.deciders.some((item) => item.name === name));
    invalidated.push({
      gateId: id,
      priorState: entry.state,
      priorFingerprint: entry.fingerprint,
      fingerprint: current.fingerprint,
      changedDeciders: moved,
      removedDeciders: missing,
      state: 'unproven',
      invalidatedAt: at,
      reason: `evidence for ${id} was recorded at fingerprint ${entry.fingerprint} and the deciding implementation has changed since: ${[...moved, ...missing.map((name) => `${name} (no longer declared)`)].join(', ')}. The recorded outcome is dropped to unproven rather than carried forward, because a proof cannot survive the code that produced it`,
    });
  }
  return { gates: kept, invalidated, authorizesPromotion: false };
}

module.exports = { GATES, GATE_DECIDERS, STATES, gateFingerprint, allFingerprints, DurableGateEvidenceStore, invalidateStaleGates };
