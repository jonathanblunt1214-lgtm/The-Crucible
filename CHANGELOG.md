# Changelog

All notable changes to The Crucible are documented here.

---

## [Unreleased] — Plug-in branch

### Added — Perplexity Plugin (config-gated)

- `perplexity-plugin/README.md` — Perplexity remote MCP connector setup,
  security model, permitted-tool list, and self-routing policy documentation.
- `perplexity-plugin/.env.example` — All required env vars. `AI_COLLABORATION_BASE_URL`
  is intentionally blank by default; the AI Collaboration adapter remains **disabled**
  until that value is set.
- `perplexity-plugin/connector-contract.json` — Streamable HTTP registration
  metadata for Perplexity custom remote connectors.
- `perplexity-plugin/ai-collaboration-adapter.js` — Thin config-gated adapter
  over the existing AI Collaboration `/mcp` and `/v1/chat/completions` surfaces.
  Injects `_origin.provider = 'perplexity'` and `selfRouting` metadata so the
  council can enforce the self-routing policy without any changes to the
  AI Collaboration codebase.
- `perplexity-plugin/perplexity.test.js` — Regression tests: tool-list parity,
  no-argument rule, forbidden-tool exclusion, config-gate enforcement, and
  self-routing default.

### Not changed

- `chatgpt-mcp/server.js` — **unchanged**
- `chatgpt-mcp/stdio.js` — **unchanged**
- `chatgpt-mcp/server.test.js` — **unchanged**
- `chatgpt-mcp/stdio.test.js` — **unchanged**
- Canonical governance on `main` — **unchanged**
- Crucible learning/research search path — **unchanged and not exposed to Perplexity**

### Policy decisions recorded

- `PERPLEXITY_SELF_ROUTING=exclude_origin_provider` is the enforced default.
  Perplexity-originated AI Collaboration council requests will not include the
  Perplexity provider to prevent circular self-corroboration.
- AI Collaboration integration is **config-gated**: the adapter is a no-op
  unless `AI_COLLABORATION_BASE_URL` is explicitly set.
- Perplexity connects to the existing `chatgpt-mcp` HTTPS `/mcp` endpoint.
  No new MCP server or RPC implementation was created.
