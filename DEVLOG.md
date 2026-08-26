# Development log

This log reflects exactly what has happened on **this branch** (`Archive`), commit by commit, oldest first within each day. It is generated from real git history, not a narrative summary.

**This branch is a pull-only historical reference, not active development.** Every commit unique to it was already ported into `development` before it was archived here (see `development`'s own `DEVLOG.md`, the "Port engine-code scan and expanded spyware coverage from claude/github-connection-zvp5z9" entry). Nothing on this branch is needed to operate The Crucible; it is kept only in case something in it is useful for a future feature. It should not be pushed to, merged from, or built on without the repository owner explicitly saying so.

## History shared with `main` (2026-08-24)

Same as `main`'s own history up to `dac3a4c` — see `main`'s `DEVLOG.md` for that list.

## Unique to this branch (2026-08-26, before archival)

- `1af0700` Add CodeQL analysis and a GitHub repository security settings gate
- `a85e069` Require administration:read on the linking repository, fix false-disabled detection
- `ebbf6a2` Add a troubleshooting guide and actionable fix messages to the security gate
- `ca13d8b` Fix win32 npm-CLI path resolution to use path.win32 explicitly
- `4a32e43` Add an internal repair system scoped only to this engine's own repository
- `456c31b` Fix outage: administration is not a valid Actions permissions key
- `fd9df14` Fix a real Privacy Gate finding: avoid a literal email in test fixture
- `891d7a6` Add agent-boundaries.md: explicit AI-agent rules for the Crucible link
- `a72cb1b` State outright in agent-boundaries.md that the link is one-way
- `f6f3e67` Reverse ownership framing: installed-to-run-Crucible files belong to Crucible
- `7bca25a` State outright that access to The Crucible is one-shot and severed after use
- `36e36d7` Add a one-time, self-revoking connect workflow to install the design brief
- `8cf6b05` Sever the link if the installed design brief is deleted, with a loud notice
- `6f1a7f8` Add pinned-commit integrity verification and connection-point input validation
- `5a5d227` Scan the checked-out engine code itself, and harden repair.js's own guard *(this branch's tip)*
