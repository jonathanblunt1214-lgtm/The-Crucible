const path = require('node:path');
const { GoogleResearchStore, BoundedGoogleSearchClient, AtomicSourceQueueCandidateSink, AutomatedGoogleResearch } = require('./automatedGoogleResearch');
const { ClaimExtractionWorker } = require('./claimExtractionWorker');

async function run(argv = process.argv.slice(2), env = process.env, output = console.log, options = {}) {
  const [command, ...topics] = argv;
  const projectId = env.CRUCIBLE_LEARNING_PROJECT_ID;
  const root = env.CRUCIBLE_LEARNING_ROOT;
  const queue = env.CRUCIBLE_SOURCE_QUEUE;
  if (!projectId || !root || !queue) throw new Error('CRUCIBLE_LEARNING_PROJECT_ID, CRUCIBLE_LEARNING_ROOT, and CRUCIBLE_SOURCE_QUEUE are required.');
  if (command === 'readiness') { output(JSON.stringify({ ready:true, projectId, root:path.resolve(root), queue:path.resolve(queue) })); return; }
  if (command !== 'run' || !topics.length) throw new Error('Usage: automatedGoogleResearchCli.js run <approved-topic> [approved-topic ...]');
  const store = new GoogleResearchStore(root, projectId, topics);
  const client = new BoundedGoogleSearchClient({ killSwitchFile:path.join(root, 'GOOGLE-RESEARCH-KILL') });
  const candidateSink = new AtomicSourceQueueCandidateSink(queue, projectId);
  const research = options.research || new AutomatedGoogleResearch({ store, client, candidateSink });
  const extractionWorker = options.extractionWorker || new ClaimExtractionWorker({ queueFile:queue, projectId, learningRoot:root, maximumSources:Number(env.CRUCIBLE_EXTRACTION_BATCH_SIZE || 25), pdfPagesPerBatch:Number(env.CRUCIBLE_PDF_PAGES_PER_BATCH || 20) });
  const outcomes = await research.runDue();
  const extraction = extractionWorker.run();
  output(JSON.stringify({ projectId, searched:outcomes.length, completed:outcomes.filter((item) => item.state === 'completed').length, blocked:outcomes.filter((item) => item.state === 'blocked').length, novel:outcomes.reduce((sum, item) => sum + item.novel, 0), extraction:{ processed:extraction.length, completed:extraction.filter((item) => item.state === 'claim-extraction-complete').length, continuing:extraction.filter((item) => item.state === 'claim-extraction-forced-pending').length, blocked:extraction.filter((item) => item.state === 'blocked').length, candidates:extraction.reduce((sum, item) => sum + item.candidateIds.length, 0) } }));
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
