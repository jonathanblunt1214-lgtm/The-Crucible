---
name: handoff
description: Perform the required Crucible handoff read from the canonical governing documents, then report current state.
---

# Crucible handoff read

Do not act on any remembered version of this repository's policy. Read the
current canonical documents and follow whatever they say now.

## Read, in this order

1. `AGENTS.md` — in particular its sections on reading `DEVLOG.md` first,
   rechecking governing documents, and branch policy.
2. `DEVLOG.md` — the `## Shared AI handoff` section.
3. `AI-HANDOFF.json` — enumerate the top-level `governingDocuments` object and
   read **every** file it names. A key of the form `Branch:Path` names a file
   on that branch, not a path here.
4. `AI-HANDOFF.json` — `activePlan` and `sessionPolicy`.
5. `AI-CONFLICTS.json`.

The default `main` branch is canonical for shared governance. If the checkout
you are in disagrees with `main`, say so rather than assuming either side.

## Then report

- the current step actually in progress, per `activePlan`
- files touched and their verification status
- what remains, per `handoffNotes.remaining`
- any open conflict, lock, or constraint limiting what may be done next, as
  those documents currently define it

Apply the staleness rule exactly as `AGENTS.md` states it, using
`sessionPolicy.lastActionAt`.

Report state only. Do not begin implementation in this command.
