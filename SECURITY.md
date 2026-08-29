# Security

The plugin is intentionally narrow.

It does not execute shell commands, spawn processes, write Git history, access secrets, or request network authority. Its write surface is limited by plugin logic to text paths under `governingDocuments/`, and destructive operations require explicit confirmation.

Auto Inject is off by default. When explicitly selected and confirmed, it writes only `governingDocuments/CRUCIBLE-REFERENCES.json`, which contains non-secret links to canonical shared governance on The Crucible's default branch. It does not copy the canonical policy files themselves.

Nexus remains responsible for plugin malware screening, capability enforcement, workspace path containment, and enable/disable state.

Scientific-learning records are project-isolated under `governingDocuments/.crucible-learning/<projectId>/` and use strict allow-list schemas. Unknown fields, cross-project identities, forbidden state transitions, correlation-only claims, non-independent verification, property/boundary drift, missing gates, and prohibited promotion kinds fail closed. Contradictions quarantine instead of overwriting active knowledge, and prior verified versions remain rollbackable.

Telemetry is explicitly non-evidentiary and cannot satisfy any learning gate. Weekly transport uses sandboxed Web Crypto for trusted RS256 OIDC verification, HKDF-SHA256 project-key derivation, and AES-256-GCM. The master key is ephemeral action input only: it is never persisted in the workspace or emitted through telemetry. Issuer, audience, repository, ref, project, short token lifetime, week, OIDC subject, ciphertext, and authentication-tag mismatches all fail closed.
