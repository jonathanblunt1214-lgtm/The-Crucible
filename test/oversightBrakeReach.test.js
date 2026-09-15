'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ExternalOversightReflex, canonical } = require('../src/oversightReflex');
const { DurableOrganismRuntime } = require('../src/organismRuntime');

const PROJECT = 'p';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oversight = crypto.generateKeyPairSync('ed25519');
  const owner = crypto.generateKeyPairSync('ed25519');
  const organs = {
    brain: async () => ({ ok: true }),
    immune: async () => ({ ok: true }),
    digestive: async () => ({ ok: true }),
    learning: async () => ({ ok: true }),
    reporting: async () => ({ ok: true }),
  };
  const runtime = new DurableOrganismRuntime({
    projectId: PROJECT,
    root,
    organs,
    learningStore: { retrieve: () => [] },
    oversightReflex: new ExternalOversightReflex({ projectId: PROJECT, oversightPublicKey: oversight.publicKey, ownerPublicKey: owner.publicKey }),
  });
  return { runtime, oversight, owner };
}

function envelope(runtime, oversightKey, ownerKey, decision) {
  const payload = { schemaVersion: 1, projectId: PROJECT, decision, reason: decision === 'STOP' ? 'unsafe organism state' : 'owner-reviewed recovery', issuedAt: new Date().toISOString(), stateSha256: runtime.stateHash() };
  const sign = (key) => crypto.sign(null, Buffer.from(canonical(payload)), key).toString('base64');
  return { ...payload, oversightSignature: sign(oversightKey), ...(ownerKey ? { ownerSignature: sign(ownerKey) } : {}) };
}

// The brake has to reach the organs themselves, not only the pump. An organism whose queue is
// halted while every organ still reads healthy has a health view that disagrees with its state,
// and the health view is what a person is trusting when they are not watching.
test('a STOP inhibits every governed organ, not just the queue', (t) => {
  const { runtime, oversight } = fixture(t);
  for (const organ of Object.values(runtime.health().organs)) assert.equal(organ.state, 'healthy');

  runtime.applyOversight(envelope(runtime, oversight.privateKey, null, 'STOP'));
  const health = runtime.health();
  assert.equal(health.state, 'inhibited');
  const organs = Object.entries(health.organs);
  assert.equal(organs.length, 5);
  for (const [id, organ] of organs) {
    assert.equal(organ.state, 'inhibited', `${id} still reads ${organ.state} under a STOP`);
    assert.match(organ.missingDependency, /oversight STOP/i, 'and says why it is inhibited');
  }
});

// Homeostasis is allowed to recover inhibited work on its own. Under an oversight stop it is not.
test('an organism cannot recover itself out of a STOP', (t) => {
  const { runtime, oversight, owner } = fixture(t);
  runtime.applyOversight(envelope(runtime, oversight.privateKey, null, 'STOP'));

  assert.throws(() => runtime.recover(), /requires oversight clearance and the owner authorisation/);
  assert.equal(runtime.health().state, 'inhibited', 'and the attempt changes nothing');

  runtime.applyOversight(envelope(runtime, oversight.privateKey, owner.privateKey, 'CLEAR'));
  assert.doesNotThrow(() => runtime.recover(), 'homeostasis resumes only once the brake is properly released');
});

// A clear must not launder a degraded organ into a healthy one.
test('a CLEAR restores each organ to what it was, never better', (t) => {
  const { runtime, oversight, owner } = fixture(t);
  runtime.setOrganAvailability('immune', false, 'verifier unavailable', 'governance');
  assert.equal(runtime.health().organs.immune.state, 'unavailable');

  runtime.applyOversight(envelope(runtime, oversight.privateKey, null, 'STOP'));
  assert.equal(runtime.health().organs.immune.state, 'inhibited');

  runtime.applyOversight(envelope(runtime, oversight.privateKey, owner.privateKey, 'CLEAR'));
  const after = runtime.health();
  assert.equal(after.organs.immune.state, 'unavailable', 'the organ that was unavailable before the stop is unavailable after it');
  assert.equal(after.organs.brain.state, 'healthy');
});

test('clearing still requires oversight and the owner together', (t) => {
  const { runtime, oversight, owner } = fixture(t);
  runtime.applyOversight(envelope(runtime, oversight.privateKey, null, 'STOP'));
  assert.throws(() => runtime.applyOversight(envelope(runtime, oversight.privateKey, null, 'CLEAR')), /Owner/);
  const stranger = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => runtime.applyOversight(envelope(runtime, oversight.privateKey, stranger.privateKey, 'CLEAR')), /Owner/);
  assert.doesNotThrow(() => runtime.applyOversight(envelope(runtime, oversight.privateKey, owner.privateKey, 'CLEAR')));
});
