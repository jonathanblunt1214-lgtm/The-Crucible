const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { runHostedProof } = require('../src/hostedLearningProof');

const AT = '2026-08-31T21:00:00.000Z';
const PROJECT = 'github:owner/repo';
const CLAIM = 'The map method returns a new array and does not modify the original array.';
const SCOPE = 'Node.js ordinary dense arrays of numbers';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// The restored real corpus, in exactly the shape hostedSourceBundle.stage() produces, with the
// durable store filled by the real extraction worker reading the real document files. The
// hosted proof has no fixture fallback, so this is the only way it can reach R4.
function buildCorpus(base, documents) {
  const bundleRoot = path.join(base, 'bundle');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  const links = documents.map((doc) => {
    const digest = sha256(doc.content);
    const durablePath = path.join(bundleRoot, 'sources', `${digest}.txt`);
    fs.writeFileSync(durablePath, doc.content);
    return { id: doc.url, state: 'claim-extraction-forced-pending', url: doc.url, finalUrl: doc.url, contentType: 'text/plain', contentSha256: digest, durablePath, retrievedAt: AT };
  });
  const queueFile = path.join(bundleRoot, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify({ schemaVersion: 1, projectId: PROJECT, updatedAt: AT, documents: [], links }, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, projectId: PROJECT, repository: 'owner/repo', ref: 'refs/heads/development', sourceFiles: links.map((l) => ({ name: `${l.contentSha256}.txt`, sha256: l.contentSha256, bytes: 1 })) }, null, 2)}\n`);
  const scopeFile = path.join(base, 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify({ declarations: [{ claim: CLAIM, claimScope: SCOPE, generalizationBoundary: 'Does not cover sparse arrays, proxies, subclasses, or host objects.', language: 'javascript' }] }, null, 2));
  return { bundleRoot, queueFile, scopeFile };
}

const documents = () => ([
  { url: 'https://example.edu/arrays', content: `Working with arrays in JavaScript.\n${CLAIM} Callers keep the original values for later work.` },
  { url: 'https://example.org/iteration', content: `A reference on iteration helpers.\nCallbacks receive each element in turn. ${CLAIM} Chaining further calls stays predictable.` },
]);

// The proof's own store root, seeded by the real worker so the candidates it evaluates are
// extracted from documents rather than constructed.
function seedStore(root, queueFile) {
  const storeRoot = path.join(root, 'store');
  fs.mkdirSync(storeRoot, { recursive: true });
  new ClaimExtractionWorker({ queueFile, projectId: PROJECT, learningRoot: storeRoot, now: () => AT }).run();
  return storeRoot;
}

test('GitHub-hosted proof persists encrypted project-bound state and restores it restart-safe', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-proof-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const encrypted = path.join(base, 'cache', 'state.json');
  const report = path.join(base, 'report.json');
  const { bundleRoot, queueFile, scopeFile } = buildCorpus(base, documents());
  const common = { encryptedFile: encrypted, reportFile: report, key: Buffer.alloc(32, 7).toString('base64'), repository: 'owner/repo', ref: 'refs/heads/development', bundleRoot, scopeDeclarationFile: scopeFile, now: () => AT };

  const firstRoot = path.join(base, 'one');
  seedStore(firstRoot, queueFile);
  const first = await runHostedProof({ ...common, root: firstRoot, runId: '1' });
  assert.equal(first.restoredEncryptedState, false);
  // R4-R6 are satisfied by learning from the real documents. R7 and R8 are reported as the
  // readiness gate judges them against this corpus, not asserted: R7 previously superseded a
  // candidate the proof built from its own hardcoded claim, and R8's retrieval cases ran
  // against a stubbed fetch with three of the eight compared against themselves. A two-document
  // corpus genuinely cannot demonstrate either, and the honest state is pending.
  assert.deepEqual(first.gates.map((item) => item.state), ['satisfied', 'satisfied', 'satisfied', 'pending', 'pending']);
  assert.equal(first.supersession.satisfied, false);
  assert.match(first.supersession.reason, /no further source in the corpus/, 'R7 says what the corpus could not supply');
  assert.equal(first.supersession.promotionAuthorized, false);

  // Every safety behaviour carries evidence or a reason, and only demonstrated ones are
  // reported as evidence to the gate.
  assert.equal(first.safetyBehaviours.length, 8);
  for (const behaviour of first.safetyBehaviours) assert.ok(behaviour.satisfied ? behaviour.evidence : behaviour.reason);
  assert.ok(first.safetyEvidence.includes('kill-switch'), 'refusals are provable against a real retriever with its real fetch');
  assert.ok(first.safetyEvidence.includes('blocked-source'));
  assert.ok(first.safetyEvidence.includes('duplicate-claim'), 'one claim from two real documents is real deduplication evidence');
  assert.ok(first.safetyUnsatisfied.some((item) => item.behaviour === 'contradiction-quarantine'));
  for (const behaviour of first.safetyBehaviours) {
    assert.ok(first.safetyEvidence.includes(behaviour.behaviour) === behaviour.satisfied, 'nothing undemonstrated is listed as evidence');
  }
  assert.equal(first.outOfScopeRetrievalCount, 0);
  assert.doesNotMatch(fs.readFileSync(encrypted, 'utf8'), /The map method/, 'the claim never appears in the ciphertext');

  const secondRoot = path.join(base, 'two');
  seedStore(secondRoot, queueFile);
  const second = await runHostedProof({ ...common, root: secondRoot, runId: '2' });
  assert.equal(second.restoredEncryptedState, true);
  assert.ok(second.revision > first.revision);
  assert.equal(second.projectId, PROJECT);
  assert.equal(second.authorizesPromotion, false);
});

test('the hosted proof has no fixture fallback and stops when the corpus cannot supply', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-proof-stop-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const report = path.join(base, 'report.json');
  const common = { encryptedFile: path.join(base, 'cache', 'state.json'), reportFile: report, key: Buffer.alloc(32, 7).toString('base64'), repository: 'owner/repo', ref: 'refs/heads/development', now: () => AT };

  // No restored corpus at all: it refuses rather than inventing sources.
  await assert.rejects(() => runHostedProof({ ...common, root: path.join(base, 'none'), runId: '1' }), /has no fixture fallback/);

  // A corpus with only one source cannot corroborate, so the gates report unsatisfied.
  const { bundleRoot, queueFile, scopeFile } = buildCorpus(base, [documents()[0]]);
  const root = path.join(base, 'single');
  seedStore(root, queueFile);
  await assert.rejects(
    () => runHostedProof({ ...common, root, runId: '2', bundleRoot, scopeDeclarationFile: scopeFile }),
    /two or more independently identified sources/,
  );
  const stopped = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(stopped.learnedFromRealCorpus, false);
  assert.deepEqual(stopped.gates.map((item) => item.state), ['unsatisfied', 'unsatisfied', 'unsatisfied', 'unsatisfied', 'unsatisfied']);
  assert.equal(stopped.authorizesPromotion, false);
});
