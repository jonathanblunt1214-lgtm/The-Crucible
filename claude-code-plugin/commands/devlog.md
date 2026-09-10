---
name: devlog
description: Add a compliant chain-of-custody entry to DEVLOG.md, following the current archive and pruning policy.
---

# Crucible DEVLOG entry

`DEVLOG.md` is a chain of custody whose required shape is enforced
mechanically. Do not write the entry from a remembered template.

## Read first

- `AGENTS.md` — the `DEVLOG.md` chain-of-custody and `Command log archive`
  sections define the required heading fields, the mandatory plain-language
  summary, the per-command record, the archive bounds, and the pruning and
  archival rules.
- `src/handoffPolicy.js` — `validateDevlogChainOfCustody` is the authority on
  what actually passes. Its exported helpers
  (`devlogPruneSnapshot`, `effectiveDevlogPrunedCapacity`,
  `appendToDevlogPrunedLedger`, `prunedDevlogEntries`) exist so pruning and
  archival are done mechanically rather than by hand — use them.
- `AI-HANDOFF.json` — the `activePlan` and `sessionPolicy` fields this unit of
  work must also update.

Match the format of the existing newest entry in `DEVLOG.md` rather than
reproducing a format from memory.

## In the same unit of work

1. Add the new entry in the position the policy requires.
2. Update `## Shared AI handoff` per its stated purpose — reference the dev
   plan rather than restating it.
3. Update `AI-HANDOFF.json`'s `activePlan` and `sessionPolicy.lastActionAt`.
4. If the archive bounds force a prune, perform it here, and archive what was
   pruned exactly as `AGENTS.md` specifies, using the helpers above.

The `Archive` branch is pull-only apart from the single narrow exception
`AGENTS.md` describes. Read that section before touching it, and stay within
it.

Do not reconstruct history that predates the ledger by inferring it from git
history.

## Verify

Run `npm run audit:handoff` and report its real exit status.
