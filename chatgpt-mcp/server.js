'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number.parseInt(process.env.PORT || process.env.CRUCIBLE_MCP_PORT || '8787', 10);
const SERVER_NAME = 'the-crucible-plugin';
const SERVER_VERSION = '0.4.0';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function toolDefinitions() {
  return [
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
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handleRpc(message) {
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
        canonicalBranch: 'main'
      };
    } else if (name === 'crucible_nexus_manifest') {
      payload = readJson('nexus.plugin.json');
    } else if (name === 'crucible_canonical_governance') {
      payload = {
        repository: 'jonathanblunt1214-lgtm/The-Crucible',
        branch: 'main',
        policy: 'Shared Crucible governance remains canonical on main; the Plug-in branch references it instead of duplicating it.'
      };
    } else {
      return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`);
    }

    return rpcResult(message.id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      isError: false
    });
  }

  return rpcError(message.id, -32601, `Method not found: ${message.method}`);
}

function sendJson(res, statusCode, value) {
  const body = value === null ? '' : JSON.stringify(value);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': process.env.CRUCIBLE_MCP_ALLOW_ORIGIN || '*',
    'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
    'access-control-allow-methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return sendJson(res, 204, null);
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, server: SERVER_NAME, version: SERVER_VERSION });
    }
    if (req.method !== 'POST' || req.url !== '/mcp') return sendJson(res, 404, { error: 'Not found' });

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const response = await handleRpc(JSON.parse(body));
        return sendJson(res, response === null ? 202 : 200, response);
      } catch (error) {
        return sendJson(res, 400, rpcError(null, -32700, error.message));
      }
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`[The Crucible] ChatGPT MCP adapter listening on port ${PORT}.`);
  });
}

module.exports = { createServer, handleRpc, toolDefinitions };
