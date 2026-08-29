# Plugin-branch agent instructions

This `Plug-in` branch intentionally contains only Nexus-plugin-related material.

Shared repository governance is canonical on the default `main` branch. Before modifying this branch, read and follow the current versions of `AGENTS.md`, `DEVLOG.md`, `AI-HANDOFF.json`, `AI-CONFLICTS.json`, and every governing document named by `main:AI-HANDOFF.json` from the `main` branch rather than copying those files here.

Branch-specific implementation and release information belongs in this branch's plugin README, host contract, security document, changelog, tests, scripts, and workflow. Do not copy Crucible core source, core workflows, shared governance documents, or other default-branch material into this branch merely to make it locally self-contained; reference or check out `main` when shared material is needed.

The owner explicitly designated `Plug-in` for plugin work. Do not promote or alter `main` or `release` without a separate explicit owner instruction.
