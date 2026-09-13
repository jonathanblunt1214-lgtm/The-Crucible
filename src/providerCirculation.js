'use strict';

// Provider traffic enters the digestive discovery path through circulation instead of adding a
// direct digestive-to-brain cable. This adapter deliberately returns candidate citations only.
// The provider's prose is hashed for audit and discarded; it can never become a claim, a vote,
// corroboration, verification, or promotion authority.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createProviderAdapter } = require('./aiProviderAdapters');
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

module.exports = { DEFAULT_PERPLEXITY_DISCOVERY_MODEL, MAXIMUM_CITATIONS_PER_TOPIC, discoveryPrompt, PerplexityCitationTransport };
