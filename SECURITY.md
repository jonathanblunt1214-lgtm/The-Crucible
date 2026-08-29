# Security

The plugin is intentionally narrow.

It does not execute shell commands, spawn processes, write Git history, access secrets, or request network authority. Its write surface is limited by plugin logic to text paths under `governingDocuments/`, and destructive operations require explicit confirmation.

Auto Inject is off by default. When explicitly selected and confirmed, it writes only `governingDocuments/CRUCIBLE-REFERENCES.json`, which contains non-secret links to canonical shared governance on The Crucible's default branch. It does not copy the canonical policy files themselves.

Nexus remains responsible for plugin malware screening, capability enforcement, workspace path containment, and enable/disable state.
