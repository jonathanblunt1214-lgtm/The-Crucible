'use strict';

// Operator entry point for free governed discovery. Same three commands as the Perplexity CLI -
// init, readiness, run - because an operator should not have to learn a second shape to use a
// second provider.
//
// `readiness` exists so a missing credential is reported as configuration rather than discovered
// as a vendor error halfway through a run, and so it fails closed: a discovery run that cannot
// authenticate must not report zero admitted URLs as though it had looked and found nothing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MAXIMUM_QUERIES_PER_RUN, DEFAULT_DISCOVERY_PROVIDER, ModelPointerResearchStore, AutomatedModelPointerResearch, AtomicSourceQueueCandidateSink } = require('./automatedModelPointerResearch');
// The provider registry is reached through circulation rather than imported directly: a
// digestive module cabled straight to the brain is exactly the linkage fly-by-wire forbids.
const { ModelPointerTransport, describeDiscoveryProvider } = require('./providerCirculation');
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

// The provider is chosen from the governed set only. The lookup throws CRU-0033 for an unknown
// id, so a typo cannot quietly become an ungoverned fifth provider.
function selectedProvider(env) {
  const id = String(env.CRUCIBLE_DISCOVERY_PROVIDER || '').trim() || DEFAULT_DISCOVERY_PROVIDER;
  return describeDiscoveryProvider(id, env);
}

async function run(argv = process.argv.slice(2), env = process.env, output = console.log, options = {}) {
  const [command, ...topics] = argv;
  const projectId = env.CRUCIBLE_LEARNING_PROJECT_ID;
  const root = env.CRUCIBLE_LEARNING_ROOT;
  const queue = env.CRUCIBLE_SOURCE_QUEUE;
  if (!projectId || !root || !queue) throw crucibleError('CRU-0042', 'CRUCIBLE_LEARNING_PROJECT_ID, CRUCIBLE_LEARNING_ROOT, and CRUCIBLE_SOURCE_QUEUE are required.');
  const provider = selectedProvider(env);
  const model = provider.model;

  if (command === 'init') {
    const queueFile = ensureHoldingQueue(queue, projectId);
    output(JSON.stringify({ ready:true, projectId, provider:provider.id, root:path.resolve(root), queue:queueFile, model, authorizesPromotion:false }));
    return;
  }

  if (command === 'readiness') {
    const missing = [];
    if (!provider.credentialPresent) missing.push(provider.credentialEnv);
    if (!model) missing.push(provider.modelEnv);
    if (!fs.existsSync(path.resolve(queue))) missing.push('CRUCIBLE_SOURCE_QUEUE');
    const ready = missing.length === 0;
    output(JSON.stringify({ ready, projectId, provider:provider.id, root:path.resolve(root), queue:path.resolve(queue), model, missing, authorizesPromotion:false }));
    if (!ready) throw crucibleError('CRU-0033', `${provider.label} discovery is not ready; missing ${missing.join(', ')}.`);
    return;
  }

  if (command !== 'run' || !topics.length) throw crucibleError('CRU-0042', 'Usage: automatedModelPointerResearchCli.js run <approved-topic> [approved-topic ...]');
  if (!provider.credentialPresent) throw crucibleError('CRU-0033', `${provider.label} discovery requires ${provider.credentialEnv}.`);
  if (!model) throw crucibleError('CRU-0033', `${provider.label} discovery requires ${provider.modelEnv}. There is deliberately no default model.`);

  const queueFile = ensureHoldingQueue(queue, projectId);
  const maximumQueriesPerRun = env.CRUCIBLE_DISCOVERY_MAX_QUERIES === undefined ? MAXIMUM_QUERIES_PER_RUN : Number(env.CRUCIBLE_DISCOVERY_MAX_QUERIES);
  const store = new ModelPointerResearchStore(root, projectId, topics, { provider:provider.id });
  const client = options.client || new ModelPointerTransport({ env, providerId:provider.id, model, killSwitchFile:path.join(root, 'MODEL-POINTER-RESEARCH-KILL') });
  const candidateSink = options.candidateSink || new AtomicSourceQueueCandidateSink(queueFile, projectId);
  const research = options.research || new AutomatedModelPointerResearch({ store, client, candidateSink, maximumQueriesPerRun });
  const outcomes = await research.runDue();

  const report = {
    overallState:outcomes.some((item) => item.state === 'blocked') ? 'partial' : 'completed',
    projectId,
    provider:provider.id,
    model,
    // Named in every report so a reader never has to infer whether these URLs were citations or
    // a model's guesses. They are candidates either way; the distinction is about what they are
    // evidence of, which is nothing until they are retrieved and hashed.
    providerKind:outcomes.find((item) => item.providerKind)?.providerKind || null,
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
  if (report.blocked) throw crucibleError('CRU-0042', `${provider.label} discovery completed partially: ${report.blocked} of ${report.searched} due topic(s) were blocked; completed outcomes were retained.`);
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { ensureHoldingQueue, selectedProvider, run };
