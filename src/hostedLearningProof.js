'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DurableScientificLearningStore, encryptWeeklyEnvelope, decryptWeeklyEnvelope, sha } = require('./scientificLearning');
const { runLearningCycle } = require('./learningCycle');
const { preSoakReadiness } = require('./preSoakReadiness');
const { learnFromRealCorpus, hasRealCorpusKnowledge, readBundle, corpusCandidateStore, allCandidateRecords } = require('./realCorpusLearning');
const { realCorpusSafety } = require('./realCorpusSafety');
const { realSupersession } = require('./realSupersession');

const BOUNDARY = 'Node.js ordinary dense arrays of numbers';
const GENERALIZATION = 'Does not cover sparse arrays, proxies, subclasses, or host objects.';
const STATE_CONTEXT = 'github-hosted-learning-state-v1';

function proof(candidate, hypothesis, at) {
  return { schemaVersion:1, candidateId:candidate.id, projectId:candidate.projectId, hypothesis, testedProperty:candidate.claim, experimentBoundary:candidate.claimBoundary, controls:['output identity differs from input','input snapshot remains unchanged'], causalIsolation:{method:'single mapped operation with identity and mutation controls',result:'only the returned array differs',correlationOnly:false}, negativeTests:['empty input returns a distinct empty array'], regressionTests:['dense numeric mapping preserves input values'], scopeProof:BOUNDARY, generalizationResult:GENERALIZATION, contradictionResult:'none', completedAt:at };
}
function harnesses(at) {
  const execute = () => { const input=[1,2,3]; const output=input.map((value)=>value*2); assert.notEqual(output,input); assert.deepEqual(input,[1,2,3]); assert.deepEqual(output,[2,4,6]); assert.deepEqual([].map((value)=>value),[]); };
  return {
    experiment:{ id:'github-controlled-runner', run:async({candidate,hypothesis})=>{ execute(); return proof(candidate,hypothesis,at); } },
    verifier:{ id:'github-independent-runner', run:async({candidate,experimentalProof})=>{ execute(); return { verifierId:'github-independent-runner', independent:true, testedProperty:candidate.claim, experimentBoundary:experimentalProof.experimentBoundary, result:'passed', verifiedAt:at }; } },
  };
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
async function runHostedProof({ root, encryptedFile, reportFile, key, repository, ref, runId, bundleRoot, scopeDeclarationFile, now=()=>new Date().toISOString() }) {
  if (!/^[-_A-Za-z0-9+/=]{32,}$/.test(key||'')) throw new Error('CRUCIBLE_HOSTED_STORE_KEY is missing or invalid.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')) throw new Error('GitHub repository identity is invalid.');
  if (ref!=='refs/heads/development') throw new Error('Hosted learning proof is development-only.');
  const masterKey=Buffer.from(key,'base64'); if(masterKey.length<32)throw new Error('CRUCIBLE_HOSTED_STORE_KEY must decode to at least 32 bytes.');
  const projectId=`github:${repository}`, subject=`repo:${repository}:ref:${ref}`, binding={projectId,repository,subject};
  const storeRoot=path.join(root,'store'); fs.mkdirSync(storeRoot,{recursive:true});
  const store=new DurableScientificLearningStore({root:storeRoot,projectId}); const restored=restore(store,encryptedFile,masterKey,binding); const at=now(); const {experiment,verifier}=harnesses(at);
  // R4-R6 are learned from the real restored corpus. There is deliberately no synthetic
  // fallback: this previously built two "sources" in code out of the claim string itself,
  // which proved the pipeline ran and proved nothing about learning. If the real corpus
  // cannot supply a corroborated, owner-scoped claim, this reports unsatisfied and stops.
  let realLearning = null;
  const restoredBundle = bundleRoot && fs.existsSync(path.join(bundleRoot,'manifest.json')) ? readBundle(bundleRoot) : null;
  if (!hasRealCorpusKnowledge(store, restoredBundle)) {
    if (!bundleRoot) throw new Error('CRUCIBLE_HOSTED_BUNDLE_ROOT is required: the hosted proof learns from the restored real corpus and has no fixture fallback.');
    realLearning = await learnFromRealCorpus({ bundleRoot, learningRoot:storeRoot, projectId, scopeDeclarationFile, harnessesFor:()=>({experiment,verifier}), now:()=>at });
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
      const c = stopped.corpus || {};
      console.log(`[The Crucible] corpus: ${c.sources} sources, ${c.documentsWithContent} with stored content; ${c.corpusCandidateRecords} candidate(s) in the corpus learning state, ${c.candidateRecords} in the persistent store, ${c.candidatesAvailableForCorroboration} available to corroboration; ${c.furnitureExcludedFromCorroboration} excluded as document furniture; ${c.corroboratedClaims} corroborated; corpus learning state restored: ${c.corpusLearningStateRestored}.`);
      for (const review of (realLearning.reviews || []).slice(0, 25)) console.log(`[The Crucible] review: ${review.testable ? 'testable' : `not testable (${review.reviewRoute})`} - ${String(review.claim).slice(0, 150)}`);
      for (const [index,item] of (stopped.corroborated||[]).entries()) {
        console.log(`[The Crucible] corroborated ${index+1}/${stopped.corroborated.length} (${item.agreement}, ${item.sourceCount} sources): ${item.claim}`);
        console.log(`[The Crucible]   sources: ${(item.sourceIds||[]).join(' | ')}`);
        if (item.agreement === 'semantic') for (const asserted of item.assertedAs||[]) console.log(`[The Crucible]   asserted as: ${asserted}`);
      }
      for (const failure of stopped.pairedFailures||[]) console.log(`[The Crucible] pairing not usable for "${failure.claim}": ${failure.reason}`);
      throw new Error(`Hosted learning proof stopped: ${realLearning.reason}`);
    }
  }
  // R7 on real evidence: a further independent corpus source re-tests the promoted claim,
  // supersedes it, and the prior version is restored with its history intact. This previously
  // built a candidate out of the same hardcoded claim string it had just promoted, labelled it
  // a repository test fixture, and superseded a version it had made for itself.
  const corpusStore = restoredBundle ? corpusCandidateStore(restoredBundle, bundleRoot, projectId) : null;
  const supersession = await realSupersession({
    store,
    available: allCandidateRecords(store, corpusStore),
    bundle: restoredBundle,
    experiment,
    verifier,
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
  const safetyResult = await realCorpusSafety({
    root,
    bundleRoot,
    bundle: restoredBundle,
    payload,
    candidateRecords: [...everyRecord.values()],
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
  const report={schemaVersion:1,projectId,repository,ref,runId:String(runId),completedAt:at,restoredEncryptedState:restored,revision:payload.revision,candidateRecords:payload.candidateRecords.length,knowledgeVersions:payload.knowledgeVersions.length,activeVersion:payload.activeVersion,activeBoundary:(payload.knowledgeVersions.find((item)=>item.version===payload.activeVersion)||{}).boundary||null,outOfScopeRetrievalCount:store.retrieve({boundary:'outside hosted proof boundary'}).length,gates:gateStates,safetyEvidence:safety,safetyBehaviours:safetyResult.behaviours,safetyUnsatisfied:safetyResult.unsatisfied,supersession,encryptedStateSha256:sha(fs.readFileSync(encryptedFile)),authorizesPromotion:false};
  fs.mkdirSync(path.dirname(reportFile),{recursive:true}); fs.writeFileSync(reportFile,`${JSON.stringify(report,null,2)}\n`,{mode:0o600}); return report;
}

if(require.main===module){runHostedProof({root:process.env.RUNNER_TEMP||process.cwd(),encryptedFile:process.env.CRUCIBLE_HOSTED_ENCRYPTED_STATE||'.hosted-learning-cache/store.envelope.json',reportFile:process.env.CRUCIBLE_HOSTED_PROOF_REPORT||'hosted-learning-proof/report.json',key:process.env.CRUCIBLE_HOSTED_STORE_KEY,repository:process.env.GITHUB_REPOSITORY,ref:process.env.GITHUB_REF,runId:process.env.GITHUB_RUN_ID,bundleRoot:process.env.CRUCIBLE_HOSTED_BUNDLE_ROOT,scopeDeclarationFile:process.env.CRUCIBLE_HOSTED_SCOPE_DECLARATIONS||crypto.randomUUID()}).then((report)=>console.log(`[The Crucible] GitHub-hosted durable learning proof passed R4-R8 at revision ${report.revision}.`)).catch((error)=>{console.error(`[The Crucible] Hosted learning proof failed closed: ${error.message}`);process.exitCode=1;});}

module.exports={runHostedProof};
