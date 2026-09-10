# ChatGPT MCP adapter

This directory adds a ChatGPT-compatible MCP endpoint to the existing `Plug-in` branch without changing the Nexus plugin runtime contract.

## Two transports, one tool set

The adapter is exposed over two transports that share `handleRpc` in `server.js`, so
neither can drift from the other and neither adds a tool, argument, or capability the
other lacks. `stdio.test.js` asserts that parity directly.

| Transport | Entry point | Used by |
| --- | --- | --- |
| HTTP | `server.js` (`npm run mcp`) | A remote client registering a public `/mcp` URL |
| stdio | `stdio.js` (`npm run mcp:stdio`) | A local client that launches the server as a child process |

## Run over HTTP

```bash
npm run mcp
```

The server listens on port `8787` by default, or `PORT` / `CRUCIBLE_MCP_PORT` when set.

Endpoints:

- `GET /health`
- `POST /mcp`

The adapter intentionally exposes only bounded, read-only plugin metadata tools:

- `crucible_plugin_info`
- `crucible_nexus_manifest`
- `crucible_canonical_governance`

It does not expose arbitrary shell execution, filesystem paths, secrets, Git writes, or unrestricted network access. The existing Nexus plugin actions continue to run through the Nexus host contract; this MCP adapter does not bypass that sandbox.

## Run over stdio

```bash
npm run mcp:stdio
```

Newline-delimited JSON-RPC on stdin/stdout, no port bound and nothing to start by hand.
This is how a local MCP client launches it, and it is what the `crucible-mcp` entry in
`.claude-plugin/marketplace.json` declares.

## Which client uses what

| Client | Integration surface |
| --- | --- |
| Claude Code | `crucible` plugin (commands and the SessionStart hook) plus `crucible-mcp`, which launches `stdio.js` |
| Nexus | `nexus.plugin.json` through the Nexus host contract in `HOST-CONTRACT.md`; unrelated to MCP |
| ChatGPT | the HTTP `/mcp` endpoint below, registered as a custom app/connector |
| Perplexity | today, as a council provider inside the AI Collaboration service rather than through this adapter. The HTTP endpoint is transport-generic, so any MCP-capable client can consume it, but nothing here is Perplexity-specific and this has not been verified against a Perplexity client. |

## ChatGPT connection

Deploy this branch to an HTTPS-capable Node host, start it with `npm run mcp`, and register the public MCP endpoint ending in `/mcp` as a custom ChatGPT app/connector. The health endpoint can be used to verify the deployment before registration.

## Test

```bash
npm run test:mcp
npm test
npm run verify
```

Shared Crucible governance remains canonical on the repository `main` branch, consistent with this plugin branch's existing canonical-source rule.
