---
name: devlog
description: Add a compliant chain-of-custody session entry to DEVLOG.md, pruning and archiving per policy.
---

# Crucible DEVLOG entry

`DEVLOG.md` is a chain of custody, mechanically enforced by
`validateDevlogChainOfCustody` in `src/handoffPolicy.js`. Write the entry to
satisfy the validator, not just to look right.

## Required shape

The newest entry goes **first** under `## Command log archive`:

```
### Session: <short label> — <ISO timestamp> — <agent> — mode:<regular/default|work>

Plain-language summary: <one or two plain-English sentences>
- `command` — started TIMESTAMP, finished TIMESTAMP, exit CODE
```

Mandatory, each independently enforced:

- The heading's `mode:` field. Execution mode is part of the chain of custody.
- The `Plain-language summary:` line on the newest entry — a short,
  non-technical recap a human can skim without parsing commands or SHAs. It
  sits *alongside* the command list, never instead of it.
- Every command with a real effect for the session — tests, audits, lint, git
  operations — each with a start time, a finish time, and its exit code.

## Also required in the same unit of work

1. Update `## Shared AI handoff` to point at `AI-HANDOFF.json`'s `activePlan`
   rather than restating the plan.
2. Update `AI-HANDOFF.json`'s `activePlan` and
   `sessionPolicy.lastActionAt` (current time) in any commit touching it.
3. **Pruning:** the archive is capped at the 10 most recent sessions *and* a
   180-day limit, whichever forces a prune first. If this entry pushes past
   either bound, prune the offending entries in this same commit.
4. **Archive every prune.** A pruned entry must also be appended to
   `Devlog-Pruned` on the `Archive` branch, as a full DEVLOG.md snapshot led
   by a plain-language summary — not an excerpt. Use
   `src/handoffPolicy.js`'s `devlogPruneSnapshot`,
   `effectiveDevlogPrunedCapacity`, and `appendToDevlogPrunedLedger` to do
   this mechanically rather than by hand.

`Archive` is otherwise pull-only. Appending pruned DEVLOG sessions to that one
file is the single standing owner-authorized exception: a normal, visible
commit touching only `Devlog-Pruned`. Never force-push, rebase, or modify
anything else on `Archive`.

Do not backfill entries pruned before the ledger existed by guessing from git
history — this repository has concurrent edits from multiple agents, and a
heuristic reconstruction would fabricate an authoritative record. Such history
stays retrievable via `git log -p DEVLOG.md`.

Finally, run `npm run audit:handoff` and report its real exit status.
