const path = require('node:path');
const { GoogleResearchStore, BoundedGoogleSearchClient, AtomicSourceQueueCandidateSink, AutomatedGoogleResearch } = require('./automatedGoogleResearch');

async function run(argv = process.argv.slice(2), env = process.env, output = console.log) {
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
  const outcomes = await new AutomatedGoogleResearch({ store, client, candidateSink }).runDue();
  output(JSON.stringify({ projectId, searched:outcomes.length, completed:outcomes.filter((item) => item.state === 'completed').length, blocked:outcomes.filter((item) => item.state === 'blocked').length, novel:outcomes.reduce((sum, item) => sum + item.novel, 0) }));
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
