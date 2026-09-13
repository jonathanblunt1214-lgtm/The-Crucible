// One real R4 -> R5 cycle: independent sources in, verified knowledge out.
//
// R4 and R5 were each provable on their own and had never been joined. Joining them
// surfaced why. `routeThreeWayComparison` decides two sources share a scope by comparing
// `claimBoundary`, but the extraction worker builds that string out of the source document
// (`<url>, SHA-256 <hash>, retrieved content only`). Two independent sources therefore
// never match, always route to `bounded-scope-or-version-update`, and never reach
// `new-claim-evaluation` - so a pair of extracted candidates could not be promoted no
// matter how sound the claim was. That is recorded as a finding rather than patched over
// here: automated discovery alone cannot currently produce a promotable pair.
//
// This cycle therefore uses R4's other stated path, owner ingest, and keeps the two
// notions apart deliberately: the claim's scope is declared once and shared by both
// candidates, while each candidate carries its own independent provenance. Nothing is
// fabricated to achieve that - a claim is only accepted if the exact assertion is present
// in that source's own content, checked through the same bounded extraction the worker
// uses, so every candidate remains genuinely derived from the document backing it.
const crypto = require('node:crypto');
const { boundedAssertions } = require('./claimExtractionWorker');
const { ControlledClaimEvaluationWorker } = require('./claimEvaluationWorker');
const { ClaimComparisonLedger } = require('./claimComparison');
const { CriticalClaimReviewer } = require('./criticalClaimReview');
const { LogicalReasoningProblemSolver, ReasoningLedger } = require('./reasoningProblemSolving');
const { CreativeDecisionAdaptationEngine, CognitiveStrategyLedger } = require('./creativeDecisionAdaptation');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// R4: a real source becomes candidate custody only if the claim is actually in it.
function extractCandidate({ projectId, source, claim, claimBoundary, generalizationBoundary, at }) {
  if (!source || typeof source.content !== 'string' || !source.content.trim()) throw new Error('Each source requires real retrieved content.');
  if (!source.sourceId || !source.url) throw new Error('Each source requires an independent sourceId and its retrieval URL.');
  const assertions = boundedAssertions(source.content);
  if (!assertions.includes(claim)) {
    throw new Error(`The claim is not a bounded assertion of source ${source.sourceId}; candidate evidence is never asserted beyond what its document contains.`);
  }
  const contentSha256 = sha256(source.content);
  return {
    schemaVersion: 1,
    id: `cycle-${sha256(`${source.sourceId}\n${claim}`).slice(0, 32)}`,
    projectId,
    claim,
    claimBoundary,
    generalizationBoundary,
    kind: 'extracted-source-assertion',
    provenance: { sourceType: 'retrieved-web-document', sourceId: source.sourceId, retrievedAt: source.retrievedAt || at, author: source.author || 'not declared', license: source.license || 'not declared; verify source terms before redistribution', contentSha256 },
    classification: 'Insufficient Evidence',
    createdAt: at,
  };
}

async function runLearningCycle({ store, root, projectId, sources, claim, claimBoundary, generalizationBoundary, experiment, verifier, language = 'javascript', now = () => new Date().toISOString() }) {
  if (!Array.isArray(sources) || sources.length < 2) throw new Error('A cycle requires at least two independently identified sources.');
  if (new Set(sources.map((item) => item.sourceId)).size !== sources.length) throw new Error('Sources must be independently identified.');
  const at = now();

  // R4: every source through extraction into candidate custody, provenance intact.
  const candidates = sources.map((source) => extractCandidate({ projectId, source, claim, claimBoundary, generalizationBoundary, at }));
  const ingested = [];
  for (const candidate of candidates) {
    if (!store.get(candidate.id)) store.ingest(candidate);
    ingested.push(store.get(candidate.id));
  }
  const r4 = {
    satisfied: ingested.every((record) => record && record.state === 'candidate'),
    candidateIds: ingested.map((record) => record.candidate.id),
    provenance: ingested.map((record) => ({ sourceId: record.candidate.provenance.sourceId, contentSha256: record.candidate.provenance.contentSha256 })),
    // Extraction produces candidate evidence and nothing more. It never satisfies proof.
    classification: 'Insufficient Evidence',
    proofStageSatisfied: false,
  };

  // R5: the controlled pipeline, with a verifier that is a distinct identity from the executor.
  const worker = new ControlledClaimEvaluationWorker({
    store,
    comparisonLedger: new ClaimComparisonLedger({ root, projectId }),
    criticalReviewer: new CriticalClaimReviewer(),
    reasoningProblemSolver: new LogicalReasoningProblemSolver(),
    reasoningLedger: new ReasoningLedger({ root, projectId }),
    strategyEngine: new CreativeDecisionAdaptationEngine(),
    strategyLedger: new CognitiveStrategyLedger({ root, projectId }),
    experimentHarnesses: { [language]: experiment },
    verifierHarnesses: { [language]: verifier },
    now: () => at,
  });
  const evaluation = await worker.process({ candidateId: r4.candidateIds[0], corroboratingCandidateId: r4.candidateIds[1], language });

  const verified = evaluation.verifiedKnowledge;
  return {
    schemaVersion: 1,
    projectId,
    r4,
    r5: {
      satisfied: Boolean(verified),
      route: evaluation.decision.route,
      criticalReview: evaluation.criticalReview.route,
      state: evaluation.record.state,
      verifiedKnowledge: verified,
      // Retrieval of the active version within its own tested boundary, which is R6's shape.
      retrieved: evaluation.usedKnowledge,
      independentVerifierId: verifier.id,
      experimentExecutorId: experiment.id,
    },
  };
}

module.exports = { extractCandidate, runLearningCycle };
