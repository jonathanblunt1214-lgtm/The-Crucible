const path = require('node:path');
const { MAXIMUM_QUERIES_PER_RUN, GoogleResearchStore, BoundedGoogleSearchClient, AtomicSourceQueueCandidateSink, AutomatedGoogleResearch } = require('./automatedGoogleResearch');
const { ClaimExtractionWorker } = require('./claimExtractionWorker');
const { crucibleError } = require('./failureCodes');

async function run(argv = process.argv.slice(2), env = process.env, output = console.log, options = {}) {
  const [command, ...topics] = argv;
  const projectId = env.CRUCIBLE_LEARNING_PROJECT_ID;
  const root = env.CRUCIBLE_LEARNING_ROOT;
  const queue = env.CRUCIBLE_SOURCE_QUEUE;
  const maximumQueriesPerRun = env.CRUCIBLE_GOOGLE_MAX_QUERIES === undefined ? MAXIMUM_QUERIES_PER_RUN : Number(env.CRUCIBLE_GOOGLE_MAX_QUERIES);
  if (!projectId || !root || !queue) throw new Error('CRUCIBLE_LEARNING_PROJECT_ID, CRUCIBLE_LEARNING_ROOT, and CRUCIBLE_SOURCE_QUEUE are required.');
  if (command === 'readiness') { output(JSON.stringify({ ready:true, projectId, root:path.resolve(root), queue:path.resolve(queue) })); return; }
  if (command !== 'run' || !topics.length) throw new Error('Usage: automatedGoogleResearchCli.js run <approved-topic> [approved-topic ...]');
  const store = new GoogleResearchStore(root, projectId, topics);
  const client = new BoundedGoogleSearchClient({ killSwitchFile:path.join(root, 'GOOGLE-RESEARCH-KILL') });
  const candidateSink = new AtomicSourceQueueCandidateSink(queue, projectId);
  const research = options.research || new AutomatedGoogleResearch({ store, client, candidateSink, maximumQueriesPerRun });
  const extractionWorker = options.extractionWorker || new ClaimExtractionWorker({ queueFile:queue, projectId, learningRoot:root, maximumSources:Number(env.CRUCIBLE_EXTRACTION_BATCH_SIZE || 25), pdfPagesPerBatch:Number(env.CRUCIBLE_PDF_PAGES_PER_BATCH || 20) });
  const outcomes = await research.runDue();
  const search = {
    searched:outcomes.length,
    completed:outcomes.filter((item) => item.state === 'completed').length,
    blocked:outcomes.filter((item) => item.state === 'blocked').length,
    novel:outcomes.reduce((sum, item) => sum + item.novel, 0),
    duplicates:outcomes.reduce((sum, item) => sum + Math.max(0, (item.discovered || 0) - (item.novel || 0)), 0),
    outcomes:outcomes.map((item) => ({ topic:item.topic || null, state:item.state, discovered:item.discovered || 0, novel:item.novel || 0, reason:item.reason || null, candidateIds:(item.registered || []).map((entry) => entry?.id).filter(Boolean) })),
  };
  let extraction;
  try { extraction = extractionWorker.run(); }
  catch (error) {
    const reason = String(error.message || error);
    output(JSON.stringify({ overallState:'partial', projectId, ...search, extraction:{ state:'blocked', reason, processed:0, completed:0, continuing:0, blocked:1, candidates:0 } }));
    throw crucibleError('CRU-0040', `Automated Google research completed, but extraction failed: ${reason}`);
  }
  output(JSON.stringify({ overallState:'completed', projectId, ...search, extraction:{ state:'completed', reason:null, processed:extraction.length, completed:extraction.filter((item) => item.state === 'claim-extraction-complete').length, continuing:extraction.filter((item) => item.state === 'claim-extraction-forced-pending').length, blocked:extraction.filter((item) => item.state === 'blocked').length, candidates:extraction.reduce((sum, item) => sum + item.candidateIds.length, 0) } }));
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
