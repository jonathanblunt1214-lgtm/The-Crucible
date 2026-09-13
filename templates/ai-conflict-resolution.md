# Repository-independent AI conflict resolution

Install or reference this policy in every repository where AI agents may act. It applies to conflicts between agents, instructions, plans, branch policies, concurrent changes, automation, claimed prior decisions, and injected governance.

For every future Crucible injection, the injected governance and the receiving project's native governance are assimilated as one unified native governing body. `AI-HANDOFF` is that governing body's shared coordination state and `AI-CONFLICTS` is its internal conflict ledger. All authorized agents work together from that shared state going forward.

No agent may invent a hierarchy among components of the unified governing body merely to avoid a real conflict. Injected governance is not subordinate solely because it arrived later, and pre-existing governance does not automatically override injected governance solely because it existed first. A genuine conflict that cannot be reconciled must be preserved and resolved through the procedure below.

## Required resolution sequence

1. Detect: treat two directions as conflicting when both cannot be followed without changing, discarding, bypassing, or weakening either one.
2. Freeze only the contested mutation. Continue safe read-only investigation and unrelated work when it cannot prejudice the decision.
3. Preserve both sides verbatim where possible. Do not silently choose the newest, oldest, most convenient, or most permissive instruction.
4. Record the sources, affected files/settings/branches, current state, evidence, and reversible options in the repository's shared handoff or development log. Also add one structured record to `AI-CONFLICTS.json`; this mandatory ledger is what governance and the GitHub status check enforce. Disclose the exact sources and instructions, evidence, at least two alternatives, the contested action, and a concise rationale summary. A resolved record must also preserve the owner's decision and rationale summary.
5. Apply the unified governing body's explicit scope and branch boundaries. They can rule out an action, but an AI must not invent an exception or broaden its authority.
6. Preserve the universal development-first chain for all tracked mutations: `task/change branch -> designated development branch -> required security/CI/governance/integrity gates -> required review/OWNER approval -> production branch`. Conflict resolution never authorizes bypassing that chain.
7. If a real conflict remains, ask the repository OWNER or designated native deciding authority for an explicit decision. Permission for adjacent work does not resolve it.
8. After the decision, record the exact resolution, make only the authorized change, and verify the result. Never rewrite history to hide the conflict.

Use `npm run audit:ai-conflict` as a structured stop/go check. An unresolved conflict may pass only in report-only mode; a contested mutation fails until the handoff is updated and an explicit owner resolution is supplied.

The non-optional enforcement path is `npm run audit:ai-conflict-governance`. It fails when `AI-CONFLICTS.json` is missing, malformed, contains an invalid resolution, or contains any `open` conflict. The reusable workflow always publishes this result as the **AI conflict governance** status check, and the general governance command runs the same audit.

This is an auditable decision record, not private chain-of-thought. The Crucible cannot access reasoning a model never emits, and it must never claim that it can. It enforces complete disclosed rationale and evidence for every recorded conflict and fails closed when required fields are absent.

## Required-check example

A request to make a workflow check required conflicts with a rule that the production branch cannot be modified implicitly when that workflow exists only on development. Preserve both goals: allow development reporting, block required-check activation, and use `required-check-rollout.md` after explicit OWNER promotion. Do not solve the conflict by weakening protection, skipping development, or silently touching production.

## Multi-AI deliberation, corroboration, and mutation ownership

Record the disagreement in `AI-CONFLICTS.json`. Do not create a separate
deliberation file - `AI-DELIBERATION.json` does not exist and is not required.

Each conflict record may carry a `deliberation` block:

- `proposals[]` - competing implementations, each with `provider` and `evidence`.
- `positions[]` - each AI's stance on the open technical question.
- `responses[]` - other AIs answering a proposal, with `stance` one of
  `corroborates`, `disputes`, `partial`, `abstains`.
- `corroboration` - the outcome: `consensus`, `partial-agreement`,
  `unresolved-conflict`, `insufficient-evidence`, or `test-verified`, with a
  `rationaleSummary`. `unresolved-conflict` must set `escalatedToOwner: true`.

`consensus` requires at least two independent positions, and no AI may set
`ownerApproved`. Cross-model agreement is evidence, not proof.

Add `contestedScope` naming the paths or code regions the conflict freezes.
The freeze is narrow on purpose: only the contested mutation stops. Read-only
investigation, testing and review continue everywhere, and unrelated scopes
keep moving.

Mutation ownership is separate from the argument. It lives in
`AI-HANDOFF.json` `mutationClaims` and changes only by explicit release or
handoff. An AI whose proposal is accepted has not thereby acquired the right to
write the file; the current owner may implement it. Run
`npm run audit:coordination` to check ownership, DEVLOG accountability, and
that no provider credential has reached a governance artifact.
