'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, manifest.entry), 'utf8');

function harness(respond = async () => ({ ok: true })) {
  let registration;
  const calls = [];
  const telemetry = [];
  const context = {
    register(value) { registration = value; },
    nexus: {
      call: async (capability, payload) => { calls.push({ capability, payload }); return respond(capability, payload); },
      emitTelemetry: (event, payload) => telemetry.push({ event, payload })
    },
    Date
  };
  vm.runInNewContext(source, context, { timeout: 1000, codeGeneration: { strings: false, wasm: false } });
  return { registration, calls, telemetry };
}

test('manifest is first-release v0.0.1 with least reviewed capabilities', () => {
  assert.equal(manifest.version, '0.0.1');
  assert.deepEqual([...manifest.capabilities].sort(), ['account:private','telemetry:emit','ui:slot','workspace:read','workspace:write'].sort());
  assert.equal(manifest.entry, 'index.js');
});

test('entry registers without Node globals or dynamic code', () => {
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bprocess\s*\./);
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(/);
  const { registration } = harness();
  assert.equal(typeof registration.onActivate, 'function');
  assert.equal(typeof registration.slots['project-actions'], 'function');
});

test('Auto Inject is off by default and requires explicit selection plus confirmation', async () => {
  const { registration, calls } = harness();
  const result = await registration.slots['project-actions']({ actionId: 'crucible-auto-inject' });
  assert.equal(result.ok, false);
  assert.equal(result.requiresSelection, true);
  assert.equal(calls.length, 0);
});

test('Auto Inject requires a signed-in account before writing and records only paths after write', async () => {
  const { registration, calls } = harness(async (capability, payload) => {
    if (capability === 'account:private' && payload.operation === 'status') return { ok: true, signedIn: true };
    if (capability === 'workspace:write') return { ok: true, written: payload.files.map((file) => ({ path: file.path })) };
    if (capability === 'account:private' && payload.operation === 'record') return { ok: true };
    return { ok: true };
  });
  const result = await registration.slots['project-actions']({ actionId: 'crucible-auto-inject', selected: true, confirmed: true, projectRef: 'project-fingerprint' });
  assert.equal(result.ok, true);
  assert.equal(result.accountPrivateTracking, true);
  const record = calls.find((item) => item.capability === 'account:private' && item.payload.operation === 'record');
  assert.ok(record);
  assert.ok(record.payload.record.files.every((value) => typeof value === 'string'));
  assert.equal(Object.hasOwn(record.payload.record, 'content'), false);
});

test('governance operations cannot escape governingDocuments', async () => {
  const { registration } = harness();
  await assert.rejects(() => registration.slots['project-actions']({ actionId: 'crucible-governance-read', path: '../secret.txt' }), /restricted/);
  await assert.rejects(() => registration.slots['project-actions']({ actionId: 'crucible-governance-write', path: 'AGENTS.md', content: 'x' }), /restricted/);
});

test('full governance lifecycle maps to bounded host operations with confirmation for destructive changes', async () => {
  const { registration, calls } = harness(async (capability, payload) => {
    if (capability === 'workspace:read' && payload.operation === 'list') return { files: ['governingDocuments/a.md', '../bad.txt'] };
    if (capability === 'workspace:read' && payload.operation === 'read') return { content: 'hello' };
    return { ok: true, written: [{ path: payload.files?.[0]?.path }] };
  });
  const actions = registration.slots['project-actions'];
  assert.deepEqual(await actions({ actionId: 'crucible-governance-list' }), { ok: true, root: 'governingDocuments', files: ['governingDocuments/a.md'] });
  assert.equal((await actions({ actionId: 'crucible-governance-read', path: 'governingDocuments/a.md' })).content, 'hello');
  assert.equal((await actions({ actionId: 'crucible-governance-write', path: 'governingDocuments/new.md', content: 'new' })).ok, true);
  assert.equal((await actions({ actionId: 'crucible-governance-delete', path: 'governingDocuments/a.md' })).requiresConfirmation, true);
  assert.equal((await actions({ actionId: 'crucible-governance-move', from: 'governingDocuments/a.md', to: 'governingDocuments/b.md' })).requiresConfirmation, true);
  await actions({ actionId: 'crucible-governance-delete', path: 'governingDocuments/a.md', confirmed: true });
  await actions({ actionId: 'crucible-governance-move', from: 'governingDocuments/a.md', to: 'governingDocuments/b.md', confirmed: true });
  assert.ok(calls.some((item) => item.capability === 'workspace:write' && item.payload.operation === 'delete'));
  assert.ok(calls.some((item) => item.capability === 'workspace:write' && item.payload.operation === 'move'));
});
