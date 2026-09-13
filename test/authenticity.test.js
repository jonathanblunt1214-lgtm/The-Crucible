const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyClaims, digestFile, recordExperience, learningGuidance } = require('../src/authenticity');
const { DurableScientificLearningStore } = require('../src/scientificLearning');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-authenticity-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed');
  git(root, ['add', 'seed.txt']);
  git(root, ['commit', '-m', 'seed']);
  return root;
}
function config(claims) {
  return { authenticity:{ claims, requireArtifacts:true }, workload:{ timeoutMinutes:1 } };
}

test('digestFile returns the sha256 of a file\'s exact contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-authenticity-digest-'));
  const target = path.join(root, 'file.txt');
  fs.writeFileSync(target, 'known content');
  assert.equal(digestFile(target), crypto.createHash('sha256').update('known content').digest('hex'));
});

test('runs each claim\'s command and records evidence with its digest and the current commit', async () => {
  const root = repository();
  const claim = {
    name:'Build produces output',
    run:process.execPath,
    args:['-e', "require('fs').writeFileSync('evidence.txt', 'proof')"],
    cwd:'.',
    evidence:['evidence.txt'],
  };
  const result = await verifyClaims(root, config([claim]));
  assert.equal(result.claims, 1);
  const record = result.records[0];
  assert.equal(record.claim, 'Build produces output');
  assert.equal(record.commit, git(root, ['rev-parse', 'HEAD']).trim());
  assert.deepEqual(record.evidence, [{ path:'evidence.txt', sha256:crypto.createHash('sha256').update('proof').digest('hex') }]);
  assert.ok(record.commandSha256);
  assert.ok(record.verifiedAt);
});

test('throws when a claim declares evidence its command never produced', async () => {
  const root = repository();
  const claim = { name:'Broken claim', run:process.execPath, args:['-e', "''"], cwd:'.', evidence:['missing.txt'] };
  await assert.rejects(verifyClaims(root, config([claim])), /did not produce evidence file missing\.txt/);
});

test('throws when requireArtifacts is set and a claim declares no evidence at all', async () => {
  const root = repository();
  const claim = { name:'No evidence', run:process.execPath, args:['-e', "''"], cwd:'.' };
  await assert.rejects(verifyClaims(root, config([claim])), /must declare at least one evidence artifact/);
});

test('refuses evidence paths that escape the project root', async () => {
  const root = repository();
  const claim = { name:'Escaping claim', run:process.execPath, args:['-e', "''"], cwd:'.', evidence:['../outside.txt'] };
  await assert.rejects(verifyClaims(root, config([claim])), /did not produce evidence file \.\.\/outside\.txt/);
});

test('runs multiple claims in order and returns one record per claim', async () => {
  const root = repository();
  const claims = [
    { name:'First', run:process.execPath, args:['-e', "require('fs').writeFileSync('first.txt', '1')"], cwd:'.', evidence:['first.txt'] },
    { name:'Second', run:process.execPath, args:['-e', "require('fs').writeFileSync('second.txt', '2')"], cwd:'.', evidence:['second.txt'] },
  ];
  const result = await verifyClaims(root, config(claims));
  assert.equal(result.claims, 2);
  assert.deepEqual(result.records.map((record) => record.claim), ['First', 'Second']);
});

test('eligible suite success is automatically recorded as non-promotable experience evidence when durable learning is configured', async (t) => {
  const root = repository(); const learningRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-auth-learning-'));
  t.after(() => { fs.rmSync(root, { recursive:true, force:true }); fs.rmSync(learningRoot, { recursive:true, force:true }); });
  const claim = { name:'Bounded suite succeeds', run:process.execPath, args:['-e', "require('fs').writeFileSync('learn.txt', 'proof')"], cwd:'.', evidence:['learn.txt'], learning:{ claimBoundary:'exact commit/runtime/suite', generalizationBoundary:'no wider than exact commit/runtime/suite', expectedOutcome:'suite succeeds', environment:'governed fixture runner' } };
  const result = await verifyClaims(root, config([claim]), { CRUCIBLE_LEARNING_PROJECT_ID:'project-a', CRUCIBLE_LEARNING_ROOT:learningRoot, CRUCIBLE_EXPERIENCE_ACTOR_ID:'suite-runner-1' });
  assert.equal(result.learning[0].recorded, true);
  assert.equal(result.learningGuidance[0].nextAction, 'run-bounded-test-and-submit-candidate-evidence');
  assert.equal(result.learningGuidance[0].maySkipTest, false);
  const records = new DurableScientificLearningStore({ root:learningRoot, projectId:'project-a' }).read().candidateRecords;
  assert.equal(records.length, 1); assert.equal(records[0].state, 'candidate'); assert.equal(records[0].candidate.kind, 'experience-observation'); assert.equal(records[0].candidate.classification, 'Insufficient Evidence');
});

test('eligible suite failure is retained as experience evidence and the original gate still fails', async (t) => {
  const root = repository(); const learningRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-auth-learning-'));
  t.after(() => { fs.rmSync(root, { recursive:true, force:true }); fs.rmSync(learningRoot, { recursive:true, force:true }); });
  const claim = { name:'Bounded suite fails', run:process.execPath, args:['-e', 'process.exit(2)'], cwd:'.', evidence:['unused.txt'], learning:{ claimBoundary:'exact failing commit/runtime/suite', generalizationBoundary:'no wider than exact failing commit/runtime/suite', expectedOutcome:'suite succeeds', environment:'governed fixture runner' } };
  await assert.rejects(() => verifyClaims(root, config([claim]), { CRUCIBLE_LEARNING_PROJECT_ID:'project-a', CRUCIBLE_LEARNING_ROOT:learningRoot }), /exit code 2|Command failed/);
  const records = new DurableScientificLearningStore({ root:learningRoot, projectId:'project-a' }).read().candidateRecords;
  assert.equal(records.length, 1); assert.equal(records[0].state, 'candidate'); assert.equal(records[0].candidate.kind, 'experience-observation');
});

test('suite learning is skipped when custody is absent and fails closed when custody is partially configured', async (t) => {
  const root = repository(); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const claim = { name:'Eligible but unconfigured', run:process.execPath, args:['-e', "require('fs').writeFileSync('proof.txt', 'proof')"], cwd:'.', evidence:['proof.txt'], learning:{ claimBoundary:'exact run', generalizationBoundary:'exact run only', expectedOutcome:'pass', environment:'fixture' } };
  const skipped = await verifyClaims(root, config([claim]), {}); assert.deepEqual(skipped.learning, [{ eligible:true, recorded:false, reason:'durable-learning-not-configured' }]);
  await assert.rejects(() => verifyClaims(root, config([claim]), { CRUCIBLE_LEARNING_PROJECT_ID:'project-a' }), /requires both/);
});

test('suite learning retries bounded transient store contention without bypassing a persistent lock', async () => {
  const record = { claim:'bounded claim', commandSha256:'a'.repeat(64), commit:'b'.repeat(40), verifiedAt:'2026-08-30T22:00:00.000Z', evidence:[] };
  const claim = { run:'node', args:['--test'], learning:{ claimBoundary:'exact run', generalizationBoundary:'exact run only', expectedOutcome:'pass', environment:'fixture' } };
  let attempts = 0;
  const recorder = { projectId:'project-a', record:() => { attempts += 1; if (attempts < 3) throw new Error('Durable learning store is locked; concurrent mutation fails closed.'); return [{ candidate:{ id:'recorded' } }]; } };
  const result = await recordExperience(recorder, claim, record, { outcome:'succeeded', actualOutcome:'passed', resultSha256:'c'.repeat(64), observedAt:record.verifiedAt, actorId:'runner' });
  assert.equal(result.recorded, true); assert.equal(attempts, 3);
});

test('suite receives only active exact-boundary knowledge as non-skipping regression context',()=>{const claim={learning:{claimBoundary:'node-22/windows/test-y'}};const recorder={store:{retrieve:({boundary})=>[{version:2,candidateId:'verified-a',claim:'repair X causes test Y to pass',boundary,proofSha256:'a'.repeat(64),createdAt:'2026-08-30T22:00:00.000Z',status:'active',projectId:'project-a'}]}};const guidance=learningGuidance(recorder,claim);assert.equal(guidance.activeKnowledge.length,1);assert.equal(guidance.nextAction,'use-active-knowledge-as-bounded-regression-context');assert.equal(guidance.knowledgeIsProofForCurrentRun,false);assert.equal(guidance.maySkipTest,false);assert.equal('status' in guidance.activeKnowledge[0],false);});
