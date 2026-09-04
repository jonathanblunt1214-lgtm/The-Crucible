const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { DurableScientificLearningStore } = require('../src/scientificLearning');
const { routeThreeWayComparison } = require('../src/claimComparison');
const { readSourceContent, assertingSentence, verifyPairedDeclaration } = require('../src/pairedCorroboration');
const { readBundle, corroboratedClaims, readScopeDeclarations, learnFromRealCorpus } = require('../src/realCorpusLearning');

const PROJECT = 'github:owner/repo';
const AT = '2026-09-01T00:00:00.000Z';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Two documents that assert the same thing in genuinely different words. Neither sentence is a
// rewording of the other that any conservative wording test would accept, which is exactly the
// case owner pairing exists for.
const SPEC_SENTENCE = 'The map method returns a new array and does not modify the original array.';
const PROSE_SENTENCE = 'Every call to map provides a freshly built list, and the input it walks over stays untouched throughout.';
const OPPOSITE_SENTENCE = 'The map method returns a new array and does modify the original array.';

const SCOPE = 'Node.js ordinary dense arrays of numbers';
const PROOF = "const input=[1,2,3];const output=input.map(x=>x*2);if(output===input)process.exit(1);if(JSON.stringify(input)!=='[1,2,3]')process.exit(1);if(JSON.stringify(output)!=='[2,4,6]')process.exit(1);";

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-corroboration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Exactly what hostedSourceBundle.stage() leaves behind, including the relative durablePath,
// and the store filled by running the REAL extraction worker over the REAL files on disk.
function buildBundle(dir, documents, { runExtraction = true } = {}) {
  const bundleRoot = path.join(dir, 'bundle');
  const learningRoot = path.join(dir, 'learning');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  fs.mkdirSync(learningRoot, { recursive: true });

  const links = documents.map((doc) => {
    const digest = sha256(doc.content);
    fs.writeFileSync(path.join(bundleRoot, 'sources', `${digest}.txt`), doc.content);
    return { id: doc.url, state: 'claim-extraction-forced-pending', url: doc.url, finalUrl: doc.url, contentType: 'text/plain', contentSha256: digest, durablePath: `sources/${digest}.txt`, retrievedAt: AT };
  });
  const queue = { schemaVersion: 1, projectId: PROJECT, updatedAt: AT, documents: [], links };
  const queueFile = path.join(bundleRoot, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, projectId: PROJECT, repository: 'owner/repo', ref: 'refs/heads/development', queueSha256: sha256(fs.readFileSync(queueFile, 'utf8')), sourceFiles: links.map((l) => ({ name: `${l.contentSha256}.txt`, sha256: l.contentSha256, bytes: 1 })) }, null, 2)}\n`);

  if (runExtraction) {
    // Extraction needs an absolute path to read; the bundle records the relative one.
    const absolute = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    absolute.links = absolute.links.map((link) => ({ ...link, durablePath: path.join(bundleRoot, link.durablePath) }));
    const extractionQueue = path.join(dir, 'extraction-queue.json');
    fs.writeFileSync(extractionQueue, `${JSON.stringify(absolute, null, 2)}\n`);
    new ClaimExtractionWorker({ queueFile: extractionQueue, projectId: PROJECT, learningRoot, now: () => AT }).run();
  }
  return { bundleRoot, learningRoot, bundle: readBundle(bundleRoot) };
}

const twoDocuments = () => ([
  { url: 'https://example.edu/spec', content: `A specification note on array helpers.\n${SPEC_SENTENCE} Callers keep the original values for later work.` },
  { url: 'https://example.org/guide', content: `A practical guide to iteration.\n${PROSE_SENTENCE} Chaining further calls stays predictable for the reader.` },
]);

const harnessesFor = () => {
  const execute = () => execFileSync(process.execPath, ['-e', PROOF], { stdio: 'ignore' });
  return {
    experiment: { id: 'javascript-controlled-runner', run: async ({ candidate, hypothesis, testPlanSha256, testPlan }) => { execute(); return { schemaVersion: 1, candidateId: candidate.id, projectId: candidate.projectId, hypothesis, testedProperty: candidate.claim, experimentBoundary: (testPlan && testPlan.experimentBoundary) || candidate.claimBoundary, controls: ['identity reference control', 'empty-input control'], causalIsolation: { method: 'single-variable intervention on the mapped callback', result: 'only the returned array changes', correlationOnly: false }, negativeTests: ['the returned array is never the input reference'], regressionTests: ['dense-array mapping still yields expected values'], scopeProof: SCOPE, generalizationResult: 'not generalized beyond the experiment boundary', contradictionResult: 'none', completedAt: AT, testPlanSha256 }; } },
    verifier: { id: 'javascript-independent-runner', run: async ({ candidate, experimentalProof, testPlanSha256, testPlan }) => { execute(); return { verifierId: 'javascript-independent-runner', independent: true, testedProperty: candidate.claim, experimentBoundary: experimentalProof.experimentBoundary, result: 'passed', verifiedAt: AT, testPlanSha256 }; } },
  };
};

function declarationFile(dir, declaration) {
  const file = path.join(dir, 'scope.json');
  fs.writeFileSync(file, JSON.stringify({ declarations: [declaration] }, null, 2));
  return file;
}

const OWNER_DECLARATION = {
  claim: 'Mapping over an array produces a new array and leaves the original one unchanged.',
  claimScope: SCOPE,
  generalizationBoundary: 'Does not cover sparse arrays, proxies, subclasses, or host objects.',
  language: 'javascript',
  pairedSources: ['https://example.edu/spec', 'https://example.org/guide'],
  pairedAssertions: [SPEC_SENTENCE, PROSE_SENTENCE],
};

// The premise of the whole feature: these two documents really do agree, and no conservative
// wording test relates them. If this ever stops holding, the tests below stop meaning anything.
test('the two documents state one claim in words the wording test cannot relate', (t) => {
  const dir = workspace(t);
  const { learningRoot } = buildBundle(dir, twoDocuments());
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  assert.ok(store.read().candidateRecords.length >= 2, 'the real worker extracted from the real documents');
  assert.equal(corroboratedClaims(store).length, 0, 'semantic corroboration alone finds nothing here');
});

test('a verified pairing carries each document\'s own sentence, never the owner\'s wording', (t) => {
  const dir = workspace(t);
  const { bundleRoot, bundle } = buildBundle(dir, twoDocuments());
  const verified = verifyPairedDeclaration({ bundle, bundleRoot, declaration: OWNER_DECLARATION });
  assert.equal(verified.satisfied, true, verified.reason);
  assert.deepEqual(verified.sources.map((source) => source.sentence), [SPEC_SENTENCE, PROSE_SENTENCE]);
  assert.ok(!verified.sources.some((source) => source.sentence === OWNER_DECLARATION.claim), 'the owner\'s phrasing never becomes evidence');
  assert.equal(verified.ownerDeclaredAgreement, true, 'the wording test did not relate these, so the agreement is the owner\'s');
});

// The failure that would matter most: a pairing must not be able to put words in a document.
test('refuses a sentence the nominated document does not contain', (t) => {
  const dir = workspace(t);
  const { bundleRoot, bundle } = buildBundle(dir, twoDocuments());
  const forged = verifyPairedDeclaration({ bundle, bundleRoot, declaration: { ...OWNER_DECLARATION, pairedAssertions: [SPEC_SENTENCE, 'The guide states that mapping is performed lazily and caches its results between calls.'] } });
  assert.equal(forged.satisfied, false);
  assert.match(forged.reason, /does not contain the sentence declared for it/);
});

test('refuses a pairing whose source is not in the corpus, and one that names a source twice', (t) => {
  const dir = workspace(t);
  const { bundleRoot, bundle } = buildBundle(dir, twoDocuments());
  const absent = verifyPairedDeclaration({ bundle, bundleRoot, declaration: { ...OWNER_DECLARATION, pairedSources: ['https://example.edu/spec', 'https://example.net/never-retrieved'] } });
  assert.equal(absent.satisfied, false);
  assert.match(absent.reason, /not in the restored corpus/);

  const doubled = verifyPairedDeclaration({ bundle, bundleRoot, declaration: { ...OWNER_DECLARATION, pairedSources: ['https://example.edu/spec', 'https://example.edu/spec'] } });
  assert.equal(doubled.satisfied, false);
  assert.match(doubled.reason, /must be distinct/);
});

test('refuses two source ids that resolve to identical content', (t) => {
  const dir = workspace(t);
  const same = `A mirrored page.\n${SPEC_SENTENCE} It is served under two addresses.`;
  const { bundleRoot, bundle } = buildBundle(dir, [{ url: 'https://a.example/x', content: same }, { url: 'https://b.example/x', content: same }]);
  const mirrored = verifyPairedDeclaration({ bundle, bundleRoot, declaration: { ...OWNER_DECLARATION, pairedSources: ['https://a.example/x', 'https://b.example/x'], pairedAssertions: [SPEC_SENTENCE, SPEC_SENTENCE] } });
  assert.equal(mirrored.satisfied, false);
  assert.match(mirrored.reason, /one document reached twice/);
});

test('refuses content that no longer matches the hash the queue recorded', (t) => {
  const dir = workspace(t);
  const { bundleRoot, bundle } = buildBundle(dir, twoDocuments());
  const tampered = path.join(bundleRoot, bundle.sources[0].durablePath);
  fs.writeFileSync(tampered, `Rewritten after staging.\n${OPPOSITE_SENTENCE} Nothing else changed here at all.`);
  const decision = verifyPairedDeclaration({ bundle, bundleRoot, declaration: OWNER_DECLARATION });
  assert.equal(decision.satisfied, false);
  assert.match(decision.reason, /does not match the hash the queue recorded/);
  assert.throws(() => readSourceContent(bundleRoot, bundle.sources[0]), /does not match the hash/);
});

// Owner judgement reaches sameness of wording and stops there.
test('a pairing never satisfies proof, verification, or promotion', (t) => {
  const dir = workspace(t);
  const { bundleRoot, bundle } = buildBundle(dir, twoDocuments());
  for (const declaration of [OWNER_DECLARATION, { ...OWNER_DECLARATION, pairedSources: ['https://example.edu/spec', 'https://example.edu/spec'] }]) {
    const decision = verifyPairedDeclaration({ bundle, bundleRoot, declaration });
    assert.equal(decision.proofStageSatisfied, false);
    assert.equal(decision.independentVerificationSatisfied, false);
    assert.equal(decision.promotionAuthorized, false);
  }
});

// Without declared sentences the pairing falls back to the wording test, which still refuses
// to cross a negation. An owner may not pair a claim with its opposite by nomination alone.
test('an undeclared pairing will not accept a document that asserts the opposite', (t) => {
  const dir = workspace(t);
  const { bundleRoot, bundle } = buildBundle(dir, [
    { url: 'https://example.edu/spec', content: `A specification note on array helpers.\n${SPEC_SENTENCE} Callers keep the original values for later work.` },
    { url: 'https://example.org/wrong', content: `A contrary note on array helpers.\n${OPPOSITE_SENTENCE} Callers should copy first if that matters.` },
  ]);
  const decision = verifyPairedDeclaration({ bundle, bundleRoot, declaration: { ...OWNER_DECLARATION, claim: SPEC_SENTENCE, pairedSources: ['https://example.edu/spec', 'https://example.org/wrong'], pairedAssertions: undefined } });
  assert.equal(decision.satisfied, false);
  assert.match(decision.reason, /does not assert the declared claim/);
  assert.equal(assertingSentence(`Prose about arrays.\n${OPPOSITE_SENTENCE} And more.`, SPEC_SENTENCE), null);
});

test('owner-declared agreement changes only whether two sources agree, never what proof requires', () => {
  const base = { sourceId: 'source-a', claim: SPEC_SENTENCE, claimBoundary: 'shared', generalizationBoundary: 'ordinary arrays only', claimScope: SCOPE };
  const other = { ...base, sourceId: 'source-b', claim: PROSE_SENTENCE };
  const route = (ownerDeclaredAgreement) => routeThreeWayComparison({ projectId: PROJECT, candidateId: 'candidate-a', sourceA: base, sourceB: other, activeKnowledge: [], comparedAt: AT, ownerDeclaredAgreement });

  const without = route(false);
  assert.equal(without.route, 'contradiction-review', 'the wording test alone cannot relate these two');
  assert.equal(without.agreementBasis, 'none');

  const with_ = route(true);
  assert.equal(with_.route, 'new-claim-evaluation');
  assert.equal(with_.agreementBasis, 'owner-declared', 'the basis is recorded, so it is never mistaken for a machine judgement');
  assert.equal(with_.proofStageSatisfied, false);
  assert.equal(with_.independentVerificationSatisfied, false);
  assert.equal(with_.promotionAllowed, false);

  // Owner judgement is a claim about wording; it cannot be a value that quietly reads as true.
  assert.throws(() => route('yes'), /must be a boolean/);
});

test('a declaration may not nominate a malformed pairing', (t) => {
  const dir = workspace(t);
  assert.throws(() => readScopeDeclarations(declarationFile(dir, { ...OWNER_DECLARATION, pairedSources: ['only-one'] })), /exactly two source ids/);
  assert.throws(() => readScopeDeclarations(declarationFile(dir, { ...OWNER_DECLARATION, pairedSources: ['a', ''] })), /non-empty source ids/);
  assert.throws(() => readScopeDeclarations(declarationFile(dir, { ...OWNER_DECLARATION, pairedSources: ['a', 'A'] })), /two distinct sources/);
  assert.equal(readScopeDeclarations(declarationFile(dir, OWNER_DECLARATION))[0].pairedSources.length, 2);
});

test('the owner-paired route carries a real claim through the full pipeline to verified knowledge', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot } = buildBundle(dir, twoDocuments());
  const report = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: declarationFile(dir, OWNER_DECLARATION), harnessesFor, now: () => AT });

  assert.equal(report.learned, true, report.reason);
  assert.equal(report.corroborationRoute, 'owner-paired');
  assert.equal(report.ownerDeclaredAgreement, true);
  assert.deepEqual(report.assertedAs, [SPEC_SENTENCE, PROSE_SENTENCE], 'the documents\' own sentences went through the pipeline');
  assert.equal(new Set(report.sourceIds).size, 2);
  assert.notEqual(report.experimentExecutorId, report.independentVerifierId);
  assert.ok(report.retrievedWithinScope.length > 0, 'verified knowledge is retrievable within its tested boundary');
  assert.deepEqual(report.gates, { R4: true, R5: true, R6: true });
  assert.equal(report.promotionAuthorized, false, 'learning is never self-authorized release');
});

test('a pairing whose sources were never extracted reports that, rather than inventing candidates', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot } = buildBundle(dir, twoDocuments(), { runExtraction: false });
  const report = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: declarationFile(dir, OWNER_DECLARATION), harnessesFor, now: () => AT });
  assert.equal(report.learned, false);
  assert.match(report.reason, /have not been through claim extraction/);
  assert.deepEqual(report.gates, { R4: false, R5: false, R6: false });
});

// A pairing nominates two sources by id; the content behind those ids comes from a queue restored
// from a repository Crucible does not control. A declared path is a claim about where the content
// lives, not permission to read there.
test('a declared source path outside the corpus is refused rather than read as corroboration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-containment-'));
  const bundleRoot = path.join(root, 'bundle');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runner-secret.txt'), 'a runner file that is none of the corpus business');
  const inside = 'Bounded caches are invalidated on write.';
  fs.writeFileSync(path.join(bundleRoot, 'sources', 'ok.html'), inside);

  const read = (durablePath, contentSha256) => readSourceContent(bundleRoot, { id: 's1', durablePath, contentSha256 });
  for (const escape of ['../runner-secret.txt', 'sources/../../runner-secret.txt', path.join(root, 'runner-secret.txt'), '/etc/passwd']) {
    assert.throws(() => read(escape), /declares content outside the corpus/, `${escape} must be refused`);
  }
  // A contained source still reads normally, absolute or relative, when its hash is recorded.
  const hash = crypto.createHash('sha256').update(inside).digest('hex');
  assert.equal(read('sources/ok.html', hash), inside);
  assert.equal(read(path.join(bundleRoot, 'sources', 'ok.html'), hash), inside);
});

// Owner pairing reaches the corpus by source id. Without a recorded hash the bytes behind that id
// are whatever happens to be on disk, so content with no hash cannot be corroboration at all - the
// check is required, not merely applied when a hash happens to be present.
test('a source with no recorded content hash cannot become corroboration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-hash-'));
  const bundleRoot = path.join(root, 'bundle');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  const body = 'Bounded caches are invalidated on write.';
  fs.writeFileSync(path.join(bundleRoot, 'sources', 'ok.html'), body);
  const read = (contentSha256) => readSourceContent(bundleRoot, { id: 's1', durablePath: 'sources/ok.html', contentSha256 });
  for (const missing of [undefined, null, '', '   ', 'not-a-hash', 'a'.repeat(63)]) {
    assert.throws(() => read(missing), /no recorded content hash/, `${JSON.stringify(missing)} must not be accepted as a hash`);
  }
  assert.throws(() => read('b'.repeat(64)), /does not match the hash/);
  assert.equal(read(crypto.createHash('sha256').update(body).digest('hex')), body);
});
