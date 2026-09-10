/**
 * ai-collaboration-adapter.js
 *
 * Config-gated thin adapter that connects the Perplexity plugin to the
 * AI Collaboration service over its existing /mcp or /v1/chat/completions
 * surface.
 *
 * DISABLED by default. Requires AI_COLLABORATION_BASE_URL to be set.
 *
 * Does NOT:
 *   - Duplicate council logic, quorum, billing, or provider policy
 *   - Allow Perplexity to appear in its own council (PERPLEXITY_SELF_ROUTING
 *     defaults to exclude_origin_provider)
 *   - Leak secrets in responses
 *   - Accept arbitrary command strings
 *   - Expand authority beyond what AI Collaboration already grants
 */

'use strict';

const BASE_URL   = process.env.AI_COLLABORATION_BASE_URL   || '';
const BEARER     = process.env.AI_COLLABORATION_BEARER_TOKEN || '';
const SELF_ROUTE = process.env.PERPLEXITY_SELF_ROUTING      || 'exclude_origin_provider';
const TIMEOUT_MS = parseInt(process.env.PLUGIN_REQUEST_TIMEOUT_MS || '10000', 10);

/** Returns true only when the adapter is fully configured. */
function isEnabled() {
  return BASE_URL.trim().length > 0;
}

/**
 * Calls AI Collaboration /mcp with the given MCP method and params.
 * Automatically injects origin metadata so the council can apply
 * the self-routing policy.
 *
 * @param {string} method  - MCP method name, e.g. 'tools/list'
 * @param {object} [params] - MCP params (optional)
 * @returns {Promise<object>} Parsed JSON result from AI Collaboration
 */
async function callMcp(method, params = {}) {
  if (!isEnabled()) {
    throw new Error(
      'AI Collaboration adapter is disabled. Set AI_COLLABORATION_BASE_URL to enable.'
    );
  }

  const url = `${BASE_URL.replace(/\/$/, '')}/mcp`;

  const body = {
    jsonrpc: '2.0',
    id:      Date.now(),
    method,
    params:  {
      ...params,
      _origin: {
        provider:    'perplexity',
        selfRouting: SELF_ROUTE
      }
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (BEARER) headers['Authorization'] = `Bearer ${BEARER}`;

    const response = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
      signal:  controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI Collaboration responded ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`AI Collaboration MCP error ${json.error.code}: ${json.error.message}`);
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls AI Collaboration /v1/chat/completions (OpenAI-compatible surface).
 * Uses the configured bearer token; passes Perplexity origin in system prompt
 * metadata comment only — does not alter the model's instruction content.
 *
 * @param {Array}  messages - OpenAI-format messages array
 * @param {object} [opts]   - Optional: model, temperature, max_tokens
 * @returns {Promise<object>} Parsed OpenAI-format response
 */
async function callChat(messages, opts = {}) {
  if (!isEnabled()) {
    throw new Error(
      'AI Collaboration adapter is disabled. Set AI_COLLABORATION_BASE_URL to enable.'
    );
  }

  const url = `${BASE_URL.replace(/\/$/, '')}/v1/chat/completions`;

  const body = {
    model:       opts.model       || 'auto',
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens:  opts.max_tokens  || 1024,
    // _perplexity_origin is advisory only; council enforces self-routing
    // via the provider's own origin metadata check, not this field.
    _perplexity_origin: { selfRouting: SELF_ROUTE }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (BEARER) headers['Authorization'] = `Bearer ${BEARER}`;

    const response = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
      signal:  controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI Collaboration chat responded ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isEnabled, callMcp, callChat };
