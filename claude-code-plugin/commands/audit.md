---
name: audit
description: Run a specific Crucible audit gate, or list every available audit.
argument-hint: "[clutter|privacy|security|github-security|collisions|handoff|governance|authenticity|reproducibility|core-ref|design-brief|required-check|reference-branches|ai-conflict|all]"
---

# Crucible audit gate

Requested gate: **$ARGUMENTS**

If no gate was given, list the gates below and stop, asking which to run.

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
| ai-conflict | `npm run audit:ai-conflict`, `npm run audit:ai-conflict-governance` |
| all | every gate above, reported separately |

Treat `package.json`'s `scripts` as authoritative if it disagrees with this
table.

Run the gate and report its real exit status and output.

What a gate enforces, and what may or may not be done about a finding, is
defined by that gate's own module and the governing documents named in
`AI-HANDOFF.json` — read them rather than inferring. For required-check
activation specifically, follow `templates/required-check-rollout.md` and
`AGENTS.md` as they currently stand.
