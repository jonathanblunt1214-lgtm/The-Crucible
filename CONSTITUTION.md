# The Crucible Operational Constitution

The mandates below bind every Crucible run, worker, organ, and AI participant. They are
not aspirations. Each one is already enforced somewhere in this repository by a gate, a
test, or a refusal, and a change that weakens one is a governance change requiring the
owner's explicit decision.

## Core mandates

- Evidence Over Assertion: executable evidence outranks AI opinion, agreement, repetition, ranking, or consensus. Cross-model agreement is evidence, never proof.
- Fail Closed: missing, unreachable, or unverifiable evidence is indeterminate. Absence of a result is never permission to proceed.
- No Self-Approval: no AI declares its own work approved, and no AI is the only reviewer of its own material change.
- Proof Before Behaviour: candidate evidence cannot change behaviour until every causal, control, independent-verification, negative, regression, scope, boundary, generalization, and contradiction gate passes.
- Distinct Identities: detection, planning, execution, independent verification, and rollback never share an identity.
- Reversible Change: every applied change declares a rollback plan and returns rollback custody. Failed verification restores the exact original content.
- Exclusive Mutation: discussion is shared; mutation is exclusive. Any AI may read, test, review, critique, and propose against any scope; exactly one may mutate it, and only while holding an active claim.
- Chain Of Custody: every project change moves `DEVLOG.md` and `AI-HANDOFF.json` together, in the same commit.
- Truthful Records: a gate is never recorded as passed on evidence that did not prove it, and a refused or unstarted run carries no verdict in either direction.
- Coded Failure: every failure path carries a failure code and leaves a record the diagnostic organ can read. Silence is a defect, not a pass.
- Organ Accountability: every production module is assigned an organ, communicates through the project-bound typed signal bus, and reports healthy, degraded, inhibited, quarantined, or unavailable with its exact missing dependency.
- Project Independence: adopting projects keep their own identity, governance, and scope. The Crucible copies no application code between repositories and holds no project-content write access; its only recurring write permission is `issues: write`.
- Selective Membrane: the operator machine, GitHub, and external AI services are execution hosts, not Crucible organs or learning sources. GPU and ChatGPT egress require owner-signed permission plus an offline hard stop.
- Credential Isolation: credentials come only from environment variables or repository secrets, never from source, committed prompts, governance records, or workflow logs.
- Promotion Boundary: `development` holds unproven work and `main` holds proven state. Promotion runs through `release`, and no AI and no council authorizes it.
- Owner Decisions Stand: conflicts between agents, instructions, or claimed authority freeze the contested mutation and preserve both sides until the owner decides. No agent silently picks a side.

## Withheld powers

The Crucible does not silently delete clutter, automatically fix application code, upload
project source elsewhere, collect telemetry, read unrelated repositories, expose
repository secrets, modify branch protection, approve pull requests, or publish releases.
An adopting-project failure is reported and surfaced as an issue; it is never staged,
committed, pushed, or repaired on that project's behalf. Internal recovery is the one
exception, and it reaches only The Crucible's own repository.

## Amendment

This document changes only by an owner decision recorded in `DEVLOG.md` and
`AI-HANDOFF.json`. An agent may propose an amendment and must not enact one. A mandate
removed or weakened without that record is void, and any run may treat the prior text as
authoritative.
