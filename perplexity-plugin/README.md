# Perplexity Plugin — The Crucible

This directory wires Perplexity to The Crucible **without modifying** the existing
`chatgpt-mcp/` server, `stdio.js`, `server.js`, or canonical governance on `main`.

## How it works

Perplexity connects to the **same HTTPS Streamable HTTP `/mcp` endpoint** that the
ChatGPT MCP plugin already exposes. No new RPC server is created. The plugin is
pure configuration, documentation, and test coverage.

```
Perplexity (Remote MCP Connector)
        │  HTTPS POST /mcp
        ▼
chatgpt-mcp/server.js  ← unchanged
        │
        ▼
  handleRpc()  ← shared with stdio transport
        │
   ┌────┴─────────────────────┐
   │  crucible_plugin_info    │
   │  crucible_nexus_manifest │  ← 3 permitted tools only
   │  crucible_canonical_     │
   │    governance            │
   └──────────────────────────┘
```

## Permitted tools (v1 — read-only)

| Tool | Arguments | Returns |
|------|-----------|----------|
| `crucible_plugin_info` | none | Plugin metadata JSON |
| `crucible_nexus_manifest` | none | Nexus governance manifest JSON |
| `crucible_canonical_governance` | none | Canonical governance text |

> **Important:** All three tools take **no arguments**. Some SDKs inject extra
> fields — the existing server discards unknown properties, but your client must
> send an empty `params: {}` or omit `params` entirely.

## Connector registration (Perplexity UI)

1. Go to **Perplexity → Account Settings → Connectors → Add connector**
2. Select **Remote** → **Streamable HTTP**
3. Enter your deployed Crucible URL: `https://<your-host>/mcp`
4. Authentication: choose **API Key** (header `Authorization: Bearer <token>`) or
   **None** for local/dev use only
5. Save — Perplexity will call `POST /mcp` with `method: "tools/list"` to verify

## AI Collaboration integration

See `ai-collaboration-adapter.js` for the config-gated thin adapter.
Requires `AI_COLLABORATION_BASE_URL` to be set — disabled by default.

```
Perplexity → ai-collaboration-adapter.js
                     │  (only when AI_COLLABORATION_BASE_URL is set)
                     ▼
          AI-collaboration- /mcp  or  /v1/chat/completions
```

## Self-routing policy

`PERPLEXITY_SELF_ROUTING=exclude_origin_provider` (default)

When a request originates through this Perplexity connector, the AI Collaboration
council will **not** route that request back to the Perplexity provider. This
prevents circular self-corroboration. All other council clients keep their existing
routing behavior unchanged.

## Security model

- No arbitrary shell execution
- No unrestricted filesystem access
- No secret leakage — env vars are never forwarded to tool responses
- Governance text is never copied or reproduced; only canonical references are returned
- Consensus across providers is evidence only, never authorization
- Routing, quorum, billing, and provider policy remain owned by AI Collaboration

## Crucible learning system

The Crucible learning/research system uses a bounded credential-free search path.
**This Perplexity plugin does NOT route Crucible learning or research requests
through Perplexity search.** That path remains governed exclusively by Crucible's
own research coordinator. Any change to that boundary requires an explicit owner
decision and a corresponding policy change in the canonical governance.

## Environment variables

See `.env.example` for the full list.

## Running tests

```bash
cd chatgpt-mcp
npm test
# Perplexity-specific tests:
node --test ../perplexity-plugin/perplexity.test.js
```
