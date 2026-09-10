#!/usr/bin/env node
'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER_NAME = 'the-crucible';
const SERVER_VERSION = '0.1.0';
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 250_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

const TOOLS = Object.freeze({
  crucible_validate: {
    action: 'validate',
    description: 'Validate The Crucible configuration for the configured project.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  crucible_precheck: {
    action: 'precheck',
    description: 'Run The Crucible pre-check against the configured project.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  crucible_governance: {
    action: 'governance',
    description: 'Run The Crucible configuration and AI-conflict governance checks.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  crucible_security: {
    action: 'security',
    description: 'Run The Crucible security gate. This can quarantine suspicious findings in the configured project.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  crucible_run: {
    action: 'run',
    description: 'Run the configured Crucible gate suite. Some enabled gates can safely modify or quarantine project files.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  crucible_repair: {
    action: 'repair',
    description: 'Run The Crucible internal repair operation against the configured project.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
});

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function toolDefinitions() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: tool.annotations,
  }));
}

function configuredProjectRoot() {
  return path.resolve(process.env.CRUCIBLE_PROJECT_ROOT || process.cwd());
}

function runAllowedAction(action) {
  return new Promise((resolve) => {
    const projectRoot = configuredProjectRoot();
    const cli = path.join(__dirname, 'cli.js');
    const timeoutMs = Number.parseInt(process.env.CRUCIBLE_MCP_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS;
    const child = spawn(process.execPath, [cli, action], {
      cwd: projectRoot,
      env: { ...process.env, CRUCIBLE_PROJECT_ROOT: projectRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let totalBytes = 0;
    let truncated = false;
    let settled = false;

    const capture = (target, chunk) => {
      if (truncated) return target;
      const text = chunk.toString('utf8');
      totalBytes += Buffer.byteLength(text);
      if (totalBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        return `${target}\n[output truncated by Crucible MCP server]`;
      }
      return target + text;
    };

    child.stdout.on('data', (chunk) => { stdout = capture(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = capture(stderr, chunk); });

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    timer.unref();

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, stdout, stderr: `${stderr}${error.message}\n`, projectRoot });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const timedOut = signal === 'SIGTERM' || signal === 'SIGKILL';
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
        projectRoot,
      });
    });
  });
}

function asToolContent(result) {
  const lines = [
    `Project root: ${result.projectRoot}`,
    `Exit code: ${result.exitCode === null ? 'unavailable' : result.exitCode}`,
  ];
  if (result.timedOut) lines.push('Status: timed out');
  if (result.stdout.trim()) lines.push(`STDOUT:\n${result.stdout.trim()}`);
  if (result.stderr.trim()) lines.push(`STDERR:\n${result.stderr.trim()}`);
  return lines.join('\n\n');
}

async function handleRpc(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(message && message.id, -32600, 'Invalid Request');
  }

  const { id, method, params = {} } = message;

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: params.protocolVersion || '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  if (method === 'server/discover') {
    return jsonRpcResult(id, {
      protocolVersion: '2026-07-28',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  if (method === 'ping') return jsonRpcResult(id, {});
  if (method === 'notifications/initialized') return null;

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: toolDefinitions() });
  }

  if (method === 'tools/call') {
    const name = params && params.name;
    const tool = TOOLS[name];
    if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${String(name)}`);
    const args = params.arguments || {};
    if (Object.keys(args).length) return jsonRpcError(id, -32602, 'This tool does not accept arguments.');

    const result = await runAllowedAction(tool.action);
    return jsonRpcResult(id, {
      content: [{ type: 'text', text: asToolContent(result) }],
      isError: !result.ok,
    });
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

function writeJson(res, statusCode, body) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': process.env.CRUCIBLE_MCP_ALLOW_ORIGIN || '*',
    'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-method, mcp-name',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return writeJson(res, 204, null);

    if (req.method === 'GET' && req.url === '/health') {
      return writeJson(res, 200, {
        ok: true,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        projectRoot: configuredProjectRoot(),
      });
    }

    if (req.url !== '/mcp') return writeJson(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return writeJson(res, 405, { error: 'Use POST /mcp' });

    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) return writeJson(res, 413, jsonRpcError(null, -32600, 'Request body too large'));
      chunks.push(chunk);
    }

    let message;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return writeJson(res, 400, jsonRpcError(null, -32700, 'Parse error'));
    }

    try {
      const response = await handleRpc(message);
      if (response === null) return writeJson(res, 202, null);
      return writeJson(res, 200, response);
    } catch (error) {
      return writeJson(res, 500, jsonRpcError(message.id, -32603, 'Internal error', error.message));
    }
  });
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || '', 10) || DEFAULT_PORT;
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`[The Crucible] MCP server listening on http://${host}:${port}/mcp`);
    console.log(`[The Crucible] Project root: ${configuredProjectRoot()}`);
  });
}

module.exports = { createServer, handleRpc, toolDefinitions, TOOLS };
