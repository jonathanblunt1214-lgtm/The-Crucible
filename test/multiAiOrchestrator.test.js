const test = require('node:test');
const assert = require('node:assert/strict');
const { MultiAiOrchestrator, deliberationFromDistribution } = require('../src/multiAiOrchestrator');
const { validateDeliberation } = require('../src/multiAiDeliberation');

const ENV = { OPENAI_MODEL: 'openai-m', ANTHROPIC_MODEL: 'anthropic-m', PERPLEXITY_MODEL: 'pplx-m', NVIDIA_NIM_MODEL: 'nim-m' };
const NOW = () => '2026-09-03T17:00:00Z';

function answering(text) {
  return { run: async () => ({ text }) };
}
function failing(message) {
  return { run: async () => { throw new Error(message); } };
}

function orchestrator(adapters, options = {}) {
  const instance = new MultiAiOrchestrator({ env: ENV, now: NOW, ...options });
  for (const [id, adapter] of Object.entries(adapters)) instance.register(id, adapter);
  return instance;
}

test('a task is distributed to every provider and answers are kept separate with provenance', async () => {
  const orch = orchestrator({ openai: answering('read-time'), anthropic: answering('write-time') });
  const result = await orch.distribute({ taskId: 'extractor-approach', prompt: 'Which normalisation?' });
  assert.equal(result.responses.length, 2);
  assert.deepEqual(result.responses.map((item) => item.provider).sort(), ['anthropic', 'openai']);
  const [first] = result.responses;
  // Provenance is per response, never merged away.
  for (const field of ['provider', 'model', 'taskId', 'at', 'promptSha256', 'responseSha256']) assert.ok(first[field], `${field} recorded`);
  assert.equal(first.taskId, 'extractor-approach');
  assert.equal(result.promotionAuthorized, false);
  assert.equal(result.ownerApproved, false);
});

test('an unusable task is refused rather than half-distributed', async () => {
  const orch = orchestrator({ openai: answering('x') });
  await assert.rejects(() => orch.distribute({ taskId: '', prompt: 'p' }), (error) => error.crucibleCode === 'CRU-0034');
  await assert.rejects(() => orch.distribute({ taskId: 'valid-task', prompt: '' }), (error) => error.crucibleCode === 'CRU-0034');
  const empty = new MultiAiOrchestrator({ env: ENV, now: NOW });
  await assert.rejects(() => empty.distribute({ taskId: 'valid-task', prompt: 'p' }), (error) => error.crucibleCode === 'CRU-0034' && /No providers are registered/.test(error.message));
});

test('a credential in the prompt never leaves the process', async () => {
  const orch = orchestrator({ openai: answering('x') }, { env: { ...ENV, OPENAI_API_KEY: 'sk-livekeylivekeylivekey0123' } });
  await assert.rejects(
    () => orch.distribute({ taskId: 'leaky-task', prompt: 'use sk-livekeylivekeylivekey0123 to authenticate' }),
    (error) => error.crucibleCode === 'CRU-0033',
  );
});

test('provider failure is recorded, never silently dropped', async () => {
  const orch = orchestrator({ openai: answering('read-time'), anthropic: failing('connection reset'), perplexity: answering('read-time') });
  const result = await orch.distribute({ taskId: 'extractor-approach', prompt: 'Which normalisation?' });
  assert.equal(result.responses.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].provider, 'anthropic');
  assert.match(result.failures[0].reason, /connection reset/);
});

test('provider failure does not silently bypass governance: coverage drops to insufficient evidence', async () => {
  const orch = orchestrator({ openai: answering('same'), anthropic: failing('down'), perplexity: answering('same') });
  const result = await orch.distribute({ taskId: 'task-a', prompt: 'q' });
  const corroboration = orch.corroborate(result);
  // Two providers agreed verbatim, but a third was unreachable - so this is NOT consensus.
  assert.equal(corroboration.outcome, 'insufficient-evidence');
  assert.match(corroboration.rationaleSummary, /not coverage/);
  assert.equal(corroboration.failures.length, 1);
});

test('identical answers from several providers are consensus, and consensus is not authority', async () => {
  const orch = orchestrator({ openai: answering('read-time'), anthropic: answering('  READ-TIME  '), perplexity: answering('read-time') });
  const corroboration = orch.corroborate(await orch.distribute({ taskId: 'task-a', prompt: 'q' }));
  assert.equal(corroboration.outcome, 'consensus');
  assert.equal(corroboration.ownerApproved, false);
  assert.equal(corroboration.promotionAuthorized, false);
  assert.match(corroboration.rationaleSummary, /evidence, not proof/);
});

test('a lone answer is never corroboration', async () => {
  const orch = orchestrator({ openai: answering('read-time') });
  const corroboration = orch.corroborate(await orch.distribute({ taskId: 'task-a', prompt: 'q' }));
  assert.equal(corroboration.outcome, 'insufficient-evidence');
  assert.match(corroboration.rationaleSummary, /agreeing with itself/);
});

test('mixed answers are partial agreement, and wholly distinct answers escalate to the owner', async () => {
  const partial = orchestrator({ openai: answering('read-time'), anthropic: answering('read-time'), perplexity: answering('write-time') });
  const partialResult = partial.corroborate(await partial.distribute({ taskId: 'task-a', prompt: 'q' }));
  assert.equal(partialResult.outcome, 'partial-agreement');
  assert.equal(partialResult.escalatedToOwner, false);

  const split = orchestrator({ openai: answering('read-time'), anthropic: answering('write-time'), perplexity: answering('defer') });
  const splitResult = split.corroborate(await split.distribute({ taskId: 'task-a', prompt: 'q' }));
  assert.equal(splitResult.outcome, 'unresolved-conflict');
  assert.equal(splitResult.escalatedToOwner, true);
});

test('a passing test outranks model agreement as evidence but is still not approval', async () => {
  const orch = orchestrator({ openai: answering('read-time'), anthropic: answering('write-time'), perplexity: answering('read-time') });
  const corroboration = orch.corroborate(await orch.distribute({ taskId: 'task-a', prompt: 'q' }), { testVerified: true });
  assert.equal(corroboration.outcome, 'test-verified');
  assert.equal(corroboration.ownerApproved, false);
  assert.match(corroboration.rationaleSummary, /still not owner approval/);
});

test('egress authorisation is consulted per provider when one is injected', async () => {
  const seen = [];
  const orch = orchestrator({ openai: answering('x'), anthropic: answering('y') }, { authorize: (request) => { seen.push(request.provider); return { authorized: true }; } });
  await orch.distribute({ taskId: 'task-a', prompt: 'q', purpose: 'consult' });
  assert.deepEqual(seen.sort(), ['anthropic', 'openai']);

  // A refused authorisation is a recorded failure, not a quiet success.
  const refused = orchestrator({ openai: answering('x') }, { authorize: () => { throw new Error('External AI egress requires owner permission.'); } });
  const result = await refused.distribute({ taskId: 'task-a', prompt: 'q' });
  assert.equal(result.responses.length, 0);
  assert.match(result.failures[0].reason, /requires owner permission/);
});

test('a distribution converts into a deliberation block the conflict ledger accepts', async () => {
  const orch = orchestrator({ openai: answering('read-time'), anthropic: answering('write-time') });
  const distribution = await orch.distribute({ taskId: 'task-a', prompt: 'q' });
  const deliberation = deliberationFromDistribution(distribution, orch.corroborate(distribution));
  assert.deepEqual(validateDeliberation(deliberation), []);
  assert.equal(deliberation.proposals.length, 2);
});

test('the orchestrator enforces exclusive mutation ownership rather than assuming it', async () => {
  const orch = orchestrator({ openai: answering('x') });
  const claims = [{ taskId: 'held', owner: { provider: 'anthropic', agent: 'b' }, scope: { paths: ['src/extractor.js'] }, purpose: 'p', status: 'active', acquiredAt: '2026-09-03T17:00:00Z' }];
  assert.throws(
    () => orch.assertMayMutate({ claims, conflicts: [], actor: { provider: 'openai', agent: 'a' }, paths: ['src/extractor.js'] }),
    (error) => error.crucibleCode === 'CRU-0030',
  );
  assert.ok(orch.assertMayMutate({ claims, conflicts: [], actor: { provider: 'openai', agent: 'a' }, paths: ['src/other.js'] }).allowed);
});
