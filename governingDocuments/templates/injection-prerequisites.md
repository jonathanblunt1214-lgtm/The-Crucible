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

## Injection-file requirement

The exact preflight result MUST be included inside the injection package as `governingDocuments/INJECTION-PREREQUISITES.json` before assimilation starts.

The file must identify each prerequisite, why it is required, whether it was verified, and the remediation needed when it is not verified. Secret values must never be recorded.

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
