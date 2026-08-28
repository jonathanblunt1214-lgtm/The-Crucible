# Universal Injection Prerequisite Gate

This policy applies to every future Crucible injection.

## Mandatory preflight before package creation

Before an injection package is finalized or written to a receiving project, the injector MUST inspect the selected Crucible version and the receiving repository to determine every external prerequisite the injected capabilities require.

The preflight must check, as applicable:

- designated development branch existence;
- required GitHub repository settings;
- required Actions permissions;
- required repository or organization secrets by NAME only, never value;
- required external-service availability;
- required branch protection or ruleset state;
- required repository-read credentials and minimum permission scope;
- temporary 24-hour injection monitoring/repair link capability;
- any other non-code prerequisite required by an injected check.

## Native validation discovery prerequisite

Before package finalization, preflight MUST also discover the receiving project's own applicable validation surfaces under `governingDocuments/templates/injection-native-validation.md`.

This includes native full-test commands; stress, release, packaging, and bounded-workload commands; repository clutter/duplicate/inventory validators; governance/exception/security/integrity validators; and runtime wiring tests that can be affected by assimilation.

Preflight MUST identify any project-owned validator that duplicates or parallels a Crucible rule and determine which governed configuration, allow-list, exception source, or policy source it consumes. If a duplicated validator would interpret intentional injected native governance differently from the governing Crucible configuration, assimilation is blocked until that disagreement is reconciled.

The discovered native commands, validator paths, governing configuration sources, and current verification state MUST be recorded in `governingDocuments/INJECTION-PREREQUISITES.json` before assimilation starts.

## Injection-only credential prerequisite

Any credential capability used to satisfy an injection prerequisite MUST obey `governingDocuments/templates/injection-credential-scope.md`.

Credential capability is OFF by default. Before it can be enabled, preflight MUST positively verify the active injection authorization, expected receiving project, exact target repository, active injection window, and that the requested credential operation is required for the injection/assimilation itself.

If no injection is actively authorized, or if the requested operation is unrelated to injection/assimilation, credential capability MUST remain disabled and the operation MUST fail closed.

A general-purpose or durable project `SECURITY_READ_TOKEN` MUST NOT be created merely to satisfy injection. When repository Administration read access is required solely by injection preflight or assimilation verification, use an injection-only ephemeral credential mechanism with the least required scope. Its authority ends when assimilation completes, is blocked/cancelled, or the injection window expires.

## Temporary monitoring prerequisite

Every injection MUST satisfy `governingDocuments/templates/injection-monitoring.md` before assimilation validation begins.

Preflight MUST prove that the receiving project can expose the applicable Crucible and project-native workflow/check results needed for repair, including failed job/step/log evidence when available. It MUST record the exact target repository and development branch, the allowed workflow/check scope, and the least permission required to read that evidence and deliver authorized repairs.

The monitoring link is disabled by default and can be enabled only for the active injection. `expiresAt` MUST be no later than 24 hours after activation. If the monitoring capability cannot retrieve available failure evidence or cannot deliver a repair payload, assimilation is blocked before the link is treated as operational.

## Injection-file requirement

The exact preflight result MUST be included inside the injection package as `governingDocuments/INJECTION-PREREQUISITES.json` before assimilation starts.

The file must identify each prerequisite, why it is required, whether it was verified, and the remediation needed when it is not verified. Secret values must never be recorded.

For any injection-only credential prerequisite, the file MUST also record non-secret activation state and scope metadata: default-disabled status, authorized injection identity/window, target repository, minimum permission scope, allowed injection operations, and shutdown condition. It MUST never contain a credential value.

The file MUST also include native-validation metadata required by `injection-native-validation.md`, including the discovered project-owned commands/checks, duplicated-policy validators, their governed configuration sources, and post-assimilation status.

The file MUST include monitoring state required by `injection-monitoring.md`, including activation/expiration, exact monitored scope, defect-deduplication state, repair-payload requirement, and disabled/monitoring/repairing/retest/resolved/blocked/expired state. No credential or secret value may appear in it.

An injection package is incomplete if this file is absent, generic, stale, or does not reflect the actual receiving repository and selected Crucible version.

## Activation rule

A required gate or monitoring link may become active only after every prerequisite listed for it in `INJECTION-PREREQUISITES.json` is positively verified.

If any prerequisite is missing, unavailable, or unverifiable:

- assimilation is blocked at the prerequisite stage;
- the gate/link is not reported as satisfied;
- the project must not promote to production;
- the gate must not be bypassed, weakened, suppressed, renamed, relabeled, or treated as optional;
- the missing prerequisite must be reported explicitly for OWNER resolution.

Missing prerequisites are an injection/bootstrap failure, not a downstream surprise CI failure.

## Post-assimilation repair requirement

A verified prerequisite state does not by itself complete assimilation. After injection lands on the designated development branch, the injector MUST run Crucible and all applicable receiving-project native validation discovered during preflight.

If an applicable validation fails during the active monitoring window, the injector MUST retrieve the exact available failure evidence and follow the repair loop in `injection-monitoring.md` and `injection-native-validation.md`. Repeated occurrences of the same underlying unresolved defect update one repair record rather than creating a separate report for every run.

When the failure is safely repairable inside the active injection authority, the injector MUST continue through diagnosis, concrete repair delivery/application, and retest automatically instead of stopping after diagnosis and waiting for another owner prompt.

Assimilation may be marked complete only when both Crucible and applicable native project validation pass on the assimilated development-branch state.

Secret values must never be written into repository files, logs, handoff state, conflict records, findings, or artifacts.
