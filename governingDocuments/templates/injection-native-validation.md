# Universal Injection Native Validation Gate

This policy applies to every future Crucible injection into every receiving project.

## Purpose

Injection is not complete merely because the outer Crucible gates pass. The receiving project's own tests, stress suites, release audits, repository validators, packaging checks, and governance checks are part of assimilation verification when they can be affected by injected files, paths, configuration, governance, or runtime wiring.

The injector MUST discover these native validation surfaces before package finalization and MUST run the applicable native validation after assimilation on the designated development branch.

## Mandatory preflight discovery

Before an injection package is finalized, inspect the receiving repository and record, as applicable:

- native full-test commands;
- stress, release, packaging, and bounded-workload commands;
- repository clutter, duplicate-content, inventory, manifest, or file-layout validators;
- governance, policy, exception, security, privacy, and integrity validators;
- application/runtime wiring tests that exercise code paths the injected change can affect;
- duplicated or parallel validators that independently implement a rule also enforced by Crucible;
- configuration or allow-list sources consumed by each such validator.

The discovered commands and validator paths MUST be written as non-secret metadata into `governingDocuments/INJECTION-PREREQUISITES.json` before assimilation starts.

## Single-governance consistency rule

A receiving project may keep project-owned validators, but they MUST interpret assimilated governance consistently with the unified native governing body.

If a project-owned validator independently implements clutter, duplicate-content, governance, exception, inventory, or similar policy, preflight MUST determine whether it consumes the same governed exceptions/configuration or otherwise produces equivalent decisions for injected native governance files.

A project-owned validator MUST NOT re-flag an intentional assimilated governance file that the governing Crucible configuration explicitly permits merely because that validator ignored the governed exception source.

Do not weaken either validator to hide a genuine finding. Reconcile the implementation so both enforce the same governing decision while preserving any stricter non-conflicting project rule.

## Post-assimilation verification

After injected changes land on the designated development integration branch, but before assimilation can be marked complete or promoted:

1. run the applicable Crucible gates;
2. run the receiving project's discovered native full validation, including applicable stress/release/bounded-workload checks;
3. compare failures against the assimilated change and current source, not stale assumptions;
4. verify duplicated policy validators agree on governed exceptions and intentional native governance paths;
5. verify runtime wiring tests still match the current implementation rather than merely changing tests to accept a regression.

A passing outer Crucible gate does not override a failing native validation result, and a passing native validator does not override a failing Crucible gate.

## Automatic repair-and-retest continuation

When post-assimilation validation fails and the failure is safe, technically resolvable, within the active injection/assimilation authority, and not blocked by a genuine unresolved governance conflict, the injector MUST continue directly into diagnosis, repair, and retest. It MUST NOT stop after reporting the diagnosis or wait for another owner prompt merely to perform the already-authorized repair.

The repair loop is:

`failure -> inspect exact failing step/log/evidence -> identify current-source cause -> repair on the authorized development path -> rerun affected validation -> rerun full required assimilation validation -> repeat until passing or genuinely blocked`

Automatic repair MUST NOT invent business logic, weaken required gates, suppress findings, bypass security, widen repository authority, touch production directly, force-push, or overwrite valid concurrent work.

If a failure exposes an unrelated pre-existing defect, repair it automatically only when the active authority clearly covers that repair and the change is required to complete the authorized assimilation validation. Otherwise record the blocker precisely and keep assimilation incomplete.

## Completion rule

Assimilation may be marked complete only when:

- all required injection prerequisites are verified;
- required Crucible gates pass;
- all applicable receiving-project native validation discovered during preflight passes on the assimilated development-branch state;
- duplicated validators have been reconciled so governed exceptions and native governance files are interpreted consistently;
- no unresolved failure caused by the injection remains hidden behind a skipped, weakened, or stale check.

If any of these conditions is unmet, assimilation remains `repairing` or `blocked`, never `complete`.
