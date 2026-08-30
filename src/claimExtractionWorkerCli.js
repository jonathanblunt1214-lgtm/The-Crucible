const path = require('node:path');
const { ClaimExtractionWorker } = require('./claimExtractionWorker');

function run(argv = process.argv.slice(2), environment = process.env) {
  const projectId = environment.CRUCIBLE_LEARNING_PROJECT_ID; const learningRoot = environment.CRUCIBLE_LEARNING_ROOT; const queueFile = environment.CRUCIBLE_SOURCE_QUEUE;
  if (!projectId || !learningRoot || !queueFile) throw new Error('CRUCIBLE_LEARNING_PROJECT_ID, CRUCIBLE_LEARNING_ROOT, and CRUCIBLE_SOURCE_QUEUE are required.');
  if ((argv[0] || 'run') === 'readiness') return { ready:true, projectId, learningRoot:path.resolve(learningRoot), queueFile:path.resolve(queueFile) };
  if (argv[0] && argv[0] !== 'run') throw new Error('Usage: claimExtractionWorkerCli.js [run|readiness]');
  const worker = new ClaimExtractionWorker({ queueFile, projectId, learningRoot, maximumSources:Number(environment.CRUCIBLE_EXTRACTION_BATCH_SIZE || 25), pdfPagesPerBatch:Number(environment.CRUCIBLE_PDF_PAGES_PER_BATCH || 20) }); const outcomes = worker.run();
  return { processed:outcomes.length, completed:outcomes.filter((item) => item.state === 'claim-extraction-complete').length, continuing:outcomes.filter((item) => item.state === 'claim-extraction-forced-pending').length, blocked:outcomes.filter((item) => item.state === 'blocked').length, candidates:outcomes.reduce((sum, item) => sum + item.candidateIds.length, 0), sourceIds:outcomes.map((item) => item.sourceId) };
}

if (require.main === module) { try { console.log(JSON.stringify(run(), null, 2)); } catch (error) { console.error(`[The Crucible] Claim extraction failed closed: ${error.message}`); process.exitCode = 1; } }
module.exports = { run };
