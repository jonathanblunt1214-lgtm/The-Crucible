#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { registerOwnerDelegatedUrl, SourceRetrievalWorker } = require('./sourceRetrievalWorker');
const { crucibleError } = require('./failureCodes');

function required(environment, name) {
  const value = environment[name];
  if (!value || !String(value).trim()) throw crucibleError('CRU-0044', `${name} is required.`);
  return String(value).trim();
}

async function run(argv = process.argv.slice(2), environment = process.env) {
  const action = argv[0] || 'run';
  const projectId = required(environment, 'CRUCIBLE_LEARNING_PROJECT_ID');
  const learningRoot = path.resolve(required(environment, 'CRUCIBLE_LEARNING_ROOT'));
  const queueFile = path.resolve(required(environment, 'CRUCIBLE_SOURCE_QUEUE'));
  const auditRoot = path.join(learningRoot, 'retrieval');
  if (action === 'readiness') return { ready:true, projectId, queueFile, auditRoot, candidateOnly:true, promotionAuthorized:false };
  if (action === 'admit') {
    if (!argv[1]) throw crucibleError('CRU-0044', 'Usage: sourceRetrievalWorkerCli.js admit <https-url>');
    const trustedDomains = String(environment.CRUCIBLE_RETRIEVAL_TRUSTED_DOMAINS || '').split(',').map((item) => item.trim()).filter(Boolean);
    return registerOwnerDelegatedUrl({ queueFile, projectId, url:argv[1], trustedDomains });
  }
  if (action !== 'run') throw crucibleError('CRU-0044', 'Usage: sourceRetrievalWorkerCli.js [run|readiness|admit <https-url>]');
  const worker = new SourceRetrievalWorker({
    queueFile,
    projectId,
    auditRoot,
    maximumSources:Number(environment.CRUCIBLE_RETRIEVAL_BATCH_SIZE || 25),
    retryBlocked:environment.CRUCIBLE_RETRIEVAL_RETRY_BLOCKED === '1',
    retryQuarantined:environment.CRUCIBLE_RETRIEVAL_RETRY_QUARANTINED === '1',
    sourceId:environment.CRUCIBLE_RETRIEVAL_SOURCE_ID || null,
    minimumIntervalMs:Number(environment.CRUCIBLE_RETRIEVAL_MINIMUM_INTERVAL_MS || 1000),
  });
  const outcomes = await worker.run();
  return {
    projectId,
    processed:outcomes.length,
    readyForExtraction:outcomes.filter((item) => item.state === 'claim-extraction-forced-pending').length,
    duplicates:outcomes.filter((item) => item.duplicateOfSourceId).length,
    quarantined:outcomes.filter((item) => item.state === 'quarantined').length,
    blocked:outcomes.filter((item) => item.state === 'retrieval-blocked').length,
    outcomes,
    candidateOnly:true,
    promotionAuthorized:false,
  };
}

if (require.main === module) {
  run().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.blocked || report.quarantined) process.exitCode = 1;
  }).catch((error) => {
    console.error(`[The Crucible] Source retrieval failed closed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run };
