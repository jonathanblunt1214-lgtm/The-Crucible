# Security

The plugin is intentionally narrow.

The Nexus runtime does not execute shell commands, spawn processes, write Git
history, access secrets, or request network authority. Its write surface is
limited by plugin logic to text paths under `governingDocuments/`, and
destructive operations require explicit confirmation.

The separate ChatGPT MCP transport is part of this plugin package but is not part
of the Nexus sandbox. HTTP requests require a deployment-specific bearer token;
the listener fails closed when it is absent. Execution tools accept no request
arguments or paths. They invoke only an allow-listed action through Node against
fixed, resolved `CRUCIBLE_CORE_ROOT` and `CRUCIBLE_PROJECT_ROOT` directories, with
bounded output, timeout, and concurrency. The adapter bearer token is removed
from the spawned CLI environment. `security`, `run`, and `repair` remain
disabled unless the deployment owner explicitly enables mutation-capable tools.
The adapter does not copy the core engine onto `Plug-in` and does not provide
arbitrary command, shell, Git, secret, or network primitives.

Auto Inject is off by default. When explicitly selected and confirmed, it writes only `governingDocuments/CRUCIBLE-REFERENCES.json`, which contains non-secret links to canonical shared governance on The Crucible's default branch. It does not copy the canonical policy files themselves.

Nexus remains responsible for plugin malware screening, capability enforcement, workspace path containment, and enable/disable state.

Scientific-learning records are project-isolated under `governingDocuments/.crucible-learning/<projectId>/` and use strict allow-list schemas. No candidate evidence or learning mutation is accepted until one-time setup validates the project ID, trusted public OIDC policy, exact OIDC subject, and ephemeral-key commitment. Unknown fields, cross-project identities, forbidden state transitions, correlation-only claims, non-independent verification, property/boundary drift, missing gates, and prohibited promotion kinds fail closed. Contradictions quarantine instead of overwriting active knowledge, and prior verified versions remain rollbackable.

Telemetry is explicitly non-evidentiary and cannot satisfy any learning gate. Weekly transport uses sandboxed Web Crypto for trusted RS256 OIDC verification, HKDF-SHA256 project-key derivation, and AES-256-GCM. The master key is ephemeral action input only: it is never persisted in the workspace or emitted through telemetry. Only its SHA-256 commitment is stored, and later transport calls fail unless the supplied key matches it. Stored trusted OIDC configuration—not caller-replaced trust data—controls later verification. Issuer, audience, repository, ref, project, short token lifetime, week, OIDC subject, ciphertext, and authentication-tag mismatches all fail closed.
