# Instructions for AI agents on `development`

Canonical repository governance lives on the default branch (`main`) and is not duplicated here by design.

Before acting on `development`, read the canonical policy from:
- `main:AGENTS.md`
- `main:AI-HANDOFF.json`
- every path listed by `main:AI-HANDOFF.json` under `governingDocuments`

Then read the branch-local mutation state that must remain local to `development` when it diverges from `main`:
- `AI-HANDOFF.json`
- `DEVLOG.md`
- `AI-CONFLICTS.json`

If this branch is currently at the same commit as `main`, the canonical files are already the exact same Git objects and no extra copy is created by Git. Do not replace executable source, workflows, schemas, tests, package metadata, or runtime configuration with cross-branch text references; those files must remain present in the checked-out tree for local tools, CI, validation, and promotion semantics to work.

The canonical `main:AGENTS.md` branch policy remains authoritative, including: develop only on `development` unless the owner explicitly names another branch; never mutate `main` directly; preserve concurrent work; keep AI handoff/conflict chain of custody current when creating new development commits; and never weaken required gates merely to remove duplication.
