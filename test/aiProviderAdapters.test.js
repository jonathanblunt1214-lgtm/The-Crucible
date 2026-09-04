const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIALECTS, createProviderAdapter, createConfiguredAdapters, requireModel, assertDialectsMatchGovernedProviders,
} = require('../src/aiProviderAdapters');
const { PROVIDER_IDS } = require('../src/aiProviderRegistry');
const { MultiAiOrchestrator } = require('../src/multiAiOrchestrator');

const KEY = 'sk-secretsecretsecretsecret0123';
const FULL_ENV = {
  OPENAI_API_KEY: KEY, OPENAI_MODEL: 'openai-model',
  ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODEL: 'anthropic-model',
  PERPLEXITY_API_KEY: KEY, PERPLEXITY_MODEL: 'perplexity-model',
  NVIDIA_NIM_API_KEY: KEY, NVIDIA_NIM_MODEL: 'nim-model',
};

// A fake HTTP transport. It records what the adapter actually sent, so the request dialect is
// asserted rather than assumed, and returns whatever the test wants back.
function transport(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  return { calls, fetchImpl };
}
function ok(payload) {
  return { status: 200, text: async () => JSON.stringify(payload) };
}
const CHAT_PAYLOAD = { model: 'served-model', choices: [{ message: { content: 'the answer' } }] };
const ANTHROPIC_PAYLOAD = { model: 'served-anthropic', content: [{ type: 'text', text: 'the answer' }] };

test('the governed provider set is canonical and the dialect table may not add to it', () => {
  assert.deepEqual(assertDialectsMatchGovernedProviders(), { providers: 4 });
  assert.deepEqual(Object.keys(DIALECTS).sort(), [...PROVIDER_IDS].sort());
  assert.equal(PROVIDER_IDS.length, 4);
});

test('with an empty environment no provider is configured and each reports why', () => {
  const { adapters, unconfigured } = createConfiguredAdapters({ env: {} });
  assert.deepEqual([...adapters.keys()], []);
  assert.equal(unconfigured.length, 4);
  assert.deepEqual(unconfigured.map((item) => item.provider).sort(), ['anthropic', 'nvidia-nim', 'openai', 'perplexity']);
  for (const item of unconfigured) assert.match(item.reason, /API_KEY is not set/);
});

test('a provider with a credential but no model is reported as unconfigured, not defaulted', () => {
  const { adapters, unconfigured } = createConfiguredAdapters({ env: { OPENAI_API_KEY: KEY } });
  assert.equal(adapters.size, 0);
  assert.match(unconfigured.find((item) => item.provider === 'openai').reason, /OPENAI_MODEL is not set/);
  assert.throws(() => requireModel('openai', { OPENAI_API_KEY: KEY }), (error) => error.crucibleCode === 'CRU-0033' && /no default/.test(error.message));
});

test('with all four configured, exactly four adapters exist and none is duplicated', () => {
  const { adapters, unconfigured } = createConfiguredAdapters({ env: FULL_ENV, fetchImpl: async () => ok(CHAT_PAYLOAD) });
  assert.equal(adapters.size, 4);
  assert.deepEqual(unconfigured, []);
  assert.deepEqual([...adapters.keys()].sort(), ['anthropic', 'nvidia-nim', 'openai', 'perplexity']);
});

test('OpenAI: endpoint, bearer authorization, chat dialect, model and extraction', async () => {
  const { calls, fetchImpl } = transport(() => ok(CHAT_PAYLOAD));
  const result = await createProviderAdapter('openai', { env: FULL_ENV, fetchImpl }).run({ prompt: 'question' });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'openai-model');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'question' }]);
  assert.equal(result.text, 'the answer');
  assert.equal(result.model, 'served-model');
});

test('Anthropic: x-api-key, pinned version header, and content-block extraction', async () => {
  const { calls, fetchImpl } = transport(() => ok(ANTHROPIC_PAYLOAD));
  const result = await createProviderAdapter('anthropic', { env: FULL_ENV, fetchImpl }).run({ prompt: 'question' });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], KEY);
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0].init.headers.authorization, undefined, 'Anthropic must not use bearer auth');
  assert.equal(JSON.parse(calls[0].init.body).model, 'anthropic-model');
  assert.equal(result.text, 'the answer');
  assert.equal(result.model, 'served-anthropic');
});

test('Perplexity: bearer auth, and citations are retained as evidence', async () => {
  const { calls, fetchImpl } = transport(() => ok({ ...CHAT_PAYLOAD, citations: ['https://example.org/spec'] }));
  const result = await createProviderAdapter('perplexity', { env: FULL_ENV, fetchImpl }).run({ prompt: 'question' });
  assert.equal(calls[0].url, 'https://api.perplexity.ai/chat/completions');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(calls[0].init.body).model, 'perplexity-model');
  assert.deepEqual(result.evidence, ['https://example.org/spec']);
});

test('NVIDIA NIM: bearer auth against its integrate endpoint', async () => {
  const { calls, fetchImpl } = transport(() => ok(CHAT_PAYLOAD));
  const result = await createProviderAdapter('nvidia-nim', { env: FULL_ENV, fetchImpl }).run({ prompt: 'question' });
  assert.equal(calls[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(calls[0].init.body).model, 'nim-model');
  assert.equal(result.text, 'the answer');
});

test('the endpoint is overridable so a gateway or pinned version needs no code change', async () => {
  const { calls, fetchImpl } = transport(() => ok(CHAT_PAYLOAD));
  await createProviderAdapter('openai', { env: { ...FULL_ENV, OPENAI_BASE_URL: 'https://gateway.internal/v1/chat' }, fetchImpl }).run({ prompt: 'q' });
  assert.equal(calls[0].url, 'https://gateway.internal/v1/chat');
});

test('an explicitly requested model overrides the configured one', async () => {
  const { calls, fetchImpl } = transport(() => ok(CHAT_PAYLOAD));
  await createProviderAdapter('openai', { env: FULL_ENV, fetchImpl }).run({ prompt: 'q', model: 'pinned-override' });
  assert.equal(JSON.parse(calls[0].init.body).model, 'pinned-override');
});

test('an HTTP error becomes CRU-0036 and never echoes the credential back', async () => {
  const { fetchImpl } = transport(() => ({ status: 401, text: async () => `unauthorized for key ${KEY}` }));
  await assert.rejects(
    () => createProviderAdapter('openai', { env: FULL_ENV, fetchImpl }).run({ prompt: 'q' }),
    (error) => error.crucibleCode === 'CRU-0036' && /HTTP 401/.test(error.message) && !error.message.includes(KEY) && /redacted:OPENAI_API_KEY/.test(error.message),
  );
});

test('a non-JSON body, an empty completion, and a malformed response all become CRU-0036', async () => {
  const notJson = transport(() => ({ status: 200, text: async () => '<html>gateway timeout</html>' }));
  await assert.rejects(() => createProviderAdapter('openai', { env: FULL_ENV, fetchImpl: notJson.fetchImpl }).run({ prompt: 'q' }), (error) => error.crucibleCode === 'CRU-0036' && /not JSON/.test(error.message));

  const empty = transport(() => ok({ choices: [{ message: { content: '   ' } }] }));
  await assert.rejects(() => createProviderAdapter('openai', { env: FULL_ENV, fetchImpl: empty.fetchImpl }).run({ prompt: 'q' }), (error) => error.crucibleCode === 'CRU-0036' && /empty completion/.test(error.message));

  const malformed = transport(() => ({ notAResponse: true }));
  await assert.rejects(() => createProviderAdapter('openai', { env: FULL_ENV, fetchImpl: malformed.fetchImpl }).run({ prompt: 'q' }), (error) => error.crucibleCode === 'CRU-0036' && /no usable HTTP response/.test(error.message));
});

test('a transport failure or timeout becomes CRU-0036 with the credential redacted', async () => {
  const thrown = transport(() => { throw new Error(`socket hang up while sending ${KEY}`); });
  await assert.rejects(
    () => createProviderAdapter('anthropic', { env: FULL_ENV, fetchImpl: thrown.fetchImpl }).run({ prompt: 'q' }),
    (error) => error.crucibleCode === 'CRU-0036' && /could not be reached/.test(error.message) && !error.message.includes(KEY),
  );

  // A real abort surfaces the same way rather than hanging the caller.
  const slow = { fetchImpl: (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted'))); }) };
  await assert.rejects(
    () => createProviderAdapter('openai', { env: FULL_ENV, fetchImpl: slow.fetchImpl, timeoutMs: 10 }).run({ prompt: 'q' }),
    (error) => error.crucibleCode === 'CRU-0036' && /aborted/i.test(error.message),
  );
});

test('a credential appearing in a provider response is redacted before it is stored', async () => {
  const { fetchImpl } = transport(() => ok({ choices: [{ message: { content: `here is your key ${KEY}` } }] }));
  const result = await createProviderAdapter('openai', { env: FULL_ENV, fetchImpl }).run({ prompt: 'q' });
  assert.ok(!result.text.includes(KEY));
  assert.match(result.text, /redacted:OPENAI_API_KEY/);
});

test('a failed provider casts no vote: it lowers coverage instead of agreeing or disagreeing', async () => {
  const good = transport(() => ok(CHAT_PAYLOAD));
  const bad = transport(() => ({ status: 500, text: async () => 'upstream error' }));
  const orchestrator = new MultiAiOrchestrator({ env: FULL_ENV, now: () => '2026-09-03T17:00:00Z' });
  orchestrator.register('openai', createProviderAdapter('openai', { env: FULL_ENV, fetchImpl: good.fetchImpl }));
  orchestrator.register('perplexity', createProviderAdapter('perplexity', { env: FULL_ENV, fetchImpl: good.fetchImpl }));
  orchestrator.register('anthropic', createProviderAdapter('anthropic', { env: FULL_ENV, fetchImpl: bad.fetchImpl }));

  const distribution = await orchestrator.distribute({ taskId: 'coverage-task', prompt: 'q' });
  assert.equal(distribution.responses.length, 2);
  assert.equal(distribution.failures.length, 1);
  assert.equal(distribution.failures[0].provider, 'anthropic');
  assert.match(distribution.failures[0].reason, /CRU-0036/);

  // Two providers agreed verbatim, but the third failed - so this is not consensus.
  const corroboration = orchestrator.corroborate(distribution);
  assert.equal(corroboration.outcome, 'insufficient-evidence');
  assert.equal(corroboration.providers.length, 2);
  assert.equal(corroboration.failures.length, 1);
  assert.equal(corroboration.ownerApproved, false);
});

test('provenance survives the real adapter path end to end', async () => {
  const { fetchImpl } = transport(() => ok(CHAT_PAYLOAD));
  const orchestrator = new MultiAiOrchestrator({ env: FULL_ENV, now: () => '2026-09-03T17:00:00Z' });
  orchestrator.register('openai', createProviderAdapter('openai', { env: FULL_ENV, fetchImpl }));
  const distribution = await orchestrator.distribute({ taskId: 'provenance-task', prompt: 'question' });
  const [response] = distribution.responses;
  assert.equal(response.provider, 'openai');
  assert.equal(response.model, 'served-model');
  assert.equal(response.taskId, 'provenance-task');
  assert.equal(response.at, '2026-09-03T17:00:00Z');
  assert.match(response.promptSha256, /^[0-9a-f]{64}$/);
  assert.match(response.responseSha256, /^[0-9a-f]{64}$/);
});

test('an adapter refuses to run without a prompt, and without a credential', async () => {
  const { fetchImpl } = transport(() => ok(CHAT_PAYLOAD));
  await assert.rejects(() => createProviderAdapter('openai', { env: FULL_ENV, fetchImpl }).run({ prompt: '' }), (error) => error.crucibleCode === 'CRU-0034');
  await assert.rejects(() => createProviderAdapter('openai', { env: { OPENAI_MODEL: 'm' }, fetchImpl }).run({ prompt: 'q' }), (error) => error.crucibleCode === 'CRU-0033');
});
