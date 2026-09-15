const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  GATES,
  GATE_DECIDERS,
  gateFingerprint,
  allFingerprints,
  DurableGateEvidenceStore,
  invalidateStaleGates,
} = require('../src/durableGateEvidence');

const PROJECT = 'github:jonathanblunt1214-lgtm/The-Crucible';
const T1 = '2026-09-15T11:00:00.000Z';
const T2 = '2026-09-15T12:00:00.000Z';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A stand-in source tree carrying every declared decider, so a test can move one file and
// nothing else. Using the real src/ would make these tests fail whenever unrelated work landed.
function sourceTree(dir) {
  const root = path.join(dir, 'src');
  fs.mkdirSync(root, { recursive: true });
  for (const names of Object.values(GATE_DECIDERS)) {
    for (const name of names) fs.writeFileSync(path.join(root, name), `// original ${name}\n`);
  }
  fs.writeFileSync(path.join(root, 'somethingElse.js'), '// unrelated\n');
  return root;
}

const states = () => GATES.map((id) => ({ id, state: 'satisfied', detail: `${id} demonstrated` }));

test('every declared gate names deciders that really exist in this repository', () => {
  assert.deepEqual([...GATES], ['R4', 'R5', 'R6', 'R7', 'R8']);
  for (const gate of GATES) {
    assert.ok(GATE_DECIDERS[gate].length >= 1, `${gate} must declare at least one decider`);
    // Against the real tree: a declared decider that does not exist would fingerprint nothing.
    assert.doesNotThrow(() => gateFingerprint(gate, 'src'), `${gate} deciders must exist`);
  }
});

test('a fingerprint tracks the content of that gate and only that gate', (t) => {
  const root = sourceTree(workspace(t));
  const before = allFingerprints(root);

  fs.writeFileSync(path.join(root, 'realSupersession.js'), '// changed behaviour\n');
  const after = allFingerprints(root);
  assert.notEqual(after.R7.fingerprint, before.R7.fingerprint, 'R7 must notice its own decider changing');
  for (const gate of ['R4', 'R5', 'R6', 'R8']) {
    assert.equal(after[gate].fingerprint, before[gate].fingerprint, `${gate} must not move when R7's decider does`);
  }

  fs.writeFileSync(path.join(root, 'somethingElse.js'), '// unrelated edit\n');
  const unrelated = allFingerprints(root);
  for (const gate of GATES) assert.equal(unrelated[gate].fingerprint, after[gate].fingerprint, `${gate} must ignore a file no gate declares`);
});

test('a gate whose deciding implementation changed loses its evidence and is told why', (t) => {
  const dir = workspace(t);
  const root = sourceTree(dir);
  const store = new DurableGateEvidenceStore({ root: path.join(dir, 'state'), projectId: PROJECT });

  store.record({ gateStates: states(), sourceRoot: root, runId: '111', at: T1 });
  const recorded = store.read();
  assert.equal(recorded.gates.R7.state, 'satisfied');
  assert.equal(recorded.gates.R7.runId, '111');
  assert.equal(recorded.revision, 1);

  // Unchanged code keeps every gate.
  const held = invalidateStaleGates(recorded, root, T2);
  assert.equal(held.invalidated.length, 0);
  assert.deepEqual(Object.keys(held.gates).sort(), [...GATES]);
  assert.equal(held.authorizesPromotion, false);

  // Now R7's decider changes. Its proof predates the change, so it cannot stand.
  fs.writeFileSync(path.join(root, 'realSupersession.js'), '// rewritten supersession\n');
  const stale = invalidateStaleGates(store.read(), root, T2);
  assert.equal(stale.invalidated.length, 1, 'exactly the gate whose code moved loses its evidence');
  const dropped = stale.invalidated[0];
  assert.equal(dropped.gateId, 'R7');
  assert.equal(dropped.priorState, 'satisfied');
  assert.equal(dropped.state, 'unproven');
  assert.deepEqual(dropped.changedDeciders, ['realSupersession.js'], 'the reason has to name the file that moved');
  assert.match(dropped.reason, /a proof cannot survive the code that produced it/);
  assert.equal(stale.gates.R7, undefined, 'a dropped gate must not remain readable as current');
  assert.deepEqual(Object.keys(stale.gates).sort(), ['R4', 'R5', 'R6', 'R8'], 'the other four are untouched');
});

test('the store fails closed on tampering, a foreign project, and an invalid identity', (t) => {
  const dir = workspace(t);
  const root = sourceTree(dir);
  const stateRoot = path.join(dir, 'state');
  const store = new DurableGateEvidenceStore({ root: stateRoot, projectId: PROJECT });
  store.record({ gateStates: states(), sourceRoot: root, runId: '111', at: T1 });

  assert.throws(() => new DurableGateEvidenceStore({ root: stateRoot, projectId: '' }), /CRU-0049/);
  assert.throws(() => new DurableGateEvidenceStore({ root: '', projectId: PROJECT }), /CRU-0049/);

  // Promoting a gate by hand is the move this envelope exists to catch.
  const file = path.join(stateRoot, 'gate-evidence.json');
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  envelope.payload.gates.R7.state = 'satisfied';
  envelope.payload.gates.R7.fingerprint = 'f'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(envelope, null, 2));
  assert.throws(() => store.read(), /CRU-0049.*integrity or project binding failed/s);

  const foreign = new DurableGateEvidenceStore({ root: stateRoot, projectId: 'github:someone/else' });
  assert.throws(() => foreign.read(), /CRU-0049/);
});

test('a renamed or deleted decider is reconciled rather than fingerprinted around', (t) => {
  const dir = workspace(t);
  const root = sourceTree(dir);
  fs.rmSync(path.join(root, 'knowledgeLifecycle.js'));
  assert.throws(() => gateFingerprint('R6', root), /CRU-0049.*does not exist/s);
  assert.throws(() => allFingerprints(root), /CRU-0049/);
  assert.throws(() => gateFingerprint('R99', root), /CRU-0049.*No decider files are declared/s);
});

test('an unrecognised gate state is refused rather than recorded', (t) => {
  const dir = workspace(t);
  const root = sourceTree(dir);
  const store = new DurableGateEvidenceStore({ root: path.join(dir, 'state'), projectId: PROJECT });
  assert.throws(
    () => store.record({ gateStates: [{ id: 'R7', state: 'probably-fine' }], sourceRoot: root, runId: '1', at: T1 }),
    /CRU-0049.*which is not one of/s,
  );
  assert.throws(() => store.record({ gateStates: 'R7', sourceRoot: root, runId: '1', at: T1 }), /CRU-0049.*must be an array/s);
  // A gate outside the five is ignored rather than stored, so an unrelated reporter entry
  // cannot invent a sixth hosted gate.
  store.record({ gateStates: [{ id: 'R1', state: 'satisfied' }], sourceRoot: root, runId: '1', at: T1 });
  assert.deepEqual(Object.keys(store.read().gates), []);
});
