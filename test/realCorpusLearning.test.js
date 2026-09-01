const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { DurableScientificLearningStore } = require('../src/scientificLearning');
const { readBundle, corpusCandidateStore, corroboratedClaims, reviewCorroborated, readScopeDeclarations, learnFromRealCorpus } = require('../src/realCorpusLearning');

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
    experiment: { id: 'javascript-controlled-runner', run: async ({ candidate, hypothesis, testPlanSha256, testPlan }) => { execute(); return { schemaVersion: 1, candidateId: candidate.id, projectId: candidate.projectId, hypothesis, testedProperty: candidate.claim, experimentBoundary: (testPlan && testPlan.experimentBoundary) || candidate.claimBoundary, controls: ['identity reference control', 'empty-input control'], causalIsolation: { method: 'single-variable intervention on the mapped callback', result: 'only the returned array changes', correlationOnly: false }, negativeTests: ['the returned array is never the input reference'], regressionTests: ['dense-array mapping still yields expected values'], scopeProof: SCOPE, generalizationResult: 'not generalized beyond the experiment boundary', contradictionResult: 'none', completedAt: AT, testPlanSha256 }; } },
    verifier: { id: 'javascript-independent-runner', run: async ({ candidate, experimentalProof, testPlanSha256, testPlan }) => { execute(); return { verifierId: 'javascript-independent-runner', independent: true, testedProperty: candidate.claim, experimentBoundary: experimentalProof.experimentBoundary, result: 'passed', verifiedAt: AT, testPlanSha256 }; } },
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

// The defect this pins, twice over: the hosted proof first guarded on "does the store hold
// any knowledge versions", so fixture state in the encrypted cache skipped real learning
// entirely; then on a fixture source-type marker, which the synthetic sources did not carry
// because they were built through the same extraction path as real ones. Only membership in
// the restored corpus separates them.
test('only knowledge whose source is actually in the restored corpus counts as learned', (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot } = buildBundle(dir, twoRealDocuments());
  const { hasRealCorpusKnowledge, readBundle } = require('../src/realCorpusLearning');
  const bundle = readBundle(bundleRoot);
  const realHash = bundle.manifest.sourceFiles[0].sha256;

  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  assert.equal(hasRealCorpusKnowledge(store, bundle), false, 'extracted candidates alone are not verified knowledge');

  // A synthetic source indistinguishable by shape: same sourceType, a valid hash, a plausible
  // URL. It is not in the corpus, so it does not count.
  const synthetic = { read: () => ({
    knowledgeVersions: [{ version: 1, candidateId: 'cycle-synthetic' }],
    candidateRecords: [{ candidate: { id: 'cycle-synthetic', provenance: { sourceType: 'retrieved-web-document', sourceId: 'https://proof.example.edu/arrays', contentSha256: 'a'.repeat(64) } } }],
  }) };
  assert.equal(hasRealCorpusKnowledge(synthetic, bundle), false, 'a fixture that looks like a real document still is not one');

  // The same shape, but its content hash is one the restored manifest attests.
  const real = { read: () => ({
    knowledgeVersions: [{ version: 1, candidateId: 'extracted-real' }],
    candidateRecords: [{ candidate: { id: 'extracted-real', provenance: { sourceType: 'retrieved-web-document', sourceId: 'https://example.edu/arrays', contentSha256: realHash } } }],
  }) };
  assert.equal(hasRealCorpusKnowledge(real, bundle), true);

  assert.equal(hasRealCorpusKnowledge(real, null), false, 'with no restored corpus, nothing can be proven to come from it');
});

// The defect this replaced: agreement was exact string equality, so two independently written
// documents essentially never matched and a 403-source corpus corroborated nothing at all.
test('corroborates two real documents that assert one claim in different words', (t) => {
  const dir = workspace(t);
  const restated = 'The map method returns a new array and does not modify the original input.';
  const { learningRoot } = buildBundle(dir, [
    { url: 'https://example.edu/arrays', content: `Working with arrays in JavaScript.\n${CLAIM} Callers keep the original values for later work.` },
    { url: 'https://example.org/reference', content: `A reference on iteration helpers.\n${restated} Chaining further calls stays predictable.` },
  ]);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });

  const found = corroboratedClaims(store).find((item) => item.claimKey.includes('map method returns a new array'));
  assert.ok(found, 'differently worded assertions of one claim are corroboration');
  assert.equal(found.agreement, 'semantic', 'the report never hides that this was a wording judgement');
  assert.equal(new Set(found.sourceIds).size, 2);
  assert.deepEqual([...found.assertedAs].sort(), [CLAIM, restated].sort(), 'each source keeps its own sentence');

  // And the boundary that makes the looser test safe: a document asserting the opposite is
  // never grouped with them, however much wording it shares.
  const contradicting = workspace(t);
  const { learningRoot: other } = buildBundle(contradicting, [
    { url: 'https://example.edu/arrays', content: `Working with arrays in JavaScript.\n${CLAIM} Callers keep the original values for later work.` },
    { url: 'https://example.org/contrary', content: `A contrary reference.\nThe map method returns a new array and does modify the original array. Callers should copy first.` },
  ]);
  const contrary = corroboratedClaims(new DurableScientificLearningStore({ root: other, projectId: PROJECT }));
  assert.equal(contrary.length, 0, 'opposite claims are a contradiction, never corroboration');
});

// The second defect of the same family as measuring gates against fixtures: the proof restored
// two stores and read the wrong one. The corpus's extracted candidates live in the learning
// state staged inside the bundle, not in the persistent store the proof writes promotions to,
// so corroboration was searching a store holding almost no extracted evidence and would have
// found nothing however sameness was decided.
test('corroborates candidates held in the corpus own learning state, not only the persistent store', async (t) => {
  const dir = workspace(t);
  const restated = 'The map method returns a new array and does not modify the original input.';
  const documents = [
    { url: 'https://example.edu/arrays', content: `Working with arrays in JavaScript.\n${CLAIM} Callers keep the original values for later work.` },
    { url: 'https://example.org/reference', content: `A reference on iteration helpers.\n${restated} Chaining further calls stays predictable.` },
  ];

  // Extraction writes into the BUNDLE root, exactly as the owner's staged learning state does.
  const staged = path.join(dir, 'staged');
  const { bundleRoot } = buildBundle(staged, documents);
  const stagedStoreFile = path.join(staged, 'learning', `${sha256(PROJECT)}.learning.json`);
  fs.copyFileSync(stagedStoreFile, path.join(bundleRoot, path.basename(stagedStoreFile)));
  const manifestFile = path.join(bundleRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.learningFile = path.basename(stagedStoreFile);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const bundle = readBundle(bundleRoot);
  assert.equal(path.basename(bundle.learningFile), path.basename(stagedStoreFile), 'the bundle exposes its own learning state');
  const corpusStore = corpusCandidateStore(bundle, bundleRoot, PROJECT);
  assert.ok(corpusStore.read().candidateRecords.length >= 2, 'the corpus store holds the extracted candidates');

  // A persistent store that has never seen any of it - which is what the hosted run restores.
  const emptyRoot = path.join(dir, 'persistent');
  fs.mkdirSync(emptyRoot, { recursive: true });
  const persistent = new DurableScientificLearningStore({ root: emptyRoot, projectId: PROJECT });
  assert.equal(persistent.read().candidateRecords.length, 0);
  assert.equal(corroboratedClaims(persistent).length, 0, 'the persistent store alone corroborates nothing');

  const report = await learnFromRealCorpus({ bundleRoot, learningRoot: emptyRoot, projectId: PROJECT, scopeDeclarationFile: writeDeclaration(dir), harnessesFor, now: () => AT });
  assert.equal(report.corpus.corpusLearningStateRestored, true);
  assert.ok(report.corpus.corpusCandidateRecords >= 2, 'the corpus candidates were counted');
  assert.equal(report.learned, true, report.reason);
  assert.equal(report.corroborationRoute, 'corpus-corroborated');
  assert.equal(report.ingestedFromCorpus.length, 2, 'both candidates were taken into custody from the corpus, not invented');
  assert.deepEqual(report.gates, { R4: true, R5: true, R6: true });
  assert.equal(report.promotionAuthorized, false);
});

// "Use all of them" was not possible: a run evaluated the first usable declaration and stopped,
// so declaring ten scopes tested one and left nine untouched with nothing in the report to say so.
test('every declared claim is evaluated in its own right, not just the first', async (t) => {
  const dir = workspace(t);
  const second = 'The filter method returns a new array and does not modify the original array.';
  const { bundleRoot, learningRoot } = buildBundle(dir, [
    { url: 'https://example.edu/arrays', content: `Working with arrays.\n${CLAIM} Callers keep the original values for later work.\n${second} The predicate decides which elements survive.` },
    { url: 'https://other.org/iteration', content: `A reference on iteration helpers.\n${CLAIM} Chaining further calls stays predictable.\n${second} Every retained element keeps its order.` },
  ]);
  const file = path.join(dir, 'two-scopes.json');
  const shared = { claimScope: SCOPE, generalizationBoundary: 'Does not cover sparse arrays, proxies, subclasses, or host objects.', language: 'javascript' };
  fs.writeFileSync(file, JSON.stringify({ declarations: [{ claim: CLAIM, ...shared }, { claim: second, ...shared }] }, null, 2));

  const report = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: file, harnessesFor, now: () => AT });
  assert.equal(report.declarationsEvaluated, 2, 'both declarations were carried through');
  assert.equal(new Set(report.evaluations.map((item) => item.claim)).size, 2, 'each declaration got its own outcome');
  for (const evaluation of report.evaluations) {
    assert.equal(evaluation.promotionAuthorized, false);
    assert.ok(evaluation.learned === true || typeof evaluation.reason === 'string', 'every evaluation says what happened to it');
  }
  assert.ok(report.claimsPromoted >= 1, report.reason);
});

// Running every corroborated claim through the real reviewer needs no declaration and writes
// nothing, so a stopped run can still say which claims could ever be tested.
test('every corroborated claim gets a verdict from the real critical reviewer', (t) => {
  const dir = workspace(t);
  const ambiguous = 'It is usually written to provide a clear and concise explanation for beginner programmers.';
  const { learningRoot } = buildBundle(dir, [
    { url: 'https://example.edu/arrays', content: `Working with arrays.\n${CLAIM} Callers keep the original values.\n${ambiguous} More prose follows here.` },
    { url: 'https://other.org/iteration', content: `A reference on iteration.\n${CLAIM} Chaining stays predictable.\n${ambiguous} More prose follows here.` },
  ]);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  const records = store.read().candidateRecords;
  const corroborated = corroboratedClaims(records);
  assert.ok(corroborated.length >= 2, 'both claims corroborate');

  const reviews = reviewCorroborated(corroborated, records, { projectId: PROJECT, at: AT });
  assert.equal(reviews.length, corroborated.length, 'no corroborated claim is left unreviewed');
  for (const review of reviews) {
    assert.equal(review.promotionAuthorized, false, 'reviewing never authorizes anything');
    assert.equal(review.scopeDeclared, false, 'no scope was declared or invented to make this possible');
  }
  const flagged = reviews.find((review) => review.claim === ambiguous);
  assert.equal(flagged.testable, false, 'the reviewer refuses a claim whose wording it cannot pin down');
  assert.ok(flagged.ambiguities.length > 0);
  assert.match(flagged.nextAction, /measurable terms/);

  assert.equal(store.read().candidateRecords.length, records.length, 'the review pass wrote nothing');
});
