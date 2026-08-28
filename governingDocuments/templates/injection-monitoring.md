# Universal Injection Monitoring and Repair Link

This policy applies to every future Crucible injection into every receiving project.

## Mandatory temporary monitoring link

Every authorized injection MUST create an injection-exclusive monitoring link between the receiving project and the Crucible monitoring/repair system before assimilation validation begins.

The monitoring link exists only for the active injection/assimilation. Its maximum lifetime is 24 hours from activation. It MUST be disabled when assimilation completes, is cancelled, becomes blocked beyond current authority, or the 24-hour window expires, whichever occurs first.

When no authorized injection is active, the monitoring link MUST be disabled and MUST NOT inspect, modify, trigger, or otherwise operate on the receiving project.

## Exact scope

The link may observe only the target repository, development path, workflows, checks, jobs, artifacts, and logs required to validate or repair the authorized injection/assimilation.

It MUST NOT become a general repository monitor, persistent agent connection, production control channel, telemetry service, or authority over unrelated project work.

Any read/write credential used by the link remains governed by `injection-credential-scope.md`; credential values are never persisted in governance, logs, reports, handoff state, conflicts, artifacts, or repair records.

## Failure intake

During the active 24-hour window, when an applicable Crucible gate or receiving-project native validation fails, the monitoring system MUST retrieve the actual failure evidence needed to repair it, including as applicable:

- workflow run identity and development commit;
- failed job and failed step;
- bounded failing log lines or structured report output;
- relevant artifact/report metadata;
- current-source evidence required to distinguish a stale test from a real runtime regression;
- the governing configuration or exception source used by duplicated validators.

A summary such as `failed`, `clutter detected`, or `tests failed` is not sufficient when more specific evidence is available.

Secret or credential values MUST be redacted or discarded under existing Crucible security non-persistence rules.

## One defect, one repair record

The monitoring system MUST fingerprint the underlying unresolved defect from non-secret evidence such as validator/action, normalized error class, affected path/component, and repair target.

Repeated workflow runs or commits that encounter the same unresolved defect MUST update the existing repair record rather than creating a new report/comment for every run.

A new repair record is created only when the underlying defect materially changes or a distinct defect is detected. When a defect is verified fixed, its record is resolved rather than multiplied.

## Repair delivery requirement

The monitoring system MUST return a repair payload, not merely an error notification.

A repair payload contains, as applicable:

- the exact failing evidence;
- current-source cause;
- affected file(s)/component(s);
- concrete code/configuration change required;
- a patch or directly executable edit when it can be derived safely and deterministically;
- the validation that must be rerun after the repair;
- state: `repair-ready`, `repairing`, `retest`, `resolved`, or `blocked`.

When the repair is safe, technically resolvable, required to complete assimilation, within the active injection authority, and not blocked by an unresolved governance conflict, the injector MUST apply the repair through the receiving project's development-first path and retest automatically. It MUST NOT stop after diagnosis and wait for another OWNER prompt merely to perform that already-authorized repair.

If a safe deterministic patch cannot be produced without inventing business logic, widening authority, weakening a gate, or resolving a genuine ambiguity, the repair payload MUST state the exact blocker and assimilation remains incomplete.

## Monitoring state required in the injection package

`governingDocuments/INJECTION-PREREQUISITES.json` MUST contain non-secret monitoring state with at least:

- `defaultState: disabled`;
- active injection authorization identity;
- exact target repository and development branch;
- `activatedAt` and `expiresAt`, with `expiresAt` no later than 24 hours after activation;
- allowed workflow/check scope;
- permission scope required to read failure evidence and deliver authorized repairs;
- `deduplicateByUnderlyingDefect: true`;
- `repairPayloadRequired: true`;
- `disableWhenNoActiveInjection: true`;
- current state: `disabled`, `monitoring`, `repairing`, `retest`, `resolved`, `blocked`, or `expired`.

No secret value may appear in this state.

## Expiration and severance

At expiration the monitoring link MUST fail closed and stop reading or writing the receiving project. It MUST NOT auto-extend itself.

A later injection requires a fresh injection authorization and a fresh temporary monitoring link. Previously assimilated governance remains; monitoring authority does not.
