const { AutonomousScientificLearner } = require('./scientificLearning');
const { routeThreeWayComparison } = require('./claimComparison');

class ControlledClaimEvaluationWorker {
  constructor({ store, comparisonLedger, criticalReviewer, reasoningProblemSolver, reasoningLedger, strategyEngine, strategyLedger, experimentHarnesses, verifierHarnesses, now=()=>new Date().toISOString() }) {
    if (!store?.get || !store?.activeKnowledge || !comparisonLedger?.record) throw new Error('Durable learning and comparison custody are required.');
    if (!criticalReviewer?.review) throw new Error('A non-proof critical claim reviewer is required.');
    if (!reasoningProblemSolver?.plan || !reasoningProblemSolver?.interpret || !reasoningLedger?.record) throw new Error('Non-proof logical reasoning and problem-solving custody is required.');
    if (!strategyEngine?.prepare || !strategyEngine?.afterTest || !strategyLedger?.record || !strategyLedger?.attempts) throw new Error('Governed creativity, decision-making, and adaptability custody is required.');
    if (!experimentHarnesses || !verifierHarnesses) throw new Error('Language-specific experiment and verifier harness registries are required.');
    this.store=store;this.comparisonLedger=comparisonLedger;this.criticalReviewer=criticalReviewer;this.reasoningProblemSolver=reasoningProblemSolver;this.reasoningLedger=reasoningLedger;this.strategyEngine=strategyEngine;this.strategyLedger=strategyLedger;this.experimentHarnesses=experimentHarnesses;this.verifierHarnesses=verifierHarnesses;this.now=now;
  }
  select(candidateId, corroboratingCandidateId) {
    const primary=this.store.get(candidateId);const corroborating=this.store.get(corroboratingCandidateId);
    if (!primary || !corroborating || primary.state!=='candidate' || corroborating.state!=='candidate') throw new Error('Evaluation selects two existing unprocessed bounded candidates.');
    if (primary.candidate.id===corroborating.candidate.id || primary.candidate.provenance.sourceId===corroborating.candidate.provenance.sourceId) throw new Error('Evaluation requires two independently identified evidence sources.');
    return {primary,corroborating};
  }
  async process({ candidateId, corroboratingCandidateId, language }) {
    const {primary,corroborating}=this.select(candidateId,corroboratingCandidateId);const experiment=this.experimentHarnesses[language];const verifier=this.verifierHarnesses[language];
    if (!experiment || !verifier || typeof experiment.run!=='function' || typeof verifier.run!=='function' || !experiment.id || !verifier.id || experiment.id===verifier.id) throw new Error('A supported language requires distinct experiment and verifier harnesses.');
    const decision=routeThreeWayComparison({projectId:this.store.projectId,candidateId,sourceA:{sourceId:primary.candidate.provenance.sourceId,claim:primary.candidate.claim,claimBoundary:primary.candidate.claimBoundary,generalizationBoundary:primary.candidate.generalizationBoundary},sourceB:{sourceId:corroborating.candidate.provenance.sourceId,claim:corroborating.candidate.claim,claimBoundary:corroborating.candidate.claimBoundary,generalizationBoundary:corroborating.candidate.generalizationBoundary},activeKnowledge:this.store.activeKnowledge(),comparedAt:this.now()});this.comparisonLedger.record(decision);
    const criticalReview=this.criticalReviewer.review({candidate:primary.candidate,corroboratingCandidate:corroborating.candidate,comparison:decision,reviewedAt:this.now()});
    const reasoningPlan=this.reasoningProblemSolver.plan({candidate:primary.candidate,corroboratingCandidate:corroborating.candidate,comparison:decision,criticalReview,plannedAt:this.now()});this.reasoningLedger.record(reasoningPlan);
    const strategy=this.strategyEngine.prepare({candidate:primary.candidate,reasoningPlan,criticalReview,preparedAt:this.now()});this.strategyLedger.record(strategy);
    if (!['new-claim-evaluation'].includes(decision.route) || criticalReview.route!=='ready-for-controlled-testing' || reasoningPlan.route!=='ready-for-controlled-testing' || strategy.decision.action!=='test') return {decision,criticalReview,reasoningPlan,strategy,postTestReasoning:null,postTestDecision:null,record:primary,verifiedKnowledge:null,usedKnowledge:[]};
    let postTestReasoning=null;let postTestDecision=null;const governedExperiment={id:experiment.id,run:async(input)=>{try{const result=await experiment.run(input);postTestReasoning=this.reasoningProblemSolver.interpret({plan:reasoningPlan,result,interpretedAt:this.now()});this.reasoningLedger.record(postTestReasoning);postTestDecision=this.strategyEngine.afterTest({candidate:primary.candidate,postTestReasoning,attempts:this.strategyLedger.attempts(candidateId)+1,decidedAt:this.now()});this.strategyLedger.record(postTestDecision);if(postTestDecision.decision.action!=='send-to-independent-verifier')throw new Error(`Post-test decision blocked verification: ${postTestDecision.decision.action}.`);return result;}catch(error){if(!postTestReasoning){postTestReasoning=this.reasoningProblemSolver.interpret({plan:reasoningPlan,error:String(error.message||error),interpretedAt:this.now()});this.reasoningLedger.record(postTestReasoning);}if(!postTestDecision){postTestDecision=this.strategyEngine.afterTest({candidate:primary.candidate,postTestReasoning,attempts:this.strategyLedger.attempts(candidateId)+1,decidedAt:this.now()});this.strategyLedger.record(postTestDecision);}throw error;}}};
    const learner=new AutonomousScientificLearner({store:this.store,experimentExecutor:governedExperiment,independentVerifier:verifier,now:this.now});const record=await learner.process(candidateId,reasoningPlan.hypothesis);
    const verifiedKnowledge=record.state==='verified'?this.store.activeKnowledge().find((item)=>item.candidateId===candidateId)||null:null;
    return {decision,criticalReview,reasoningPlan,strategy,postTestReasoning,postTestDecision,record,verifiedKnowledge,usedKnowledge:verifiedKnowledge?this.store.retrieve({boundary:verifiedKnowledge.boundary}):[]};
  }
}

module.exports={ControlledClaimEvaluationWorker};
