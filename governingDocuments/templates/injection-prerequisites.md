# Universal Injection Prerequisite Gate

This policy applies to every future Crucible injection.

Before any injected Crucible check is activated as a required gate, the injection must verify every non-code prerequisite required by that check, including:

- required development branch existence;
- required GitHub repository settings;
- required Actions permissions;
- required repository or organization secrets;
- required external-service availability;
- required branch/ruleset state;
- any repository-read credential needed by the check.

A required gate may become active only after all of its prerequisites are positively verified.

If any prerequisite is missing, unavailable, or unverifiable:

- assimilation is blocked at the prerequisite stage;
- the gate is not reported as satisfied;
- the project must not promote to production;
- the gate must not be bypassed, weakened, suppressed, renamed, relabeled, or treated as optional;
- the missing prerequisite must be reported explicitly for OWNER resolution.

Missing prerequisites are an injection/bootstrap failure, not a downstream surprise CI failure.

Secret values must never be written into repository files, logs, handoff state, conflict records, findings, or artifacts.
