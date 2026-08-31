// Learning from the real corpus, not from fixtures.
//
// The hosted proof previously satisfied R4-R8 against two source objects built in code from
// the claim string itself. That proves the pipeline runs; it proves nothing about learning,
// because no document was ever read. This reads the restored bundle - the real extraction
// queue, the real retrieved documents, and the real durable store - and promotes only what
// that corpus actually supports.
//
// There is no synthetic fallback here, deliberately. If the corpus cannot supply a
// corroborated claim, or the owner has not declared a scope for one, the gates report
// unsatisfied and say why. A gate that passes when the data cannot support it is worse than
// a gate that fails, because it is indistinguishable from one that succeeded.
const fs = require('node:fs');
const path = require('node:path');
const { DurableScientificLearningStore } = require('./scientificLearning');
const { ControlledClaimEvaluationWorker } = require('./claimEvaluationWorker');
const { ClaimComparisonLedger } = require('./claimComparison');
const { CriticalClaimReviewer } = require('./criticalClaimReview');
const { LogicalReasoningProblemSolver, ReasoningLedger } = require('./reasoningProblemSolving');
const { CreativeDecisionAdaptationEngine, CognitiveStrategyLedger } = require('./creativeDecisionAdaptation');

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

function readBundle(root) {
  const manifestFile = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`No restored bundle at ${root}: manifest.json is missing.`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const queueFile = path.join(root, 'source-queue.json');
  if (!fs.existsSync(queueFile)) throw new Error('The restored bundle has no source-queue.json.');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  return { manifest, queue, sources: [...(queue.documents || []), ...(queue.links || [])] };
}

// Every claim the real corpus asserts through two or more independently identified sources.
// This is the only thing that can ever be corroborated: one document agreeing with itself is
// not corroboration, and neither is the same document reached by two URLs.
function corroboratedClaims(store) {
  const byClaim = new Map();
  for (const record of store.read().candidateRecords) {
    if (record.state !== 'candidate') continue;
    const key = normalize(record.candidate.claim);
    if (!key) continue;
    if (!byClaim.has(key)) byClaim.set(key, []);
    byClaim.get(key).push(record);
  }
  const corroborated = [];
  for (const [key, records] of byClaim) {
    const bySource = new Map();
    for (const record of records) {
      const sourceId = record.candidate.provenance.sourceId;
      if (!bySource.has(sourceId)) bySource.set(sourceId, record);
    }
    if (bySource.size < 2) continue;
    const picked = [...bySource.values()].sort((a, b) => (a.candidate.id < b.candidate.id ? -1 : 1));
    corroborated.push({ claimKey: key, claim: picked[0].candidate.claim, sourceCount: bySource.size, candidateIds: picked.slice(0, 2).map((item) => item.candidate.id), sourceIds: picked.slice(0, 2).map((item) => item.candidate.provenance.sourceId) });
  }
  return corroborated.sort((a, b) => b.sourceCount - a.sourceCount || (a.claimKey < b.claimKey ? -1 : 1));
}

// The owner declares the scope a claim was tested within, plus the two harnesses. No scope is
// ever inferred: extraction cannot know what a sentence's tested boundary is, and guessing one
// would be the same self-certification this replaces.
function readScopeDeclarations(file) {
  if (!file) return [];
  if (!fs.existsSync(file)) throw new Error(`Scope declaration file was not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const declarations = Array.isArray(parsed) ? parsed : parsed.declarations;
  if (!Array.isArray(declarations)) throw new Error('Scope declarations must be an array.');
  return declarations.map((item, index) => {
    for (const field of ['claim', 'claimScope', 'generalizationBoundary']) {
      if (typeof item?.[field] !== 'string' || !item[field].trim()) throw new Error(`declarations[${index}].${field} is required.`);
    }
    return { ...item, claimKey: normalize(item.claim) };
  });
}

// Whether the store's verified knowledge actually came from the real corpus.
//
// "Does the store have any knowledge versions" is not the same question, and using it as the
// guard is how fixture-derived state masked real learning: the encrypted cache still held
// versions promoted from candidates the proof generated for itself, so the real-corpus path
// was skipped and the run passed in a tenth of a second without reading a document.
const FIXTURE_SOURCE_TYPES = new Set(['github-hosted-proof']);
function hasRealCorpusKnowledge(store) {
  const payload = store.read();
  return payload.knowledgeVersions.some((version) => {
    const record = payload.candidateRecords.find((item) => item.candidate.id === version.candidateId);
    const provenance = record && record.candidate && record.candidate.provenance;
    if (!provenance) return false;
    if (FIXTURE_SOURCE_TYPES.has(provenance.sourceType)) return false;
    if (/^github-run:/.test(String(provenance.sourceId || ''))) return false;
    return /^[a-f0-9]{64}$/i.test(String(provenance.contentSha256 || ''));
  });
}

async function learnFromRealCorpus({ bundleRoot, learningRoot, projectId, scopeDeclarationFile, harnessesFor, now = () => new Date().toISOString() }) {
  const bundle = readBundle(bundleRoot);
  if (bundle.manifest.projectId !== projectId) throw new Error(`The restored bundle belongs to ${bundle.manifest.projectId}, not ${projectId}.`);

  const store = new DurableScientificLearningStore({ root: learningRoot, projectId });
  const before = store.read();
  const corroborated = corroboratedClaims(store);
  const declarations = readScopeDeclarations(scopeDeclarationFile);

  const corpus = {
    sources: bundle.sources.length,
    documentsWithContent: bundle.manifest.sourceFiles ? bundle.manifest.sourceFiles.length : 0,
    candidateRecords: before.candidateRecords.length,
    corroboratedClaims: corroborated.length,
    knowledgeVersionsBefore: before.knowledgeVersions.length,
  };

  const usable = corroborated.map((item) => ({ ...item, declaration: declarations.find((entry) => entry.claimKey === item.claimKey) || null }));
  const ready = usable.find((item) => item.declaration);

  if (!ready) {
    // Fail closed and say exactly which of the two reasons applies, so the next step is obvious.
    const reason = corroborated.length === 0
      ? 'the real corpus contains no claim asserted by two or more independently identified sources, so nothing in it can be corroborated yet'
      : `${corroborated.length} corroborated claim(s) exist in the real corpus but none has an owner-declared scope, and a scope is never inferred`;
    return { schemaVersion: 1, projectId, corpus, learned: false, reason, corroborated: corroborated.slice(0, 25), gates: { R4: false, R5: false, R6: false }, promotionAuthorized: false };
  }

  const { experiment, verifier } = harnessesFor(ready.declaration);
  if (!experiment?.id || !verifier?.id || experiment.id === verifier.id) throw new Error('Independent verification requires distinct experiment and verifier identities.');

  const worker = new ControlledClaimEvaluationWorker({
    store,
    comparisonLedger: new ClaimComparisonLedger({ root: learningRoot, projectId }),
    criticalReviewer: new CriticalClaimReviewer(),
    reasoningProblemSolver: new LogicalReasoningProblemSolver(),
    reasoningLedger: new ReasoningLedger({ root: learningRoot, projectId }),
    strategyEngine: new CreativeDecisionAdaptationEngine(),
    strategyLedger: new CognitiveStrategyLedger({ root: learningRoot, projectId }),
    experimentHarnesses: { [ready.declaration.language || 'javascript']: experiment },
    verifierHarnesses: { [ready.declaration.language || 'javascript']: verifier },
    now,
  });

  const evaluation = await worker.process({
    candidateId: ready.candidateIds[0],
    corroboratingCandidateId: ready.candidateIds[1],
    language: ready.declaration.language || 'javascript',
    claimScope: ready.declaration.claimScope,
  });

  const verified = evaluation.verifiedKnowledge;
  const after = store.read();
  return {
    schemaVersion: 1,
    projectId,
    corpus,
    learned: Boolean(verified),
    reason: verified ? null : `the controlled pipeline did not promote this claim: comparison routed ${evaluation.decision.route}, critical review routed ${evaluation.criticalReview.route}, and the record ended in state ${evaluation.record.state}`,
    claim: ready.claim,
    claimScope: ready.declaration.claimScope,
    sourceIds: ready.sourceIds,
    candidateIds: ready.candidateIds,
    experimentExecutorId: experiment.id,
    independentVerifierId: verifier.id,
    verifiedVersion: verified ? verified.version : null,
    retrievedWithinScope: verified ? store.retrieve({ boundary: verified.boundary }).map((item) => item.version) : [],
    knowledgeVersionsAfter: after.knowledgeVersions.length,
    gates: { R4: true, R5: Boolean(verified), R6: Boolean(verified) && store.retrieve({ boundary: verified.boundary }).length > 0 },
    promotionAuthorized: false,
  };
}

module.exports = { readBundle, corroboratedClaims, readScopeDeclarations, hasRealCorpusKnowledge, learnFromRealCorpus };
