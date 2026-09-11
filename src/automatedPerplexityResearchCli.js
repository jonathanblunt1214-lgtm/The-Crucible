'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MAXIMUM_QUERIES_PER_RUN, PerplexityResearchStore, AutomatedPerplexityResearch, AtomicSourceQueueCandidateSink } = require('./automatedPerplexityResearch');
const { PerplexityCitationTransport, DEFAULT_PERPLEXITY_DISCOVERY_MODEL } = require('./providerCirculation');
const { crucibleError } = require('./failureCodes');

function ensureHoldingQueue(file, projectId) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive:true });
  if (!fs.existsSync(resolved)) {
    const temporary = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion:1, projectId, updatedAt:null, protocol:{ purpose:'candidate-url-holding-queue', authorizesPromotion:false }, documents:[], links:[] }, null, 2)}\n`, { flag:'wx', mode:0o600 });
    fs.renameSync(temporary, resolved);
  }
  const queue = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (queue?.schemaVersion !== 1 || queue.projectId !== projectId || !Array.isArray(queue.documents) || !Array.isArray(queue.links)) throw crucibleError('CRU-0042', 'Source queue is invalid or belongs to another project.');
  return resolved;
}

async function run(argv = process.argv.slice(2), env = process.env, output = console.log, options = {}) {
  const [command, ...topics] = argv;
  const projectId = env.CRUCIBLE_LEARNING_PROJECT_ID;
  const root = env.CRUCIBLE_LEARNING_ROOT;
  const queue = env.CRUCIBLE_SOURCE_QUEUE;
  if (!projectId || !root || !queue) throw crucibleError('CRU-0042', 'CRUCIBLE_LEARNING_PROJECT_ID, CRUCIBLE_LEARNING_ROOT, and CRUCIBLE_SOURCE_QUEUE are required.');
  const model = String(env.PERPLEXITY_MODEL || '').trim() || DEFAULT_PERPLEXITY_DISCOVERY_MODEL;
  if (command === 'init') {
    const queueFile = ensureHoldingQueue(queue, projectId);
    output(JSON.stringify({ ready:true, projectId, root:path.resolve(root), queue:queueFile, model, authorizesPromotion:false })); return;
  }
  if (command === 'readiness') {
    const missing = [];
    if (!String(env.PERPLEXITY_API_KEY || '').trim()) missing.push('PERPLEXITY_API_KEY');
    if (!fs.existsSync(path.resolve(queue))) missing.push('CRUCIBLE_SOURCE_QUEUE');
    const ready = missing.length === 0;
    output(JSON.stringify({ ready, projectId, root:path.resolve(root), queue:path.resolve(queue), model, missing, authorizesPromotion:false }));
    if (!ready) throw crucibleError('CRU-0033', `Perplexity discovery is not ready; missing ${missing.join(', ')}.`);
    return;
  }
  if (command !== 'run' || !topics.length) throw crucibleError('CRU-0042', 'Usage: automatedPerplexityResearchCli.js run <approved-topic> [approved-topic ...]');
  if (!String(env.PERPLEXITY_API_KEY || '').trim()) throw crucibleError('CRU-0033', 'Perplexity discovery requires PERPLEXITY_API_KEY.');
  const queueFile = ensureHoldingQueue(queue, projectId);
  const maximumQueriesPerRun = env.CRUCIBLE_PERPLEXITY_MAX_QUERIES === undefined ? MAXIMUM_QUERIES_PER_RUN : Number(env.CRUCIBLE_PERPLEXITY_MAX_QUERIES);
  const store = new PerplexityResearchStore(root, projectId, topics);
  const client = options.client || new PerplexityCitationTransport({ env, model, killSwitchFile:path.join(root, 'PERPLEXITY-RESEARCH-KILL') });
  const candidateSink = options.candidateSink || new AtomicSourceQueueCandidateSink(queueFile, projectId);
  const research = options.research || new AutomatedPerplexityResearch({ store, client, candidateSink, maximumQueriesPerRun });
  const outcomes = await research.runDue();
  const report = {
    overallState:outcomes.some((item) => item.state === 'blocked') ? 'partial' : 'completed',
    projectId,
    model,
    searched:outcomes.length,
    completed:outcomes.filter((item) => item.state === 'completed').length,
    blocked:outcomes.filter((item) => item.state === 'blocked').length,
    cited:outcomes.reduce((sum, item) => sum + item.cited, 0),
    admitted:outcomes.reduce((sum, item) => sum + item.admitted, 0),
    rejected:outcomes.reduce((sum, item) => sum + item.rejected, 0),
    novel:outcomes.reduce((sum, item) => sum + item.novel, 0),
    outcomes:outcomes.map((item) => ({ topic:item.topic, state:item.state, cited:item.cited, admitted:item.admitted, rejected:item.rejected, novel:item.novel, reason:item.reason || null, candidateIds:(item.registered || []).map((entry) => entry?.id).filter(Boolean) })),
    authorizesPromotion:false,
  };
  output(JSON.stringify(report));
  if (report.blocked) throw crucibleError('CRU-0042', `Perplexity discovery completed partially: ${report.blocked} of ${report.searched} due topic(s) were blocked; completed outcomes were retained.`);
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { ensureHoldingQueue, run };
