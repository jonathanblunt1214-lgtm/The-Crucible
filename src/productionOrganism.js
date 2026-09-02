'use strict';
const crypto=require('node:crypto');const {DurableOrganismRuntime}=require('./organismRuntime');const {assertFlyByWire}=require('./circulationLinkage');
const id=(prefix,value)=>`${prefix}-${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24)}`;
function signal({type,sourceOrgan,targetOrgan,boundary,payload}){return{id:id(`${sourceOrgan}-to-${targetOrgan}`,{type,boundary,payload}),type,sourceOrgan,targetOrgan,boundary,payload};}
function createProductionOrganism({projectId,root,learningStore,oversightReflex,diagnosticPlanner,repairActuator,experienceRecorder,reporter,digestiveWorker,testingOrgan,now}){
  // testingOrgan is required rather than defaulted. Everything else here is injected too, and a
  // quiet default import would both break that discipline and hide the fact that an organism now
  // has a route to the test suite - which is precisely the wiring a reader needs to see.
  for(const [name,value] of Object.entries({diagnosticPlanner,repairActuator,experienceRecorder,reporter,digestiveWorker,testingOrgan}))if(!value)throw new Error(`${name} is required for the production organism.`);
  const organs={
    brain:async({payload,memory,envelope})=>{const plan=await diagnosticPlanner.plan({...payload,boundary:envelope.boundary,verifiedMemory:memory});if(!plan?.bounded||!plan?.nextAction)throw new Error('Brain produced no bounded governed plan.');return{planSha256:id('plan',plan),signals:[signal({type:'work-request',sourceOrgan:'brain',targetOrgan:plan.nextAction==='repair'?'immune':'reporting',boundary:envelope.boundary,payload:{...payload,plan}})],proofStageSatisfied:false,promotionAuthorized:false};},
    immune:async({payload,envelope})=>{const result=await repairActuator.run({projectId,boundary:envelope.boundary,changeBaseSha256:payload.changeBaseSha256||payload.plan?.changeBaseSha256});const signals=[signal({type:'candidate-evidence',sourceOrgan:'immune',targetOrgan:'learning',boundary:envelope.boundary,payload:{kind:'experience-observation',result}}),signal({type:'report',sourceOrgan:'immune',targetOrgan:'reporting',boundary:envelope.boundary,payload:{result}})];
      // The immune system's route to the test suite. It asks for the tests the governed plan
      // named; it never invents a selection, because a request nobody asked for would be this
      // organ deciding for itself what evidence it wants to be judged on.
      const request=payload.testRequest||payload.plan?.testRequest;
      if(request)signals.push(signal({type:'work-request',sourceOrgan:'immune',targetOrgan:'testing',boundary:envelope.boundary,payload:{request,repairResult:result}}));
      return{result,signals,proofStageSatisfied:false,promotionAuthorized:false};},
    // Runs existing tests on request and reports what it observed. A passing test is an
    // observation, never a proof stage - the record it emits is candidate evidence like any
    // other, and circulation independently refuses a handler that claims otherwise.
    testing:async({payload,envelope})=>{const outcome=await testingOrgan({payload,envelope});return{...outcome,signals:[signal({type:'candidate-evidence',sourceOrgan:'testing',targetOrgan:'learning',boundary:envelope.boundary,payload:{kind:'existing-test-observation',result:outcome.result}}),signal({type:'report',sourceOrgan:'testing',targetOrgan:'reporting',boundary:envelope.boundary,payload:{result:outcome.result}})]};},
    digestive:async({payload,envelope})=>{const result=await digestiveWorker.process(payload);return{result,signals:[signal({type:'candidate-evidence',sourceOrgan:'digestive',targetOrgan:'learning',boundary:envelope.boundary,payload:{kind:'vetted-extraction',result}})],proofStageSatisfied:false,promotionAuthorized:false};},
    learning:async({payload,envelope})=>{const recorded=await experienceRecorder.record({...payload,projectId,claimBoundary:envelope.boundary,classification:'Insufficient Evidence'});return{recorded,proofStageSatisfied:false,promotionAuthorized:false};},
    reporting:async({payload,envelope})=>({reported:await reporter.report({...payload,projectId,boundary:envelope.boundary}),proofStageSatisfied:false,promotionAuthorized:false}),
  };
  // Fly-by-wire: the organism will not start with a severed wire, because a signal to an
  // organ with no handler never arrives and nothing reports its absence.
  assertFlyByWire(organs);
  return new DurableOrganismRuntime({projectId,root,organs,learningStore,oversightReflex,now});
}
function submitNervousObservation(runtime,{observationId,boundary,finding,changeBaseSha256}){return runtime.submit(signal({type:'observation',sourceOrgan:'nervous-system',targetOrgan:'brain',boundary,payload:{observationId,finding,changeBaseSha256}}));}
function submitVettedIntake(runtime,{intakeId,boundary,custody}){return runtime.submit(signal({type:'candidate-evidence',sourceOrgan:'lungs',targetOrgan:'digestive',boundary,payload:{intakeId,custody}}));}
module.exports={createProductionOrganism,submitNervousObservation,submitVettedIntake};
