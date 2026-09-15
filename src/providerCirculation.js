'use strict';

// Provider traffic enters the digestive discovery path through circulation instead of adding a
// direct digestive-to-brain cable. This adapter deliberately returns candidate citations only.
// The provider's prose is hashed for audit and discarded; it can never become a claim, a vote,
// corroboration, verification, or promotion authority.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createProviderAdapter } = require('./aiProviderAdapters');
const { describeProvider, credentialPresent, modelFor } = require('./aiProviderRegistry');
const { crucibleError } = require('./failureCodes');

const DEFAULT_PERPLEXITY_DISCOVERY_MODEL = 'sonar';
const MAXIMUM_CITATIONS_PER_TOPIC = 10;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function discoveryPrompt(topic) {
  return [
    'Find primary or authoritative technical sources for the approved software-engineering topic below.',
    'Return no more than ten citations. Prefer HTTPS sources hosted by .edu, .org, or .gov domains.',
    'Do not treat your answer, summary, ranking, or repetition as evidence. The caller will ignore all prose and independently retrieve and vet citation URLs.',
    `Approved topic: ${topic}`,
  ].join('\n');
}

class PerplexityCitationTransport {
  constructor({ env = process.env, adapter = null, killSwitchFile, model = null, now = () => new Date().toISOString() } = {}) {
    this.env = env;
    this.adapter = adapter || createProviderAdapter('perplexity', { env });
    this.killSwitchFile = path.resolve(killSwitchFile);
    this.model = String(model || env.PERPLEXITY_MODEL || '').trim() || DEFAULT_PERPLEXITY_DISCOVERY_MODEL;
    this.now = now;
  }

  async search(topic) {
    if (fs.existsSync(this.killSwitchFile)) throw crucibleError('CRU-0042', 'Perplexity research kill switch is active.');
    const prompt = discoveryPrompt(topic);
    const result = await this.adapter.run({ prompt, model:this.model });
    const citations = Array.isArray(result.evidence) ? result.evidence.slice(0, MAXIMUM_CITATIONS_PER_TOPIC).map(String) : [];
    return {
      citations,
      searchedAt:this.now(),
      provider:'perplexity',
      model:String(result.model || this.model),
      promptSha256:sha256(prompt),
      responseSha256:sha256(JSON.stringify({ model:result.model || this.model, text:result.text || '', citations })),
    };
  }
}

// Discovery from a provider that has no search behind it at all.
//
// Perplexity returns a `citations` array, which is why the transport above can hand back real
// source references. Every other governed provider is a plain chat model: `parseChatCompletion`
// derives `evidence` from `payload.citations`, a field they never send, so `evidence` comes back
// empty and any URL exists only inside the prose. Discovery on a free provider therefore has to
// read URLs out of the text.
//
// That is a weaker input, and it is labelled as one rather than quietly mixed in with citations.
// A model naming a URL is not a search result and is not a source: it is a guess about where
// something might live. The guess is cheap to check and the check is already mandatory - every
// candidate is independently retrieved, its final host must end in an admitted suffix, and its
// bytes are hashed - so a hallucinated URL simply 404s or fails admission and costs nothing but
// a request. What must never happen is the guess being mistaken later for a citation, so the
// audit carries `providerKind: 'model-proposed-pointers'` on every record it produces.
const MODEL_POINTER_PROVIDER_KIND = 'model-proposed-pointers';
const CITATION_PROVIDER_KIND = 'provider-citations';

// The discovery path needs to know which provider it is configured for, whether its credential
// and model are present, and what to name in the error when they are not. That knowledge lives in
// the registry, which belongs to the brain - and a digestive CLI importing it directly would be a
// new organ-to-organ cable the fly-by-wire ratchet refuses, correctly. Circulation is where that
// question is allowed to be asked, so it is asked here and the answer is carried to the caller.
function describeDiscoveryProvider(providerId, env = process.env) {
  const provider = describeProvider(providerId);
  return {
    id: provider.id,
    label: provider.label,
    credentialEnv: provider.credentialEnv,
    modelEnv: provider.modelEnv,
    model: modelFor(provider.id, env),
    credentialPresent: credentialPresent(provider.id, env),
  };
}

// Deliberately strict. `)` and `]` are excluded from the URL body so a markdown link yields the
// href rather than the punctuation after it, and trailing sentence punctuation is trimmed,
// because "see https://example.org/page." must not become a URL ending in a full stop.
const TEXT_URL_PATTERN = /https:\/\/[^\s<>"'`)\]}]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?'"`]+$/;

function extractUrlsFromText(text, maximum = MAXIMUM_CITATIONS_PER_TOPIC) {
  const found = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(TEXT_URL_PATTERN)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '');
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    found.push(candidate);
    if (found.length >= maximum) break;
  }
  return found;
}

class ModelPointerTransport {
  constructor({ env = process.env, providerId = 'nvidia-nim', adapter = null, killSwitchFile, model = null, now = () => new Date().toISOString() } = {}) {
    this.env = env;
    this.providerId = providerId;
    this.adapter = adapter || createProviderAdapter(providerId, { env });
    this.killSwitchFile = path.resolve(killSwitchFile);
    this.model = model ? String(model).trim() : null;
    this.now = now;
  }

  async search(topic) {
    if (fs.existsSync(this.killSwitchFile)) throw crucibleError('CRU-0042', `${this.providerId} research kill switch is active.`);
    const prompt = discoveryPrompt(topic);
    const result = await this.adapter.run({ prompt, ...(this.model ? { model: this.model } : {}) });
    // Prefer real citations if a provider ever starts sending them; fall back to the prose.
    const cited = Array.isArray(result.evidence) ? result.evidence.filter(Boolean).map(String) : [];
    const citations = cited.length ? cited.slice(0, MAXIMUM_CITATIONS_PER_TOPIC) : extractUrlsFromText(result.text);
    return {
      citations,
      searchedAt: this.now(),
      provider: this.providerId,
      providerKind: cited.length ? CITATION_PROVIDER_KIND : MODEL_POINTER_PROVIDER_KIND,
      model: String(result.model || this.model || ''),
      promptSha256: sha256(prompt),
      responseSha256: sha256(JSON.stringify({ model: result.model || this.model || '', text: result.text || '', citations })),
    };
  }
}

module.exports = {
  DEFAULT_PERPLEXITY_DISCOVERY_MODEL,
  MAXIMUM_CITATIONS_PER_TOPIC,
  MODEL_POINTER_PROVIDER_KIND,
  CITATION_PROVIDER_KIND,
  discoveryPrompt,
  extractUrlsFromText,
  describeDiscoveryProvider,
  PerplexityCitationTransport,
  ModelPointerTransport,
};
