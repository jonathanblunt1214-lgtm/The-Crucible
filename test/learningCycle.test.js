const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DurableScientificLearningStore } = require('../src/scientificLearning');
const { extractCandidate, runLearningCycle } = require('../src/learningCycle');

const AT = '2026-09-01T00:00:00.000Z';
const PROJECT = 'project-a';

// The exact sentence both documents assert. It is a real, low-risk, falsifiable property
// of Array.prototype.map, long enough to survive bounded extraction.
const CLAIM = 'The map method returns a new array and does not modify the original array.';
const CLAIM_BOUNDARY = 'Node.js ordinary dense arrays of numbers';
const GENERALIZATION = 'Does not cover sparse arrays, proxies, subclasses, or host objects.';

// Two independent documents that genuinely contain the claim, in different surrounding prose.
const DOC_A = `Working with arrays in JavaScript.\n${CLAIM} Callers keep the original values for later work.`;
const DOC_B = `A short reference on iteration helpers.\nCallbacks receive each element in turn. ${CLAIM} Chaining further calls stays predictable.`;

const sources = () => ([
  { sourceId: 'https://example.edu/arrays', url: 'https://example.edu/arrays', content: DOC_A, retrievedAt: AT },
  { sourceId: 'https://example.org/iteration', url: 'https://example.org/iteration', content: DOC_B, retrievedAt: AT },
]);

// Real execution, not a stub: this actually runs the claim and its negative control.
function execute() {
  execFileSync(process.execPath, ['-e', "const input=[1,2,3];const output=input.map(x=>x*2);if(output===input)process.exit(1);if(JSON.stringify(input)!=='[1,2,3]')process.exit(1);if(JSON.stringify(output)!=='[2,4,6]')process.exit(1);const empty=[].map(x=>x);if(!Array.isArray(empty)||empty.length!==0)process.exit(1);"], { stdio: 'ignore' });
}

const experiment = {
  id: 'javascript-controlled-runner',
  run: async ({ candidate, hypothesis }) => {
    execute();
    return { schemaVersion: 1, candidateId: candidate.id, projectId: candidate.projectId, hypothesis, testedProperty: candidate.claim, experimentBoundary: candidate.claimBoundary, controls: ['identity reference control: output is not the input array', 'empty-input control: mapping an empty array yields an empty array'], causalIsolation: { method: 'single-variable intervention on the mapped callback', result: 'only the returned array changes; the input is unchanged', correlationOnly: false }, negativeTests: ['the returned array is never the same reference as the input'], regressionTests: ['existing dense-array mapping still yields the expected values'], scopeProof: 'executed only against ordinary dense arrays of numbers on this runtime', generalizationResult: 'not generalized beyond the experiment boundary', contradictionResult: 'none', completedAt: AT };
  },
};
const verifier = {
  id: 'javascript-independent-runner',
  run: async ({ candidate, experimentalProof }) => {
    execute();
    return { verifierId: 'javascript-independent-runner', independent: true, testedProperty: candidate.claim, experimentBoundary: experimentalProof.experimentBoundary, result: 'passed', verifiedAt: AT };
  },
};

function workspace(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('R4: a claim is only accepted as candidate evidence when its own source actually contains it', () => {
  const [source] = sources();
  const candidate = extractCandidate({ projectId: PROJECT, source, claim: CLAIM, claimBoundary: CLAIM_BOUNDARY, generalizationBoundary: GENERALIZATION, at: AT });
  assert.equal(candidate.claim, CLAIM);
  assert.equal(candidate.classification, 'Insufficient Evidence');
  assert.match(candidate.provenance.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(candidate.provenance.sourceId, source.sourceId);

  assert.throws(
    () => extractCandidate({ projectId: PROJECT, source: { ...source, content: 'An unrelated document that asserts something else entirely about other things.' }, claim: CLAIM, claimBoundary: CLAIM_BOUNDARY, generalizationBoundary: GENERALIZATION, at: AT }),
    /not a bounded assertion of source/,
    'a claim is never asserted beyond what its document contains',
  );
});

test('R4 -> R5: a real cycle carries independent sources through to verified knowledge', async (t) => {
  const root = workspace(t, 'learning-cycle-');
  const store = new DurableScientificLearningStore({ root, projectId: PROJECT });
  assert.equal(store.read().knowledgeVersions.length, 0, 'the store starts with nothing verified');

  const result = await runLearningCycle({ store, root, projectId: PROJECT, sources: sources(), claim: CLAIM, claimBoundary: CLAIM_BOUNDARY, generalizationBoundary: GENERALIZATION, experiment, verifier, now: () => AT });

  // R4
  assert.equal(result.r4.satisfied, true);
  assert.equal(result.r4.candidateIds.length, 2);
  assert.equal(result.r4.proofStageSatisfied, false, 'extraction never satisfies proof');
  assert.equal(new Set(result.r4.provenance.map((item) => item.sourceId)).size, 2, 'two independent sources');

  // R5
  assert.equal(result.r5.route, 'new-claim-evaluation');
  assert.equal(result.r5.criticalReview, 'ready-for-controlled-testing');
  assert.equal(result.r5.state, 'verified');
  assert.equal(result.r5.satisfied, true);
  assert.notEqual(result.r5.experimentExecutorId, result.r5.independentVerifierId, 'the verifier is a distinct identity from the executor');

  const verified = result.r5.verifiedKnowledge;
  assert.ok(verified, 'the cycle produced a verified knowledge version');
  assert.equal(verified.claim, CLAIM);
  assert.equal(verified.boundary, CLAIM_BOUNDARY);
  assert.equal(verified.status, 'active');

  // The store really holds it, and retrieval within the tested boundary returns it.
  const payload = store.read();
  assert.equal(payload.knowledgeVersions.length, 1);
  assert.equal(payload.activeVersion, verified.version);
  assert.deepEqual(store.retrieve({ boundary: CLAIM_BOUNDARY }).map((item) => item.claim), [CLAIM]);
  assert.deepEqual(store.retrieve({ boundary: 'some other boundary entirely' }), [], 'retrieval stays inside the tested boundary');
});

test('the cycle refuses a single source and refuses two views of the same source', async (t) => {
  const root = workspace(t, 'learning-cycle-guard-');
  const store = new DurableScientificLearningStore({ root, projectId: PROJECT });
  const base = { store, root, projectId: PROJECT, claim: CLAIM, claimBoundary: CLAIM_BOUNDARY, generalizationBoundary: GENERALIZATION, experiment, verifier, now: () => AT };
  await assert.rejects(() => runLearningCycle({ ...base, sources: [sources()[0]] }), /at least two independently identified sources/);
  await assert.rejects(() => runLearningCycle({ ...base, sources: [sources()[0], { ...sources()[1], sourceId: sources()[0].sourceId }] }), /independently identified/);
});

// The finding that joining R4 to R5 exposed, pinned so it cannot regress unnoticed.
test('two extracted candidates from independent documents cannot reach evaluation on their own', () => {
  const { routeThreeWayComparison } = require('../src/claimComparison');
  const boundaryFor = (url, sha) => `${url}, SHA-256 ${sha}, retrieved content only`;
  const decision = routeThreeWayComparison({
    projectId: PROJECT,
    candidateId: 'candidate-a',
    sourceA: { sourceId: 'https://example.edu/arrays', claim: CLAIM, claimBoundary: boundaryFor('https://example.edu/arrays', 'a'.repeat(64)), generalizationBoundary: GENERALIZATION },
    sourceB: { sourceId: 'https://example.org/iteration', claim: CLAIM, claimBoundary: boundaryFor('https://example.org/iteration', 'b'.repeat(64)), generalizationBoundary: GENERALIZATION },
    activeKnowledge: [],
    comparedAt: AT,
  });
  assert.equal(decision.route, 'bounded-scope-or-version-update');
  assert.notEqual(decision.route, 'new-claim-evaluation');
  assert.equal(decision.promotionAllowed, false);
});
