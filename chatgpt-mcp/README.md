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
set CRUCIBLE_MCP_BEARER_TOKEN=<secret-generated-for-this-deployment>
npm run mcp
```

The server listens on loopback port `8787` by default, or `HOST` plus `PORT` /
`CRUCIBLE_MCP_PORT` when explicitly set. Every `/mcp` request requires
`Authorization: Bearer <CRUCIBLE_MCP_BEARER_TOKEN>`. The process refuses to
start the HTTP listener when the token is missing. CORS is omitted by default;
set one exact `CRUCIBLE_MCP_ALLOW_ORIGIN` only when a browser client needs it.

Endpoints:

- `GET /health`
- `POST /mcp`

The adapter exposes bounded, read-only plugin metadata tools:

- `crucible_plugin_info`
- `crucible_nexus_manifest`
- `crucible_canonical_governance`

It also keeps the ChatGPT MCP capability on this plugin branch by exposing the
canonical Crucible CLI allow-list from the former feature branch:

- Read-only by default: `crucible_validate`, `crucible_precheck`,
  `crucible_governance`.
- Mutation-capable and disabled by default: `crucible_security`, `crucible_run`,
  `crucible_repair`.

Execution never accepts a path or command from an MCP request and never uses a
shell. The deployment must bind two absolute local directories:

```bash
set CRUCIBLE_CORE_ROOT=C:\absolute\path\to\The-Crucible-core-checkout
set CRUCIBLE_PROJECT_ROOT=C:\absolute\path\to\the-authorized-project
```

`CRUCIBLE_CORE_ROOT` must contain `src/cli.js`; the adapter invokes that fixed
CLI with one allow-listed action. Output is bounded to 250 KB, execution defaults
to one concurrent run and a ten-minute timeout, and paths are resolved before
execution. The HTTP bearer token is removed from the child-process environment.
Override those bounds only with positive integers in
`CRUCIBLE_MCP_MAX_CONCURRENT_RUNS` and `CRUCIBLE_MCP_TIMEOUT_MS`.

The three mutation-capable tools remain unavailable unless the deployment owner
explicitly sets `CRUCIBLE_MCP_ENABLE_MUTATIONS=true`. Their MCP annotations mark
them non-read-only, destructive, and non-idempotent. Nexus actions still run
through the Nexus host contract; this external bridge does not import core source
into the plugin package.

## Run over stdio

```bash
npm run mcp:stdio
```

Newline-delimited JSON-RPC on stdin/stdout, no port bound and nothing to start by hand.
This is how a local MCP client launches it, and it is what the `crucible-mcp` entry in
`.claude-plugin/marketplace.json` declares. The same fixed core/project root and
mutation opt-in rules apply; HTTP bearer authentication is transport-only.

## Which client uses what

| Client | Integration surface |
| --- | --- |
| Claude Code | `crucible` plugin (commands and the SessionStart hook) plus `crucible-mcp`, which launches `stdio.js` |
| Nexus | `nexus.plugin.json` through the Nexus host contract in `HOST-CONTRACT.md`; unrelated to MCP |
| ChatGPT | the HTTP `/mcp` endpoint below, registered as a custom app/connector |
| Perplexity | today, as a council provider inside the AI Collaboration service rather than through this adapter. The HTTP endpoint is transport-generic, so any MCP-capable client can consume it, but nothing here is Perplexity-specific and this has not been verified against a Perplexity client. |

## ChatGPT connection

Deploy this branch to an HTTPS-capable Node host, configure the bearer token and
fixed roots, start it with `npm run mcp`, and register the public endpoint ending
in `/mcp` as a custom ChatGPT app/connector. The unauthenticated health endpoint
reports only whether authentication, execution, and mutation modes are configured;
it does not expose paths or secrets.

## Test

```bash
npm run test:mcp
npm test
npm run verify
```

Shared Crucible governance remains canonical on the repository `main` branch, consistent with this plugin branch's existing canonical-source rule.
