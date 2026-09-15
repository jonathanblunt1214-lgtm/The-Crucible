'use strict';

// A scope declaration is the hypothesis, so it has to be pre-registered like one.
//
// Nothing in this pipeline writes a hypothesis by hand. `languageExperimentRegistry` builds it
// as `Within ${claimBoundary}, controlled execution will show that ${claim}` - a template over
// the declared scope and the claim - and `hypothesisTestPlan` then holds the experiment to
// `experimentBoundary`, which is the owner's declared `claimScope` whenever one exists. Every
// falsifiable commitment in the hypothesis therefore comes from the declaration. The declaration
// is not configuration for the hypothesis; it is the hypothesis.
//
// `hypothesisTestPlanSha256` already freezes the plan, so the scope's value does sit inside a
// hash. What was missing is that the hash is computed during the run, after the declaration has
// been read. Nothing recorded what the boundary was *before* the result was known, so a boundary
// could be narrowed after a failed experiment and the next run would look identical to a run
// that had always used the narrower one. R5 asks for a hash-bound pre-result plan; that held
// within a run and not across runs, which is the half that matters, because the run is where the
// result appears.
//
// This ledger closes that. The first run to see a declaration records its content hash against
// the run's own clock. Later runs compare. A declaration whose hash changed after a run in which
// that claim was actually evaluated and not verified is refused, because after the fact that is
// indistinguishable from narrowing the boundary until the claim stopped failing.
//
// Three deliberate limits on that rule.
//
// The timestamp lives here rather than in the declaration file. A `declaredAt` the owner types
// is documentation that cannot be enforced - a text editor can backdate it - and a field that
// looks like evidence without being evidence is worse than no field at all. What cannot be
// forged from the declaration file is that a run saw a hash and wrote it down.
//
// A claim that was never evaluated is not protected, and must not be. A declaration the corpus
// could not pair, or one that no corroborated claim matched, never reached an experiment, so
// changing it is ordinary correction rather than narrowing-after-failure. Only `not-verified` -
// an experiment that ran and did not promote - arms the refusal.
//
// A claim that was verified is not blocked either. The knowledge version keeps the boundary it
// was actually verified at; re-declaring a different boundary is a new experiment, which is
// legitimate. The change is recorded and the prior registration is kept in history rather than
// overwritten, so the sequence stays auditable.
//
// This module decides whether a declaration may be evaluated. It never promotes anything, never
// marks a gate passed, and never edits a declaration.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// failureCodes lives in circulation, which is the wire rather than the cable: looking a code up
// is not a new direct organ-to-organ connection.
const { crucibleError } = require('./failureCodes');

// The substantive content of a pre-registration: what is claimed, where it is claimed to hold,
// where it explicitly does not, which language harness tests it, and which two sources are
// nominated as asserting it. Commentary fields and anything a future schema adds are excluded by
// construction, so a documentation edit is not a boundary change.
const PRE_REGISTERED_FIELDS = Object.freeze(['claim', 'claimScope', 'generalizationBoundary', 'language', 'pairedSources', 'pairedAssertions']);

const OUTCOMES = Object.freeze(['pending', 'verified', 'not-verified']);

function canonical(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}

function hash(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw crucibleError('CRU-0048', `${label} must be non-empty text.`);
  return value;
}

// Whitespace is normalized before hashing so that reflowing a long boundary across lines is not
// recorded as having moved it. Nothing else is normalized: case and wording are meaning here.
function normalizeText(value) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value; }

function preRegisteredContent(declaration) {
  const content = {};
  for (const field of PRE_REGISTERED_FIELDS) {
    const value = declaration?.[field];
    content[field] = Array.isArray(value) ? value.map(normalizeText) : normalizeText(value === undefined ? null : value);
  }
  return content;
}

function declarationSha256(declaration) {
  text(declaration?.claim, 'declaration.claim');
  text(declaration?.claimScope, 'declaration.claimScope');
  return hash(preRegisteredContent(declaration));
}

// Named so a refusal can say what actually moved rather than only that something did. The owner
// reading it needs to know whether the boundary narrowed or a paired source was swapped.
function changedFields(before, after) {
  const a = preRegisteredContent(before);
  const b = preRegisteredContent(after);
  return PRE_REGISTERED_FIELDS.filter((field) => canonical(a[field]) !== canonical(b[field]));
}

class ScopePreRegistrationLedger {
  constructor({ root, projectId }) {
    this.root = path.resolve(text(root, 'root'));
    this.projectId = text(projectId, 'projectId');
    this.file = path.join(this.root, 'scope-pre-registration.json');
    fs.mkdirSync(this.root, { recursive: true });
  }

  read() {
    if (!fs.existsSync(this.file)) return { schemaVersion: 1, projectId: this.projectId, registrations: [] };
    const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (envelope?.sha256 !== hash(envelope.payload) || envelope.payload?.schemaVersion !== 1 || envelope.payload.projectId !== this.projectId || !Array.isArray(envelope.payload.registrations)) {
      throw crucibleError('CRU-0048', 'Scope pre-registration ledger integrity or project binding failed.');
    }
    return structuredClone(envelope.payload);
  }

  write(payload) {
    const envelope = { payload, sha256: hash(payload) };
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  find(claimKey) { return this.read().registrations.find((item) => item.claimKey === claimKey) || null; }

  // Records a hash against this run's clock. `supersedes` carries the prior registration into
  // history rather than discarding it, so a re-declared verified claim keeps its sequence.
  register(claimKey, declaration, at, { supersedes = null, reason = 'first pre-registration' } = {}) {
    const payload = this.read();
    const sha256 = declarationSha256(declaration);
    const existing = payload.registrations.find((item) => item.claimKey === claimKey);
    const entry = {
      claimKey: text(claimKey, 'claimKey'),
      declarationSha256: sha256,
      content: preRegisteredContent(declaration),
      firstRegisteredAt: at,
      lastSeenAt: at,
      runs: 1,
      outcome: 'pending',
      outcomeAt: null,
      reason,
      history: supersedes ? [...(existing?.history || []), supersedes] : (existing?.history || []),
    };
    if (existing) Object.assign(existing, entry);
    else payload.registrations.push(entry);
    this.write(payload);
    return structuredClone(entry);
  }

  seen(claimKey, at) {
    const payload = this.read();
    const entry = payload.registrations.find((item) => item.claimKey === claimKey);
    if (!entry) return null;
    entry.lastSeenAt = at;
    entry.runs += 1;
    this.write(payload);
    return structuredClone(entry);
  }

  // Called only for a declaration that actually reached a controlled experiment. A claim that was
  // never evaluated keeps `pending`, which is what leaves the owner free to correct it.
  recordOutcome(claimKey, outcome, at) {
    if (!OUTCOMES.includes(outcome)) throw crucibleError('CRU-0048', `Scope pre-registration outcome must be one of ${OUTCOMES.join(', ')}.`);
    const payload = this.read();
    const entry = payload.registrations.find((item) => item.claimKey === claimKey);
    if (!entry) throw crucibleError('CRU-0048', `No scope pre-registration exists for claim key ${claimKey}.`);
    entry.outcome = outcome;
    entry.outcomeAt = at;
    this.write(payload);
    return structuredClone(entry);
  }
}

// Splits the declarations into the ones a run may evaluate and the ones it must refuse, and
// records the registrations it accepted. The caller passes only `usable` onward.
function screenDeclarations({ declarations, ledger, at }) {
  const usable = [];
  const refused = [];
  const registrations = [];

  for (const declaration of declarations) {
    const claimKey = declaration.claimKey || normalizeText(declaration.claim).toLowerCase();
    const sha256 = declarationSha256(declaration);
    const prior = ledger.find(claimKey);

    if (!prior) {
      registrations.push({ claim: declaration.claim, claimKey, declarationSha256: sha256, state: 'first-pre-registration', registration: ledger.register(claimKey, declaration, at) });
      usable.push(declaration);
      continue;
    }

    if (prior.declarationSha256 === sha256) {
      registrations.push({ claim: declaration.claim, claimKey, declarationSha256: sha256, state: 'unchanged', registration: ledger.seen(claimKey, at) });
      usable.push(declaration);
      continue;
    }

    const moved = changedFields(prior.content, declaration);
    if (prior.outcome === 'not-verified') {
      refused.push({
        claim: declaration.claim,
        claimKey,
        state: 'changed-after-unverified-experiment',
        priorDeclarationSha256: prior.declarationSha256,
        declarationSha256: sha256,
        changedFields: moved,
        priorOutcomeAt: prior.outcomeAt,
        reason: `the declaration changed after a controlled experiment on this claim ran and did not verify it. Pre-registered ${prior.declarationSha256} at ${prior.firstRegisteredAt}; the experiment reported not-verified at ${prior.outcomeAt}; the declaration now hashes to ${sha256} with ${moved.join(', ')} changed. After the fact this cannot be told apart from narrowing the boundary until the claim stopped failing, so it is refused rather than evaluated`,
      });
      // The ledger is deliberately left untouched on refusal. Recording the new hash here would
      // let the very next run accept it as though it had always been the pre-registered one.
      continue;
    }

    // `pending` means no experiment ever ran on this claim, and `verified` means the knowledge
    // version already holds the boundary it was proven at. Both may be re-declared; both are
    // recorded, and the prior registration is preserved in history.
    const supersedes = { declarationSha256: prior.declarationSha256, content: prior.content, firstRegisteredAt: prior.firstRegisteredAt, outcome: prior.outcome, outcomeAt: prior.outcomeAt, changedFields: moved, supersededAt: at };
    const reason = prior.outcome === 'verified'
      ? 're-declared after a verified experiment; the existing knowledge version keeps the boundary it was verified at, so this is a new experiment rather than a revision of that one'
      : 're-declared before any experiment ran on this claim, so nothing was known about the result when it changed';
    registrations.push({ claim: declaration.claim, claimKey, declarationSha256: sha256, state: prior.outcome === 'verified' ? 're-declared-after-verified' : 're-declared-before-any-experiment', changedFields: moved, registration: ledger.register(claimKey, declaration, at, { supersedes, reason }) });
    usable.push(declaration);
  }

  return { usable, refused, registrations, authorizesPromotion: false };
}

module.exports = { PRE_REGISTERED_FIELDS, OUTCOMES, declarationSha256, changedFields, preRegisteredContent, ScopePreRegistrationLedger, screenDeclarations };
