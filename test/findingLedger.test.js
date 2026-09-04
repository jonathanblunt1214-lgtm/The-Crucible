'use strict';const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readLedger,appendOutcome,historyFor,assessRecurrence,GENESIS}=require('../src/findingLedger');
const {recordFinding,repairOutcome}=require('../src/gradedOversightResponse');
const {ExternalOversightReflex}=require('../src/oversightReflex');
const {DurableOrganismRuntime}=require('../src/organismRuntime');
const at='2026-09-01T06:00:00.000Z';
const ledgerFile=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'finding-ledger-')),'finding-ledger.json');
const fault=(detail='a verifier outage')=>recordFinding({kind:'stale-lock',organ:'digestive',boundary:'claim extraction queue',detail,observedAt:at});
const unverifiedAttempt=(finding)=>repairOutcome({finding,attempted:true,result:{organ:finding.organ,boundary:finding.boundary},independentVerification:null,observedAt:at});

test('an absent ledger is no history, and every appended link is chained to the one before it',()=>{
  const file=ledgerFile();
  assert.deepEqual(readLedger(file).entries,[],'a first run has no recorded past');
  const finding=fault();
  const first=appendOutcome({file,outcome:unverifiedAttempt(finding)});
  const second=appendOutcome({file,outcome:unverifiedAttempt(finding)});
  assert.equal(first.previousSha256,GENESIS);
  assert.equal(second.previousSha256,first.entrySha256,'the chain is what makes the record append-only');
  assert.equal(readLedger(file).entries.length,2);
});

test('a rewritten or truncated ledger refuses to answer rather than reporting a clean past',()=>{
  const file=ledgerFile();
  const finding=fault();
  appendOutcome({file,outcome:unverifiedAttempt(finding)});
  appendOutcome({file,outcome:unverifiedAttempt(finding)});
  const tampered=JSON.parse(fs.readFileSync(file,'utf8'));
  tampered.entries[0].record.attempted=false;
  fs.writeFileSync(file,JSON.stringify(tampered,null,2));
  assert.throws(()=>readLedger(file),/rewritten after it was recorded/);
  const cut=JSON.parse(fs.readFileSync(file,'utf8'));
  cut.entries.splice(0,1);
  fs.writeFileSync(file,JSON.stringify(cut,null,2));
  assert.throws(()=>readLedger(file),/out of sequence|does not follow/);
  fs.writeFileSync(file,'{not json');
  assert.throws(()=>readLedger(file),/unreadable history is not an empty one/);
});

test('the first occurrence of an ordinary fault gets one bounded window; the same fault returning does not',()=>{
  const file=ledgerFile();
  const first=assessRecurrence({file,kind:'stale-lock',organ:'digestive',boundary:'claim extraction queue',detail:'a worker holds an extraction lock past the staleness floor',observedAt:at});
  assert.equal(first.decision.repairAllowed,true);
  assert.equal(first.recurrence,0);
  appendOutcome({file,outcome:unverifiedAttempt(first.finding)});
  const again=assessRecurrence({file,kind:'stale-lock',organ:'digestive',boundary:'claim extraction queue',detail:'worded entirely differently this time',observedAt:at});
  assert.equal(again.finding.findingId,first.finding.findingId,'the same fault described differently is the same fault');
  assert.equal(again.recurrence,1);
  assert.equal(again.decision.repairAllowed,false);
  assert.equal(again.decision.escalate,true);
  assert.equal(again.decision.requestedOfOversight,'STOP');
  assert.match(again.decision.reason,/never independently verified/);
  assert.equal(again.decision.decidesStop,false,'Crucible requests a stop; it never decides one');
});

test("history is read per finding, so an unrelated fault does not spend another fault's window",()=>{
  const file=ledgerFile();
  appendOutcome({file,outcome:unverifiedAttempt(fault())});
  const other=assessRecurrence({file,kind:'stale-lock',organ:'learning',boundary:'promotion queue',detail:'a different organ entirely',observedAt:at});
  assert.equal(other.recurrence,0);
  assert.equal(other.decision.repairAllowed,true);
  assert.equal(historyFor({file,findingId:fault().findingId}).length,1);
});

test('appending requires a recorded finding and somewhere durable to keep it',()=>{
  assert.throws(()=>appendOutcome({file:ledgerFile(),outcome:{attempted:true}}),/recorded findingId is required/);
  assert.throws(()=>appendOutcome({file:'',outcome:unverifiedAttempt(fault())}),/nowhere to live/);
});

function runtimeFixture(root){
  const {publicKey:oversightPublicKey}=crypto.generateKeyPairSync('ed25519');
  const {publicKey:ownerPublicKey}=crypto.generateKeyPairSync('ed25519');
  const organs={brain:async()=>({planned:true}),immune:async()=>{throw new Error('simulated verifier outage');},reporting:async()=>({reported:true})};
  return new DurableOrganismRuntime({projectId:'p',root,organs,learningStore:{retrieve:()=>[]},oversightReflex:new ExternalOversightReflex({projectId:'p',oversightPublicKey,ownerPublicKey}),maximumQueue:8,now:()=>at});
}

test('a fault that returns across runs escalates, and homeostasis may not clear what oversight was asked about',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'organism-recurrence-'));
  const runtime=runtimeFixture(root);
  runtime.submit({id:'immune-1',type:'work-request',sourceOrgan:'brain',targetOrgan:'immune',boundary:'repair',payload:{}});
  for(let i=0;i<3;i+=1)await runtime.heartbeat();
  assert.equal(runtime.read().queue[0].state,'quarantined');
  assert.deepEqual(runtime.health().escalations,[],'a first occurrence is an incident, and gets its bounded attempt');
  runtime.setOrganAvailability('immune',true,null,'governance+immune');
  runtime.recover();
  assert.equal(runtime.read().queue[0].state,'queued','the first fault is recoverable by homeostasis');

  // The same fault, in a later run against the same durable state: now it is a pattern.
  const restarted=runtimeFixture(root);
  for(let i=0;i<3;i+=1)await restarted.heartbeat();
  const escalations=restarted.health().escalations;
  assert.equal(escalations.length,1,'the recurrence is escalated exactly once');
  assert.equal(escalations[0].organ,'immune');
  assert.equal(escalations[0].requestedOfOversight,'STOP');
  assert.equal(restarted.health().oversight.requestedOfOversight,'STOP','a standing request is visible in the health view');

  restarted.setOrganAvailability('immune',true,null,'governance+immune');
  restarted.recover();
  const item=restarted.read().queue[0];
  assert.equal(item.state,'quarantined','homeostasis may not answer the organism’s own escalation');
  assert.match(item.lastError,/STOP has been requested of independent oversight/);
  assert.ok(readLedger(path.join(root,'finding-ledger.json')).entries.length>=2,'every occurrence is on the durable record');
});
