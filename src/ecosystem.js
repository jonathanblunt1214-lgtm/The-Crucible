const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const LIFECYCLE=Object.freeze(['observe','prioritize','plan','act','verify','learn','adapt','report']);
const CORE_COMPONENTS=Object.freeze([
  {id:'safe-retrieval',role:'sensory-input',module:'safeInformationRetrieval.js',stages:['observe']},
  {id:'source-extraction',role:'sensory-processing',module:'claimExtractionWorker.js',stages:['observe','learn']},
  {id:'test-suite',role:'controlled-action-and-sensing',module:'authenticity.js',stages:['act','verify','learn']},
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
function verifyCoreEcosystem(root){const ids=new Set();const missing=[];for(const item of CORE_COMPONENTS){if(ids.has(item.id))throw new Error(`Duplicate ecosystem component ${item.id}.`);ids.add(item.id);if(!item.stages.every((stage)=>LIFECYCLE.includes(stage)))throw new Error(`Invalid lifecycle stage for ${item.id}.`);if(!fs.existsSync(path.join(root,'src',item.module)))missing.push(item.module);}return{ready:missing.length===0,components:CORE_COMPONENTS.length,missing};}
class EcosystemCoordinator{
  constructor({projectId,root,handlers={},now=()=>new Date().toISOString()}){if(typeof projectId!=='string'||!projectId||!root)throw new Error('Project-bound ecosystem identity and root are required.');const status=verifyCoreEcosystem(root);if(!status.ready)throw new Error(`Ecosystem components are missing: ${status.missing.join(', ')}.`);this.projectId=projectId;this.root=path.resolve(root);this.handlers=handlers;this.now=now;this.events=[];}
  async cycle(observation={}){if(observation.projectId!==this.projectId)throw new Error('Cross-project ecosystem observation is forbidden.');let signal={...structuredClone(observation),projectId:this.projectId};const stages=[];for(const stage of LIFECYCLE){const components=CORE_COMPONENTS.filter((item)=>item.stages.includes(stage));const outcomes=[];for(const component of components){const handler=this.handlers[component.id]?.[stage];if(!handler){outcomes.push({componentId:component.id,state:'ready-no-work'});continue;}const output=await handler(structuredClone(signal));if(output?.verified===true||output?.promotionAuthorized===true)throw new Error(`${component.id} attempted to self-certify through ecosystem coordination.`);outcomes.push({componentId:component.id,state:'completed',outputSha256:hash(output)});signal={...signal,[component.id]:structuredClone(output)};}stages.push({stage,outcomes});}const event={schemaVersion:1,projectId:this.projectId,cycleId:`cycle-${hash({observation,at:this.now()}).slice(0,24)}`,at:this.now(),stages,proofStageSatisfied:false,promotionAuthorized:false};this.events.push(event);return{event,signal,health:this.health()};}
  health(){const core=verifyCoreEcosystem(this.root);return{projectId:this.projectId,ready:core.ready,components:core.components,lifecycle:[...LIFECYCLE],cycles:this.events.length,homeostasis:{missingComponents:core.missing,inhibited:!core.ready},coordinatorIsTruthSource:false};}
}
module.exports={LIFECYCLE,CORE_COMPONENTS,verifyCoreEcosystem,EcosystemCoordinator};
