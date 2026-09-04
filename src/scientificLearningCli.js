#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { DurableScientificLearningStore } = require('./scientificLearning');
const { routeThreeWayComparison, ClaimComparisonLedger } = require('./claimComparison');

function configuredStore(environment = process.env) {
  const projectId = environment.CRUCIBLE_LEARNING_PROJECT_ID;
  const root = environment.CRUCIBLE_LEARNING_ROOT;
  if (!projectId || !projectId.trim()) throw new Error('CRUCIBLE_LEARNING_PROJECT_ID is required.');
  if (!root || !root.trim()) throw new Error('CRUCIBLE_LEARNING_ROOT is required.');
  return new DurableScientificLearningStore({ projectId, root:path.resolve(root) });
}

function readCandidate(file) {
  if (!file) throw new Error('Candidate JSON file path is required.');
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function run(argv = process.argv.slice(2), environment = process.env) {
  const action = argv[0] || 'readiness';
  const store = configuredStore(environment);
  if (action === 'readiness') return { ...store.readiness(), readyForTrainingEvidence:store.readiness().ready, autonomousProcessingApi:true };
  if (action === 'ingest') {
    const record = store.ingest(readCandidate(argv[1]));
    return { accepted:true, candidateId:record.candidate.id, state:record.state, classification:record.candidate.classification };
  }
  if (action === 'status') {
    if (!argv[1]) throw new Error('Candidate id is required.');
    const record = store.get(argv[1]);
    if (!record) throw new Error('Candidate evidence does not exist.');
    return record;
  }
  if (action === 'retrieve') return { verifiedKnowledge:store.retrieve(argv[1] ? { boundary:argv[1] } : {}) };
  if (action === 'compare') {
    const input=readCandidate(argv[1]); const keys=Object.keys(input || {}).sort(); if (keys.join(',') !== 'candidateId,comparedAt,sourceA,sourceB') throw new Error('Comparison input requires exactly candidateId, comparedAt, sourceA, and sourceB.');
    const decision=routeThreeWayComparison({ projectId:store.projectId, candidateId:input.candidateId, sourceA:input.sourceA, sourceB:input.sourceB, activeKnowledge:store.activeKnowledge(), comparedAt:input.comparedAt });
    return new ClaimComparisonLedger({ root:store.root, projectId:store.projectId }).record(decision);
  }
  throw new Error(`Unknown scientific-learning action: ${action}`);
}

if (require.main === module) {
  try { console.log(JSON.stringify(run(), null, 2)); }
  catch (error) { console.error(`[The Crucible] Scientific learning failed closed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { configuredStore, readCandidate, run };
