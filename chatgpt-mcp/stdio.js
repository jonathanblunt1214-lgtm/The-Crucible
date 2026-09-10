'use strict';

// Stdio transport for the same MCP adapter the ChatGPT connector serves over HTTP.
//
// The HTTP server in ./server.js is what a remote ChatGPT app/connector registers.
// Local MCP clients - Claude Code among them - launch a server as a child process and
// speak newline-delimited JSON-RPC over stdin/stdout instead, with no port to bind and
// nothing to start by hand. This module reuses ./server.js's handleRpc unchanged, so
// both transports expose exactly the same bounded, read-only tool set. It adds no tool,
// no argument, and no capability of its own.

const { handleRpc } = require('./server');

const PARSE_ERROR = -32700;

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// Bounds the buffer the same way the HTTP transport bounds a request body, so a client
// that never sends a newline cannot grow this process without limit.
const MAX_BUFFERED_BYTES = 1_000_000;

function createStdioBridge({ input, output, onError = () => {} } = {}) {
  let buffer = '';
  let closed = false;

  const write = (value) => {
    if (value === null || closed) return;
    output.write(`${JSON.stringify(value)}\n`);
  };

  const handleLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      write(errorResponse(null, PARSE_ERROR, error.message));
      return;
    }
    try {
      write(await handleRpc(message));
    } catch (error) {
      onError(error);
      write(errorResponse(message && message.id, -32603, 'Internal error'));
    }
  };

  const queue = [];
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length) await handleLine(queue.shift());
    draining = false;
  };

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_BUFFERED_BYTES) {
      buffer = '';
      write(errorResponse(null, PARSE_ERROR, 'Message exceeded the buffered size bound.'));
      return;
    }
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) queue.push(line);
    void drain();
  });
  input.on('end', () => {
    if (buffer.trim()) queue.push(buffer);
    buffer = '';
    void drain().then(() => { closed = true; });
  });

  return { handleLine, drain };
}

if (require.main === module) {
  createStdioBridge({ input: process.stdin, output: process.stdout, onError: (error) => { process.stderr.write(`[The Crucible] MCP stdio error: ${error.message}\n`); } });
}

module.exports = { createStdioBridge };
