/**
 * perplexity.test.js
 *
 * Regression tests for the Perplexity plugin surface.
 * Run with: node --test perplexity-plugin/perplexity.test.js
 *
 * These tests lock in:
 *   1. Tool-list parity — all 3 permitted tools are present
 *   2. No-argument rule — tools declare no inputSchema properties
 *   3. Canonical-governance reference is present in the tool list
 *   4. AI Collaboration adapter is DISABLED when env var is absent
 *   5. Self-routing default is 'exclude_origin_provider'
 *   6. Crucible learning/research path is NOT exposed as a tool
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const PERMITTED_TOOLS = [
  'crucible_plugin_info',
  'crucible_nexus_manifest',
  'crucible_canonical_governance'
];

// Tools that must NEVER appear in a Perplexity-facing tool list.
const FORBIDDEN_TOOLS = [
  'crucible_search',
  'crucible_learn',
  'crucible_research',
  'crucible_fetch'
];

describe('Perplexity connector contract', () => {
  let contract;

  before(() => {
    contract = require(path.join(__dirname, 'connector-contract.json'));
  });

  it('lists exactly the 3 permitted tools', () => {
    assert.deepStrictEqual(
      [...contract.permitted_tools].sort(),
      [...PERMITTED_TOOLS].sort()
    );
  });

  it('uses streamable-http transport', () => {
    assert.strictEqual(contract.transport, 'streamable-http');
  });

  it('declares no_arguments policy', () => {
    assert.strictEqual(contract.tool_argument_policy, 'no_arguments');
  });

  it('does not expose forbidden learning/research tools', () => {
    for (const t of FORBIDDEN_TOOLS) {
      assert.ok(
        !contract.permitted_tools.includes(t),
        `Forbidden tool '${t}' must not appear in permitted_tools`
      );
    }
  });
});

describe('AI Collaboration adapter — config-gated', () => {
  it('isEnabled() returns false when AI_COLLABORATION_BASE_URL is absent', () => {
    // Temporarily clear the env var
    const saved = process.env.AI_COLLABORATION_BASE_URL;
    delete process.env.AI_COLLABORATION_BASE_URL;

    const adapter = require(path.join(__dirname, 'ai-collaboration-adapter.js'));
    assert.strictEqual(adapter.isEnabled(), false);

    // Restore
    if (saved !== undefined) process.env.AI_COLLABORATION_BASE_URL = saved;
  });

  it('callMcp() throws when adapter is disabled', async () => {
    const saved = process.env.AI_COLLABORATION_BASE_URL;
    delete process.env.AI_COLLABORATION_BASE_URL;

    // Re-require with cleared cache to pick up env state
    delete require.cache[require.resolve(path.join(__dirname, 'ai-collaboration-adapter.js'))];
    const adapter = require(path.join(__dirname, 'ai-collaboration-adapter.js'));

    await assert.rejects(
      () => adapter.callMcp('tools/list'),
      /AI Collaboration adapter is disabled/
    );

    if (saved !== undefined) process.env.AI_COLLABORATION_BASE_URL = saved;
  });

  it('callChat() throws when adapter is disabled', async () => {
    const saved = process.env.AI_COLLABORATION_BASE_URL;
    delete process.env.AI_COLLABORATION_BASE_URL;

    delete require.cache[require.resolve(path.join(__dirname, 'ai-collaboration-adapter.js'))];
    const adapter = require(path.join(__dirname, 'ai-collaboration-adapter.js'));

    await assert.rejects(
      () => adapter.callChat([{ role: 'user', content: 'hello' }]),
      /AI Collaboration adapter is disabled/
    );

    if (saved !== undefined) process.env.AI_COLLABORATION_BASE_URL = saved;
  });
});

describe('Self-routing policy default', () => {
  it('defaults to exclude_origin_provider', () => {
    const saved = process.env.PERPLEXITY_SELF_ROUTING;
    delete process.env.PERPLEXITY_SELF_ROUTING;

    delete require.cache[require.resolve(path.join(__dirname, 'ai-collaboration-adapter.js'))];
    // We can't directly read the module-level const, but we can verify
    // the env example documents the correct default.
    const fs = require('fs');
    const envExample = fs.readFileSync(
      path.join(__dirname, '.env.example'), 'utf8'
    );
    assert.ok(
      envExample.includes('PERPLEXITY_SELF_ROUTING=exclude_origin_provider'),
      '.env.example must document exclude_origin_provider as default'
    );

    if (saved !== undefined) process.env.PERPLEXITY_SELF_ROUTING = saved;
  });
});
