const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { DurableScientificLearningStore } = require('../src/scientificLearning');
const { readBundle, learnFromRealCorpus } = require('../src/realCorpusLearning');
const { realSupersession, findFurtherSource } = require('../src/realSupersession');

const PROJECT = 'github:owner/repo';
const AT = '2026-09-01T00:00:00.000Z';
const CLAIM = 'The map method returns a new array and does not modify the original array.';
const SCOPE = 'Node.js ordinary dense arrays of numbers';
const PROOF = "const input=[1,2,3];const output=input.map(x=>x*2);if(output===input)process.exit(1);if(JSON.stringify(input)!=='[1,2,3]')process.exit(1);if(JSON.stringify(output)!=='[2,4,6]')process.exit(1);";
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-supersession-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function buildBundle(dir, documents) {
  const bundleRoot = path.join(dir, 'bundle');
  const learningRoot = path.join(dir, 'learning');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  fs.mkdirSync(learningRoot, { recursive: true });
  const links = documents.map((doc) => {
    const digest = sha256(doc.content);
    const file = path.join(bundleRoot, 'sources', `${digest}.txt`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, doc.content);
    return { id: doc.url, state: 'claim-extraction-forced-pending', url: doc.url, finalUrl: doc.url, contentType: 'text/plain', contentSha256: digest, durablePath: `sources/${digest}.txt`, retrievedAt: AT, author: doc.author };
  });
  const queue = { schemaVersion: 1, projectId: PROJECT, updatedAt: AT, documents: [], links };
  const queueFile = path.join(bundleRoot, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, projectId: PROJECT, repository: 'owner/repo', ref: 'refs/heads/development', queueSha256: sha256(fs.readFileSync(queueFile, 'utf8')), sourceFiles: links.map((l) => ({ name: `${l.contentSha256}.txt`, sha256: l.contentSha256, bytes: 1 })) }, null, 2)}\n`);
  const absolute = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  absolute.links = absolute.links.map((link) => ({ ...link, durablePath: path.join(bundleRoot, link.durablePath) }));
  const extractionQueue = path.join(dir, 'extraction-queue.json');
  fs.writeFileSync(extractionQueue, `${JSON.stringify(absolute, null, 2)}\n`);
  new ClaimExtractionWorker({ queueFile: extractionQueue, projectId: PROJECT, learningRoot, now: () => AT }).run();
  return { bundleRoot, learningRoot, bundle: readBundle(bundleRoot) };
}

const harnesses = () => {
  const execute = () => execFileSync(process.execPath, ['-e', PROOF], { stdio: 'ignore' });
  return {
    experiment: { id: 'javascript-controlled-runner', run: async ({ candidate, hypothesis }) => { execute(); return { schemaVersion: 1, candidateId: candidate.id, projectId: candidate.projectId, hypothesis, testedProperty: candidate.claim, experimentBoundary: candidate.claimBoundary, controls: ['identity reference control', 'empty-input control'], causalIsolation: { method: 'single-variable intervention on the mapped callback', result: 'only the returned array changes', correlationOnly: false }, negativeTests: ['the returned array is never the input reference'], regressionTests: ['dense-array mapping still yields expected values'], scopeProof: SCOPE, generalizationResult: 'not generalized beyond the experiment boundary', contradictionResult: 'none', completedAt: AT }; } },
    verifier: { id: 'javascript-independent-runner', run: async ({ candidate, experimentalProof }) => { execute(); return { verifierId: 'javascript-independent-runner', independent: true, testedProperty: candidate.claim, experimentBoundary: experimentalProof.experimentBoundary, result: 'passed', verifiedAt: AT }; } },
  };
};

function declaration(dir) {
  const file = path.join(dir, 'scope.json');
  fs.writeFileSync(file, JSON.stringify({ declarations: [{ claim: CLAIM, claimScope: SCOPE, generalizationBoundary: 'Does not cover sparse arrays, proxies, subclasses, or host objects.', language: 'javascript' }] }, null, 2));
  return file;
}

const document = (url, author, extra) => ({ url, author, content: `A reference on arrays.\n${CLAIM} ${extra}` });

// A correct harness reports the boundary the claim was actually tested within - the owner's
// declared scope - not the boundary extraction derived from whichever document asserted it.
// Two documents never share a provenance boundary, so a harness that reports one makes
// supersession structurally impossible; the test below pins that failure mode too.

test('R7 says it follows R4-R6 rather than manufacturing something to supersede', async (t) => {
  const dir = workspace(t);
  const { learningRoot, bundle } = buildBundle(dir, [document('https://a.example/x', 'A', 'One.'), document('https://b.example/x', 'B', 'Two.')]);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  const { experiment, verifier } = harnesses();
  const result = await realSupersession({ store, available: store.read().candidateRecords, bundle, experiment, verifier, now: () => AT });
  assert.equal(result.satisfied, false);
  assert.match(result.reason, /nothing to supersede/);
  assert.match(result.reason, /R4-R6/);
  assert.equal(result.promotionAuthorized, false);
});

// The decisive finding about R7, established rather than asserted: a third real independent
// source does re-test the claim and does verify, and still cannot supersede - because every
// version's boundary is derived from whichever document asserted it, so no two documents ever
// share one. `claimScope` was introduced for exactly this conflation but was only wired into
// comparison; the pre-test plan still pins experimentBoundary to candidate.claimBoundary and
// the post-test reasoner requires the result to match it. Until the declared scope reaches the
// experiment boundary, R7 is structurally unprovable on real multi-source evidence, and the
// run says so precisely instead of superseding a claim it invented for itself.
test('a third real independent source verifies but cannot supersede while boundaries are provenance-derived', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot, bundle } = buildBundle(dir, [
    document('https://a.example/x', 'Author A', 'One.'),
    document('https://b.example/x', 'Author B', 'Two.'),
    document('https://c.example/x', 'Author C', 'Three.'),
  ]);
  const learned = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: declaration(dir), harnessesFor: harnesses, now: () => AT });
  assert.equal(learned.learned, true, learned.reason);

  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  const before = store.read().knowledgeVersions.find((item) => item.status === 'active');
  const { experiment, verifier } = harnesses();
  const result = await realSupersession({ store, available: store.read().candidateRecords, bundle, experiment, verifier, excludeSourceIds: learned.evaluations[0].sourceIds, now: () => AT });

  assert.equal(result.satisfied, false, 'nothing is superseded, and nothing pretends to be');
  assert.match(result.reason, /does not carry version 1 as its predecessor/);
  assert.match(result.reason, /owner-declared scope rather than the source document's provenance/, 'the reason names the actual defect');
  assert.equal(result.promotionAuthorized, false);

  // The third source was real, was found, and did verify. The blocker is the boundary, not the
  // evidence - which is why the report must not read as "no further source exists".
  const payload = store.read();
  assert.ok(payload.knowledgeVersions.length > 1, 'the further source produced its own verified version');
  assert.equal(payload.knowledgeVersions.at(-1).previousVersion, null, 'on a separate lineage rather than superseding');
  assert.notEqual(payload.knowledgeVersions.at(-1).boundary, before.boundary, 'because the two boundaries came from two different documents');
});

// The case that would matter most: a third source that is not actually a third source.
test('a further source from the same publisher cannot supersede', async (t) => {
  const dir = workspace(t);
  const { bundleRoot, learningRoot, bundle } = buildBundle(dir, [
    document('https://a.example/x', 'Author A', 'One.'),
    document('https://b.example/x', 'Author B', 'Two.'),
    document('https://a.example/second-page', 'Author A', 'Three.'),
  ]);
  const learned = await learnFromRealCorpus({ bundleRoot, learningRoot, projectId: PROJECT, scopeDeclarationFile: declaration(dir), harnessesFor: harnesses, now: () => AT });
  assert.equal(learned.learned, true, learned.reason);

  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  const { experiment, verifier } = harnesses();
  const result = await realSupersession({ store, available: store.read().candidateRecords, bundle, experiment, verifier, excludeSourceIds: learned.evaluations[0].sourceIds, now: () => AT });
  assert.equal(result.satisfied, false);
  assert.match(result.reason, /independent of/);
  assert.equal(store.read().knowledgeVersions.filter((item) => item.previousVersion).length, 0, 'nothing was superseded');
});

test('a paraphrase starts its own lineage rather than silently superseding', (t) => {
  const dir = workspace(t);
  const { bundle } = buildBundle(dir, [document('https://a.example/x', 'A', 'One.')]);
  const paraphrase = { state: 'candidate', candidate: { id: 'c-1', claim: 'The map method returns a new array and does not modify the original input.', provenance: { sourceId: 'https://z.example/x' } } };
  const found = findFurtherSource({ available: [paraphrase], bundle, activeVersion: { claim: CLAIM, version: 1 }, usedSourceIds: [] });
  assert.equal(found, null, 'only a verbatim assertion can supersede, because the store matches a prior version on exact claim text');
});
