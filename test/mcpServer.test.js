'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRpc, toolDefinitions } = require('../src/mcpServer');

test('MCP tool list exposes only bounded Crucible actions', () => {
  const tools = toolDefinitions();
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'crucible_governance',
    'crucible_precheck',
    'crucible_repair',
    'crucible_run',
    'crucible_security',
    'crucible_validate',
  ]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.properties, {});
  }
});

test('initialize advertises tool capability', async () => {
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25' },
  });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(response.result.capabilities, { tools: {} });
  assert.equal(response.result.serverInfo.name, 'the-crucible');
});

test('server/discover advertises modern protocol support', async () => {
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'server/discover',
    params: {},
  });
  assert.equal(response.result.protocolVersion, '2026-07-28');
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test('tools/list returns tool definitions', async () => {
  const response = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(response.result.tools.length, 6);
});

test('unknown tool calls are rejected', async () => {
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'shell', arguments: { command: 'rm -rf /' } },
  });
  assert.equal(response.error.code, -32602);
});

test('tool calls reject arbitrary arguments', async () => {
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'crucible_validate', arguments: { projectRoot: '/tmp/other' } },
  });
  assert.equal(response.error.code, -32602);
});
