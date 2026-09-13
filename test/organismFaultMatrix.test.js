'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DurableOrganismRuntime } = require('../src/organismRuntime');
const { ExternalOversightReflex } = require('../src/oversightReflex');

function fixture() {
  const oversight = crypto.generateKeyPairSync('ed25519');
  const owner = crypto.generateKeyPairSync('ed25519');
  const organs = Object.fromEntries(['sensor', 'worker', 'verifier', 'repairer', 'circulation'].map((name) => [name, async ({ payload }) => ({ accepted: payload })]));
  const runtime = new DurableOrganismRuntime({ projectId: 'p', root: fs.mkdtempSync(path.join(os.tmpdir(), 'fault-matrix-')), organs, learningStore: { retrieve: () => [] }, oversightReflex: new ExternalOversightReflex({ projectId: 'p', oversightPublicKey: oversight.publicKey, ownerPublicKey: owner.publicKey }), now: () => '2026-09-01T06:00:00.000Z' });
  return { runtime, oversight, owner };
}

for (const organ of ['sensor', 'worker', 'verifier', 'repairer', 'circulation']) test(`${organ} loss degrades safely and recovers without losing bounded work`, async () => {
  const { runtime } = fixture();
  runtime.setOrganAvailability(organ, false, `${organ} unavailable`, 'governance');
  runtime.submit({ id: `${organ}-work`, type: 'work-request', sourceOrgan: 'brain', targetOrgan: organ, boundary: 'exact-test-boundary', payload: { safe: true } });
  const inhibited = await runtime.heartbeat();
  assert.equal(inhibited.results[0].state, 'inhibited');
  assert.equal(inhibited.health.organs[organ].state, 'unavailable');
  runtime.setOrganAvailability(organ, true, null, 'governance+immune');
  runtime.recover();
  const recovered = await runtime.heartbeat();
  assert.equal(recovered.results[0].state, 'delivered');
});

test('invalid oversight credential cannot stop or clear the organism', () => {
  const { runtime } = fixture();
  const attacker = crypto.generateKeyPairSync('ed25519');
  const envelope = { schemaVersion: 1, projectId: 'p', decision: 'STOP', reason: 'forged', stateSha256: runtime.stateHash(), issuedAt: '2026-09-01T06:00:00.000Z' };
  const canonical = JSON.stringify(envelope, Object.keys(envelope).sort());
  envelope.oversightSignature = crypto.sign(null, Buffer.from(canonical), attacker.privateKey).toString('base64');
  assert.throws(() => runtime.applyOversight(envelope), /signature/i);
  assert.equal(runtime.health().oversight.state, 'CLEAR');
});

test('circulation cannot decide inhibition or recovery authority', () => {
  const { runtime } = fixture();
  assert.throws(() => runtime.setOrganAvailability('worker', false, 'pressure', 'circulation'), /governance authority/);
  runtime.setOrganAvailability('worker', false, 'pressure', 'governance');
  assert.throws(() => runtime.setOrganAvailability('worker', true, null, 'circulation'), /governance\+immune authority/);
});
