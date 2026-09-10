'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createStdioBridge } = require('./stdio');
const { handleRpc, toolDefinitions } = require('./server');

function harness() {
  const input = new EventEmitter();
  input.setEncoding = () => {};
  const written = [];
  const output = { write: (chunk) => written.push(chunk) };
  const bridge = createStdioBridge({ input, output });
  const send = async (text) => {
    input.emit('data', text);
    await bridge.drain();
  };
  const messages = () => written.join('').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { send, messages, written };
}

test('stdio transport answers initialize as newline-delimited JSON-RPC', async () => {
  const h = harness();
  await h.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}\n');
  assert.equal(h.written.length, 1);
  assert.ok(h.written[0].endsWith('\n'));
  const [response] = h.messages();
  assert.equal(response.id, 1);
  assert.equal(response.result.serverInfo.name, 'the-crucible-plugin');
});

test('stdio transport exposes exactly the tools the HTTP transport exposes', async () => {
  const h = harness();
  await h.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  const [response] = h.messages();
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name).sort(),
    toolDefinitions().map((tool) => tool.name).sort()
  );
  const overHttp = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(response.result, overHttp.result);
});

test('stdio transport writes nothing for a notification', async () => {
  const h = harness();
  await h.send('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  assert.deepEqual(h.written, []);
});

test('stdio transport reports malformed JSON as a parse error without exiting', async () => {
  const h = harness();
  await h.send('{not json}\n{"jsonrpc":"2.0","id":4,"method":"ping"}\n');
  const messages = h.messages();
  assert.equal(messages[0].error.code, -32700);
  assert.equal(messages[0].id, null);
  assert.equal(messages[1].id, 4);
});

test('stdio transport handles a message split across chunks', async () => {
  const h = harness();
  await h.send('{"jsonrpc":"2.0","id":5,');
  assert.deepEqual(h.written, []);
  await h.send('"method":"ping"}\n');
  const [response] = h.messages();
  assert.equal(response.id, 5);
  assert.deepEqual(response.result, {});
});

test('stdio transport rejects an unbounded line rather than buffering it forever', async () => {
  const h = harness();
  await h.send(`{"jsonrpc":"2.0","id":6,"padding":"${'x'.repeat(1_000_001)}"`);
  const [response] = h.messages();
  assert.equal(response.error.code, -32700);
  assert.match(response.error.message, /bound/);
});

test('stdio transport adds no tool or capability of its own', async () => {
  const h = harness();
  await h.send('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"crucible_plugin_info","arguments":{"extra":1}}}\n');
  const [response] = h.messages();
  assert.equal(response.error.code, -32602);
});
