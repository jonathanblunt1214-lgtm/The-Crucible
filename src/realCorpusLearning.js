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
const crypto = require('node:crypto');
const { DurableScientificLearningStore } = require('./scientificLearning');
const { ControlledClaimEvaluationWorker } = require('./claimEvaluationWorker');
const { ClaimComparisonLedger } = require('./claimComparison');
const { CriticalClaimReviewer } = require('./criticalClaimReview');
const { routeThreeWayComparison } = require('./claimComparison');
const { LogicalReasoningProblemSolver, ReasoningLedger } = require('./reasoningProblemSolving');
const { CreativeDecisionAdaptationEngine, CognitiveStrategyLedger } = require('./creativeDecisionAdaptation');
const { groupCorroborating, semanticallyCorroborates } = require('./semanticCorroboration');
const { verifyPairedDeclaration } = require('./pairedCorroboration');
const { sourceIndex, independentSubset } = require('./sourceIndependence');

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

function readBundle(root) {
  const manifestFile = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`No restored bundle at ${root}: manifest.json is missing.`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const queueFile = path.join(root, 'source-queue.json');
  if (!fs.existsSync(queueFile)) throw new Error('The restored bundle has no source-queue.json.');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  // The bundle also carries the owner's durable learning state, staged under its own basename.
  // That is where the corpus's extracted candidates actually live.
  const learningFile = manifest.learningFile ? path.join(root, manifest.learningFile) : null;
  return { manifest, queue, sources: [...(queue.documents || []), ...(queue.links || [])], learningFile: learningFile && fs.existsSync(learningFile) ? learningFile : null };
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
function corroboratedClaims(storeOrRecords, options = {}) {
  const records = Array.isArray(storeOrRecords) ? storeOrRecords : storeOrRecords.read().candidateRecords;
  const index = options.sourceIndex || null;
  const entries = [];
  for (const record of records) {
    if (record.state !== 'candidate') continue;
    if (!normalize(record.candidate.claim)) continue;
    entries.push({ id: record.candidate.id, claim: record.candidate.claim, sourceId: record.candidate.provenance.sourceId, provenance: record.candidate.provenance });
  }
  const corroborated = [];
  for (const group of groupCorroborating(entries, options)) {
    const bySource = new Map();
    for (const member of group.members) if (!bySource.has(member.sourceId)) bySource.set(member.sourceId, member);
    if (bySource.size < 2) continue;
    // Distinct source ids are not the same thing as independent sources. Two editions of one
    // book, or two pages of one publisher, agree with themselves; counting that as
    // corroboration is how a single mistaken document becomes two votes.
    const { members: independentMembers, rejected } = independentSubset([...bySource.values()], index);
    if (independentMembers.length < 2) continue;
    const picked = independentMembers.sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 2);
    corroborated.push({
      claimKey: normalize(group.claim),
      claim: group.claim,
      // How the two sources were found to agree, so a report never hides a wording judgement.
      agreement: picked.some((member) => normalize(member.claim) !== normalize(group.claim)) ? 'semantic' : 'verbatim',
      sourceCount: independentMembers.length,
      sourceIdsSeen: bySource.size,
      notIndependent: rejected,
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

// The store the corpus's own candidates are in.
//
// The hosted proof restores two separate things: the persistent encrypted store it writes
// promotions into, and the bundle, which carries the owner's durable learning state as staged
// by hostedSourceBundle.stage(). The corpus's roughly 1,416 extracted candidates are in the
// second one. Reading only the first meant corroboration was searching a store that holds
// almost no extracted evidence, so it would have found nothing whatever sameness test was
// used - the same shape of mistake as measuring gates against fixtures.
function corpusCandidateStore(bundle, bundleRoot, projectId) {
  if (!bundle || !bundle.learningFile) return null;
  // The store names its own file from the project id. Only open the bundle root as a store when
  // the staged learning file is that exact name, so a bundle from another project or an older
  // layout is reported rather than silently read as an empty store.
  const expected = `${crypto.createHash('sha256').update(projectId).digest('hex')}.learning.json`;
  if (path.basename(bundle.learningFile) !== expected) return null;
  return new DurableScientificLearningStore({ root: bundleRoot, projectId });
}

// Every candidate available to corroboration: the persistent store's and the corpus's, keyed by
// candidate id so a candidate present in both is counted once.
function allCandidateRecords(store, corpusStore) {
  const byId = new Map();
  for (const source of [corpusStore, store]) {
    if (!source) continue;
    for (const record of source.read().candidateRecords) {
      if (record.state !== 'candidate') continue;
      if (!byId.has(record.candidate.id)) byId.set(record.candidate.id, record);
    }
  }
  return [...byId.values()];
}

// Putting every corroborated claim through the real critical reviewer, without promoting any
// of them and without declaring anything.
//
// A scope is the owner's to declare, and until one exists a claim cannot be evaluated. But the
// comparison and the critical reviewer are pure functions over evidence already in custody, so
// every corroborated claim can be run through them now and say for itself whether it is the
// kind of assertion this pipeline could ever test. That is a real verdict from the system's own
// reviewer rather than an opinion about the claim, and it costs nothing: nothing is written,
// nothing is promoted, and no scope is invented to make it possible.
function reviewCorroborated(corroborated, records, { declarations = [], reviewer = new CriticalClaimReviewer(), at = new Date().toISOString(), projectId } = {}) {
  const byId = new Map(records.map((record) => [record.candidate.id, record.candidate]));
  const reviews = [];
  for (const item of corroborated) {
    const a = byId.get(item.candidateIds[0]);
    const b = byId.get(item.candidateIds[1]);
    if (!a || !b) continue;
    const declaration = declarations.find((entry) => entry.claimKey === item.claimKey) || null;
    const claimScope = declaration ? declaration.claimScope : null;
    const source = (candidate) => ({ sourceId: candidate.provenance.sourceId, claim: candidate.claim, claimBoundary: candidate.claimBoundary, generalizationBoundary: candidate.generalizationBoundary, claimScope });
    let decision;
    try {
      decision = routeThreeWayComparison({ projectId: projectId || a.projectId, candidateId: a.id, sourceA: source(a), sourceB: source(b), activeKnowledge: [], comparedAt: at, ownerDeclaredAgreement: item.agreement === 'semantic' });
    } catch (error) {
      reviews.push({ claim: item.claim, testable: false, route: 'not-comparable', reason: error.message, scopeDeclared: Boolean(declaration) });
      continue;
    }
    const review = reviewer.review({ candidate: a, corroboratingCandidate: b, comparison: decision, reviewedAt: at });
    reviews.push({
      claim: item.claim,
      sourceCount: item.sourceCount,
      agreement: item.agreement,
      scopeDeclared: Boolean(declaration),
      comparisonRoute: decision.route,
      reviewRoute: review.route,
      ambiguities: review.ambiguities,
      causalLanguage: review.causalLanguage,
      // The reviewer routes a claim to controlled testing only when nothing in its wording
      // stops it. Anything else is the system saying this is not yet a testable assertion.
      testable: review.route === 'ready-for-controlled-testing',
      nextAction: review.nextAction,
      proofStageSatisfied: false,
      promotionAuthorized: false,
    });
  }
  return reviews;
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
function selectEvaluable({ store, available, corroborated, declarations, bundle, bundleRoot, options = {} }) {
  const all = selectAllEvaluable({ store, available, corroborated, declarations, bundle, bundleRoot, options });
  return { ready: all.ready[0] || null, pairedFailures: all.pairedFailures };
}

// Every declaration the corpus can support, not only the first.
//
// A single run used to evaluate one claim and stop, so declaring ten scopes tested one of them
// and left the other nine untouched with no way to tell from the report. Each usable
// declaration is now carried through on its own, and each reports its own outcome: the
// pipeline may promote one, quarantine another, and refuse a third in the same run, which is
// what a governed pipeline judging ten different claims should look like.
function selectAllEvaluable({ store, available, corroborated, declarations, bundle, bundleRoot, options = {} }) {
  const pairedFailures = [];
  const ready = [];
  const claimed = new Set();

  for (const declaration of declarations) {
    const match = corroborated.find((item) => item.claimKey === declaration.claimKey
      || (item.assertedAs || []).some((claim) => normalize(claim) === declaration.claimKey)
      || semanticallyCorroborates(declaration.claim, item.claim, options).corroborates);
    if (match && !claimed.has(match.candidateIds.join('|'))) {
      claimed.add(match.candidateIds.join('|'));
      ready.push({ ...match, declaration, route: 'corpus-corroborated' });
    }
  }

  const records = available || store.read().candidateRecords;
  const candidateFor = (sourceId, sentence) => records.find((record) => record.state === 'candidate'
    && String(record.candidate.provenance.sourceId) === String(sourceId)
    && normalize(record.candidate.claim) === normalize(sentence));

  for (const declaration of declarations.filter((item) => Array.isArray(item.pairedSources) && !ready.some((item2) => item2.declaration === item))) {
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
    const candidate = {
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
    };
    if (!claimed.has(candidate.candidateIds.join('|'))) {
      claimed.add(candidate.candidateIds.join('|'));
      ready.push(candidate);
    }
  }

  return { ready, pairedFailures };
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
  // Corroboration searches the corpus's own extracted candidates as well as the persistent
  // store's; the persistent store holds only what previous runs promoted or ingested.
  const corpusStore = corpusCandidateStore(bundle, bundleRoot, projectId);
  const available = allCandidateRecords(store, corpusStore);
  const corroborated = corroboratedClaims(available, { ...corroborationOptions, sourceIndex: sourceIndex(bundle) });
  const declarations = readScopeDeclarations(scopeDeclarationFile);

  const corpus = {
    sources: bundle.sources.length,
    documentsWithContent: bundle.manifest.sourceFiles ? bundle.manifest.sourceFiles.length : 0,
    candidateRecords: before.candidateRecords.length,
    corpusCandidateRecords: corpusStore ? corpusStore.read().candidateRecords.length : 0,
    corpusLearningStateRestored: Boolean(corpusStore),
    candidatesAvailableForCorroboration: available.length,
    corroboratedClaims: corroborated.length,
    knowledgeVersionsBefore: before.knowledgeVersions.length,
  };

  const selection = selectAllEvaluable({ store, available, corroborated, declarations, bundle, bundleRoot, options: corroborationOptions });
  const reviews = reviewCorroborated(corroborated, available, { declarations, at: now(), projectId });

  if (!selection.ready.length) {
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
    return { schemaVersion: 1, projectId, corpus, learned: false, reason, corroborated: corroborated.slice(0, 25), reviews, pairedFailures: selection.pairedFailures, evaluations: [], gates: { R4: false, R5: false, R6: false }, promotionAuthorized: false };
  }

  // Every usable declaration is carried through on its own. One may promote while another is
  // quarantined and a third is refused; each says which, and none decides for the others.
  const evaluations = [];
  for (const ready of selection.ready) {
    const { experiment, verifier } = harnessesFor(ready.declaration);
    if (!experiment?.id || !verifier?.id || experiment.id === verifier.id) throw new Error('Independent verification requires distinct experiment and verifier identities.');

    const ingestedFromCorpus = [];
    for (const record of available) {
      if (!ready.candidateIds.includes(record.candidate.id)) continue;
      if (store.get(record.candidate.id)) continue;
      store.ingest(record.candidate);
      ingestedFromCorpus.push(record.candidate.id);
    }

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

    let evaluation;
    try {
      evaluation = await worker.process({
        candidateId: ready.candidateIds[0],
        corroboratingCandidateId: ready.candidateIds[1],
        language: ready.declaration.language || 'javascript',
        claimScope: ready.declaration.claimScope,
        ownerDeclaredAgreement: Boolean(ready.ownerDeclaredAgreement),
      });
    } catch (error) {
      // One claim failing its controlled test is a result about that claim, not a reason to
      // abandon the others.
      evaluations.push({ claim: ready.claim, claimScope: ready.declaration.claimScope, corroborationRoute: ready.route, sourceIds: ready.sourceIds, candidateIds: ready.candidateIds, ingestedFromCorpus, learned: false, reason: `the controlled pipeline stopped on this claim: ${error.message}`, verifiedVersion: null, promotionAuthorized: false });
      continue;
    }

    const verified = evaluation.verifiedKnowledge;
    evaluations.push({
      claim: ready.claim,
      claimScope: ready.declaration.claimScope,
      corroborationRoute: ready.route,
      agreement: ready.agreement,
      ownerDeclaredAgreement: Boolean(ready.ownerDeclaredAgreement),
      assertedAs: ready.assertedAs,
      sourceIds: ready.sourceIds,
      candidateIds: ready.candidateIds,
      ingestedFromCorpus,
      experimentExecutorId: experiment.id,
      independentVerifierId: verifier.id,
      learned: Boolean(verified),
      reason: verified ? null : `the controlled pipeline did not promote this claim: comparison routed ${evaluation.decision.route}, critical review routed ${evaluation.criticalReview.route}, and the record ended in state ${evaluation.record.state}`,
      verifiedVersion: verified ? verified.version : null,
      retrievedWithinScope: verified ? store.retrieve({ boundary: verified.boundary }).map((item) => item.version) : [],
      promotionAuthorized: false,
    });
  }

  const promoted = evaluations.filter((item) => item.learned);
  const after = store.read();
  const first = promoted[0] || null;
  return {
    schemaVersion: 1,
    projectId,
    corpus,
    reviews,
    // Each declaration's own outcome, so a run that promotes one claim and refuses four says so.
    evaluations,
    declarationsEvaluated: evaluations.length,
    claimsPromoted: promoted.length,
    learned: promoted.length > 0,
    reason: promoted.length ? null : `no declared claim was promoted: ${evaluations.map((item) => `"${item.claim.slice(0, 60)}" - ${item.reason}`).join('; ')}`,
    claim: first ? first.claim : null,
    claimScope: first ? first.claimScope : null,
    corroborationRoute: first ? first.corroborationRoute : null,
    agreement: first ? first.agreement : null,
    ownerDeclaredAgreement: first ? Boolean(first.ownerDeclaredAgreement) : false,
    assertedAs: first ? first.assertedAs : null,
    ingestedFromCorpus: first ? first.ingestedFromCorpus : [],
    sourceIds: first ? first.sourceIds : null,
    candidateIds: first ? first.candidateIds : null,
    experimentExecutorId: first ? first.experimentExecutorId : null,
    independentVerifierId: first ? first.independentVerifierId : null,
    verifiedVersion: first ? first.verifiedVersion : null,
    retrievedWithinScope: first ? first.retrievedWithinScope : [],
    knowledgeVersionsAfter: after.knowledgeVersions.length,
    gates: { R4: evaluations.length > 0, R5: promoted.length > 0, R6: promoted.length > 0 && Boolean(first) && first.retrievedWithinScope.length > 0 },
    promotionAuthorized: false,
  };
}

module.exports = { readBundle, corpusCandidateStore, allCandidateRecords, corroboratedClaims, reviewCorroborated, readScopeDeclarations, selectEvaluable, selectAllEvaluable, hasRealCorpusKnowledge, learnFromRealCorpus };
