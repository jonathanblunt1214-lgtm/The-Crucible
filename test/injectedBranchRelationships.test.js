'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeProjectBranchLinks,
  ensureInjectedGovernance,
  walkFiles,
  OPERATIONAL_LINKS_FILE
} = require('../src/injectedGovernance');

test('injection classifies arbitrary paired and canonical-reference structures from metadata, not names', () => {
  const normalized = normalizeProjectBranchLinks({
    schemaVersion: 1,
    canonicalBranch: 'shipping-line',
    links: [
      {
        relationship: 'paired',
        branches: [
          { name: 'work-stream', role: 'development' },
          { name: 'shipping-line', role: 'canonical' }
        ]
      },
      {
        relationship: 'canonical-reference',
        branch: 'adapter-surface',
        dependsOn: 'shipping-line',
        requiredPaths: ['contracts/runtime.json', 'governingDocuments/policy.md']
      }
    ]
  });
  assert.equal(normalized.canonicalBranch, 'shipping-line');
  assert.equal(normalized.links[0].relationship, 'paired');
  assert.deepEqual(normalized.links[0].branches.map((entry) => entry.name), ['work-stream', 'shipping-line']);
  assert.equal(normalized.links[1].branch, 'adapter-surface');
  assert.equal(normalized.links[1].dependsOn, 'shipping-line');
  assert.deepEqual(normalized.links[1].requiredPaths, ['contracts/runtime.json', 'governingDocuments/policy.md']);
});

test('injection rejects ambiguous or name-inferred relationship records', () => {
  assert.throws(() => normalizeProjectBranchLinks({ schemaVersion: 1, canonicalBranch: 'stable', links: [{ relationship: 'paired', branches: [{ name: 'one', role: 'development' }] }] }), /exactly two/);
  assert.throws(() => normalizeProjectBranchLinks({ schemaVersion: 1, canonicalBranch: 'stable', links: [{ relationship: 'canonical-reference', branch: 'adapter', dependsOn: 'adapter' }] }), /cannot depend on itself/);
  assert.throws(() => normalizeProjectBranchLinks({ schemaVersion: 1, canonicalBranch: 'stable', links: [{ relationship: 'canonical-reference', branch: 'adapter', dependsOn: 'stable', requiredPaths: ['../escape'] }] }), /safe repository paths/);
});

test('injection initializes project-local branch ledgers without copying Crucible-specific links', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-injection-links-'));
  const source = path.join(temp, 'source');
  const project = path.join(temp, 'project');
  const target = path.join(project, 'governingDocuments');
  const handoff = path.join(project, 'AI-HANDOFF.json');
  fs.mkdirSync(path.join(source, 'known-bugs'), { recursive: true });
  fs.writeFileSync(path.join(source, 'BRANCH-LINKS.json'), JSON.stringify({ schemaVersion: 1, canonicalBranch: 'main', links: [{ relationship: 'canonical-reference', branch: 'engine-specific', dependsOn: 'main', requiredPaths: ['AI-HANDOFF.json'] }] }));
  fs.writeFileSync(path.join(source, 'branch-linking-policy.md'), '# canonical policy');
  fs.writeFileSync(path.join(source, 'known-bugs', 'KNOWN-BUGS.json'), JSON.stringify({ schemaVersion: 1, severityOrder: ['critical'], bugs: [{ id: 'engine-only' }] }));
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(handoff, JSON.stringify({ schemaVersion: 1, governingDocuments: {} }));

  const result = ensureInjectedGovernance({ sourceRoot: source, targetRoot: target, handoffPath: handoff, canonicalBranch: 'release-line' });
  assert.deepEqual(walkFiles(target), walkFiles(source));
  assert.deepEqual(result.branchLinks, { schemaVersion: 1, canonicalBranch: 'release-line', links: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'BRANCH-LINKS.json'), 'utf8')), result.branchLinks);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, OPERATIONAL_LINKS_FILE), 'utf8')), result.branchLinks);
  assert.equal(JSON.stringify(result.branchLinks).includes('engine-specific'), false);
  const handoffAfter = JSON.parse(fs.readFileSync(handoff, 'utf8'));
  assert.ok(handoffAfter.governingDocuments['governingDocuments/BRANCH-LINKS.json']);
  assert.ok(handoffAfter.governingDocuments['governingDocuments/branch-linking-policy.md']);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('injection preserves and validates existing arbitrary project relationships', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-existing-links-'));
  const source = path.join(temp, 'source');
  const project = path.join(temp, 'project');
  const target = path.join(project, 'governingDocuments');
  const handoff = path.join(project, 'AI-HANDOFF.json');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(source, 'BRANCH-LINKS.json'), '{}');
  fs.writeFileSync(path.join(source, 'branch-linking-policy.md'), '# policy');
  const links = {
    schemaVersion: 1,
    canonicalBranch: 'production-anchor',
    links: [
      { relationship: 'paired', branches: [{ name: 'build-lane', role: 'development' }, { name: 'production-anchor', role: 'canonical' }] },
      { relationship: 'canonical-reference', branch: 'docs-surface', dependsOn: 'production-anchor', requiredPaths: ['schema/public.json'] }
    ]
  };
  fs.writeFileSync(path.join(target, 'BRANCH-LINKS.json'), JSON.stringify(links));
  fs.writeFileSync(path.join(project, OPERATIONAL_LINKS_FILE), JSON.stringify(links));
  fs.writeFileSync(handoff, JSON.stringify({ schemaVersion: 1, governingDocuments: {} }));

  const result = ensureInjectedGovernance({ sourceRoot: source, targetRoot: target, handoffPath: handoff, canonicalBranch: 'production-anchor' });
  assert.deepEqual(result.branchLinks, links);
  assert.equal(result.branchLinks.links.length, 2);
  fs.rmSync(temp, { recursive: true, force: true });
});
