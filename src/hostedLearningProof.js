'use strict';

const assert = require('node:assert/strict');
const { crucibleError, UNCODED } = require('./failureCodes');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DurableScientificLearningStore, encryptWeeklyEnvelope, decryptWeeklyEnvelope, sha } = require('./scientificLearning');
const { runLearningCycle } = require('./learningCycle');
const { preSoakReadiness } = require('./preSoakReadiness');
const { learnFromRealCorpus, hasRealCorpusKnowledge, readBundle, corpusCandidateStore, allCandidateRecords, readScopeDeclarations, corpusBackedVersions, oversightQuarantinedHashes } = require('./realCorpusLearning');
const { realCorpusSafety, oversightInjectionRefusals } = require('./realCorpusSafety');
const { DurableGateEvidenceStore, invalidateStaleGates } = require('./durableGateEvidence');
const { realSupersession } = require('./realSupersession');
const { intakePathways } = require('./intakePathways');
const { harnessesForDeclaration, lazyHarnessPair } = require('./hostedExperimentHarnesses');

const STATE_CONTEXT = 'github-hosted-learning-state-v1';

// The hardcoded harness pair that used to live here ran one fixed JavaScript array-map snippet
// for every claim, and had the same closure "independently" confirm it. Real per-language
// harnesses are built in hostedExperimentHarnesses.js, where independence is a different
// measurement method rather than a different id string, and every proof field is derived from
// the analysis that actually ran.
function withoutPlanBinding(harness) {
  return { id:harness.id, run:async(input)=>{const result=await harness.run(input);const bounded={...result};delete bounded.testPlanSha256;return bounded;} };
}
function restore(store, encryptedFile, key, binding) {
  if (!fs.existsSync(encryptedFile)) return false;
  const envelope = JSON.parse(fs.readFileSync(encryptedFile,'utf8'));
  const transport = decryptWeeklyEnvelope(envelope,{ masterKey:key, expectedProjectId:binding.projectId, expectedRepository:binding.repository, expectedWeek:STATE_CONTEXT, expectedOidcSubject:binding.subject });
  const payload = transport.candidateEvidence[0]?.durableState;
  if (!payload) throw new Error('Encrypted hosted state contains no durable payload.');
  store.writeEnvelope(payload);
  store.read();
  return true;
}
function persist(store, encryptedFile, key, binding) {
  const transport={schemaVersion:1,projectId:binding.projectId,week:STATE_CONTEXT,candidateEvidence:[{durableState:store.read()}],verifiedKnowledge:[]};
  const envelope = encryptWeeklyEnvelope(transport,{ masterKey:key, projectId:binding.projectId, repository:binding.repository, week:STATE_CONTEXT, oidcSubject:binding.subject });
  fs.mkdirSync(path.dirname(encryptedFile),{recursive:true});
  const temporary=`${encryptedFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(envelope,null,2)}\n`,{flag:'wx',mode:0o600});
  fs.renameSync(temporary,encryptedFile);
}
async function runHostedProof({ root, encryptedFile, reportFile, key, repository, ref, runId, bundleRoot, scopeDeclarationFile, oversightCustodyReportFile=null, now=()=>new Date().toISOString() }) {
  if (!/^[-_A-Za-z0-9+/=]{32,}$/.test(key||'')) throw new Error('CRUCIBLE_HOSTED_STORE_KEY is missing or invalid.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')) throw new Error('GitHub repository identity is invalid.');
  if (ref!=='refs/heads/development') throw new Error('Hosted learning proof is development-only.');
  const masterKey=Buffer.from(key,'base64'); if(masterKey.length<32)throw new Error('CRUCIBLE_HOSTED_STORE_KEY must decode to at least 32 bytes.');
  const projectId=`github:${repository}`, subject=`repo:${repository}:ref:${ref}`, binding={projectId,repository,subject};
  const storeRoot=path.join(root,'store'); fs.mkdirSync(storeRoot,{recursive:true});
  const store=new DurableScientificLearningStore({root:storeRoot,projectId}); const restored=restore(store,encryptedFile,masterKey,binding); const at=now();
  // R4-R6 are learned from the real restored corpus. There is deliberately no synthetic
  // fallback: this previously built two "sources" in code out of the claim string itself,
  // which proved the pipeline ran and proved nothing about learning. If the real corpus
  // cannot supply a corroborated, owner-scoped claim, this reports unsatisfied and stops.
  let realLearning = null;
  const restoredBundle = bundleRoot && fs.existsSync(path.join(bundleRoot,'manifest.json')) ? readBundle(bundleRoot) : null;
  // Read here rather than just before the safety check, because the refusals in it decide what
  // learning is allowed to see. Candidate evidence from an independent party: two fields, decision
  // and reason, never an instruction. An unusable report excludes nothing and says so.
  let custodyReport = null;
  if (oversightCustodyReportFile) {
    try {
      custodyReport = JSON.parse(fs.readFileSync(oversightCustodyReportFile, 'utf8'));
      const injection = oversightInjectionRefusals(custodyReport);
      const refused = oversightQuarantinedHashes(custodyReport);
      console.log(`[The Crucible] independent oversight custody report read: ${(custodyReport.sourceReviews || []).length} source review(s), ${refused.size} quarantined, ${injection.length} of them for prompt injection.`);
    } catch (error) {
      custodyReport = null;
      console.log(`[The Crucible] independent oversight custody report was not usable (${error.message}); nothing is excluded on consumption and R8 falls back to what the corpus alone can show.`);
    }
  }
  if (!hasRealCorpusKnowledge(store, restoredBundle)) {
    if (!bundleRoot) throw new Error('CRUCIBLE_HOSTED_BUNDLE_ROOT is required: the hosted proof learns from the restored real corpus and has no fixture fallback.');
    realLearning = await learnFromRealCorpus({ bundleRoot, learningRoot:storeRoot, projectId, scopeDeclarationFile, harnessesFor:(declaration)=>harnessesForDeclaration(declaration,{projectId,at}), custodyReport, now:()=>at });
    if (!realLearning.learned) {
      const stopped = { schemaVersion:1, projectId, repository, ref, runId:String(runId), completedAt:at, restoredEncryptedState:restored,
        learnedFromRealCorpus:false, reason:realLearning.reason, corpus:realLearning.corpus,
        // What the corpus does corroborate, and why any nominated pairing was not usable. A scope
        // is never inferred, so the owner has to be able to see what there is to declare one for.
        corroborated:realLearning.corroborated || [], pairedFailures:realLearning.pairedFailures || [],
        gates:[{id:'R4',state:'unsatisfied'},{id:'R5',state:'unsatisfied'},{id:'R6',state:'unsatisfied'},{id:'R7',state:'unsatisfied'},{id:'R8',state:'unsatisfied'}],
        authorizesPromotion:false };
      fs.mkdirSync(path.dirname(reportFile),{recursive:true});
      fs.writeFileSync(reportFile,`${JSON.stringify(stopped,null,2)}\n`,{mode:0o600});
      // Print them to the run log too: the report is an artifact, and an owner cannot declare a
      // scope for a claim they would have to download the run to read. The counts come first,
      // because "did extraction produce anything" and "was anything promoted" are different
      // questions and the reason line only answers the second.
      // Digestion's two pathways, reported separately. "Nothing corroborated" and "digestion
      // stopped three steps earlier" are different findings, and this repository has already
      // spent runs mistaking the second for the first.
      const pathways = realLearning.intake || intakePathways({ sources: (restoredBundle && restoredBundle.sources) || [], candidateRecords: [] });
      stopped.intakePathways = pathways;
      console.log(`[The Crucible] intake -> learning: ${pathways.learning.usableCandidates} usable candidate(s) from ${pathways.learning.distinctSources} source(s); ${pathways.learning.excludedAsFurniture} excluded as document furniture.`);
      console.log(`[The Crucible] intake -> diagnostics: ${pathways.diagnostics.healthy ? 'digestion healthy' : pathways.diagnostics.signals.map((item) => item.signal).join(', ')}`);
      for (const signal of pathways.diagnostics.signals) console.log(`[The Crucible]   ${signal.signal}: ${signal.detail}`);
      if (pathways.blocked) console.log(`[The Crucible] blocked pathway: ${pathways.blocked}`);
      const c = stopped.corpus || {};
      console.log(`[The Crucible] corpus: ${c.sources} sources, ${c.sourcesWithContent} with stored content held in ${c.documentsWithContent} content-addressed file(s) (${c.sourcesWithContent - c.documentsWithContent} share a file with another source); ${c.corpusCandidateRecords} candidate(s) in the corpus learning state, ${c.candidateRecords} in the persistent store, ${c.candidatesAvailableForCorroboration} available to corroboration; ${c.furnitureExcludedFromCorroboration} excluded as document furniture; ${c.corroboratedClaims} corroborated; corpus learning state restored: ${c.corpusLearningStateRestored}.`);
      // Says whether zero corroborated claims is the corpus or the threshold. Reporting only.
      if (c.corroborationSensitivity) {
        const s = c.corroborationSensitivity;
        const line = s.measured
          .map((m) => `${m.minimumOverlap}${m.configured ? ' (configured)' : ''}: ${m.corroboratedClaims}`)
          .join('; ');
        console.log(`[The Crucible] corroboration at each sameness threshold - ${line}. This decides nothing and authorizes nothing; the configured threshold is unchanged.`);
        // The endpoint alone cannot say why a run corroborates nothing: four filters run in
        // series and each one alone produces the same zero. These name the stage that loses it.
        for (const m of s.measured) {
          const g = m.stages;
          console.log(`[The Crucible]   at ${m.minimumOverlap}: ${s.candidatesJudged} candidate(s) -> ${g.groups} group(s) -> ${g.groupsAgreeing} with two or more claims -> ${g.groupsWithTwoSourceIds} with two source ids -> ${g.groupsWithTwoIndependentSources} with two independent sources.`);
          for (const lost of g.lostToOneSource) console.log(`[The Crucible]     agreed but one source (${lost.sourceId}, ${lost.members} claims): ${String(lost.claim).slice(0, 120)}`);
          for (const lost of g.lostToDependence) console.log(`[The Crucible]     agreed across ${lost.sourceIdsSeen} source ids but not independent - ${lost.reason}: ${String(lost.claim).slice(0, 120)}`);
        }
      }
      for (const review of (realLearning.reviews || []).slice(0, 25)) console.log(`[The Crucible] review: ${review.testable ? 'testable' : `not testable (${review.reviewRoute})`} - ${String(review.claim).slice(0, 150)}`);
      for (const [index,item] of (stopped.corroborated||[]).entries()) {
        console.log(`[The Crucible] corroborated ${index+1}/${stopped.corroborated.length} (${item.agreement}, ${item.sourceCount} sources): ${item.claim}`);
        console.log(`[The Crucible]   sources: ${(item.sourceIds||[]).join(' | ')}`);
        if (item.agreement === 'semantic') for (const asserted of item.assertedAs||[]) console.log(`[The Crucible]   asserted as: ${asserted}`);
      }
      for (const failure of stopped.pairedFailures||[]) console.log(`[The Crucible] pairing not usable for "${failure.claim}": ${failure.reason}`);
      // The most frequently red check in this repository, and until now its failure carried no
      // code at all: a reader got a paragraph of prose and had to work out from it whether the
      // blockage was digestion, corpus composition, or a missing owner declaration. Those
      // demand opposite responses. The code comes from the branch that chose the reason.
      throw crucibleError(realLearning.stopCode || UNCODED, `Hosted learning proof stopped: ${realLearning.reason}`);
    }
    // What this run actually did, in the log rather than only in the retained artifact. Every
    // gate below is judged from the store, so "R5 satisfied" on its own cannot distinguish a
    // claim this run tested from one an earlier run promoted and this one restored - and those
    // are different findings. This names the claim, the two adapters that measured it, and the
    // version, so which of the two happened is readable without downloading the run.
    for (const item of realLearning.evaluations || []) {
      console.log(`[The Crucible] ${item.learned ? 'promoted' : 'not promoted'} (${item.language}): ${String(item.claim).slice(0, 140)}`);
      console.log(`[The Crucible]   experiment ${item.experimentExecutorId || 'none'} | independent verifier ${item.independentVerifierId || 'none'} | version ${item.verifiedVersion || 'none'} | sources ${(item.sourceIds || []).join(' ')}`);
      if (!item.learned) console.log(`[The Crucible]   ${item.reason}`);
    }
  } else {
    console.log('[The Crucible] real corpus knowledge was restored from retained state, so no declaration was evaluated and no claim was tested on this runner.');
  }
  // Names the claim each satisfied gate is actually about. R5 and R6 are judged from the store,
  // so on a restored run they read satisfied with nothing in the log saying what was verified -
  // and the boundary is what identifies the language whose harness produced it. The first run to
  // finish reported four gates satisfied without naming a single claim.
  // Each one says whether the corpus backs it, because deleting a harness does not retract what
  // it already promoted. The first run to print this found an active version carrying the exact
  // module constant the deleted hardcoded harness used as its boundary, still counted by R5
  // alongside the version a real experiment earned. Membership in the restored corpus is the one
  // thing a fixture cannot forge, so that is the discriminator, reused rather than reinvented.
  const backedVersions = corpusBackedVersions({ payload: store.read(), bundle: restoredBundle });
  const unbacked = [];
  for (const version of store.activeKnowledge()) {
    const backed = backedVersions.has(version.version);
    if (!backed) unbacked.push(version);
    console.log(`[The Crucible] active knowledge v${version.version} (${backed ? 'corpus-backed' : 'NOT corpus-backed'}, candidate ${version.candidateId}): ${String(version.claim).slice(0, 140)}`);
    console.log(`[The Crucible]   boundary: ${version.boundary}`);
  }
  for (const version of unbacked) {
    console.log(`[The Crucible] WARNING active knowledge v${version.version} is not backed by any source in the restored corpus: its candidate ${version.candidateId} has no provenance matching a manifest hash or a queue source id. It is still counted as a verified knowledge version by R5. This reports it and changes no gate; retracting durable state is an owner decision.`);
  }
  // R7 on real evidence: a further independent corpus source re-tests the promoted claim,
  // supersedes it, and the prior version is restored with its history intact. This previously
  // built a candidate out of the same hardcoded claim string it had just promoted, labelled it
  // a repository test fixture, and superseded a version it had made for itself.
  const corpusStore = restoredBundle ? corpusCandidateStore(restoredBundle, bundleRoot, projectId) : null;
  // Resolved lazily from the declaration whose claim was promoted, because R7 re-tests that
  // claim and must use its language. realSupersession returns unsatisfied before touching a
  // harness while no verified knowledge exists, so nothing is built in that case.
  // Resolved in order, because R7 must use the harness for the claim it is re-testing and that
  // claim may have been promoted by an earlier run rather than this one. A restart-safe run
  // restores active knowledge while promoting nothing, so this run's own promotion is not always
  // available. Falling through to null throws CRU-0050 rather than substituting a harness.
  const supersessionHarnesses = lazyHarnessPair({ projectId, at, resolveLanguage: () => {
    if (realLearning && realLearning.language) return realLearning.language;
    const active = store.activeKnowledge();
    if (!active.length) return null;
    const flatten = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const declarations = readScopeDeclarations(scopeDeclarationFile);
    for (const version of active) {
      const match = declarations.find((item) => flatten(item.claim) === flatten(version.claim));
      if (match) return match.language || 'javascript';
    }
    return null;
  } });
  const supersession = await realSupersession({
    store,
    available: allCandidateRecords(store, corpusStore),
    bundle: restoredBundle,
    experiment:withoutPlanBinding(supersessionHarnesses.experiment),
    verifier:withoutPlanBinding(supersessionHarnesses.verifier),
    excludeSourceIds: (realLearning && realLearning.sourceIds) || [],
    now: () => at,
  });

  let payload=store.read();
  // R8 against the real corpus and a real retriever. The four retrieval behaviours previously
  // ran with fetchImpl replaced by a function returning a string written inline, and three of
  // the eight were tautologies - a hash compared with itself. Every behaviour is now derived
  // from the documents actually retrieved, the queue that recorded them, and the candidates
  // extraction produced; a behaviour the corpus cannot demonstrate is reported unsatisfied.
  // Deduplication evidence is about what extraction produced, not about custody state, so this
  // takes every record rather than only those still awaiting evaluation - a claim that was
  // promoted is still a claim two documents asserted.
  const everyRecord = new Map();
  for (const record of [...payload.candidateRecords, ...(corpusStore ? corpusStore.read().candidateRecords : [])]) {
    if (!everyRecord.has(record.candidate.id)) everyRecord.set(record.candidate.id, record);
  }
  // The independent vetting organ's own refusal record, when the job has it. Oversight publishes
  // encrypted-custody-report.json beside the ciphertext, the workflow already clones it to join
  // the parts, and nothing read it - so a source Oversight quarantined for prompt injection
  // appeared here only as oversight-vetting-pending and R8 reported no quarantine existed.
  // Read as candidate evidence from an independent party: two fields, and the refusal counts only
  // when Crucible also holds none of the bytes. A malformed or absent report is not fatal, and it
  // is not silent either - it leaves the behaviour to the corpus alone and says so.
  const safetyResult = await realCorpusSafety({
    root,
    bundleRoot,
    bundle: restoredBundle,
    payload,
    candidateRecords: [...everyRecord.values()],
    custodyReport,
  });
  const safety = safetyResult.evidence;
  for (const item of safetyResult.unsatisfied) console.log(`[The Crucible] R8 ${item.behaviour} not demonstrated: ${item.reason}`);
  if (!supersession.satisfied) console.log(`[The Crucible] R7 not demonstrated: ${supersession.reason}`);

  payload=store.read(); const readiness=preSoakReadiness({payload,combinedSafetyEvidence:safety});
  // The gates are reported as the readiness reporter judges them. They were previously asserted
  // to be satisfied, which turns an unsatisfied gate into a crash rather than a finding, and
  // made a fixture-fed pass indistinguishable from a real one.
  const gateStates = readiness.gates.filter((item)=>['R4','R5','R6','R7','R8'].includes(item.id));
  for (const gate of gateStates) if (gate.state !== 'satisfied') console.log(`[The Crucible] ${gate.id} ${gate.state}: ${gate.detail}`);

  persist(store,encryptedFile,masterKey,binding);

  // Gate evidence is recorded beside the encrypted store and travels with it, so a later run
  // inherits what this one observed instead of re-deriving it from a store that may have been
  // evicted. Each outcome is bound to a fingerprint of the code that decided it, and any
  // inherited outcome whose deciders have since changed is dropped to unproven rather than
  // carried forward - evidence that outlives its own implementation reads as current and is
  // worse than none. This records and invalidates; preSoakReadiness still decides the gates.
  const evidenceStore = new DurableGateEvidenceStore({ root: path.dirname(path.resolve(encryptedFile)), projectId });
  const staleCheck = invalidateStaleGates(evidenceStore.read(), path.join(__dirname), at);
  for (const item of staleCheck.invalidated) console.log(`[The Crucible] inherited ${item.gateId} evidence invalidated: ${item.reason}`);
  const gateEvidence = evidenceStore.record({ gateStates, sourceRoot: path.join(__dirname), runId, at });

  const report={schemaVersion:1,projectId,repository,ref,runId:String(runId),completedAt:at,restoredEncryptedState:restored,revision:payload.revision,candidateRecords:payload.candidateRecords.length,knowledgeVersions:payload.knowledgeVersions.length,activeVersion:payload.activeVersion,activeBoundary:(payload.knowledgeVersions.find((item)=>item.version===payload.activeVersion)||{}).boundary||null,outOfScopeRetrievalCount:store.retrieve({boundary:'outside hosted proof boundary'}).length,gates:gateStates,gateEvidence:{revision:gateEvidence.revision,recorded:Object.fromEntries(Object.entries(gateEvidence.gates).map(([id,entry])=>[id,{state:entry.state,fingerprint:entry.fingerprint,runId:entry.runId}])),invalidatedOnRestore:staleCheck.invalidated},intakePathways:intakePathways({sources:(restoredBundle&&restoredBundle.sources)||[],candidateRecords:[...everyRecord.values()]}),safetyEvidence:safety,safetyBehaviours:safetyResult.behaviours,safetyUnsatisfied:safetyResult.unsatisfied,supersession,encryptedStateSha256:sha(fs.readFileSync(encryptedFile)),authorizesPromotion:false};
  fs.mkdirSync(path.dirname(reportFile),{recursive:true}); fs.writeFileSync(reportFile,`${JSON.stringify(report,null,2)}\n`,{mode:0o600}); return report;
}

// The completion line used to print "passed R4-R8" on every resolve, whatever the gates said.
// While the proof failed closed at CRU-0026 that line was unreachable, and it became reachable
// the moment an owner declaration let a run get this far - so the first run that ever finished
// produced a green check and a log line claiming five gates had passed while R8 was pending. A
// green check is read here as the evidence that the gates hold. This reports each gate exactly as
// the readiness reporter judged it and exits non-zero unless all of R4-R8 are satisfied. The
// retention step is `if: always()`, so a red run still uploads the durable state and the gate
// evidence, and the restore chain the next run reads is unaffected.
// Deliberately one stream. The gate lines went to stdout and the verdict to stderr, and the
// runner interleaves the two, so the first red run printed its verdict between R4 and R5 - a
// report whose point is that each gate is stated plainly should not arrive shuffled.
function reportCompletion(report, log = console.log) {
  const gates = report.gates || [];
  const unsatisfied = gates.filter((item) => item.state !== 'satisfied');
  const lines = gates.map((gate) => `[The Crucible] ${gate.id}: ${gate.state}`);
  if (gates.length && !unsatisfied.length) {
    lines.push(`[The Crucible] GitHub-hosted durable learning proof: R4-R8 all satisfied at revision ${report.revision}. This authorizes no promotion.`);
    log(lines.join('\n'));
    return 0;
  }
  lines.push(`[The Crucible] GitHub-hosted durable learning proof did not pass at revision ${report.revision}: ${unsatisfied.map((item) => `${item.id} ${item.state}`).join(', ') || 'no gate was reported at all'}. The run is red because the gates it exists to prove are not all satisfied; the retained artifact still carries the durable state.`);
    log(lines.join('\n'));
  return 1;
}

if (require.main === module) {
  runHostedProof({ root: process.env.RUNNER_TEMP || process.cwd(), encryptedFile: process.env.CRUCIBLE_HOSTED_ENCRYPTED_STATE || '.hosted-learning-cache/store.envelope.json', reportFile: process.env.CRUCIBLE_HOSTED_PROOF_REPORT || 'hosted-learning-proof/report.json', key: process.env.CRUCIBLE_HOSTED_STORE_KEY, repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, runId: process.env.GITHUB_RUN_ID, bundleRoot: process.env.CRUCIBLE_HOSTED_BUNDLE_ROOT, scopeDeclarationFile: process.env.CRUCIBLE_HOSTED_SCOPE_DECLARATIONS || crypto.randomUUID(), oversightCustodyReportFile: process.env.CRUCIBLE_OVERSIGHT_CUSTODY_REPORT || null })
    .then((report) => { process.exitCode = reportCompletion(report); })
    .catch((error) => { console.error(`[The Crucible] Hosted learning proof failed closed: ${error.message}`); process.exitCode = 1; });
}

module.exports={runHostedProof,reportCompletion};
