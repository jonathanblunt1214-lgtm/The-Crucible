#!/usr/bin/env node
// The command line for governed multi-AI coordination.
//
// Separate from src/cli.js because that module runs its own main() on require, which makes it
// unusable as a library. These are the operations an agent actually performs on the shared state:
// read the handover before touching anything, take a scope, give it back, hand it to someone
// else, and put one bounded question to several providers at once.
const path = require('node:path');
const { crucibleError, failureCode, UNCODED } = require('./failureCodes');
const { listClaims, acquire, release, handOff } = require('./mutationClaimStore');
const { inspectForContinuation, formatContinuationReport } = require('./aiHandoffContinuation');
const { ownerLabel } = require('./mutationClaims');
const { createConfiguredAdapters } = require('./aiProviderAdapters');
const { MultiAiOrchestrator, deliberationFromDistribution } = require('./multiAiOrchestrator');
const { PROVIDER_IDS, credentialPresent, modelFor } = require('./aiProviderRegistry');

const root = process.env.CRUCIBLE_PROJECT_ROOT ? path.resolve(process.env.CRUCIBLE_PROJECT_ROOT) : process.cwd();

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  if (index < 0 || !args[index + 1]) return fallback;
  return args[index + 1];
}

function list(args, name) {
  const value = flag(args, name);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function requiredFlag(args, name) {
  const value = flag(args, name);
  if (!value) throw crucibleError('CRU-0029', `--${name} is required.`);
  return value;
}

function actorFrom(args) {
  return { provider: requiredFlag(args, 'provider'), model: flag(args, 'model'), agent: flag(args, 'agent') };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'continue') {
    const report = inspectForContinuation(root, { runChecks: args.includes('--run-checks') });
    console.log(formatContinuationReport(report));
    // Exit non-zero when a successor must not start writing yet, so a script cannot walk past it.
    if (!report.mayMutate) process.exitCode = 1;
    return;
  }

  if (command === 'claims') {
    const { claims, active } = listClaims(root);
    console.log(`${claims.length} claim(s), ${active.length} active.`);
    for (const claim of claims) console.log(`- ${claim.taskId} [${claim.status}] ${ownerLabel(claim.owner)} :: ${JSON.stringify(claim.scope)}`);
    return;
  }

  if (command === 'claim') {
    const claim = {
      taskId: requiredFlag(args, 'task'),
      owner: actorFrom(args),
      scope: { paths: list(args, 'paths'), regions: [] },
      purpose: requiredFlag(args, 'purpose'),
      status: 'active',
      acquiredAt: new Date().toISOString(),
      handedOffTo: null,
      releasedAt: null,
    };
    const result = acquire(root, claim);
    console.log(`[The Crucible] ${result.owner} now exclusively owns ${JSON.stringify(result.scope)} under ${result.acquired}. Other agents may read, test, review and propose against it.`);
    return;
  }

  if (command === 'release') {
    const result = release(root, requiredFlag(args, 'task'));
    console.log(`[The Crucible] Released ${result.released} at ${result.releasedAt}.`);
    return;
  }

  if (command === 'handoff') {
    const result = handOff(root, requiredFlag(args, 'task'), {
      to: { provider: requiredFlag(args, 'to-provider'), model: flag(args, 'to-model'), agent: flag(args, 'to-agent') },
      taskId: flag(args, 'successor-task'),
      purpose: flag(args, 'purpose'),
    });
    console.log(`[The Crucible] ${result.handedOff} handed off to ${result.to} as ${result.successor}.`);
    return;
  }

  if (command === 'providers') {
    const { adapters, unconfigured } = createConfiguredAdapters();
    console.log(`${adapters.size} of ${PROVIDER_IDS.length} governed provider(s) are configured and callable.`);
    for (const id of PROVIDER_IDS) {
      const ready = adapters.has(id);
      console.log(`- ${id}: ${ready ? 'ready' : 'not configured'}${ready ? '' : ` (${(unconfigured.find((item) => item.provider === id) || {}).reason || 'unknown'})`}${ready ? ` model=${modelFor(id)}` : ''}${credentialPresent(id) ? '' : ''}`);
    }
    return;
  }

  if (command === 'consult') {
    const taskId = requiredFlag(args, 'task');
    const prompt = requiredFlag(args, 'prompt');
    const { adapters, unconfigured } = createConfiguredAdapters();
    if (!adapters.size) throw crucibleError('CRU-0034', `No provider is configured, so this task cannot be distributed. ${unconfigured.map((item) => item.reason).join(' ')}`);
    const orchestrator = new MultiAiOrchestrator();
    for (const [id, adapter] of adapters) orchestrator.register(id, adapter);
    const distribution = await orchestrator.distribute({ taskId, prompt });
    const corroboration = orchestrator.corroborate(distribution, { testVerified: args.includes('--test-verified') });
    // Printed as the deliberation block that belongs in AI-CONFLICTS.json, so the operator pastes
    // provenance rather than retyping a summary of it.
    console.log(JSON.stringify({ distribution: { taskId: distribution.taskId, promptSha256: distribution.promptSha256, failures: distribution.failures }, deliberation: deliberationFromDistribution(distribution, corroboration) }, null, 2));
    return;
  }

  throw crucibleError('CRU-0016', `Unknown action: ${command || '(none)'}. Valid: continue, claims, claim, release, handoff, providers, consult.`);
}

main().catch((error) => {
  console.error(`[The Crucible] FAIL: [${failureCode(error) || UNCODED}] ${error.message.replace(/^\[CRU-\d{4}\] /, '')}`);
  process.exitCode = 1;
});
