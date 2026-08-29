# Changelog

## 0.0.1

- Initial standalone Nexus plugin package.
- Plugin files live at the `Plug-in` branch root.
- Shared Crucible governance is referenced from the canonical default `main` branch instead of duplicated.
- Auto Inject writes one reference manifest only and remains opt-in with confirmation.
- Project-specific governance is managed as a local overlay under `governingDocuments/`.
- Runtime capability set is limited to Nexus UI slots, project workspace read/write, and telemetry.
