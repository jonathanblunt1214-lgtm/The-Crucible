'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRpc, toolDefinitions } = require('./server');

test('exposes only bounded read-only tools', () => {
  const tools = toolDefinitions();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'crucible_canonical_governance',
    'crucible_nexus_manifest',
    'crucible_plugin_info'
  ]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
  }
});

test('initialize advertises MCP tools', async () => {
  const response = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(response.result.serverInfo.name, 'the-crucible-plugin');
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test('plugin info is available without arbitrary arguments', async () => {
  const response = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'crucible_plugin_info', arguments: {} } });
  assert.equal(response.result.isError, false);
  assert.match(response.result.content[0].text, /the-crucible-nexus-plugin/);
});

test('arbitrary arguments are rejected', async () => {
  const response = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'crucible_plugin_info', arguments: { command: 'shell' } } });
  assert.equal(response.error.code, -32602);
});
