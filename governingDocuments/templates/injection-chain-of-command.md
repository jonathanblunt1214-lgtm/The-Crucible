# Injection Chain of Command Template

This template MUST accompany governing-document injections into internal projects unless an explicitly authorized receiving-project variant is stronger.

## Unified native governing body

Injected `governingDocuments/` assimilate at the receiving project's native governance level. They do not remain a subordinate sidecar merely because they were injected later.

The receiving project's native governance and the injected governance are interpreted as one integrated governing body at the authorized native level. `AI-HANDOFF` is the governing body's shared coordination state. `AI-CONFLICTS` is the governing body's internal conflict ledger. Agents must not manufacture a hierarchy among these components to evade a real conflict.

Genuine unresolved internal conflicts are preserved, recorded, and routed to the OWNER or explicitly designated native deciding authority. Safe non-conflicting work may continue where governance permits.

## Development-first invariant

Every tracked mutation MUST traverse the receiving project's designated development integration branch before production promotion.

Canonical chain:

`task branch -> designated development branch -> required security/CI/governance gates -> required OWNER review/approval -> production branch`

No normal task branch may target the production branch directly. This applies to every tracked 1 or 0: application code, tests, documentation, governance, configuration, dependencies, workflows, generated artifacts, metadata, migrations, security changes, and automation changes.

There are no file-type, urgency, simplicity, automation, governance, security, or documentation exceptions.

The production promotion is valid only when its head is the designated development branch and all required gates have passed.

## Security-gate invariant

Required security, CI, governance, integrity, and review gates are mandatory chain-of-command controls.

Agents MUST NOT bypass, suppress, disable, weaken, rename around, or route around a required gate to achieve a passing result. A required gate that cannot execute because a prerequisite is missing is blocked/incomplete, never passing.

If a security check requires a repository-approved read credential that the default GitHub token cannot supply, the requirement remains active. The missing credential is surfaced as a prerequisite; the check is not bypassed. Secret values must never be committed, logged, placed in handoff state, or recorded in conflict ledgers.

## OWNER execution directive

When the OWNER gives a clear instruction that is lawful, technically possible, within current authorized scope, and not in genuine conflict with higher-priority platform safety or repository constraints, agents execute it directly.

Agents must not create unnecessary procedural runaround, repeated confirmation, invented ambiguity, or discretionary reinterpretation. Clarification is reserved for real ambiguity, actual impossibility, safety/prohibition, or a genuine unresolved governance conflict.

## Multi-agent cooperation

All authorized agents work together from shared project state going forward. They consume current handoff state, preserve valid concurrent work, reconcile compatible changes, record genuine conflicts, and never force-push or silently overwrite another authorized agent's valid work merely to simplify their own path.

## Injection lifetime

The temporary injection/assimilation authority remains one-time and self-expiring under the authorized injection window. Expiry severs only the temporary injection authority. Governance already assimilated into the receiving project's native governing body remains in force until changed through the receiving project's normal authorized governance process.
