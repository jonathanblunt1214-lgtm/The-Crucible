# Security policy — Nexus plugin

## Supported version

The first development release is `0.0.1`. Until a later stable version is declared, only the current `Plug-in` branch tip is supported.

## Trust boundaries

The plugin runtime is treated as untrusted by Nexus. The plugin requests only the capabilities declared in `nexus.plugin.json`; Nexus must independently enforce project authorization, path confinement, account ownership, package screening, signatures, and lifecycle state.

The runtime entry intentionally has no Node `require`, `process`, shell execution, Git write, unrestricted network, or secret-store capability. Governance mutations are limited by plugin-side path guards to `governingDocuments/`, and the host must enforce the same boundary independently.

Auto Inject is disabled by default, requires explicit selection and confirmation, defaults to no overwrite, and requires authenticated account-private tracking before mutation begins.

## Private tracking

Injection history contains only bounded metadata: version, timestamp, action, project reference, and file paths. It must never contain governance file contents, credentials, tokens, signing keys, personal secrets, or raw account credentials. Nexus must isolate records by authenticated account and plugin namespace.

## Signing

Source manifests are reviewable and unsigned. Release signing uses `NEXUS_PLUGIN_SIGNING_KEY_PEM` only in a protected release environment. Never commit or log the private key. Compromise of a signing key requires revocation/rotation in Nexus's trusted-key configuration and a new plugin release.

## Reporting

Report plugin security defects through the repository's normal private/security reporting channel when available. Do not post live credentials, private signing material, or exploitable account data in a public issue.
