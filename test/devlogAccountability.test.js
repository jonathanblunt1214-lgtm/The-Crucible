const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateAccountabilityRecord, assertAccountabilityRecord,
  materialClaims, auditDevlogAccountability, findFuturePlanning,
} = require('../src/devlogAccountability');
const { coordinationGate } = require('../src/coordinationGate');

function record(overrides = {}) {
  return {
    provider: 'anthropic',
    model: 'example-model',
    agent: 'session-b',
    taskId: 'extractor-repair',
    timestamp: '2026-09-03T17:00:00Z',
    role: 'mutator',
    action: 'Closed the end-tag hole in cleanText.',
    filesExamined: ['src/claimExtractionWorker.js'],
    filesChanged: ['src/claimExtractionWorker.js'],
    testsRun: ['node --test test/claimExtractionWorker.test.js'],
    results: '714/714 passed',
    repositoryStateChanged: true,
    ...overrides,
  };
}

function claim(taskId, status) {
  return { taskId, owner: { provider: 'anthropic', agent: 'b' }, scope: { paths: ['src/a.js'] }, purpose: 'p', status, acquiredAt: '2026-09-03T17:00:00Z', releasedAt: status === 'active' ? null : '2026-09-03T18:00:00Z' };
}

test('a complete accountability record identifies who did what, and with what result', () => {
  assert.deepEqual(validateAccountabilityRecord(record()), []);
  assert.deepEqual(assertAccountabilityRecord(record()), { ok: true });
});

test('an action that cannot be attributed is rejected', () => {
  for (const field of ['provider', 'taskId', 'timestamp', 'role', 'action']) {
    const findings = validateAccountabilityRecord(record({ [field]: '' }));
    assert.ok(findings.some((item) => item.includes(field)), `${field} is required`);
  }
  assert.ok(validateAccountabilityRecord(record({ repositoryStateChanged: undefined })).some((item) => /never left blank/.test(item)));
  assert.ok(validateAccountabilityRecord(record({ role: 'overlord' })).some((item) => /role must be one of/.test(item)));
  assert.ok(validateAccountabilityRecord(record({ timestamp: 'yesterday' })).some((item) => /ISO-8601/.test(item)));
});

test('a record cannot claim a change it does not list, or list changes it says it did not make', () => {
  assert.ok(validateAccountabilityRecord(record({ filesChanged: [] })).some((item) => /lists no filesChanged/.test(item)));
  assert.ok(validateAccountabilityRecord(record({ repositoryStateChanged: false })).some((item) => /says the repository did not change/.test(item)));
  assert.deepEqual(validateAccountabilityRecord(record({ repositoryStateChanged: false, filesChanged: [] })), []);
  assert.throws(() => assertAccountabilityRecord(record({ provider: '' })), (error) => error.crucibleCode === 'CRU-0035');
});

test('only claims that actually had their turn need a DEVLOG record', () => {
  assert.deepEqual(materialClaims([claim('a', 'active')]), []);
  assert.equal(materialClaims([claim('a', 'released'), claim('b', 'handed-off'), claim('c', 'active')]).length, 2);
});

test('DEVLOG entries are required for material mutation activity', () => {
  const claims = [claim('extractor-repair', 'released')];
  const missing = auditDevlogAccountability({ devlog: '# Development log\n\nnothing relevant here\n', claims });
  assert.equal(missing.findings.length, 1);
  assert.match(missing.findings[0].detail, /extractor-repair/);
  assert.match(missing.findings[0].detail, /must record what it did there/);

  const present = auditDevlogAccountability({ devlog: '- anthropic completed extractor-repair, exit 0\n', claims });
  assert.deepEqual(present.findings, []);
});

test('an active claim that has not finished is not yet owed a record', () => {
  assert.deepEqual(auditDevlogAccountability({ devlog: '', claims: [claim('in-flight', 'active')] }).findings, []);
});

test('DEVLOG records what happened; future intent belongs in AI-HANDOFF.json', () => {
  const planning = '# Development log\n\n## Command log archive\n\n### Session: x — 2026-09-03T17:00:00Z — Claude — mode:regular/default\n\n- Next session will implement the retriever rewrite.\n';
  const findings = findFuturePlanning(planning);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /Future intent belongs in AI-HANDOFF\.json/);

  const factual = '# Development log\n\n## Command log archive\n\n### Session: x — 2026-09-03T17:00:00Z — Claude — mode:regular/default\n\n- Implemented the retriever rewrite; 714/714 passed — started 2026-09-03T17:00:00Z, finished 2026-09-03T17:10:00Z, exit 0.\n';
  assert.deepEqual(findFuturePlanning(factual), []);
});

test('the coordination gate refuses overlapping claims, missing records and persisted credentials', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-coordination-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (handoff, devlog) => {
    fs.writeFileSync(path.join(root, 'AI-HANDOFF.json'), JSON.stringify(handoff));
    fs.writeFileSync(path.join(root, 'DEVLOG.md'), devlog);
  };

  // Two AIs holding the same scope stops the gate.
  write({ schemaVersion: 1, mutationClaims: [
    { taskId: 'task-a', owner: { provider: 'openai', agent: 'a' }, scope: { paths: ['src/'] }, purpose: 'p', status: 'active', acquiredAt: '2026-09-03T17:00:00Z' },
    { taskId: 'task-b', owner: { provider: 'anthropic', agent: 'b' }, scope: { paths: ['src/a.js'] }, purpose: 'p', status: 'active', acquiredAt: '2026-09-03T17:00:00Z' },
  ] }, '# Development log\n');
  assert.throws(() => coordinationGate(root), (error) => error.crucibleCode === 'CRU-0029' && /Exclusive mutation ownership failed/.test(error.message));

  // A finished claim with nothing in the log stops the gate.
  write({ schemaVersion: 1, mutationClaims: [claim('ghost-task', 'released')] }, '# Development log\n');
  assert.throws(() => coordinationGate(root), (error) => error.crucibleCode === 'CRU-0035');

  // A credential in a governance artifact stops the gate.
  write({ schemaVersion: 1, note: 'sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa', mutationClaims: [] }, '# Development log\n');
  assert.throws(() => coordinationGate(root), (error) => error.crucibleCode === 'CRU-0033');

  // Non-overlapping claims, recorded and credential-free, pass.
  write({ schemaVersion: 1, mutationClaims: [
    { taskId: 'task-a', owner: { provider: 'openai', agent: 'a' }, scope: { paths: ['src/a.js'] }, purpose: 'p', status: 'active', acquiredAt: '2026-09-03T17:00:00Z' },
    { taskId: 'task-b', owner: { provider: 'anthropic', agent: 'b' }, scope: { paths: ['src/b.js'] }, purpose: 'p', status: 'active', acquiredAt: '2026-09-03T17:00:00Z' },
  ] }, '# Development log\n');
  const result = coordinationGate(root);
  assert.equal(result.active, 2);
});

test('this repository passes its own coordination gate', () => {
  const result = coordinationGate(path.join(__dirname, '..'));
  assert.ok(result.claims >= 0);
});
