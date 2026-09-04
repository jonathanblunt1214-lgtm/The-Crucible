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
    experiment: { id: 'javascript-controlled-runner', run: async ({ candidate, hypothesis, testPlanSha256, testPlan, claimScope }) => { execute(); return { schemaVersion: 1, candidateId: candidate.id, projectId: candidate.projectId, hypothesis, testedProperty: candidate.claim, experimentBoundary: (testPlan && testPlan.experimentBoundary) || claimScope || candidate.claimBoundary, controls: ['identity reference control', 'empty-input control'], causalIsolation: { method: 'single-variable intervention on the mapped callback', result: 'only the returned array changes', correlationOnly: false }, negativeTests: ['the returned array is never the input reference'], regressionTests: ['dense-array mapping still yields expected values'], scopeProof: SCOPE, generalizationResult: 'not generalized beyond the experiment boundary', contradictionResult: 'none', completedAt: AT, testPlanSha256 }; } },
    verifier: { id: 'javascript-independent-runner', run: async ({ candidate, experimentalProof, testPlanSha256, testPlan }) => { execute(); return { verifierId: 'javascript-independent-runner', independent: true, testedProperty: candidate.claim, experimentBoundary: experimentalProof.experimentBoundary, result: 'passed', verifiedAt: AT, testPlanSha256 }; } },
  };
};

function withoutPlanBinding(harness) {
  return {
    id: harness.id,
    run: async (input) => {
      const result = await harness.run(input);
      const bounded = { ...result };
      delete bounded.testPlanSha256;
      return bounded;
    },
  };
}

const directSupersessionHarnesses = () => {
  const { experiment, verifier } = harnesses();
  return {
    experiment: withoutPlanBinding(experiment),
    verifier: withoutPlanBinding(verifier),
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
  const { experiment, verifier } = directSupersessionHarnesses();
  const result = await realSupersession({ store, available: store.read().candidateRecords, bundle, experiment, verifier, now: () => AT });
  assert.equal(result.satisfied, false);
  assert.match(result.reason, /nothing to supersede/);
  assert.match(result.reason, /R4-R6/);
  assert.equal(result.promotionAuthorized, false);
});

// R7, working. This test previously pinned the blocker: every version's boundary was derived
// from whichever document asserted the claim, so no two documents ever shared one, a third real
// source verified onto its own lineage instead of superseding, and both this suite and the
// hosted proof had to strip the plan binding on exactly that path. The declared scope now
// carries the tested boundary - a property of the claim rather than of the document - so two
// independent sources can share it and a later one can supersede an earlier version.
test('a third real independent source supersedes the promoted version within the declared scope', async (t) => {
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
  assert.equal(before.boundary, SCOPE, 'the promoted version is bounded by the declared scope, not by its document');

  const { experiment, verifier } = directSupersessionHarnesses();
  const result = await realSupersession({ store, available: store.read().candidateRecords, bundle, experiment, verifier, claimScope: SCOPE, excludeSourceIds: learned.evaluations[0].sourceIds, now: () => AT });

  assert.equal(result.satisfied, true, result.reason);
  assert.equal(result.supersededVersion, before.version);
  assert.ok(result.newVersion > before.version, 'a further version was created');
  assert.equal(result.rolledBackTo, before.version, 'and the prior version was restored');
  assert.equal(result.supersededStillRecorded, true, 'the superseding version survives the rollback');
  assert.ok(!result.independentOf.includes(result.furtherSourceId), 'the third source is not one of the two already behind the claim');
  assert.equal(result.promotionAuthorized, false);

  const payload = store.read();
  assert.equal(payload.activeVersion, before.version);
  assert.ok(payload.knowledgeVersions.find((item) => item.version === before.version).rollback, 'the rollback is recorded on the restored version');
});

// Without a declared scope nothing changes: the provenance boundary still applies, so a second
// document still starts its own lineage. The looser boundary is the owner's declaration, never
// an inference.
test('with no declared scope the provenance boundary still governs', async (t) => {
  const dir = workspace(t);
  const { learningRoot, bundle } = buildBundle(dir, [document('https://a.example/x', 'A', 'One.'), document('https://b.example/x', 'B', 'Two.')]);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  const { experiment, verifier } = directSupersessionHarnesses();
  const result = await realSupersession({ store, available: store.read().candidateRecords, bundle, experiment, verifier, now: () => AT });
  assert.equal(result.satisfied, false);
  assert.match(result.reason, /nothing to supersede/);
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
  const { experiment, verifier } = directSupersessionHarnesses();
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
