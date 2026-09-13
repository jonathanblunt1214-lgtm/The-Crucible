const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
const ACTIONS=Object.freeze(['test','narrow','seek-evidence','quarantine','retry','stop','send-to-independent-verifier']);
function nonProof(value){return Object.freeze({...value,proofStageSatisfied:false,independentVerificationSatisfied:false,promotionAllowed:false,strategySha256:hash(value)});}
class CreativeDecisionAdaptationEngine{
  constructor({id='governed-creative-decision-adaptation-v1',maxAttempts=3}={}){if(typeof id!=='string'||!id||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10)throw new Error('Valid strategy identity and bounded maxAttempts are required.');this.id=id;this.maxAttempts=maxAttempts;}
  prepare({candidate,reasoningPlan,criticalReview,preparedAt}){
    if(!candidate||!reasoningPlan||!criticalReview||!Number.isFinite(Date.parse(preparedAt)))throw new Error('Strategy preparation requires bounded reviewed inputs.');
    const hypotheses=[reasoningPlan.hypothesis,`The observed behavior disappears under a no-operation control within ${candidate.claimBoundary}.`,`The claim fails at a boundary-value input inside ${candidate.claimBoundary}.`];
    const counterexamples=[`a minimal valid input that does not show: ${candidate.claim}`,`an adjacent version outside ${candidate.claimBoundary}`,`a setup-only result with the tested operation removed`];
    const alternativeExperiments=['single-operation intervention and reversal','boundary-value matrix with negative controls','isolated regression fixture in a fresh process'];
    const action=reasoningPlan.route==='ready-for-controlled-testing'&&criticalReview.route==='ready-for-controlled-testing'?'test':criticalReview.classification==='Crucible Issue'?'quarantine':'narrow';
    return nonProof({schemaVersion:1,stage:'pre-test-strategy',engineId:this.id,candidateId:candidate.id,originalClaim:candidate.claim,originalBoundary:candidate.claimBoundary,hypotheses,counterexamples,controls:[...reasoningPlan.controls],alternativeExperiments,decision:{action,rationale:action==='test'?'bounded claim and controls are ready':'review requires a safer route'},preparedAt});
  }
  afterTest({candidate,postTestReasoning,attempts,decidedAt}){
    if(!candidate||!postTestReasoning||!Number.isInteger(attempts)||attempts<1||!Number.isFinite(Date.parse(decidedAt)))throw new Error('Post-test decision requires a bounded attempt.');
    let action='seek-evidence';if(postTestReasoning.route==='result-logically-supports-independent-verification')action='send-to-independent-verifier';else if(postTestReasoning.route==='quarantine-contradiction')action='quarantine';else if(attempts<this.maxAttempts)action='retry';else action='stop';
    if(!ACTIONS.includes(action)||action==='promote')throw new Error('Decision action is not governed.');
    const adaptation=action==='retry'?{preserveOriginalClaim:candidate.claim,preserveOriginalBoundary:candidate.claimBoundary,nextAttempt:attempts+1,changes:['reduce fixture to one isolated operation','add the failed condition as an explicit negative control','request missing runtime/version evidence'],mayRemoveRequiredGate:false}:null;
    return nonProof({schemaVersion:1,stage:'post-test-decision',engineId:this.id,candidateId:candidate.id,attempts,decision:{action,rationale:postTestReasoning.route},adaptation,decidedAt});
  }
}
class CognitiveStrategyLedger{
  constructor({root,projectId}){this.root=path.resolve(root);this.projectId=projectId;this.file=path.join(this.root,'cognitive-strategy.json');fs.mkdirSync(this.root,{recursive:true});}
  read(){if(!fs.existsSync(this.file))return{schemaVersion:1,projectId:this.projectId,records:[]};const envelope=JSON.parse(fs.readFileSync(this.file,'utf8'));if(envelope?.sha256!==hash(envelope.payload)||envelope.payload?.projectId!==this.projectId||!Array.isArray(envelope.payload.records))throw new Error('Cognitive strategy ledger integrity or project binding failed.');return structuredClone(envelope.payload);}
  record(value){if(!value||value.proofStageSatisfied!==false||value.independentVerificationSatisfied!==false||value.promotionAllowed!==false||value.decision?.action==='promote')throw new Error('Strategy records cannot prove, verify, or promote.');const state=this.read();const id=`strategy-${hash(value).slice(0,32)}`;if(state.records.some((item)=>item.id===id))return{created:false,id};state.records.push({id,...structuredClone(value)});const envelope={payload:state,sha256:hash(state)};const temporary=`${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(envelope,null,2)}\n`,{flag:'wx',mode:0o600});fs.renameSync(temporary,this.file);return{created:true,id};}
  attempts(candidateId){return this.read().records.filter((item)=>item.candidateId===candidateId&&item.stage==='post-test-decision').length;}
}
module.exports={ACTIONS,CreativeDecisionAdaptationEngine,CognitiveStrategyLedger};
