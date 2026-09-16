const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { runHostedProof } = require('../src/hostedLearningProof');
const { harnessesForDeclaration } = require('../src/hostedExperimentHarnesses');

// This replaces an assertion that the two hardcoded harness ids differed - which was true, and
// was the only thing separating a "controlled experiment" from its "independent verifier" while
// both ran the same array-map closure. Two ids that differ is not independence, so what is
// asserted now is that the pair differs in measurement method and that the closure is gone.
test('the hosted proof resolves a real harness per language instead of one closure for every claim', () => {
  const java = harnessesForDeclaration({ language: 'java' }, { projectId: 'github:owner/repo' });
  assert.equal(java.experiment.id, 'jdk-compile-and-execute', 'the experiment executes the fixture');
  assert.equal(java.verifier.id, 'jdk-compiler-tree', 'the verifier reads its source tree instead');
  const javascript = harnessesForDeclaration({ language: 'javascript' }, { projectId: 'github:owner/repo' });
  assert.equal(javascript.experiment.id, 'node-execute');
  assert.equal(javascript.verifier.id, 'typescript-compiler-api');
  // Different languages must not collapse onto one harness, which is exactly what made a Java
  // claim testable by a JavaScript snippet.
  assert.notEqual(java.experiment.id, javascript.experiment.id);
  assert.throws(() => harnessesForDeclaration({ language: 'cobol' }, { projectId: 'github:owner/repo' }), /CRU-0050/);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'hostedLearningProof.js'), 'utf8');
  assert.doesNotMatch(source, /github-controlled-runner|github-independent-runner/, 'the hardcoded pair must stay deleted');
  assert.doesNotMatch(source, /input\.map\(\(value\)=>value\*2\)/, 'the array-map closure must stay deleted');
});

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
  // Digestion's two pathways are reported separately, so an impeded intake is never read as an
  // empty result from the learner.
  assert.equal(first.intakePathways.learning.pathway, 'intake-to-learning');
  assert.equal(first.intakePathways.diagnostics.pathway, 'intake-to-diagnostics');
  assert.equal(first.intakePathways.diagnostics.isEvidence, false);
  assert.ok(first.intakePathways.learning.usableCandidates >= 2, 'the real documents produced usable evidence');
  assert.equal(first.intakePathways.blocked, null, 'nothing is blocked when digestion is healthy and produced evidence');

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

// The run that first reached the end of this proof printed "passed R4-R8" and exited 0 while R8
// was pending, because the completion line was attached to the promise resolving rather than to
// the gates. A green check is the thing a reader trusts here, so this asserts the reporter cannot
// produce one unless every gate it names is satisfied.
test('the completion report cannot claim a pass while any gate is unsatisfied', () => {
  const { reportCompletion } = require('../src/hostedLearningProof');
  const said = [];
  const log = (line) => said.push(line);

  const pending = reportCompletion({ revision: 60, gates: [
    { id: 'R4', state: 'satisfied' }, { id: 'R5', state: 'satisfied' }, { id: 'R6', state: 'satisfied' },
    { id: 'R7', state: 'satisfied' }, { id: 'R8', state: 'pending' },
  ] }, log, log);
  assert.equal(pending, 1, 'one pending gate makes the run red');
  const pendingText = said.join('\n');
  // Anchored on the pass wording itself: the red line legitimately contains "not all satisfied".
  assert.doesNotMatch(pendingText, /passed R4-R8|R4-R8 all satisfied/, 'nothing may read as a pass');
  assert.match(pendingText, /R8 pending/, 'it names the gate that is not satisfied');
  assert.match(pendingText, /retained artifact still carries the durable state/, 'a red run does not break the chain');

  said.length = 0;
  const all = reportCompletion({ revision: 61, gates: ['R4', 'R5', 'R6', 'R7', 'R8'].map((id) => ({ id, state: 'satisfied' })) }, log, log);
  assert.equal(all, 0);
  assert.match(said.join('\n'), /R4-R8 all satisfied at revision 61/);
  assert.match(said.join('\n'), /authorizes no promotion/, 'passing every gate is still not authorization');

  // An empty gate list is the absence of a measurement, not five passes.
  said.length = 0;
  assert.equal(reportCompletion({ revision: 62, gates: [] }, log, log), 1);
  assert.match(said.join('\n'), /no gate was reported at all/);

  // And the unconditional line is gone from the source, not merely unreachable.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'hostedLearningProof.js'), 'utf8');
  assert.doesNotMatch(source, /durable learning proof passed R4-R8/);
});
