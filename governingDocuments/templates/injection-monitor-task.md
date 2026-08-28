# Universal Injection Monitor Task Contract

This contract is instantiated for every Crucible injection. It is not project-specific and does not grant authority outside the active injection/assimilation.

## Required task identity

At injection time, create one executable monitor for the receiving project and record its non-secret identity in `governingDocuments/INJECTION-PREREQUISITES.json`.

The monitor task MUST be parameterized with:

- receiving project name;
- exact `owner/repository`;
- designated development branch;
- active injection authorization identity;
- activation timestamp;
- hard expiration timestamp no later than 24 hours after activation;
- applicable Crucible checks and receiving-project native validation discovered during preflight;
- least read/write scope needed for the authorized injection repair loop.

A generic monitor with no exact target or expiration does not satisfy this contract.

## Executable monitor prompt/behavior

The instantiated monitor MUST perform this behavior, using the target values supplied by the injection:

> Check only the authorized receiving repository and its designated development path for applicable Crucible and project-native validation runs created during this injection window. Ignore runs outside the window and unrelated project work. If no applicable failure exists, make no repository mutation. If an applicable failure exists, retrieve the exact failed job, failed step, bounded logs, report/artifact metadata, current source, and governing configuration needed to diagnose it. Fingerprint the underlying defect and update the existing repair record when it is the same unresolved defect. When the defect is safely and deterministically repairable inside the active injection authority, preserve concurrent work, apply the repair autonomously through the receiving project's development-first path, and rerun the applicable validation. Repeat `failure -> evidence -> current-source diagnosis -> repair -> retest` until resolved or a real boundary blocks repair. Do not stop at diagnosis or status reporting when an authorized safe repair remains executable. Never touch production directly, widen authority, weaken or bypass a gate, expose/persist credentials, invent business logic, silently resolve a genuine governance conflict, or modify unrelated project work. At the injection expiration or earlier assimilation completion/cancellation/block, disable the monitor and perform no further reads or writes under this injection authority.

The monitor may use an event-driven listener, GitHub App, supported webhook, or condition-watch mechanism. If the available monitor is polling-based rather than event-driven, its cadence MUST be no slower than the fastest cadence supported by that monitoring platform that is reasonable for active repair, and MUST never extend the 24-hour authorization window.

## Required repair result

For each distinct failure the monitor MUST maintain one non-secret repair record containing:

- defect fingerprint;
- latest failing run/job/step identifiers;
- affected component/path;
- current-source cause;
- repair state: `repairing`, `retest`, `resolved`, or `blocked`;
- development commit containing an applied repair, when one exists;
- retest run/result, when one exists;
- exact blocker when repair cannot legally or safely continue.

Repeated runs for the same unresolved defect update this record. They MUST NOT create a new issue/comment/report for every commit.

## Activation proof

Before assimilation validation begins, the injector MUST prove that the monitor actually exists and can inspect the target. `monitoringMechanismVerified` remains false until the injection package records:

- mechanism type;
- non-secret mechanism/task identity;
- exact target repository and development branch;
- activation and expiration timestamps;
- non-secret activation proof such as a scheduled task identifier, webhook/App installation identifier, workflow/listener identity, or equivalent supported proof;
- confirmed ability to retrieve applicable run/job/step evidence;
- confirmed repair capability inside the authorized injection scope.

A declaration, policy file, issue, or status message by itself is not activation proof.

## Shutdown

The monitor is injection-exclusive and OFF by default. It MUST disable immediately when assimilation succeeds, the injection is cancelled, a boundary blocks further authorized work, or 24 hours elapse. It MUST NOT auto-extend or become persistent project monitoring. A later injection creates a fresh monitor under fresh authorization.