# CHECK GOVERNANCE

When the owner says **"check governance"**, do this before any other work:

1. Read this entire `governance/` directory first.
2. If any file in `governance/` is not already listed in `AI-HANDOFF.json.governingDocuments`, add it there before continuing.
3. If any file in `governance/` belongs in a canonical governance location, move it there and update every reference atomically in the same change.
4. Read `AGENTS.md`, `AI-CONFLICTS.json`, `DEVLOG.md`, and every file listed in `AI-HANDOFF.json.governingDocuments` in their entirety.
5. Validate `AI-CONFLICTS.json`.
6. If any conflict is `active`, do conflict work first. Do not begin unrelated new work until the conflicts are corrected or explicitly marked owner-blocked in the ledger itself.
7. Fail closed if any governance file is unreadable, untracked, misplaced, or inconsistent with `AI-HANDOFF.json`.

## Required interpretation

The phrase **"check governance"** is an instruction to:

- detect newly dropped governance files,
- move them to their proper locations when needed,
- register them in `AI-HANDOFF.json.governingDocuments`,
- reread the full governance set,
- and block unrelated work until governance and conflicts are clean.

This instruction takes priority over planning, coding, review, implementation, and status reporting.
