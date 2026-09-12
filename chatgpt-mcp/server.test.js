'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, handleRpc, toolDefinitions } = require('./server');

test('exposes metadata and consolidated Crucible execution tools with accurate annotations', () => {
  const tools = toolDefinitions();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'crucible_canonical_governance',
    'crucible_governance',
    'crucible_nexus_manifest',
    'crucible_plugin_info',
    'crucible_precheck',
    'crucible_repair',
    'crucible_run',
    'crucible_security',
    'crucible_validate'
  ]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  for (const name of ['crucible_security', 'crucible_run', 'crucible_repair']) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, true);
    assert.equal(tool.annotations.idempotentHint, false);
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

test('execution tools fail closed until fixed core and project roots are configured', async () => {
  const response = await handleRpc(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'crucible_validate', arguments: {} } },
    { env: {} }
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /CRUCIBLE_CORE_ROOT is required/);
});

test('mutation-capable tools require an explicit deployment opt-in', async () => {
  const response = await handleRpc(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'crucible_run', arguments: {} } },
    { env: {} }
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /CRUCIBLE_MCP_ENABLE_MUTATIONS=true/);
});

test('configured execution invokes the canonical CLI without a shell', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-mcp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const coreRoot = path.join(root, 'core');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(path.join(coreRoot, 'src'), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(coreRoot, 'src', 'cli.js'), "console.log('validated through configured core token=' + String(process.env.CRUCIBLE_MCP_BEARER_TOKEN));\n");

  const response = await handleRpc(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'crucible_validate', arguments: {} } },
    { env: { ...process.env, CRUCIBLE_CORE_ROOT: coreRoot, CRUCIBLE_PROJECT_ROOT: projectRoot, CRUCIBLE_MCP_BEARER_TOKEN: 'must-not-reach-child' } }
  );
  assert.equal(response.result.isError, false);
  assert.match(response.result.content[0].text, /validated through configured core token=undefined/);
});

test('HTTP MCP requests require a configured bearer token', async (t) => {
  const env = { CRUCIBLE_MCP_BEARER_TOKEN: 'test-token' };
  const server = createServer({ env });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' });

  const denied = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body });
  assert.equal(denied.status, 401);

  const allowed = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body
  });
  assert.equal(allowed.status, 200);
  const response = await allowed.json();
  assert.ok(response.result.tools.some((tool) => tool.name === 'crucible_validate'));
});
