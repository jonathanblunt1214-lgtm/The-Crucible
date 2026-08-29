'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  STATE_FILE,
  OVERRIDE_ROOT,
  ensureInjectedGovernance,
  walkFiles,
} = require('../src/injectedGovernance');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-adaptive-injection-'));
  const source = path.join(root, 'canonical');
  const project = path.join(root, 'project');
  const target = path.join(project, 'governingDocuments');
  const handoff = path.join(project, 'AI-HANDOFF.json');

  write(path.join(source, 'BRANCH-LINKS.json'), JSON.stringify({ schemaVersion: 1, canonicalBranch: 'main', links: [] }));
  write(path.join(source, 'branch-linking-policy.md'), '# canonical branch links');
  write(path.join(source, 'managed-old.md'), '# managed old');
  write(path.join(source, 'known-bugs', 'KNOWN-BUGS.json'), JSON.stringify({ schemaVersion: 1, severityOrder: ['critical'], bugs: [{ id: 'engine-only' }] }));
  write(handoff, JSON.stringify({ schemaVersion: 1, governingDocuments: { 'governingDocuments/stale-from-old-canonical.md': 'stale' } }));

  return { root, source, project, target, handoff };
}

test('reconciliation adapts governingDocuments to canonical additions removals moves and local project changes', () => {
  const fixture = makeFixture();
  try {
    const first = ensureInjectedGovernance({
      sourceRoot: fixture.source,
      targetRoot: fixture.target,
      handoffPath: fixture.handoff,
    });

    assert.deepEqual(walkFiles(fixture.target), walkFiles(fixture.source));
    assert.ok(fs.existsSync(path.join(fixture.project, STATE_FILE)));
    assert.equal(first.state.source.branch, 'main');

    fs.appendFileSync(path.join(fixture.target, 'branch-linking-policy.md'), '\nproject-local edit\n');
    write(path.join(fixture.target, 'team', 'local-policy.md'), '# project-only policy');

    fs.rmSync(path.join(fixture.source, 'managed-old.md'));
    fs.rmSync(path.join(fixture.source, 'branch-linking-policy.md'));
    write(path.join(fixture.source, 'policy', 'branch-relationships.md'), '# canonical branch links moved');
    write(path.join(fixture.source, 'policy', 'new-runtime-policy.md'), '# new canonical policy');

    const second = ensureInjectedGovernance({
      sourceRoot: fixture.source,
      targetRoot: fixture.target,
      handoffPath: fixture.handoff,
    });

    assert.deepEqual(walkFiles(fixture.target), walkFiles(fixture.source));
    assert.equal(fs.existsSync(path.join(fixture.target, 'managed-old.md')), false);
    assert.equal(fs.existsSync(path.join(fixture.target, 'branch-linking-policy.md')), false);
    assert.equal(fs.existsSync(path.join(fixture.target, 'team', 'local-policy.md')), false);
    assert.ok(fs.existsSync(path.join(fixture.target, 'policy', 'branch-relationships.md')));
    assert.ok(fs.existsSync(path.join(fixture.target, 'policy', 'new-runtime-policy.md')));

    const preservedRoot = path.join(fixture.project, OVERRIDE_ROOT);
    const preserved = walkFiles(preservedRoot);
    assert.ok(preserved.includes('branch-linking-policy.md'));
    assert.ok(preserved.includes('team/local-policy.md'));
    assert.match(fs.readFileSync(path.join(preservedRoot, 'branch-linking-policy.md'), 'utf8'), /project-local edit/);

    const actions = second.actions.map((item) => item.action);
    assert.ok(actions.includes('remove-stale-managed'));
    assert.ok(actions.includes('preserve-override'));
    assert.ok(actions.includes('create-managed'));

    const updatedHandoff = JSON.parse(fs.readFileSync(fixture.handoff, 'utf8'));
    assert.equal(updatedHandoff.governingDocuments['governingDocuments/stale-from-old-canonical.md'], undefined);
    assert.ok(updatedHandoff.governingDocuments['governingDocuments/policy/branch-relationships.md']);
    assert.ok(updatedHandoff.governingDocuments['governingDocuments/policy/new-runtime-policy.md']);
    assert.equal(updatedHandoff.injectionStructure.stateFile, STATE_FILE);
    assert.equal(updatedHandoff.injectionStructure.overrideRoot, OVERRIDE_ROOT);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('existing project branch relationships survive reconciliation and remain name-agnostic', () => {
  const fixture = makeFixture();
  try {
    const relationships = {
      schemaVersion: 1,
      canonicalBranch: 'stable-line',
      links: [
        {
          relationship: 'paired',
          branches: [
            { name: 'work-stream', role: 'development' },
            { name: 'shipping-line', role: 'production' },
          ],
        },
        {
          relationship: 'canonical-reference',
          branch: 'adapter-surface',
          dependsOn: 'stable-line',
          requiredPaths: ['AI-HANDOFF.json', 'governingDocuments/runtime.json'],
        },
      ],
    };

    write(path.join(fixture.target, 'BRANCH-LINKS.json'), JSON.stringify(relationships, null, 2));
    write(path.join(fixture.project, '.crucible-branch-links.json'), JSON.stringify(relationships, null, 2));

    const result = ensureInjectedGovernance({
      sourceRoot: fixture.source,
      targetRoot: fixture.target,
      handoffPath: fixture.handoff,
      canonicalBranch: 'stable-line',
    });

    assert.equal(result.branchLinks.canonicalBranch, 'stable-line');
    assert.equal(result.branchLinks.links[0].relationship, 'paired');
    assert.equal(result.branchLinks.links[1].branch, 'adapter-surface');
    assert.equal(result.branchLinks.links[1].dependsOn, 'stable-line');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('unsafe project structure collisions fail closed instead of overwriting active project files', () => {
  const fixture = makeFixture();
  try {
    write(path.join(fixture.source, 'nested', 'policy.md'), '# canonical nested');
    write(path.join(fixture.target, 'nested'), 'this project file blocks a canonical directory');

    assert.throws(
      () => ensureInjectedGovernance({
        sourceRoot: fixture.source,
        targetRoot: fixture.target,
        handoffPath: fixture.handoff,
      }),
      /blocks directory|non-file entry/i
    );
    assert.equal(fs.readFileSync(path.join(fixture.target, 'nested'), 'utf8'), 'this project file blocks a canonical directory');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
