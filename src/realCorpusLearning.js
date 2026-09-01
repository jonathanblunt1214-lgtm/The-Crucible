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
const { groupCorroborating, semanticallyCorroborates } = require('./semanticCorroboration');
const { verifyPairedDeclaration } = require('./pairedCorroboration');

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
//
// Agreement used to be exact string equality on the claim text. Extraction emits verbatim
// sentences, so across 403 independently written sources that matched nothing at all - exact
// equality can only fire on duplicated text, which is the opposite of independent agreement.
// Sameness is now the deterministic same-meaning test in semanticCorroboration, which still
// refuses to cross a negation or a changed number however similar the wording.
function corroboratedClaims(store, options = {}) {
  const entries = [];
  for (const record of store.read().candidateRecords) {
    if (record.state !== 'candidate') continue;
    if (!normalize(record.candidate.claim)) continue;
    entries.push({ id: record.candidate.id, claim: record.candidate.claim, sourceId: record.candidate.provenance.sourceId });
  }
  const corroborated = [];
  for (const group of groupCorroborating(entries, options)) {
    const bySource = new Map();
    for (const member of group.members) if (!bySource.has(member.sourceId)) bySource.set(member.sourceId, member);
    if (bySource.size < 2) continue;
    const picked = [...bySource.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 2);
    corroborated.push({
      claimKey: normalize(group.claim),
      claim: group.claim,
      // How the two sources were found to agree, so a report never hides a wording judgement.
      agreement: picked.some((member) => normalize(member.claim) !== normalize(group.claim)) ? 'semantic' : 'verbatim',
      sourceCount: bySource.size,
      candidateIds: picked.map((member) => member.id),
      sourceIds: picked.map((member) => member.sourceId),
      assertedAs: picked.map((member) => member.claim),
    });
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
    // pairedSources is optional. When present it nominates the two sources the owner says
    // assert this claim; the corpus still has to prove that it does, in pairedCorroboration.
    if (item.pairedSources !== undefined) {
      if (!Array.isArray(item.pairedSources) || item.pairedSources.length !== 2) throw new Error(`declarations[${index}].pairedSources must nominate exactly two source ids when present.`);
      if (item.pairedSources.some((value) => typeof value !== 'string' || !value.trim())) throw new Error(`declarations[${index}].pairedSources entries must be non-empty source ids.`);
      if (normalize(item.pairedSources[0]) === normalize(item.pairedSources[1])) throw new Error(`declarations[${index}].pairedSources must name two distinct sources.`);
    }
    return { ...item, claimKey: normalize(item.claim) };
  });
}

// Choosing the one declaration to evaluate, by the two routes into corroboration.
//
// Route A is what the corpus found on its own: a declaration matching a claim that two
// independently identified sources already assert. Route B is the owner-paired route, used
// only when route A finds nothing for that declaration, and only after the corpus has proved
// the pairing. Route A is tried first for every declaration so that a nominated pairing never
// pre-empts agreement the corpus can demonstrate without being told where to look.
//
// Either way the candidates carried forward are records the extraction worker already made
// from real documents. Nothing here creates a candidate.
function selectEvaluable({ store, corroborated, declarations, bundle, bundleRoot, options = {} }) {
  const pairedFailures = [];

  for (const declaration of declarations) {
    const match = corroborated.find((item) => item.claimKey === declaration.claimKey
      || (item.assertedAs || []).some((claim) => normalize(claim) === declaration.claimKey)
      || semanticallyCorroborates(declaration.claim, item.claim, options).corroborates);
    if (match) return { ready: { ...match, declaration, route: 'corpus-corroborated' }, pairedFailures };
  }

  const records = store.read().candidateRecords;
  const candidateFor = (sourceId, sentence) => records.find((record) => record.state === 'candidate'
    && String(record.candidate.provenance.sourceId) === String(sourceId)
    && normalize(record.candidate.claim) === normalize(sentence));

  for (const declaration of declarations.filter((item) => Array.isArray(item.pairedSources))) {
    const verified = verifyPairedDeclaration({ bundle, bundleRoot, declaration, options });
    if (!verified.satisfied) {
      pairedFailures.push({ claim: declaration.claim, pairedSources: declaration.pairedSources, reason: verified.reason });
      continue;
    }
    const resolved = verified.sources.map((source) => ({ source, record: candidateFor(source.sourceId, source.sentence) }));
    const missing = resolved.filter((item) => !item.record);
    if (missing.length) {
      pairedFailures.push({
        claim: declaration.claim,
        pairedSources: declaration.pairedSources,
        reason: `source(s) ${missing.map((item) => item.source.sourceId).join(', ')} assert the claim but have no candidate record yet, so they have not been through claim extraction; run extraction over the corpus before pairing them`,
      });
      continue;
    }
    return {
      ready: {
        claimKey: normalize(resolved[0].record.candidate.claim),
        claim: resolved[0].record.candidate.claim,
        agreement: verified.sources.every((source) => source.agreement === 'verbatim') ? 'verbatim' : 'semantic',
        sourceCount: 2,
        candidateIds: resolved.map((item) => item.record.candidate.id),
        sourceIds: resolved.map((item) => item.source.sourceId),
        assertedAs: resolved.map((item) => item.record.candidate.claim),
        declaration,
        route: 'owner-paired',
        ownerDeclaredAgreement: Boolean(verified.ownerDeclaredAgreement),
      },
      pairedFailures,
    };
  }

  return { ready: null, pairedFailures };
}

// Whether the store's verified knowledge actually came from the real corpus.
//
// Two weaker versions of this check already failed. Asking "are there any knowledge
// versions" let fixture state in the encrypted cache skip real learning entirely. Asking
// "is the provenance sourceType a fixture marker" was no better: the synthetic sources were
// built through the same extractCandidate path as real ones, so they carry
// sourceType retrieved-web-document and a perfectly valid content hash and are
// indistinguishable by shape.
//
// The only thing a fixture cannot forge is membership in the corpus. A verified version
// counts as real when its candidate's content hash is one of the hashes the restored
// manifest attests, or its source id is one the restored queue actually holds.
function hasRealCorpusKnowledge(store, bundle) {
  const payload = store.read();
  if (!payload.knowledgeVersions.length) return false;
  const realHashes = new Set((bundle && bundle.manifest && bundle.manifest.sourceFiles ? bundle.manifest.sourceFiles : []).map((file) => String(file.sha256 || '').toLowerCase()));
  const realSourceIds = new Set((bundle && bundle.sources ? bundle.sources : []).map((source) => String(source.id || '')));
  if (!realHashes.size && !realSourceIds.size) return false;
  return payload.knowledgeVersions.some((version) => {
    const record = payload.candidateRecords.find((item) => item.candidate.id === version.candidateId);
    const provenance = record && record.candidate && record.candidate.provenance;
    if (!provenance) return false;
    return realHashes.has(String(provenance.contentSha256 || '').toLowerCase()) || realSourceIds.has(String(provenance.sourceId || ''));
  });
}

async function learnFromRealCorpus({ bundleRoot, learningRoot, projectId, scopeDeclarationFile, harnessesFor, corroborationOptions = {}, now = () => new Date().toISOString() }) {
  const bundle = readBundle(bundleRoot);
  if (bundle.manifest.projectId !== projectId) throw new Error(`The restored bundle belongs to ${bundle.manifest.projectId}, not ${projectId}.`);

  const store = new DurableScientificLearningStore({ root: learningRoot, projectId });
  const before = store.read();
  const corroborated = corroboratedClaims(store, corroborationOptions);
  const declarations = readScopeDeclarations(scopeDeclarationFile);

  const corpus = {
    sources: bundle.sources.length,
    documentsWithContent: bundle.manifest.sourceFiles ? bundle.manifest.sourceFiles.length : 0,
    candidateRecords: before.candidateRecords.length,
    corroboratedClaims: corroborated.length,
    knowledgeVersionsBefore: before.knowledgeVersions.length,
  };

  const selection = selectEvaluable({ store, corroborated, declarations, bundle, bundleRoot, options: corroborationOptions });
  const ready = selection.ready;

  if (!ready) {
    // Fail closed and say exactly which reason applies, so the next step is obvious.
    let reason;
    if (selection.pairedFailures.length) {
      reason = `no declaration is usable yet; the owner-paired declaration(s) were not supported by the corpus: ${selection.pairedFailures.map((item) => `"${item.claim}" - ${item.reason}`).join('; ')}`;
    } else if (corroborated.length === 0) {
      reason = 'the real corpus contains no claim asserted by two or more independently identified sources, so nothing in it can be corroborated yet';
    } else if (!declarations.length) {
      reason = `${corroborated.length} corroborated claim(s) exist in the real corpus but none has an owner-declared scope, and a scope is never inferred`;
    } else {
      reason = `${corroborated.length} corroborated claim(s) exist in the real corpus but none matches a declaration, and no declaration nominates a pairing the corpus supports`;
    }
    return { schemaVersion: 1, projectId, corpus, learned: false, reason, corroborated: corroborated.slice(0, 25), pairedFailures: selection.pairedFailures, gates: { R4: false, R5: false, R6: false }, promotionAuthorized: false };
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
    ownerDeclaredAgreement: Boolean(ready.ownerDeclaredAgreement),
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
    // How this pair came to be treated as one claim, and the sentence each source actually
    // used. A wording judgement or an owner-nominated pairing is always visible in the report.
    corroborationRoute: ready.route,
    agreement: ready.agreement,
    ownerDeclaredAgreement: Boolean(ready.ownerDeclaredAgreement),
    assertedAs: ready.assertedAs,
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

module.exports = { readBundle, corroboratedClaims, readScopeDeclarations, selectEvaluable, hasRealCorpusKnowledge, learnFromRealCorpus };
