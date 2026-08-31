const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const LIFECYCLE=Object.freeze(['observe','prioritize','plan','act','verify','learn','adapt','report']);
const CORE_COMPONENTS=Object.freeze([
  {id:'safe-retrieval',role:'sensory-input',module:'safeInformationRetrieval.js',stages:['observe']},
  {id:'source-extraction',role:'sensory-processing',module:'claimExtractionWorker.js',stages:['observe','learn']},
  {id:'test-suite',role:'controlled-action-and-sensing',module:'authenticity.js',stages:['act','verify','learn']},
  {id:'code-security-organism',role:'code-assistive-security-reflex',module:'codeSecurityOrganism.js',stages:['observe','plan','act','verify','learn','adapt','report']},
  {id:'test-orchestrator',role:'suite-executive-control',module:'testCadence.js',stages:['prioritize','plan','act','report']},
  {id:'learning-orchestrator',role:'learning-executive-control',module:'learningOrchestrator.js',stages:['prioritize','plan','learn','adapt','report']},
  {id:'scientific-memory',role:'verified-memory',module:'scientificLearning.js',stages:['verify','learn']},
  {id:'critical-review',role:'adversarial-review',module:'criticalClaimReview.js',stages:['prioritize','plan']},
  {id:'reasoning',role:'reasoning-and-problem-solving',module:'reasoningProblemSolving.js',stages:['plan','verify','adapt']},
  {id:'adaptive-strategy',role:'creative-decision-adaptation',module:'creativeDecisionAdaptation.js',stages:['plan','adapt']},
  {id:'security',role:'immune-control',module:'security.js',stages:['observe','verify']},
  {id:'quarantine',role:'immune-isolation',module:'quarantine.js',stages:['verify','adapt']},
  {id:'recovery',role:'homeostasis',module:'repair.js',stages:['adapt']},
  {id:'reporting',role:'communication',module:'report.js',stages:['report']},
]);
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function requireText(value,name){if(typeof value!=='string'||!value.trim())throw new Error(`${name} is required.`);return value;}
function verifyCoreEcosystem(root){const ids=new Set();const missing=[];for(const item of CORE_COMPONENTS){if(ids.has(item.id))throw new Error(`Duplicate ecosystem component ${item.id}.`);ids.add(item.id);if(!item.stages.every((stage)=>LIFECYCLE.includes(stage)))throw new Error(`Invalid lifecycle stage for ${item.id}.`);if(!fs.existsSync(path.join(root,'src',item.module)))missing.push(item.module);}return{ready:missing.length===0,components:CORE_COMPONENTS.length,missing};}
class ProductionWorkflowActuator{
  constructor({projectId,actuatorId,detector,planner,executor,verifier,rollback,feedback=async()=>{},report=async()=>{}}){
    this.projectId=requireText(projectId,'projectId');this.actuatorId=requireText(actuatorId,'actuatorId');
    for(const [name,part] of Object.entries({detector,planner,executor,verifier,rollback}))if(!part||typeof part.run!=='function')throw new Error(`${name} handler is required.`);
    const identities=[detector,planner,executor,verifier,rollback].map((part,index)=>requireText(part.id,`${['detector','planner','executor','verifier','rollback'][index]}.id`));
    if(new Set(identities).size!==identities.length)throw new Error('Detection, planning, execution, independent verification, and rollback identities must be distinct.');
    this.parts={detector,planner,executor,verifier,rollback};this.feedback=feedback;this.report=report;
  }
  async run(request){
    if(request?.projectId!==this.projectId)throw new Error('Cross-project actuator request is forbidden.');
    requireText(request?.boundary,'boundary');requireText(request?.changeBaseSha256,'changeBaseSha256');
    const detected=await this.parts.detector.run(structuredClone(request));
    if(!detected?.finding||detected.safeToAct!==true)return this.finish('inhibited',{request,detected,reason:'No bounded safe-to-act finding.'});
    const planned=await this.parts.planner.run({request:structuredClone(request),detected:structuredClone(detected)});
    if(!planned?.reversibleChange||!planned?.rollbackPlan||planned?.boundary!==request.boundary)return this.finish('inhibited',{request,detected,planned,reason:'Plan is unbounded or not rollback-ready.'});
    let applied;
    try{applied=await this.parts.executor.run({request:structuredClone(request),detected:structuredClone(detected),planned:structuredClone(planned)});}
    catch(error){return this.finish('execution-failed',{request,detected,planned,error:String(error.message||error)});}
    if(!applied?.changeHash||!applied?.rollbackToken)return this.finish('inhibited',{request,detected,planned,applied,reason:'Executor did not provide change and rollback custody.'});
    const verified=await this.parts.verifier.run({request:structuredClone(request),detected:structuredClone(detected),planned:structuredClone(planned),applied:structuredClone(applied)});
    if(verified?.passed!==true||verified?.boundary!==request.boundary){const rolledBack=await this.parts.rollback.run({request:structuredClone(request),planned:structuredClone(planned),applied:structuredClone(applied),verified:structuredClone(verified)});return this.finish('rolled-back',{request,detected,planned,applied,verified,rolledBack});}
    return this.finish('verified',{request,detected,planned,applied,verified});
  }
  async finish(state,evidence){const record={schemaVersion:1,projectId:this.projectId,actuatorId:this.actuatorId,state,evidenceHash:hash(evidence),proofStageSatisfied:false,promotionAuthorized:false};await this.feedback(structuredClone(record),structuredClone(evidence));await this.report(structuredClone(record));return record;}
}
class EcosystemCoordinator{
  constructor({projectId,root,handlers={},now=()=>new Date().toISOString()}){if(typeof projectId!=='string'||!projectId||!root)throw new Error('Project-bound ecosystem identity and root are required.');const status=verifyCoreEcosystem(root);if(!status.ready)throw new Error(`Ecosystem components are missing: ${status.missing.join(', ')}.`);this.projectId=projectId;this.root=path.resolve(root);this.handlers=handlers;this.now=now;this.events=[];}
  async cycle(observation={}){if(observation.projectId!==this.projectId)throw new Error('Cross-project ecosystem observation is forbidden.');let signal={...structuredClone(observation),projectId:this.projectId};const stages=[];for(const stage of LIFECYCLE){const components=CORE_COMPONENTS.filter((item)=>item.stages.includes(stage));const outcomes=[];for(const component of components){const handler=this.handlers[component.id]?.[stage];if(!handler){outcomes.push({componentId:component.id,state:'ready-no-work'});continue;}const output=await handler(structuredClone(signal));if(output?.verified===true||output?.promotionAuthorized===true)throw new Error(`${component.id} attempted to self-certify through ecosystem coordination.`);outcomes.push({componentId:component.id,state:'completed',outputSha256:hash(output)});signal={...signal,[component.id]:structuredClone(output)};}stages.push({stage,outcomes});}const event={schemaVersion:1,projectId:this.projectId,cycleId:`cycle-${hash({observation,at:this.now()}).slice(0,24)}`,at:this.now(),stages,proofStageSatisfied:false,promotionAuthorized:false};this.events.push(event);return{event,signal,health:this.health()};}
  health(){const core=verifyCoreEcosystem(this.root);return{projectId:this.projectId,ready:core.ready,components:core.components,lifecycle:[...LIFECYCLE],cycles:this.events.length,homeostasis:{missingComponents:core.missing,inhibited:!core.ready},coordinatorIsTruthSource:false};}
}
module.exports={LIFECYCLE,CORE_COMPONENTS,verifyCoreEcosystem,ProductionWorkflowActuator,EcosystemCoordinator};
