# Changelog

## 0.2.0

- Added Web Crypto weekly transport with trusted RS256 OIDC verification, HKDF-SHA256 project-key derivation, AES-256-GCM authenticated encryption, exact identity/envelope binding, and no master-key persistence.
- Added hosted parity verification against canonical `main` states, mandatory gates, and prohibited-promotion kinds.

## 0.1.0

- Added project-isolated candidate-evidence and verified-knowledge stores.
- Added separate fail-closed hypothesis, controlled-experiment, causal-confirmation, independent-verification, promotion, retrieval, quarantine/rejection, and rollback actions.
- Prevented raw telemetry, correlation, retrieval, repetition, guesses, incomplete observations, untested hypotheses, and one-off repairs from promotion.
- Added exact claim/boundary enforcement, contradiction quarantine, versioned knowledge, proof digests, and rollback.
- Kept telemetry explicitly non-evidentiary and weekly transport fail-closed while no trusted plugin transport was present.

## 0.0.1

- Initial standalone Nexus plugin package.
- Plugin files live at the `Plug-in` branch root.
- Shared Crucible governance is referenced from the canonical default `main` branch instead of duplicated.
- Auto Inject writes one reference manifest only and remains opt-in with confirmation.
- Project-specific governance is managed as a local overlay under `governingDocuments/`.
- Runtime capability set is limited to Nexus UI slots, project workspace read/write, and telemetry.
