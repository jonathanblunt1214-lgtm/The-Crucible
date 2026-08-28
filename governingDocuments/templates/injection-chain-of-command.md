# Universal Injection Chain of Command

This policy applies to every future Crucible governing-document injection into every receiving project. It is not specific to any one project. Each future injection package must carry this policy or a stricter receiving-project equivalent that preserves every requirement below.

## Unified native governing body

Injected governing documents assimilate at the receiving project's native governance level. They are not a temporary or subordinate sidecar after successful assimilation.

The receiving project's existing native governance and the injected governance are enforced together as one unified native governing body. AI-HANDOFF is the shared coordination state of that body. AI-CONFLICTS is its internal conflict ledger. All authorized agents work from that shared governing body and shared project state going forward.

No agent may invent a hierarchy among components of the unified governing body to avoid a genuine conflict. Unresolved internal conflicts must be preserved, recorded in AI-CONFLICTS, and routed to the OWNER or designated native deciding authority.

## Mandatory development-first path

Every tracked repository mutation must pass through the receiving project's designated development integration branch before production promotion.

Required path:

`task/change branch -> prerequisite verification -> temporary injection monitoring link -> designated development branch -> Crucible gates + receiving-project native validation -> automatic repair/retest until passing or genuinely blocked -> required review and OWNER approval -> production branch`

This applies to all tracked changes, including application code, tests, documentation, governance, configuration, dependencies, lockfiles, workflows, generated artifacts, metadata, migrations, security changes, automation changes, AI handoff state, AI conflict records, and injection documents.

A normal task or change branch must not target production directly. Production promotion is valid only from the designated development integration branch after all required gates and approvals are satisfied.

There are no exceptions based on file type, urgency, simplicity, agent, automation, documentation, governance, security, or the fact that a change is itself an injection.

If the receiving project does not yet have a designated development integration branch, the injection must stop before any production mutation and report that missing prerequisite. The absence of a development branch never authorizes a direct production write.

## Prerequisite activation rule

Before any injected Crucible capability is activated as a required gate, every non-code prerequisite required by that capability must be positively verified under `governingDocuments/templates/injection-prerequisites.md`.

Preflight must also discover the receiving project's applicable native validation commands and duplicated policy validators under `governingDocuments/templates/injection-native-validation.md`. A native validator that would contradict assimilated governance because it ignores the governing exception/configuration source is an unresolved prerequisite and must be reconciled before assimilation can be completed.

Preflight MUST also create the temporary monitoring/repair state required by `governingDocuments/templates/injection-monitoring.md`. The monitoring link is OFF unless an injection is actively authorized, is limited to the exact receiving project and injection validation scope, and expires no later than 24 hours after activation.

A missing or unverifiable prerequisite blocks assimilation or promotion at the prerequisite stage. It must not be converted into a downstream surprise required-check failure after activation.

## Mandatory gates and native validation

Required security, CI, governance, integrity, receiving-project native validation, monitoring/repair, and review gates are part of the chain of command.

Agents must not bypass, suppress, disable, weaken, rename around, relabel, skip, or route around a required gate. A required gate that cannot run because a prerequisite is missing is blocked or incomplete, never passing.

A passing outer Crucible gate is not sufficient when the receiving project's applicable native full tests, stress suite, release audit, bounded workload, repository validator, or runtime wiring check fails. Likewise, a passing project-native validator cannot override a failing Crucible gate.

During the active injection window, an applicable failure MUST be handled under `injection-monitoring.md`: retrieve the exact failed job/step/log evidence, deduplicate repeated occurrences of the same underlying defect, produce one concrete repair payload, apply safe authorized repairs through the development-first path, and retest. Reporting an error without the available failure evidence and repair action is incomplete.

If a post-assimilation validation failure is safe, technically resolvable, inside the active injection authority, and not blocked by a genuine unresolved governance conflict, the injector must continue directly through diagnosis, repair, and retest. It must not stop after diagnosis and wait for another OWNER prompt merely to perform the already-authorized repair. The loop continues until the required assimilation validation passes or a genuine blocker is reached.

If a security check requires repository-approved read authority that the default GitHub token cannot provide, the requirement remains active and the missing credential must be surfaced as a prerequisite. Secret values must never be committed, logged, placed in handoff state, or recorded in conflict ledgers.

## OWNER execution directive

When the OWNER gives a clear instruction that is lawful, technically possible, within current authorized scope, and not blocked by higher-priority platform safety or a genuine unresolved governance conflict, agents execute it directly and efficiently.

Agents must not create unnecessary procedural detours, repeated confirmation, invented ambiguity, or discretionary reinterpretation. Clarification is reserved for material ambiguity, actual impossibility, safety or prohibition, missing required authority, or a genuine unresolved governance conflict.

## Multi-agent cooperation

All authorized agents work together from shared project state. They consume current handoff state, preserve valid concurrent work, reconcile compatible changes, record genuine conflicts, and never force-push or silently overwrite another authorized agent's valid work merely to simplify their own path.

## Injection completion

Assimilation is not complete until all required prerequisites, Crucible gates, applicable receiving-project native validation, and active-window repair/retest obligations discovered during preflight pass on the assimilated development-branch state. Duplicated validators must be reconciled so intentional governed exceptions and native governance files receive the same governing decision rather than conflicting because one validator ignored the unified configuration source.

A validation failure keeps assimilation in `repairing` or `blocked` state. It must never be reported as complete merely because the outer Crucible gate passed earlier in the run.

## Injection lifetime

Temporary injection and assimilation authority remains one-time and self-expiring under the authorized injection window. The monitoring link has a hard maximum lifetime of 24 hours and is disabled immediately when assimilation completes, is cancelled, becomes blocked beyond authority, or expires. It never becomes a persistent project monitor.

Expiration severs only the temporary injection/monitoring authority. Governance already assimilated into the receiving project's unified native governing body remains in force until changed through the receiving project's normal authorized governance process.

Any later injection, replacement, or expansion of injection authority requires fresh authorization and a fresh temporary monitoring link.
