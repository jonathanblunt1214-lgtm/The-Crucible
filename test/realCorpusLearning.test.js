const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { DurableScientificLearningStore } = require('../src/scientificLearning');
const { corroboratedClaims, readScopeDeclarations, learnFromRealCorpus } = require('../src/realCorpusLearning');

const PROJECT = 'github:owner/repo';
const AT = '2026-09-01T00:00:00.000Z';
const CLAIM = 'The map method returns a new array and does not modify the original array.';
const SCOPE = 'Node.js ordinary dense arrays of numbers';
const PROOF = "const input=[1,2,3];const output=input.map(x=>x*2);if(output===input)process.exit(1);if(JSON.stringify(input)!=='[1,2,3]')process.exit(1);if(JSON.stringify(output)!=='[2,4,6]')process.exit(1);const empty=[].map(x=>x);if(!Array.isArray(empty)||empty.length!==0)process.exit(1);";

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-corpus-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Builds exactly what hostedSourceBundle.stage() produces on a runner, then fills the durable
// store by running the REAL extraction worker over the REAL document files. Nothing here
// fabricates a candidate: every one is extracted from a document on disk.
function buildBundle(dir, documents) {
  const bundleRoot = path.join(dir, 'bundle');
  const learningRoot = path.join(dir, 'learning');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  fs.mkdirSync(learningRoot, { recursive: true });

  const links = documents.map((doc) => {
    const digest = sha256(doc.content);
    fs.writeFileSync(path.join(bundleRoot, 'sources', `${digest}.txt`), doc.content);
    return { id: doc.url, state: 'claim-extraction-forced-pending', url: doc.url, finalUrl: doc.url, contentType: 'text/plain', contentSha256: digest, durablePath: path.join(bundleRoot, 'sources', `${digest}.txt`), retrievedAt: AT };
  });
  const queue = { schemaVersion: 1, projectId: PROJECT, updatedAt: AT, documents: [], links };
  const queueFile = path.join(bundleRoot, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, projectId: PROJECT, repository: 'owner/repo', ref: 'refs/heads/development', queueSha256: sha256(fs.readFileSync(queueFile, 'utf8')), sourceFiles: links.map((l) => ({ name: `${l.contentSha256}.txt`, sha256: l.contentSha256, bytes: 1 })) }, null, 2)}\n`);

  // The real worker, over the real files.
  new ClaimExtractionWorker({ queueFile, projectId: PROJECT, learningRoot, now: () => AT }).run();
  return { bundleRoot, learningRoot, queueFile };
}

const harnessesFor = () => {
  const execute = () => execFileSync(process.execPath, ['-e', PROOF], { stdio: 'ignore' });
  return {
    experiment: { id: 'javascript-controlled-runner', run: async ({ candidate, hypothesis }) => { execute(); return { schemaVersion: 1, candidateId: candidate.id, projectId: candidate.projectId, hypothesis, testedProperty: candidate.claim, experimentBoundary: candidate.claimBoundary, controls: ['identity reference control', 'empty-input control'], causalIsolation: { method: 'single-variable intervention on the mapped callback', result: 'only the returned array changes', correlationOnly: false }, negativeTests: ['the returned array is never the input reference'], regressionTests: ['dense-array mapping still yields expected values'], scopeProof: SCOPE, generalizationResult: 'not generalized beyond the experiment boundary', contradictionResult: 'none', completedAt: AT }; } },
    verifier: { id: 'javascript-independent-runner', run: async ({ candidate, experimentalProof }) => { execute(); return { verifierId: 'javascript-independent-runner', independent: true, testedProperty: candidate.claim, experimentBoundary: experimentalProof.experimentBoundary, result: 'passed', verifiedAt: AT }; } },
  };
};

const twoRealDocuments = () => ([
  { url: 'https://example.edu/arrays', content: `Working with arrays in JavaScript.\n${CLAIM} Callers keep the original values for later work.` },
  { url: 'https://example.org/iteration', content: `A reference on iteration helpers.\nCallbacks receive each element in turn. ${CLAIM} Chaining further calls stays predictable.` },
]);

function writeDeclaration(dir, overrides = {}) {
  const file = path.join(dir, 'scope.json');
  fs.writeFileSync(file, JSON.stringify({ declarations: [{ claim: CLAIM, claimScope: SCOPE, generalizationBoundary: 'Does not cover sparse arrays, proxies, subclasses, or host objects.', language: 'javascript', ...overrides }] }, null, 2));
  return file;
}

test('finds only claims that two independently identified real sources actually assert', (t) => {
  const dir = workspace(t);
  const { learningRoot } = buildBundle(dir, twoRealDocuments());
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  assert.ok(store.read().candidateRecords.length >= 2, 'the real worker extracted candidates from the real documents');

  const corroborated = corroboratedClaims(store);
  const found = corroborated.find((item) => item.claimKey.includes('map method returns a new array'));
  assert.ok(found, 'the claim both documents assert is corroborated');
  assert.equal(found.sourceCount, 2);
  assert.equal(new Set(found.sourceIds).size, 2, 'corroboration requires two distinct sources');
});

test('one document agreeing with itself is never corroboration', (t) => {
  const dir = workspace(t);
  const [first] = twoRealDocuments();
  const { learningRoot } = buildBundle(dir, [{ ...first, content: `${first.content}\n${CLAIM} Repeating a sentence does not make it corroborated.` }]);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  assert.deepEqual(corroboratedClaims(store), [], 'a single source can never corroborate itself');
});

test('fails closed when the real corpus has nothing corroborated, and says so', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot } = buildBundle(dir, [twoRealDocuments()[0]]);
  const result = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: writeDeclaration(dir), harnessesFor, now: () => AT });
  assert.equal(result.learned, false);
  assert.match(result.reason, /no claim asserted by two or more independently identified sources/);
  assert.deepEqual(result.gates, { R4: false, R5: false, R6: false });
});

test('fails closed when a corroborated claim has no owner-declared scope, and never infers one', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot } = buildBundle(dir, twoRealDocuments());
  const result = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: null, harnessesFor, now: () => AT });
  assert.equal(result.learned, false);
  assert.match(result.reason, /none has an owner-declared scope, and a scope is never inferred/);
  assert.ok(result.corpus.corroboratedClaims >= 1, 'the corroboration is still reported so the next step is obvious');
  assert.equal(result.gates.R5, false);
});

test('refuses a bundle belonging to another project', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot } = buildBundle(dir, twoRealDocuments());
  await assert.rejects(
    () => learnFromRealCorpus({ bundleRoot, learningRoot, projectId: 'github:someone/else', scopeDeclarationFile: writeDeclaration(dir), harnessesFor, now: () => AT }),
    /belongs to github:owner\/repo, not github:someone\/else/,
  );
});

test('a scope declaration must be complete, never partially guessed', (t) => {
  const dir = workspace(t);
  for (const missing of ['claim', 'claimScope', 'generalizationBoundary']) {
    const file = path.join(dir, `bad-${missing}.json`);
    const declaration = { claim: CLAIM, claimScope: SCOPE, generalizationBoundary: 'x', language: 'javascript' };
    delete declaration[missing];
    fs.writeFileSync(file, JSON.stringify({ declarations: [declaration] }));
    assert.throws(() => readScopeDeclarations(file), new RegExp(`declarations\\[0\\]\\.${missing} is required`));
  }
});

test('learns for real: extracted candidates from two real documents reach verified knowledge', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot } = buildBundle(dir, twoRealDocuments());
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  assert.equal(store.read().knowledgeVersions.length, 0, 'nothing is verified before the run');

  const result = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: writeDeclaration(dir), harnessesFor, now: () => AT });

  assert.equal(result.learned, true, result.reason || 'the real corpus produced verified knowledge');
  assert.equal(result.gates.R4, true);
  assert.equal(result.gates.R5, true);
  assert.equal(result.gates.R6, true);
  assert.equal(result.claim, CLAIM);
  assert.equal(result.claimScope, SCOPE);
  assert.equal(new Set(result.sourceIds).size, 2, 'promoted on two independent real sources');
  assert.notEqual(result.experimentExecutorId, result.independentVerifierId);
  assert.equal(result.promotionAuthorized, false, 'learning never authorizes release');

  // The store really holds it, and it came from extracted candidates, not fabricated ones.
  const after = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT }).read();
  assert.equal(after.knowledgeVersions.length, 1);
  const promoted = after.candidateRecords.find((item) => item.candidate.id === result.candidateIds[0]);
  assert.equal(promoted.candidate.kind, 'extracted-source-assertion');
  assert.match(promoted.candidate.provenance.contentSha256, /^[a-f0-9]{64}$/);
  assert.match(promoted.candidate.claimBoundary, /retrieved content only/, 'the candidate still carries its own source provenance');
});
