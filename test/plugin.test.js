'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function loadPlugin() {
  let registration;
  const calls = [];
  const context = {
    register(value) { registration = value; },
    nexus: {
      manifest,
      async call(capability, payload) {
        calls.push({ capability, payload });
        if (capability === 'workspace:read' && payload.operation === 'list') return { files: [] };
        if (capability === 'workspace:read' && payload.operation === 'read') throw new Error('not found');
        if (capability === 'workspace:write') return { written: payload.files || [], moved: payload.moves || [], deleted: payload.paths || [] };
        throw new Error(`unexpected capability ${capability}`);
      },
      emitTelemetry() {}
    }
  };
  vm.runInNewContext(source, context, { filename: 'index.js' });
  return { registration, calls };
}

test('manifest uses only currently supported minimum capabilities', () => {
  assert.deepEqual([...manifest.capabilities].sort(), ['telemetry:emit','ui:slot','workspace:read','workspace:write']);
});

test('default project action describes canonical main references and opt-in injection', async () => {
  const { registration } = loadPlugin();
  const result = await registration.slots['project-actions']({});
  assert.equal(result.canonicalSource.branch, 'main');
  assert.equal(result.configuration.sharedDocumentsAreReadOnlyReferences, true);
  const inject = result.actions.find((item) => item.id === 'crucible-auto-inject');
  assert.equal(inject.selectedByDefault, false);
  assert.equal(inject.requiresConfirmation, true);
});

test('Auto Inject writes one reference manifest and no shared policy copies', async () => {
  const { registration, calls } = loadPlugin();
  const result = await registration.slots['project-actions']({ actionId: 'crucible-auto-inject', selected: true, confirmed: true });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.written), ['governingDocuments/CRUCIBLE-REFERENCES.json']);
  const write = calls.find((item) => item.capability === 'workspace:write');
  assert.equal(write.payload.files.length, 1);
  assert.equal(write.payload.files[0].path, 'governingDocuments/CRUCIBLE-REFERENCES.json');
  const parsed = JSON.parse(write.payload.files[0].content);
  assert.equal(parsed.source.branch, 'main');
  assert.ok(parsed.documents.length > 5);
});

test('governance writes cannot escape governingDocuments', async () => {
  const { registration } = loadPlugin();
  await assert.rejects(
    registration.slots['project-actions']({ actionId: 'crucible-governance-write', path: '../AGENTS.md', content: 'x' }),
    /restricted to files inside governingDocuments/
  );
});
