const crypto=require('node:crypto');
function sha(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
const AMBIGUOUS=/\b(?:usually|often|sometimes|generally|better|worse|fast|slow|modern|it|this|that)\b/i;
class CriticalClaimReviewer {
  constructor({id='deterministic-critical-review-v1'}={}){if(typeof id!=='string'||!id.trim())throw new Error('Critical reviewer id is required.');this.id=id;}
  review({candidate,corroboratingCandidate,comparison,reviewedAt}){
    if(!candidate||!corroboratingCandidate||!comparison||!Number.isFinite(Date.parse(reviewedAt)))throw new Error('Bounded candidates, comparison, and review time are required.');
    const assumptions=['declared runtime and version are available','fixtures isolate the tested operation','source agreement may still share a common error'];
    const counterexamples=['empty or boundary-value input','invalid input or negative control','adjacent runtime/version outside the declared scope'];
    const alternatives=['result caused by setup or fixture behavior','result depends on undeclared runtime state','sources repeat the same upstream assertion'];
    const ambiguities=[candidate.claim,candidate.claimBoundary,candidate.generalizationBoundary].filter((value)=>AMBIGUOUS.test(value));
    const causalLanguage=/\b(?:causes?|because|responsible for|leads? to)\b/i.test(candidate.claim);
    let route='ready-for-controlled-testing';let classification='Insufficient Evidence';let nextAction='run-controlled-experiment';
    if(comparison.classification==='Crucible Issue'){route='quarantine-or-additional-evidence';classification='Crucible Issue';nextAction=comparison.nextAction;}
    else if(ambiguities.length){route='narrow-or-clarify-claim';nextAction='replace ambiguous language with measurable terms before testing';}
    const review={schemaVersion:1,reviewerId:this.id,candidateId:candidate.id,corroboratingCandidateId:corroboratingCandidate.id,comparisonRoute:comparison.route,assumptions,counterexamples,alternativeExplanations:alternatives,ambiguities,causalLanguage,route,classification,nextAction,reviewedAt,proofStageSatisfied:false,independentVerificationSatisfied:false,promotionAllowed:false};
    return Object.freeze({...review,reviewSha256:sha(review)});
  }
}
module.exports={CriticalClaimReviewer};
