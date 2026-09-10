# ChatGPT MCP adapter

This directory adds a ChatGPT-compatible MCP endpoint to the existing `Plug-in` branch without changing the Nexus plugin runtime contract.

## Run

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

## ChatGPT connection

Deploy this branch to an HTTPS-capable Node host, start it with `npm run mcp`, and register the public MCP endpoint ending in `/mcp` as a custom ChatGPT app/connector. The health endpoint can be used to verify the deployment before registration.

## Test

```bash
npm run test:mcp
npm test
npm run verify
```

Shared Crucible governance remains canonical on the repository `main` branch, consistent with this plugin branch's existing canonical-source rule.
