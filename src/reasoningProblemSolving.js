const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const {validateHypothesisTestPlan,hypothesisTestPlanSha256}=require('./hypothesisTestPlan');
const {variablesForLanguage}=require('./languageHypothesisVariables');
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function base(stage,candidateId,at){return {schemaVersion:1,stage,candidateId,at,proofStageSatisfied:false,independentVerificationSatisfied:false,promotionAllowed:false};}
class LogicalReasoningProblemSolver{
  constructor({id='deterministic-logic-problem-solver-v1'}={}){if(typeof id!=='string'||!id.trim())throw new Error('Reasoning identity is required.');this.id=id;}
  plan({candidate,corroboratingCandidate,comparison,criticalReview,language,plannedAt}){
    if(!candidate||!corroboratingCandidate||!comparison||!criticalReview||!Number.isFinite(Date.parse(plannedAt)))throw new Error('Reasoning requires bounded inputs and a valid time.');
    const premises=[`source ${candidate.provenance.sourceId} asserts the bounded claim`,`source ${corroboratingCandidate.provenance.sourceId} independently asserts the bounded claim`,`active knowledge comparison route is ${comparison.route}`];
    const competingHypotheses=[`the claim holds inside ${candidate.claimBoundary}`,'the apparent result is caused by fixture or setup behavior','the behavior is version-specific outside the declared boundary','both sources repeat a shared upstream error'];
    const decomposedTests=['positive behavior under declared inputs','no-operation or irrelevant-operation control','negative and boundary-value behavior','regression behavior outside the tested operation','scope/version exclusion check'];
    const controls=['no-operation control','irrelevant-operation control','negative input','regression fixture','adjacent scope/version exclusion'];
    const ready=comparison.route==='new-claim-evaluation'&&criticalReview.route==='ready-for-controlled-testing';
    const hypothesis=`Within ${candidate.claimBoundary}, controlled execution will show that ${candidate.claim}`;
    const variables=variablesForLanguage(language,candidate);const testPlan=validateHypothesisTestPlan({schemaVersion:1,hypothesis,...variables,claimBoundary:candidate.claimBoundary,experimentBoundary:candidate.claimBoundary,generalizationBoundary:candidate.generalizationBoundary,createdAt:plannedAt},candidate);
    const item={...base('pre-test',candidate.id,plannedAt),reasonerId:this.id,premises,competingHypotheses,decomposedTests,controls,testedProperty:candidate.claim,experimentBoundary:candidate.claimBoundary,hypothesis,testPlan,testPlanSha256:hypothesisTestPlanSha256(testPlan,candidate),route:ready?'ready-for-controlled-testing':'request-more-evidence-or-narrow-scope',classification:comparison.classification,nextAction:ready?'execute-designed-controls':criticalReview.nextAction};return Object.freeze({...item,reasoningSha256:hash(item)});
  }
  interpret({plan,result,error,interpretedAt}){
    if(!plan||!Number.isFinite(Date.parse(interpretedAt))||(!result&&!error))throw new Error('Post-test reasoning requires a plan and result or failure.');
    const failed=Boolean(error);const identityMatches=!failed&&result.testedProperty===plan.testedProperty&&result.experimentBoundary===plan.experimentBoundary;
    const causal=!failed&&result.causalIsolation?.correlationOnly===false;const controls=!failed&&Array.isArray(result.controls)&&result.controls.length>0&&Array.isArray(result.negativeTests)&&result.negativeTests.length>0&&Array.isArray(result.regressionTests)&&result.regressionTests.length>0;
    const contradiction=!failed&&result.contradictionResult!=='none';const supported=identityMatches&&causal&&controls&&!contradiction;
    const item={...base('post-test',plan.candidateId,interpretedAt),reasonerId:this.id,planSha256:plan.reasoningSha256,logicalChecks:{identityMatches,causationNotCorrelation:causal,controlsPresent:controls,contradictionDetected:contradiction,testFailed:failed},route:supported?'result-logically-supports-independent-verification':contradiction?'quarantine-contradiction':failed?'revise-hypothesis-or-test-after-failure':'request-more-evidence-or-redesign-controls',classification:contradiction?'Crucible Issue':'Insufficient Evidence',nextAction:supported?'send-to-distinct-independent-verifier':contradiction?'quarantine-as-crucible-issue':failed?'inspect failure, revise hypothesis or request missing evidence':'redesign the bounded controlled test'};return Object.freeze({...item,reasoningSha256:hash(item)});
  }
}
class ReasoningLedger{
  constructor({root,projectId}){this.root=path.resolve(root);this.projectId=projectId;this.file=path.join(this.root,'reasoning-reviews.json');fs.mkdirSync(this.root,{recursive:true});}
  read(){if(!fs.existsSync(this.file))return{schemaVersion:1,projectId:this.projectId,reviews:[]};const envelope=JSON.parse(fs.readFileSync(this.file,'utf8'));if(envelope?.sha256!==hash(envelope.payload)||envelope.payload?.projectId!==this.projectId||!Array.isArray(envelope.payload.reviews))throw new Error('Reasoning ledger integrity or project binding failed.');return structuredClone(envelope.payload);}
  record(review){if(!review||review.proofStageSatisfied!==false||review.independentVerificationSatisfied!==false||review.promotionAllowed!==false)throw new Error('Reasoning may record only non-proof reviews.');const state=this.read();const id=`reasoning-${hash(review).slice(0,32)}`;if(state.reviews.some((item)=>item.id===id))return{created:false,id};state.reviews.push({id,...structuredClone(review)});const envelope={payload:state,sha256:hash(state)};const temporary=`${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(envelope,null,2)}\n`,{flag:'wx',mode:0o600});fs.renameSync(temporary,this.file);return{created:true,id};}
}
module.exports={LogicalReasoningProblemSolver,ReasoningLedger};
