# Host contract

This plugin targets Nexus plugin API version 1 and uses only capabilities currently allowed by Nexus manifests:

- `ui:slot`
- `workspace:read`
- `workspace:write`
- `telemetry:emit`

The plugin contributes `project-actions`, `inspector-panel`, and `command-palette` slots.

## Workspace calls

The plugin expects the Nexus host to provide bounded project-workspace operations through the generic capability handlers:

- `workspace:read` with `operation: "list"` or `operation: "read"`.
- `workspace:write` with `operation: "write"`, `operation: "move"`, or `operation: "delete"`.

All plugin-managed paths are restricted to `governingDocuments/`. Destructive operations require an explicit confirmation flag at the plugin boundary.

Scientific-learning records are stored as project-isolated JSON documents below `governingDocuments/.crucible-learning/<projectId>/`. The host must preserve the plugin's bounded `workspace:read` and `workspace:write` semantics; the plugin does not require process, Git, secret, or network capabilities.

The learning action contract is fail-closed and stage-specific: ingest candidate, declare hypothesis, record experiment, confirm causal isolation, independently verify, promote, retrieve, quarantine/reject, and roll back. A caller cannot use one action's input production to satisfy a later stage. Telemetry emitted for these actions has `evidentiary: false` and is outside the learning stores.

The Nexus runtime must expose standard Web Crypto (`globalThis.crypto.subtle` plus `getRandomValues`), `TextEncoder`/`TextDecoder`, and `atob`/`btoa`. Weekly transport uses RS256 OIDC verification, HKDF-SHA256, and AES-256-GCM through those sandbox primitives. The caller supplies the master key only as ephemeral action input; the plugin never writes or emits it. Exact identity and envelope bindings fail closed.

The canonical compatibility job checks the plugin's state list, mandatory gates, and prohibited-promotion kinds against `main:src/scientificLearning.js` on every plugin push.

## Shared references

Canonical Crucible policies are referenced from the default `main` branch of `jonathanblunt1214-lgtm/The-Crucible`. The plugin deliberately does not need a network capability because it does not download or embed those shared files. Nexus may open the returned GitHub references for the user through its normal host UI.
