# Universal Injection Chain of Command

This policy applies to every future Crucible governing-document injection into every receiving project. It is not specific to any one project. Each future injection package must carry this policy or a stricter receiving-project equivalent that preserves every requirement below.

## Unified native governing body

Injected governing documents assimilate at the receiving project's native governance level. They are not a temporary or subordinate sidecar after successful assimilation.

The receiving project's existing native governance and the injected governance are enforced together as one unified native governing body. AI-HANDOFF is the shared coordination state of that body. AI-CONFLICTS is its internal conflict ledger. All authorized agents work from that shared governing body and shared project state going forward.

No agent may invent a hierarchy among components of the unified governing body to avoid a genuine conflict. Unresolved internal conflicts must be preserved, recorded in AI-CONFLICTS, and routed to the OWNER or designated native deciding authority.

## Mandatory development-first path

Every tracked repository mutation must pass through the receiving project's designated development integration branch before production promotion.

Required path:

`task/change branch -> prerequisite verification -> designated development branch -> required security, CI, governance, and integrity gates -> required review and OWNER approval -> production branch`

This applies to all tracked changes, including application code, tests, documentation, governance, configuration, dependencies, lockfiles, workflows, generated artifacts, metadata, migrations, security changes, automation changes, AI handoff state, AI conflict records, and injection documents.

A normal task or change branch must not target production directly. Production promotion is valid only from the designated development integration branch after all required gates and approvals are satisfied.

There are no exceptions based on file type, urgency, simplicity, agent, automation, documentation, governance, security, or the fact that a change is itself an injection.

If the receiving project does not yet have a designated development integration branch, the injection must stop before any production mutation and report that missing prerequisite. The absence of a development branch never authorizes a direct production write.

## Prerequisite activation rule

Before any injected Crucible capability is activated as a required gate, every non-code prerequisite required by that capability must be positively verified under `governingDocuments/templates/injection-prerequisites.md`.

A missing or unverifiable prerequisite blocks assimilation or promotion at the prerequisite stage. It must not be converted into a downstream surprise required-check failure after activation.

## Mandatory gates

Required security, CI, governance, integrity, and review gates are part of the chain of command.

Agents must not bypass, suppress, disable, weaken, rename around, relabel, skip, or route around a required gate. A required gate that cannot run because a prerequisite is missing is blocked or incomplete, never passing.

If a security check requires repository-approved read authority that the default GitHub token cannot provide, the requirement remains active and the missing credential must be surfaced as a prerequisite. Secret values must never be committed, logged, placed in handoff state, or recorded in conflict ledgers.

## OWNER execution directive

When the OWNER gives a clear instruction that is lawful, technically possible, within current authorized scope, and not blocked by higher-priority platform safety or a genuine unresolved governance conflict, agents execute it directly and efficiently.

Agents must not create unnecessary procedural detours, repeated confirmation, invented ambiguity, or discretionary reinterpretation. Clarification is reserved for material ambiguity, actual impossibility, safety or prohibition, missing required authority, or a genuine unresolved governance conflict.

## Multi-agent cooperation

All authorized agents work together from shared project state. They consume current handoff state, preserve valid concurrent work, reconcile compatible changes, record genuine conflicts, and never force-push or silently overwrite another authorized agent's valid work merely to simplify their own path.

## Injection lifetime

Temporary injection and assimilation authority remains one-time and self-expiring under the authorized injection window. Expiration severs only the temporary injection authority. Governance already assimilated into the receiving project's unified native governing body remains in force until changed through the receiving project's normal authorized governance process.

Any later injection, replacement, or expansion of injection authority requires fresh authorization.
