---
name: handoff
description: Read The Crucible's shared AI handoff and every governing document, then report current state before doing any work.
---

# Crucible handoff read

`AGENTS.md` requires this before *any* action in this repository — answering a
question, changing code, checking CI, anything — and it applies every time, not
just once per session.

Do this in order:

1. Read `DEVLOG.md`'s **`## Shared AI handoff`** section in full.
2. Read `AI-HANDOFF.json` and enumerate its top-level `governingDocuments`
   object. Read **every file it lists**. Entries of the form `Branch:Path`
   (for example `Archive:Devlog-Pruned`) name a file on that branch, not a
   path on the default branch — do not expand them as local files.
3. Read `AI-HANDOFF.json`'s `activePlan`: `currentPrompt` is the verbatim
   request driving current work; `handoffNotes.completed` and
   `handoffNotes.remaining` are what is done and what is left.
4. Check `sessionPolicy.lastActionAt`. If more than 10 minutes have passed
   since it, treat this as a fresh session and re-read everything above —
   branch policy, PR locks, and handoff state can change while idle.
5. Read `AI-CONFLICTS.json` and report any open conflict.

Then report, concisely:

- the current step actually in progress, per the dev plan
- which files it touches and their verification status
- what remains
- any open conflict, PR lock, or governance constraint that limits what may
  be done next (branch policy in particular: `development` is the only branch
  to develop on unless the owner named another in that exact request; `main`
  is never pushed to directly; promotions go through `release`)

Do not begin implementation work in this command. Report state only.
