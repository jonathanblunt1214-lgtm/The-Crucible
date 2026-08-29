'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function loadPlugin(files = {}) {
  let registration;
  const calls = [];
  const context = {
    register(value) { registration = value; },
    nexus: {
      manifest,
      async call(capability, payload) {
        calls.push({ capability, payload });
        if (capability === 'workspace:read' && payload.operation === 'list') {
          return { files: Object.keys(files).map((path) => ({ path })) };
        }
        if (capability === 'workspace:read' && payload.operation === 'read') {
          if (!Object.prototype.hasOwnProperty.call(files, payload.path)) throw new Error('not found');
          return { content: files[payload.path] };
        }
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

test('default project action describes canonical references, project-specific branch links, and opt-in injection', async () => {
  const { registration } = loadPlugin();
  const result = await registration.slots['project-actions']({});
  assert.equal(result.canonicalSource.branch, 'main');
  assert.equal(result.configuration.sharedDocumentsAreReadOnlyReferences, true);
  assert.equal(result.configuration.branchNamesAreProjectData, true);
  assert.deepEqual(Array.from(result.configuration.branchRelationshipTypes), ['canonical-reference', 'paired']);
  const inject = result.actions.find((item) => item.id === 'crucible-auto-inject');
  assert.equal(inject.selectedByDefault, false);
  assert.equal(inject.requiresConfirmation, true);
});

test('branch-link identification accepts arbitrary names for canonical-reference and paired structures', async () => {
  const branchLinks = {
    schemaVersion: 1,
    canonicalBranch: 'stable-line',
    links: [
      {
        branch: 'adapter-surface',
        relationship: 'canonical-reference',
        dependsOn: 'stable-line',
        requiredPaths: ['contracts/runtime.json', 'governingDocuments/policy.md']
      },
      {
        relationship: 'paired',
        branches: [
          { branch: 'work-stream', role: 'development' },
          { branch: 'shipping-line', role: 'main' }
        ]
      }
    ]
  };
  const { registration } = loadPlugin({
    'governingDocuments/BRANCH-LINKS.json': JSON.stringify(branchLinks)
  });
  const result = await registration.slots['project-actions']({ actionId: 'crucible-branch-links-read' });
  assert.equal(result.ok, true);
  assert.equal(result.declared, true);
  assert.equal(result.canonicalReferences[0].sourceBranch, 'adapter-surface');
  assert.equal(result.canonicalReferences[0].targetBranch, 'stable-line');
  assert.deepEqual(Array.from(result.canonicalReferences[0].requiredPaths), ['contracts/runtime.json', 'governingDocuments/policy.md']);
  assert.deepEqual(Array.from(result.pairedRelationships[0].branches, (item) => item.branch), ['work-stream', 'shipping-line']);
});

test('branch-link identification does not invent relationships when a project has no manifest', async () => {
  const { registration } = loadPlugin();
  const result = await registration.slots['project-actions']({ actionId: 'crucible-branch-links-read' });
  assert.equal(result.ok, true);
  assert.equal(result.declared, false);
  assert.equal(result.canonicalReferences.length, 0);
  assert.equal(result.pairedRelationships.length, 0);
});

test('Auto Inject writes one reference manifest and does not invent project branch names', async () => {
  const { registration, calls } = loadPlugin();
  const result = await registration.slots['project-actions']({ actionId: 'crucible-auto-inject', selected: true, confirmed: true });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.written), ['governingDocuments/CRUCIBLE-REFERENCES.json']);
  const write = calls.find((item) => item.capability === 'workspace:write');
  assert.equal(write.payload.files.length, 1);
  assert.equal(write.payload.files[0].path, 'governingDocuments/CRUCIBLE-REFERENCES.json');
  const parsed = JSON.parse(write.payload.files[0].content);
  assert.equal(parsed.source.branch, 'main');
  assert.equal(parsed.branchLinkManifest, 'governingDocuments/BRANCH-LINKS.json');
  assert.ok(parsed.documents.some((item) => item.path === 'governingDocuments/branch-linking-policy.md'));
  assert.ok(parsed.documents.some((item) => item.path === 'governingDocuments/BRANCH-LINKS.json'));
  assert.doesNotMatch(write.payload.files[0].content, /adapter-surface|work-stream|shipping-line/);
});

test('governance writes cannot escape governingDocuments', async () => {
  const { registration } = loadPlugin();
  await assert.rejects(
    registration.slots['project-actions']({ actionId: 'crucible-governance-write', path: '../AGENTS.md', content: 'x' }),
    /restricted to files inside governingDocuments/
  );
});
