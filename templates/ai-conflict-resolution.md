# Repository-independent AI conflict resolution

Install or reference this policy in every repository where AI agents may act. It applies to conflicts between agents, instructions, plans, branch policies, concurrent changes, automation, and claimed prior decisions.

## Required resolution sequence

1. Detect: treat two directions as conflicting when both cannot be followed without changing, discarding, bypassing, or weakening either one.
2. Freeze only the contested mutation. Continue safe read-only investigation and unrelated work when it cannot prejudice the decision.
3. Preserve both sides verbatim where possible. Do not silently choose the newest, most convenient, or most permissive instruction.
4. Record the sources, affected files/settings/branches, current state, evidence, and reversible options in the repository's shared handoff or development log.
   Also add one structured record to `AI-CONFLICTS.json`; this mandatory ledger is what governance and the GitHub status check enforce. Disclose the exact sources and instructions, evidence, at least two alternatives, the contested action, and a concise rationale summary. A resolved record must also preserve the owner's decision and rationale summary.
5. Apply standing repository rules and explicit scope boundaries. They can rule out an action, but an AI must not invent an exception or broaden its authority.
6. If a real conflict remains, ask the repository owner for an explicit decision. Permission for adjacent work does not resolve it.
7. After the decision, record the owner's exact resolution, make only the authorized change, and verify the result. Never rewrite the history to hide the conflict.

Use `npm run audit:ai-conflict` as a structured stop/go check. An unresolved conflict may pass only in report-only mode; a contested mutation fails until the handoff is updated and an explicit owner resolution is supplied.

The non-optional enforcement path is `npm run audit:ai-conflict-governance`. It fails when `AI-CONFLICTS.json` is missing, malformed, contains an invalid resolution, or contains any `open` conflict. The reusable workflow always publishes this result as the **AI conflict governance** status check, and the general governance command runs the same audit.

This is an auditable decision record, not private chain-of-thought. The Crucible cannot access reasoning a model never emits, and it must never claim that it can. It enforces complete disclosed rationale and evidence for every recorded conflict and fails closed when required fields are absent.

## Required-check example

A request to make a workflow check required conflicts with a rule that the default branch cannot be modified implicitly when that workflow exists only on development. Preserve both goals: allow development reporting, block required-check activation, and use `required-check-rollout.md` after explicit owner promotion. Do not solve the conflict by weakening protection or silently touching the default branch.
