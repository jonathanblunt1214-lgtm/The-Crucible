const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PRE_REGISTERED_FIELDS,
  declarationSha256,
  changedFields,
  ScopePreRegistrationLedger,
  screenDeclarations,
} = require('../src/scopePreRegistration');

const PROJECT = 'github:jonathanblunt1214-lgtm/The-Crucible';
const T1 = '2026-09-15T10:00:00.000Z';
const T2 = '2026-09-15T11:00:00.000Z';
const T3 = '2026-09-15T12:00:00.000Z';

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'scope-prereg-')); }
function ledger() { return new ScopePreRegistrationLedger({ root: root(), projectId: PROJECT }); }

// The declaration the hosted corpus is currently blocked on, shortened only where the text does
// not matter to the test.
const MAP_CLAIM = "For example, the Array object's map function allows you to iterate over each element of an array, then build a new array by applying a transform function to each element.";
const declaration = (overrides = {}) => ({
  claim: MAP_CLAIM,
  claimScope: 'Node.js ordinary dense arrays of numbers',
  generalizationBoundary: 'Does not cover sparse arrays, proxies, subclasses, or host objects.',
  language: 'javascript',
  pairedSources: ['owner-file:2f16a53d', 'owner-delegated-url:11bfade7'],
  pairedAssertions: [MAP_CLAIM, 'The map() method creates a new array populated with the results.'],
  claimKey: MAP_CLAIM.trim().replace(/\s+/g, ' ').toLowerCase(),
  ...overrides,
});
const KEY = declaration().claimKey;

test('the hash covers what is actually pre-registered and nothing else', () => {
  assert.deepEqual([...PRE_REGISTERED_FIELDS], ['claim', 'claimScope', 'generalizationBoundary', 'language', 'pairedSources', 'pairedAssertions']);
  const base = declaration();
  // Commentary and bookkeeping are not the hypothesis, so editing them is not a boundary change.
  assert.equal(declarationSha256({ ...base, $comment: 'explaining why', declaredAt: T1, claimKey: 'anything' }), declarationSha256(base));
  // Reflowing a long boundary across lines is not moving it.
  assert.equal(declarationSha256({ ...base, claimScope: '  Node.js ordinary dense\n  arrays of numbers  ' }), declarationSha256(base));
  // Every pre-registered field is load-bearing.
  for (const [field, value] of [
    ['claim', 'a different claim entirely'],
    ['claimScope', 'Node.js dense arrays of small integers'],
    ['generalizationBoundary', 'Does not cover sparse arrays.'],
    ['language', 'python'],
    ['pairedSources', ['owner-file:2f16a53d', 'owner-file:other']],
    ['pairedAssertions', [MAP_CLAIM, 'Something else entirely.']],
  ]) {
    assert.notEqual(declarationSha256({ ...base, [field]: value }), declarationSha256(base), field);
  }
  assert.deepEqual(changedFields(base, { ...base, claimScope: 'narrower' }), ['claimScope']);
});

test('the first run to see a declaration pre-registers it against its own clock', () => {
  const store = ledger();
  const screen = screenDeclarations({ declarations: [declaration()], ledger: store, at: T1 });
  assert.equal(screen.usable.length, 1);
  assert.equal(screen.refused.length, 0);
  assert.equal(screen.registrations[0].state, 'first-pre-registration');
  assert.equal(screen.authorizesPromotion, false, 'pre-registration authorizes evaluation, never promotion');

  const entry = store.find(KEY);
  assert.equal(entry.declarationSha256, declarationSha256(declaration()));
  assert.equal(entry.firstRegisteredAt, T1, 'the timestamp is the run clock, not anything the declaration said');
  assert.equal(entry.outcome, 'pending');
  assert.equal(entry.outcomeAt, null);
});

test('an unchanged declaration stays usable across runs and counts its sightings', () => {
  const store = ledger();
  screenDeclarations({ declarations: [declaration()], ledger: store, at: T1 });
  const second = screenDeclarations({ declarations: [declaration()], ledger: store, at: T2 });
  assert.equal(second.usable.length, 1);
  assert.equal(second.registrations[0].state, 'unchanged');
  const entry = store.find(KEY);
  assert.equal(entry.runs, 2);
  assert.equal(entry.lastSeenAt, T2);
  assert.equal(entry.firstRegisteredAt, T1, 'the original pre-registration time never moves');
});

test('narrowing the boundary after a failed experiment is refused, and stays refused', () => {
  const store = ledger();
  screenDeclarations({ declarations: [declaration()], ledger: store, at: T1 });
  // An experiment ran on the pre-registered boundary and did not verify the claim.
  store.recordOutcome(KEY, 'not-verified', T2);

  const narrowed = declaration({ claimScope: 'Node.js dense arrays of small non-negative integers' });
  const screen = screenDeclarations({ declarations: [narrowed], ledger: store, at: T3 });

  assert.equal(screen.usable.length, 0, 'a post-hoc declaration must not reach an experiment');
  assert.equal(screen.refused.length, 1);
  const refusal = screen.refused[0];
  assert.equal(refusal.state, 'changed-after-unverified-experiment');
  assert.deepEqual(refusal.changedFields, ['claimScope']);
  assert.equal(refusal.priorDeclarationSha256, declarationSha256(declaration()));
  assert.equal(refusal.declarationSha256, declarationSha256(narrowed));
  assert.equal(refusal.priorOutcomeAt, T2);
  assert.match(refusal.reason, /did not verify it/);
  assert.match(refusal.reason, /narrowing the boundary until the claim stopped failing/);

  // The refusal is worthless if the act of refusing records the new hash, because the next run
  // would then read it as the pre-registered one.
  const entry = store.find(KEY);
  assert.equal(entry.declarationSha256, declarationSha256(declaration()), 'a refusal must not overwrite the pre-registration');
  assert.equal(entry.outcome, 'not-verified');
  const again = screenDeclarations({ declarations: [narrowed], ledger: store, at: '2026-09-15T13:00:00.000Z' });
  assert.equal(again.usable.length, 0, 'running again must not launder the change');
  assert.equal(again.refused.length, 1);

  // Widening it is refused on the same grounds: the objection is that the result was already
  // known, not the direction the boundary moved.
  const widened = declaration({ claimScope: 'all JavaScript arrays' });
  assert.equal(screenDeclarations({ declarations: [widened], ledger: store, at: T3 }).refused.length, 1);
});

test('a claim no experiment ever ran on may be corrected freely', () => {
  const store = ledger();
  screenDeclarations({ declarations: [declaration()], ledger: store, at: T1 });
  // No recordOutcome: the corpus could not pair this declaration, so it never reached a harness.
  // This is the situation the hosted corpus is actually in, and blocking it would be wrong.
  const repaired = declaration({ pairedSources: ['owner-file:2f16a53d', 'linked-source:28503d6f'] });
  const screen = screenDeclarations({ declarations: [repaired], ledger: store, at: T2 });

  assert.equal(screen.refused.length, 0);
  assert.equal(screen.usable.length, 1);
  assert.equal(screen.registrations[0].state, 're-declared-before-any-experiment');
  assert.deepEqual(screen.registrations[0].changedFields, ['pairedSources']);
  const entry = store.find(KEY);
  assert.equal(entry.declarationSha256, declarationSha256(repaired));
  assert.equal(entry.firstRegisteredAt, T2, 'the corrected declaration is pre-registered from when it was first seen');
  assert.equal(entry.history.length, 1, 'the superseded registration is kept, not discarded');
  assert.equal(entry.history[0].declarationSha256, declarationSha256(declaration()));
  assert.equal(entry.history[0].outcome, 'pending');
});

test('re-declaring a verified claim is a new experiment, recorded rather than blocked', () => {
  const store = ledger();
  screenDeclarations({ declarations: [declaration()], ledger: store, at: T1 });
  store.recordOutcome(KEY, 'verified', T2);

  const wider = declaration({ claimScope: 'Node.js dense arrays of any primitive' });
  const screen = screenDeclarations({ declarations: [wider], ledger: store, at: T3 });
  assert.equal(screen.usable.length, 1, 'the knowledge version keeps the boundary it was verified at; this is a new question');
  assert.equal(screen.registrations[0].state, 're-declared-after-verified');
  const entry = store.find(KEY);
  assert.equal(entry.history.length, 1);
  assert.equal(entry.history[0].outcome, 'verified');
  assert.equal(entry.history[0].outcomeAt, T2);
  assert.equal(entry.history[0].supersededAt, T3);
  assert.match(entry.reason, /new experiment rather than a revision/);
});

test('the ledger fails closed on tampering, a foreign project, and an unknown claim', () => {
  const directory = root();
  const store = new ScopePreRegistrationLedger({ root: directory, projectId: PROJECT });
  screenDeclarations({ declarations: [declaration()], ledger: store, at: T1 });

  assert.throws(() => store.recordOutcome('a claim nobody pre-registered', 'verified', T2), /CRU-0048.*No scope pre-registration exists/s);
  assert.throws(() => store.recordOutcome(KEY, 'probably-fine', T2), /CRU-0048.*outcome must be one of/s);
  assert.throws(() => new ScopePreRegistrationLedger({ root: directory, projectId: '' }), /CRU-0048/);

  // Editing the recorded boundary by hand is exactly the move this ledger exists to catch.
  const file = path.join(directory, 'scope-pre-registration.json');
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  envelope.payload.registrations[0].content.claimScope = 'something the run never saw';
  fs.writeFileSync(file, JSON.stringify(envelope, null, 2));
  assert.throws(() => store.read(), /CRU-0048.*integrity or project binding failed/s);

  const foreign = new ScopePreRegistrationLedger({ root: directory, projectId: 'github:someone/else' });
  assert.throws(() => foreign.read(), /CRU-0048/);
});

test('each declaration is screened on its own, so one refusal does not take the others down', () => {
  const store = ledger();
  const other = declaration({ claim: 'Any class can have more than one constructor.', claimKey: 'any class can have more than one constructor.', claimScope: 'Java classes', pairedSources: ['linked-source:28503d6f', 'owner-file:7a409be1'], pairedAssertions: ['Any class can have more than one constructor.', 'The class can also include one or more constructors.'] });
  screenDeclarations({ declarations: [declaration(), other], ledger: store, at: T1 });
  store.recordOutcome(KEY, 'not-verified', T2);

  const screen = screenDeclarations({ declarations: [declaration({ claimScope: 'narrowed' }), other], ledger: store, at: T3 });
  assert.equal(screen.refused.length, 1);
  assert.equal(screen.usable.length, 1);
  assert.equal(screen.usable[0].claim, other.claim);
});
