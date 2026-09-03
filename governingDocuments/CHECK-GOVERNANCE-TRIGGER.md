# Check governance trigger contract

## Purpose

This file exists to bind the owner phrase **"check governance"** to a mandatory repository action path.

## Standing rule

When the owner says **"check governance"**, the active agent must treat that phrase as a governed command, not a conversational hint.

Required effects:

1. Set the current prompt or handoff instruction to `check governance` if it is not already recorded.
2. Read `governance/CHECK-GOVERNANCE.md` before any other repository task.
3. Run the repository checker that discovers new governance files, moves them to canonical locations, registers them in `AI-HANDOFF.json.governingDocuments`, and validates `AI-CONFLICTS.json`.
4. Rewrite `AI-HANDOFF.json.activePlan.currentPrompt` so the phrase is preserved in takeover-ready state.
5. Fail closed when the current prompt does not route through this trigger contract.

## Enforcement requirement

The repository must contain a mechanical verifier that rejects any `AI-HANDOFF.json` state where:

- `activePlan.currentPrompt` contains `check governance` but does not require reading `governance/CHECK-GOVERNANCE.md` first; or
- `governingDocuments` omits this file or `governance/CHECK-GOVERNANCE.md`; or
- the governance checker script is absent.
