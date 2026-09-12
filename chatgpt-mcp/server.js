'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EXECUTION_TOOLS, executionSummary, runAllowedAction } = require('./execution');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number.parseInt(process.env.PORT || process.env.CRUCIBLE_MCP_PORT || '8787', 10);
const SERVER_NAME = 'the-crucible-plugin';
const SERVER_VERSION = '0.4.0';
const MAX_BODY_BYTES = 1_000_000;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function toolDefinitions() {
  const metadataTools = [
    {
      name: 'crucible_plugin_info',
      description: 'Return metadata for The Crucible plugin package.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: 'crucible_nexus_manifest',
      description: 'Return the Nexus plugin manifest for The Crucible.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    {
      name: 'crucible_canonical_governance',
      description: 'Return the canonical Crucible repository and governance source used by this plugin branch.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    }
  ];
  const executionTools = Object.entries(EXECUTION_TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: !tool.mutating,
      destructiveHint: tool.mutating,
      idempotentHint: !tool.mutating
    }
  }));
  return [...metadataTools, ...executionTools];
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolResult(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], isError };
}

async function handleRpc(message, { env = process.env, spawnProcess = spawn } = {}) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message && message.id, -32600, 'Invalid Request');
  }

  if (message.method === 'initialize') {
    return rpcResult(message.id, {
      protocolVersion: message.params?.protocolVersion || '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
    });
  }

  if (message.method === 'notifications/initialized') return null;
  if (message.method === 'ping') return rpcResult(message.id, {});
  if (message.method === 'tools/list') return rpcResult(message.id, { tools: toolDefinitions() });

  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (Object.keys(args).length) return rpcError(message.id, -32602, 'This tool does not accept arguments.');

    let payload;
    if (name === 'crucible_plugin_info') {
      const pkg = readJson('package.json');
      payload = {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        branchRole: 'standalone plugin package',
        canonicalRepository: 'jonathanblunt1214-lgtm/The-Crucible',
        canonicalBranch: 'main',
        executionBridgeConfigured: Boolean(env.CRUCIBLE_CORE_ROOT && env.CRUCIBLE_PROJECT_ROOT),
        mutationToolsEnabled: env.CRUCIBLE_MCP_ENABLE_MUTATIONS === 'true'
      };
    } else if (name === 'crucible_nexus_manifest') {
      payload = readJson('nexus.plugin.json');
    } else if (name === 'crucible_canonical_governance') {
      payload = {
        repository: 'jonathanblunt1214-lgtm/The-Crucible',
        branch: 'main',
        policy: 'Shared Crucible governance remains canonical on main; the Plug-in branch references it instead of duplicating it.'
      };
    } else if (EXECUTION_TOOLS[name]) {
      const tool = EXECUTION_TOOLS[name];
      if (tool.mutating && env.CRUCIBLE_MCP_ENABLE_MUTATIONS !== 'true') {
        return rpcResult(message.id, toolResult(
          'This mutation-capable tool is disabled. Set CRUCIBLE_MCP_ENABLE_MUTATIONS=true only for an explicitly authorized deployment.',
          true
        ));
      }
      const result = await runAllowedAction(tool.action, { env, spawnProcess });
      return rpcResult(message.id, toolResult(executionSummary(result), !result.ok));
    } else {
      return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`);
    }

    return rpcResult(message.id, toolResult(payload));
  }

  return rpcError(message.id, -32601, `Method not found: ${message.method}`);
}

function secureTokenEqual(provided, expected) {
  const left = Buffer.from(provided || '', 'utf8');
  const right = Buffer.from(expected || '', 'utf8');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function authorized(req, env) {
  const expected = env.CRUCIBLE_MCP_BEARER_TOKEN;
  const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
  return Boolean(expected && match && secureTokenEqual(match[1], expected));
}

function sendJson(res, statusCode, value, env) {
  const body = value === null ? '' : JSON.stringify(value);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
    'access-control-allow-methods': 'GET, POST, OPTIONS'
  };
  if (env.CRUCIBLE_MCP_ALLOW_ORIGIN) headers['access-control-allow-origin'] = env.CRUCIBLE_MCP_ALLOW_ORIGIN;
  res.writeHead(statusCode, headers);
  res.end(body);
}

function createServer({ env = process.env, spawnProcess = spawn } = {}) {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendJson(res, 204, null, env);
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, {
        ok: true,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        authenticationConfigured: Boolean(env.CRUCIBLE_MCP_BEARER_TOKEN),
        executionBridgeConfigured: Boolean(env.CRUCIBLE_CORE_ROOT && env.CRUCIBLE_PROJECT_ROOT),
        mutationToolsEnabled: env.CRUCIBLE_MCP_ENABLE_MUTATIONS === 'true'
      }, env);
    }
    if (req.method !== 'POST' || req.url !== '/mcp') return sendJson(res, 404, { error: 'Not found' }, env);
    if (!env.CRUCIBLE_MCP_BEARER_TOKEN) return sendJson(res, 503, { error: 'MCP authentication is not configured.' }, env);
    if (!authorized(req, env)) return sendJson(res, 401, { error: 'Unauthorized' }, env);

    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          return sendJson(res, 413, rpcError(null, -32600, 'Request body too large'), env);
        }
        chunks.push(chunk);
      }
      const response = await handleRpc(JSON.parse(Buffer.concat(chunks).toString('utf8')), { env, spawnProcess });
      return sendJson(res, response === null ? 202 : 200, response, env);
    } catch (error) {
      return sendJson(res, 400, rpcError(null, -32700, error.message), env);
    }
  });
}

if (require.main === module) {
  if (!process.env.CRUCIBLE_MCP_BEARER_TOKEN) {
    console.error('[The Crucible] CRUCIBLE_MCP_BEARER_TOKEN is required for the HTTP MCP transport.');
    process.exitCode = 1;
  } else {
    const host = process.env.HOST || '127.0.0.1';
    createServer().listen(PORT, host, () => {
      console.log(`[The Crucible] ChatGPT MCP adapter listening on http://${host}:${PORT}/mcp`);
    });
  }
}

module.exports = { EXECUTION_TOOLS, createServer, handleRpc, runAllowedAction, toolDefinitions };
