# Changelog

All notable Nexus plugin changes are recorded here. The plugin follows semantic versioning independently from the core Crucible package.

## 0.0.1 — unreleased

- First Nexus plugin development release.
- Optional install/enable lifecycle; no default activation or injection.
- Explicit, confirmed Auto Inject with overwrite disabled by default.
- Full text-governance configuration contract for files under `governingDocuments/`: list, read, create, update, move, and delete.
- Account-private injection history; no project-visible injection ledger.
- Least-capability manifest with no shell, Git-write, unrestricted-network, or secret access.
- Deterministic package, verification, and protected-environment signing tooling.
- VM-level regression coverage and dedicated CI workflow for the `Plug-in` branch.
