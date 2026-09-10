---
name: audit
description: Run a specific Crucible audit gate, or list every available audit and what it enforces.
argument-hint: "[clutter|privacy|security|github-security|collisions|handoff|governance|authenticity|reproducibility|core-ref|design-brief|required-check|reference-branches|ai-conflict|all]"
---

# Crucible audit gate

Requested gate: **$ARGUMENTS**

If no gate was given, list the available gates below with a one-line
description each, then stop and ask which to run.

| Gate | Command |
| --- | --- |
| clutter | `npm run audit:clutter` |
| privacy | `npm run audit:privacy` |
| security | `npm run audit:security` |
| github-security | `npm run audit:github-security` |
| collisions | `npm run audit:collisions` |
| handoff | `npm run audit:handoff` |
| governance | `npm run audit:governance` |
| authenticity | `npm run audit:authenticity` |
| reproducibility | `npm run audit:reproducibility` |
| core-ref | `npm run audit:core-ref` |
| design-brief | `npm run audit:design-brief` |
| required-check | `npm run audit:required-check` |
| reference-branches | `npm run audit:reference-branches` |
| ai-conflict | `npm run audit:ai-conflict` and `npm run audit:ai-conflict-governance` |
| all | every gate above, each reported separately |

Run the requested gate and report its real exit status and output.

Hard boundaries, regardless of what the gate reports:

- Never disable, bypass, weaken, or exclude a gate, its workflow, or
  `AI-CONFLICTS.json` to make a run pass. If a gate is wrong, that is a
  finding to raise, not a thing to route around.
- `audit:required-check` governs required-check rollout. Reporting on
  `development` is allowed; activating a check in branch protection requires
  explicit promotion to the default branch first. A report-mode pass is not
  promotion and not authorization.
- Fix the cause in source. Do not edit a ledger or baseline to silence a
  finding.
