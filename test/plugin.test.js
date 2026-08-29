'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'nexus.plugin.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function loadPlugin(files = {}) {
  let registration;
  const calls = [];
  const telemetry = [];
  const context = {
    crypto: nodeCrypto.webcrypto,
    TextEncoder,
    TextDecoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
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
        if (capability === 'workspace:write') {
          for (const file of payload.files || []) files[file.path] = file.content;
          for (const move of payload.moves || []) { files[move.to] = files[move.from]; delete files[move.from]; }
          for (const item of payload.paths || []) delete files[item];
          return { written: payload.files || [], moved: payload.moves || [], deleted: payload.paths || [] };
        }
        throw new Error(`unexpected capability ${capability}`);
      },
      emitTelemetry(name, payload) { telemetry.push({ name, payload }); }
    }
  };
  vm.runInNewContext(source, context, { filename: 'index.js' });
  return { registration, calls, telemetry, files };
}

function oidcFixture(projectId = 'project-a') {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }); jwk.kid = 'key-1'; jwk.alg = 'RS256';
  const seconds = Math.floor(Date.now() / 1000); const issuer = 'https://token.actions.githubusercontent.com'; const audience = 'crucible-learning'; const repository = 'owner/repo-a'; const ref = 'refs/heads/development'; const sub = `repo:${repository}:ref:${ref}`;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const claims = { iss: issuer, aud: audience, repository, ref, project_id: projectId, sub, iat: seconds - 5, exp: seconds + 300 };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url'); const signature = nodeCrypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
  return { token: `${header}.${body}.${signature}`, claims, identity: { jwks: { keys: [jwk] }, issuer, audience, repository, ref, projectId, now: Date.now() } };
}

const at = '2026-08-29T19:30:00.000Z';
function learningCandidate(overrides = {}) {
  return {
    schemaVersion: 1, id: 'candidate-1', projectId: 'project-a', claim: 'repair X causes test Y to pass',
    claimBoundary: 'node-22/windows/test-y', generalizationBoundary: 'no wider than node-22/windows/test-y', kind: 'controlled-experiment',
    provenance: { sourceType: 'owner-research', sourceId: 'source-1', retrievedAt: at, author: 'author-1', license: 'private-candidate-evidence', contentSha256: 'a'.repeat(64) },
    createdAt: at, ...overrides
  };
}
function experiment(overrides = {}) {
  return {
    hypothesis: 'repair X is responsible for test Y', testedProperty: 'repair X causes test Y to pass', experimentBoundary: 'node-22/windows/test-y',
    controls: ['no-repair control fails', 'irrelevant repair control fails'], causalIsolation: { method: 'single-variable intervention and reversal', result: 'only repair X changes Y', correlationOnly: false },
    negativeTests: ['X does not change Z'], regressionTests: ['existing suite remains green'], scopeProof: 'diff limited to test-y',
    generalizationResult: 'not generalized', contradictionResult: 'none', completedAt: at, ...overrides
  };
}
async function advanceToCausal(registration, candidate = learningCandidate()) {
  const action = registration.slots['project-actions'];
  await action({ actionId: 'crucible-learning-ingest', candidate });
  await action({ actionId: 'crucible-learning-hypothesis', projectId: candidate.projectId, candidateId: candidate.id, hypothesis: experiment().hypothesis, at });
  await action({ actionId: 'crucible-learning-experiment', projectId: candidate.projectId, candidateId: candidate.id, experiment: experiment({ testedProperty: candidate.claim, experimentBoundary: candidate.claimBoundary }) });
  return action({ actionId: 'crucible-learning-causal-confirm', projectId: candidate.projectId, candidateId: candidate.id, at });
}
async function promoteCandidate(registration, candidate, proofCharacter = 'b') {
  const action = registration.slots['project-actions']; await advanceToCausal(registration, candidate);
  await action({ actionId: 'crucible-learning-independent-verify', projectId: candidate.projectId, candidateId: candidate.id, verification: { verifierId: 'verifier-2', independent: true, testedProperty: candidate.claim, experimentBoundary: candidate.claimBoundary, result: 'passed', verifiedAt: at, proofSha256: proofCharacter.repeat(64) } });
  return action({ actionId: 'crucible-learning-promote', projectId: candidate.projectId, candidateId: candidate.id, at });
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

test('scientific learning ingests strict project-isolated candidates as insufficient evidence', async () => {
  const { registration } = loadPlugin();
  const action = registration.slots['project-actions'];
  const result = await action({ actionId: 'crucible-learning-ingest', candidate: learningCandidate() });
  assert.equal(result.record.state, 'candidate');
  assert.equal(result.record.candidate.classification, 'Insufficient Evidence');
  assert.ok(Object.values(result.record.gates).every((value) => value === false));
  await assert.rejects(action({ actionId: 'crucible-learning-ingest', projectId: 'project-b', candidate: learningCandidate() }), /Cross-project/);
  await assert.rejects(action({ actionId: 'crucible-learning-ingest', candidate: { ...learningCandidate({ id: 'candidate-2' }), confidence: 0.99 } }), /unknown field/);
});

test('learning stages fail closed and correlation never satisfies causation', async () => {
  const { registration } = loadPlugin(); const action = registration.slots['project-actions'];
  await action({ actionId: 'crucible-learning-ingest', candidate: learningCandidate() });
  await assert.rejects(action({ actionId: 'crucible-learning-promote', projectId: 'project-a', candidateId: 'candidate-1', at }), /requires independently-verified/);
  await action({ actionId: 'crucible-learning-hypothesis', projectId: 'project-a', candidateId: 'candidate-1', hypothesis: experiment().hypothesis, at });
  await assert.rejects(action({ actionId: 'crucible-learning-experiment', projectId: 'project-a', candidateId: 'candidate-1', experiment: experiment({ causalIsolation: { method: 'frequency', result: 'correlated', correlationOnly: true } }) }), /Correlation never/);
});

test('independent verification is a separate exact-property and boundary gate', async () => {
  const { registration } = loadPlugin(); const action = registration.slots['project-actions']; await advanceToCausal(registration);
  const base = { verifierId: 'verifier-2', independent: true, testedProperty: learningCandidate().claim, experimentBoundary: learningCandidate().claimBoundary, result: 'passed', verifiedAt: at, proofSha256: 'b'.repeat(64) };
  await assert.rejects(action({ actionId: 'crucible-learning-independent-verify', projectId: 'project-a', candidateId: 'candidate-1', verification: { ...base, verifierId: 'author-1' } }), /not independent/);
  await assert.rejects(action({ actionId: 'crucible-learning-independent-verify', projectId: 'project-a', candidateId: 'candidate-1', verification: { ...base, testedProperty: 'broader claim' } }), /only the tested property/);
  await assert.rejects(action({ actionId: 'crucible-learning-independent-verify', projectId: 'project-a', candidateId: 'candidate-1', verification: { ...base, experimentBoundary: 'all systems' } }), /inherit experiment boundaries/);
});

test('verified promotion is versioned and retrieval is read-only rather than proof', async () => {
  const { registration, telemetry, files } = loadPlugin(); const action = registration.slots['project-actions']; await advanceToCausal(registration);
  await action({ actionId: 'crucible-learning-independent-verify', projectId: 'project-a', candidateId: 'candidate-1', verification: { verifierId: 'verifier-2', independent: true, testedProperty: learningCandidate().claim, experimentBoundary: learningCandidate().claimBoundary, result: 'passed', verifiedAt: at, proofSha256: 'b'.repeat(64) } });
  const promoted = await action({ actionId: 'crucible-learning-promote', projectId: 'project-a', candidateId: 'candidate-1', at });
  assert.equal(promoted.record.state, 'verified'); assert.equal(promoted.knowledge.versions[0].version, 1); assert.equal(promoted.knowledge.versions[0].proofSha256, 'b'.repeat(64));
  const retrieved = await action({ actionId: 'crucible-learning-retrieve', projectId: 'project-a' });
  assert.equal(retrieved.knowledge.activeVersion, 1); assert.equal(retrieved.candidates[0].state, 'verified');
  assert.ok(Object.keys(files).every((item) => item.startsWith('governingDocuments/.crucible-learning/project-a/')));
  assert.ok(telemetry.every((item) => item.payload.evidentiary === false));
});

test('raw telemetry and one-off repairs cannot promote even after every proof stage', async () => {
  for (const kind of ['raw-telemetry', 'one-off-repair', 'retrieval', 'correlation']) {
    const { registration } = loadPlugin(); const action = registration.slots['project-actions']; const candidate = learningCandidate({ kind }); await advanceToCausal(registration, candidate);
    await action({ actionId: 'crucible-learning-independent-verify', projectId: 'project-a', candidateId: 'candidate-1', verification: { verifierId: 'verifier-2', independent: true, testedProperty: candidate.claim, experimentBoundary: candidate.claimBoundary, result: 'passed', verifiedAt: at, proofSha256: 'c'.repeat(64) } });
    await assert.rejects(action({ actionId: 'crucible-learning-promote', projectId: 'project-a', candidateId: 'candidate-1', at }), /can never be promoted/);
  }
});

test('contradictory claims quarantine instead of overwriting active knowledge', async () => {
  const { registration } = loadPlugin(); const first = learningCandidate(); await promoteCandidate(registration, first);
  const conflict = learningCandidate({ id: 'candidate-2', claim: 'repair X does not cause test Y to pass' });
  const result = await promoteCandidate(registration, conflict, 'd');
  assert.equal(result.quarantined, true); assert.equal(result.record.state, 'quarantined'); assert.equal(result.record.candidate.classification, 'Crucible Issue');
  assert.equal(result.knowledge.activeVersion, 1); assert.equal(result.knowledge.versions.length, 1);
});

test('verified knowledge supports explicit rollback to a prior version', async () => {
  const { registration } = loadPlugin(); const action = registration.slots['project-actions'];
  await promoteCandidate(registration, learningCandidate());
  await promoteCandidate(registration, learningCandidate({ id: 'candidate-2' }), 'd');
  const result = await action({ actionId: 'crucible-learning-rollback', projectId: 'project-a', targetVersion: 1, at, reason: 'regression discovered' });
  assert.equal(result.knowledge.activeVersion, 1); assert.equal(result.knowledge.versions[0].status, 'active'); assert.equal(result.knowledge.versions[1].status, 'rolled-back');
});

test('OIDC identity is verified with trusted RS256 signature and exact project bindings', async () => {
  const { registration } = loadPlugin(); const action = registration.slots['project-actions']; const fixture = oidcFixture();
  const result = await action({ actionId: 'crucible-learning-oidc-verify', identity: fixture.identity, oidcToken: fixture.token, oidcSubject: fixture.claims.sub });
  assert.equal(result.result.project_id, 'project-a');
  await assert.rejects(action({ actionId: 'crucible-learning-oidc-verify', identity: { ...fixture.identity, projectId: 'project-b' }, oidcToken: fixture.token, oidcSubject: fixture.claims.sub }), /not bound/);
});

test('weekly transport is encrypted, authenticated, project-bound, and never persists its key', async () => {
  const { registration, files, telemetry } = loadPlugin(); const action = registration.slots['project-actions']; const fixture = oidcFixture(); const masterKey = nodeCrypto.randomBytes(32).toString('base64url');
  const weeklyPayload = { schemaVersion: 1, projectId: 'project-a', week: '2026-W35', candidateEvidence: [{ id: 'candidate-1' }], verifiedKnowledge: [] };
  const encrypted = await action({ actionId: 'crucible-learning-weekly-encrypt', identity: fixture.identity, oidcToken: fixture.token, oidcSubject: fixture.claims.sub, masterKey, week: '2026-W35', weeklyPayload });
  assert.equal(encrypted.result.algorithm, 'A256GCM-HKDF-SHA256'); assert.doesNotMatch(encrypted.result.ciphertext, /candidate-1/);
  const decrypted = await action({ actionId: 'crucible-learning-weekly-decrypt', identity: fixture.identity, oidcToken: fixture.token, oidcSubject: fixture.claims.sub, masterKey, week: '2026-W35', envelope: encrypted.result });
  assert.deepEqual(JSON.parse(JSON.stringify(decrypted.result)), weeklyPayload);
  await assert.rejects(action({ actionId: 'crucible-learning-weekly-decrypt', identity: { ...fixture.identity, projectId: 'project-b' }, oidcToken: fixture.token, oidcSubject: fixture.claims.sub, masterKey, week: '2026-W35', envelope: encrypted.result }), /not bound/);
  const tamperedBytes = Buffer.from(encrypted.result.ciphertext, 'base64url'); tamperedBytes[0] ^= 1;
  const tampered = { ...encrypted.result, ciphertext: tamperedBytes.toString('base64url') };
  await assert.rejects(action({ actionId: 'crucible-learning-weekly-decrypt', identity: fixture.identity, oidcToken: fixture.token, oidcSubject: fixture.claims.sub, masterKey, week: '2026-W35', envelope: tampered }), /authentication failed/);
  assert.doesNotMatch(JSON.stringify(files), new RegExp(masterKey)); assert.doesNotMatch(JSON.stringify(telemetry), new RegExp(masterKey)); assert.ok(telemetry.every((item) => item.payload.evidentiary === false));
});
