// The production adapters. These actually call the providers.
//
// Each vendor speaks a different dialect, and the differences are not cosmetic: Anthropic
// authenticates with `x-api-key` and a version header and returns a content block array, while
// OpenAI, Perplexity and NVIDIA NIM authenticate with a bearer token and return choices. An
// adapter that pretended these were the same shape would work against exactly one of them.
//
// There is no default model. A wrong-but-plausible model name is worse than a missing one: it
// fails at the vendor with an error the caller has to decode, months after whoever wrote the
// default stopped paying attention. The model is configuration the owner supplies, and its
// absence is reported as configuration rather than guessed at.
//
// `fetchImpl` is injectable so tests can exercise request construction and response parsing
// without network access. The default is the real `fetch`, so the production path is the one that
// runs unless a caller deliberately replaces it.
const { crucibleError } = require('./failureCodes');
const { PROVIDER_IDS, describeProvider, credentialPresent, credentialFor, endpointFor, modelFor, redact } = require('./aiProviderRegistry');

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4096;

function requireModel(providerId, env) {
  const model = modelFor(providerId, env);
  if (!model) {
    const provider = describeProvider(providerId);
    throw crucibleError('CRU-0033', `${provider.label} has no model configured. Set ${provider.modelEnv} in the environment or as a repository secret. There is deliberately no default: a stale built-in model name fails at the vendor long after anyone is watching for it.`);
  }
  return model;
}

// Anthropic's Messages API: x-api-key plus a pinned API version, and a content block array back.
function anthropicRequest({ prompt, model, apiKey, maxTokens }) {
  return {
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  };
}

// OpenAI, Perplexity and NVIDIA NIM all speak the OpenAI chat-completions dialect.
function bearerChatRequest({ prompt, model, apiKey, maxTokens }) {
  return {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  };
}

function parseAnthropic(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const text = blocks.filter((block) => block && block.type === 'text').map((block) => block.text).join('').trim();
  return { text, model: payload?.model || null, evidence: [] };
}

function parseChatCompletion(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const text = String(choice?.message?.content || '').trim();
  // Perplexity returns the sources it used. They are real evidence and are carried through rather
  // than discarded, because a claim with its sources is worth more than the same claim without.
  const citations = Array.isArray(payload?.citations) ? payload.citations.map((item) => String(item)) : [];
  return { text, model: payload?.model || null, evidence: citations };
}

// Protocol metadata ONLY, keyed by canonical provider id. Three of the four share the OpenAI
// chat-completions dialect, so this table has fewer distinct shapes than it has entries - which is
// exactly why it must not double as the provider list. `aiProviderRegistry.PROVIDER_IDS` is the
// single canonical governed set; if a protocol variant or vendor alias is ever added here without
// being governed there, the assertion below fails rather than letting it quietly become a fifth
// provider that gets consulted, counted in corroboration, and voted.
const DIALECTS = Object.freeze({
  openai: { build: bearerChatRequest, parse: parseChatCompletion },
  anthropic: { build: anthropicRequest, parse: parseAnthropic },
  perplexity: { build: bearerChatRequest, parse: parseChatCompletion },
  'nvidia-nim': { build: bearerChatRequest, parse: parseChatCompletion },
});

// Enforced at load: dialect coverage and the governed provider set are the same four ids, no more
// and no fewer. A provider with no dialect cannot be called; a dialect with no provider is not
// governed. Either is a bug, and both are silent without this.
function assertDialectsMatchGovernedProviders() {
  const dialectIds = Object.keys(DIALECTS).sort();
  const governedIds = [...PROVIDER_IDS].sort();
  const undialected = governedIds.filter((id) => !dialectIds.includes(id));
  const ungoverned = dialectIds.filter((id) => !governedIds.includes(id));
  if (undialected.length || ungoverned.length) {
    throw crucibleError('CRU-0036', `Provider registry and protocol dialects disagree. Governed without a dialect: ${undialected.join(', ') || 'none'}. Dialect without governance: ${ungoverned.join(', ') || 'none'}. The canonical set is aiProviderRegistry.PROVIDER_IDS; dialects carry protocol metadata only.`);
  }
  return { providers: governedIds.length };
}
assertDialectsMatchGovernedProviders();

// One real adapter. It reads its credential from the environment at call time (never at module
// load, so a process that never calls a provider never touches its secret), posts to the vendor,
// and returns text plus provenance. Every error is redacted before it escapes, because an HTTP
// client will happily put the request headers - and therefore the key - into a message.
function createProviderAdapter(providerId, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTokens = DEFAULT_MAX_TOKENS,
} = {}) {
  const provider = describeProvider(providerId);
  const dialect = DIALECTS[provider.id];
  if (typeof fetchImpl !== 'function') throw crucibleError('CRU-0036', `${provider.label} adapter has no fetch implementation available. Node 18+ provides a global fetch; otherwise pass fetchImpl.`);

  return {
    provider: provider.id,
    async run({ prompt, model: requestedModel } = {}) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw crucibleError('CRU-0034', `${provider.label} adapter was called with no prompt.`);
      const apiKey = credentialFor(provider.id, env);
      const model = requestedModel || requireModel(provider.id, env);
      const endpoint = endpointFor(provider.id, env);
      const { headers, body } = dialect.build({ prompt, model, apiKey, maxTokens });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(endpoint, { method: 'POST', headers, body, signal: controller.signal });
      } catch (error) {
        throw crucibleError('CRU-0036', `${provider.label} could not be reached: ${redact(error && error.message ? error.message : String(error), env)}`);
      } finally {
        clearTimeout(timer);
      }

      if (!response || typeof response.status !== 'number') throw crucibleError('CRU-0036', `${provider.label} returned no usable HTTP response.`);
      const raw = typeof response.text === 'function' ? await response.text() : '';
      if (response.status < 200 || response.status >= 300) {
        // The body is redacted and truncated: it frequently echoes the request, and an error path
        // that leaks the key is worse than the error it was reporting.
        throw crucibleError('CRU-0036', `${provider.label} rejected the request with HTTP ${response.status}: ${redact(raw, env).slice(0, 500)}`);
      }

      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch (error) { throw crucibleError('CRU-0036', `${provider.label} returned a response that is not JSON: ${redact(error.message, env)}`); }

      const parsed = dialect.parse(payload);
      if (!parsed.text) throw crucibleError('CRU-0036', `${provider.label} returned an empty completion.`);
      return { text: redact(parsed.text, env), model: parsed.model || model, evidence: parsed.evidence.map((item) => redact(item, env)) };
    },
  };
}

// Build adapters for every provider whose credential AND model are configured. A provider that is
// not configured is simply absent - it is never replaced by something that returns a canned
// answer, because a fake response is indistinguishable from a real one downstream and would
// silently become evidence.
function createConfiguredAdapters(options = {}) {
  const env = options.env || process.env;
  const adapters = new Map();
  const unconfigured = [];
  for (const id of PROVIDER_IDS) {
    const provider = describeProvider(id);
    if (!credentialPresent(id, env)) { unconfigured.push({ provider: id, reason: `${provider.credentialEnv} is not set.` }); continue; }
    if (!modelFor(id, env)) { unconfigured.push({ provider: id, reason: `${provider.modelEnv} is not set.` }); continue; }
    try { adapters.set(id, createProviderAdapter(id, { ...options, env })); }
    catch (error) { unconfigured.push({ provider: id, reason: redact(error && error.message ? error.message : String(error), env) }); }
  }
  return { adapters, unconfigured };
}

module.exports = { DIALECTS, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, createProviderAdapter, createConfiguredAdapters, requireModel, assertDialectsMatchGovernedProviders };
