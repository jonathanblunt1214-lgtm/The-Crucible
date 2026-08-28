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
- any other non-code prerequisite required by an injected check.

## Injection-only credential prerequisite

Any credential capability used to satisfy an injection prerequisite MUST obey `governingDocuments/templates/injection-credential-scope.md`.

Credential capability is OFF by default. Before it can be enabled, preflight MUST positively verify the active injection authorization, expected receiving project, exact target repository, active injection window, and that the requested credential operation is required for the injection/assimilation itself.

If no injection is actively authorized, or if the requested operation is unrelated to injection/assimilation, credential capability MUST remain disabled and the operation MUST fail closed.

A general-purpose or durable project `SECURITY_READ_TOKEN` MUST NOT be created merely to satisfy injection. When repository Administration read access is required solely by injection preflight or assimilation verification, use an injection-only ephemeral credential mechanism with the least required scope. Its authority ends when assimilation completes, is blocked/cancelled, or the injection window expires.

## Injection-file requirement

The exact preflight result MUST be included inside the injection package as `governingDocuments/INJECTION-PREREQUISITES.json` before assimilation starts.

The file must identify each prerequisite, why it is required, whether it was verified, and the remediation needed when it is not verified. Secret values must never be recorded.

For any injection-only credential prerequisite, the file MUST also record non-secret activation state and scope metadata: default-disabled status, authorized injection identity/window, target repository, minimum permission scope, allowed injection operations, and shutdown condition. It MUST never contain a credential value.

An injection package is incomplete if this file is absent, generic, stale, or does not reflect the actual receiving repository and selected Crucible version.

## Activation rule

A required gate may become active only after every prerequisite listed for that gate in `INJECTION-PREREQUISITES.json` is positively verified.

If any prerequisite is missing, unavailable, or unverifiable:

- assimilation is blocked at the prerequisite stage;
- the gate is not reported as satisfied;
- the project must not promote to production;
- the gate must not be bypassed, weakened, suppressed, renamed, relabeled, or treated as optional;
- the missing prerequisite must be reported explicitly for OWNER resolution.

Missing prerequisites are an injection/bootstrap failure, not a downstream surprise CI failure.

Secret values must never be written into repository files, logs, handoff state, conflict records, findings, or artifacts.
