# ChatGPT MCP integration

The Crucible includes a small, dependency-free MCP HTTP server that exposes a bounded set of Crucible operations to ChatGPT custom apps.

## Exposed tools

- `crucible_validate` — validates the configured Crucible project.
- `crucible_precheck` — runs the Crucible pre-check.
- `crucible_governance` — runs configuration and AI-conflict governance.
- `crucible_security` — runs the security gate and may quarantine suspicious findings.
- `crucible_run` — runs the configured Crucible suite; enabled gates may safely modify or quarantine files.
- `crucible_repair` — runs Crucible's internal repair operation.

The MCP API does **not** accept arbitrary shell commands or arbitrary project paths. Every tool runs against the server's configured `CRUCIBLE_PROJECT_ROOT`.

## Start locally

```bash
npm run mcp
```

Defaults:

- MCP endpoint: `http://localhost:8787/mcp`
- Health endpoint: `http://localhost:8787/health`
- Project root: the process working directory

Environment variables:

- `PORT` — HTTP port. Default `8787`.
- `HOST` — bind host. Default `0.0.0.0`.
- `CRUCIBLE_PROJECT_ROOT` — only project root the MCP tools may operate against.
- `CRUCIBLE_MCP_TIMEOUT_MS` — maximum execution time per tool call.
- `CRUCIBLE_MCP_ALLOW_ORIGIN` — CORS origin. Default `*`; set this explicitly in production when possible.

Run the MCP-specific tests with:

```bash
npm run test:mcp
```

## Deploy

ChatGPT must be able to reach the MCP endpoint over HTTPS. Deploy the repository (or the target repository with The Crucible installed) to a host that can run Node.js 20+ and start:

```bash
npm run mcp
```

Set `CRUCIBLE_PROJECT_ROOT` to the repository working directory that Crucible is allowed to inspect. Do not expose a writable project root containing unrelated secrets.

The public MCP URL will be:

```text
https://YOUR_HOST/mcp
```

The health check is:

```text
https://YOUR_HOST/health
```

## Connect to ChatGPT

ChatGPT custom apps use MCP. In an eligible workspace/account with custom app or developer-mode access:

1. Open ChatGPT settings and go to **Apps**.
2. Enable developer/custom-app access if required by the workspace.
3. Create a custom app.
4. Enter the deployed HTTPS MCP endpoint, for example `https://YOUR_HOST/mcp`.
5. Use no authentication only for a private/protected deployment. For an Internet-accessible deployment, put an authenticated gateway or supported OAuth layer in front of the MCP server before connecting it.
6. Scan the tools and verify the six Crucible actions.
7. Save the app and test `crucible_validate` first.

The read/write hints are declared in the MCP tool metadata. Security, full-suite, and repair actions are intentionally marked as non-read-only because they can quarantine or change working files depending on Crucible configuration.

## Protocol compatibility

The server supports the classic `initialize` + `tools/list`/`tools/call` flow and the stateless `server/discover` flow used by newer MCP clients. It uses JSON responses over `POST /mcp` and does not require MCP sessions.

## Security boundaries

The MCP layer intentionally keeps a narrow boundary:

- no command parameter;
- no user-supplied filesystem path;
- fixed action allowlist;
- request-size and output-size limits;
- execution timeout;
- child process receives a fixed Crucible action;
- the project root is controlled only by server configuration.

If additional Crucible actions are exposed later, classify whether each action can mutate files and update its MCP annotations accordingly.
