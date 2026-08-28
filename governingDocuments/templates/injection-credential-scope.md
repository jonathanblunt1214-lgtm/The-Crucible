# Injection-Only Credential Scope

This policy applies only to Crucible injection and assimilation activity.

## Default state: disabled

Injection credential capability MUST be disabled when no authorized injection is actively running. A repository, workflow, agent, or service MUST NOT be able to use the injection credential path merely because Crucible is installed or because a prior injection occurred.

The enabled state is valid only while all of the following are true:

- an explicit injection authorization exists;
- the receiving project and repository match that authorization;
- the receiving project has confirmed that it expects the injection;
- the injection window has started and has not expired;
- the requested operation is required for injection or assimilation preflight, delivery, verification, or teardown.

If any condition is false, the capability is disabled and the operation MUST fail closed.

## Injection-only authority

Any credential created, requested, exchanged, or used for injection MUST be scoped only to the minimum repository and read/write operations required to perform the authorized injection and assimilation.

It MUST NOT be usable for unrelated development, maintenance, release, production operation, issue management, user administration, organization administration, repository administration beyond the exact read checks required by injection, or any other system activity.

An operation outside the explicit injection allow-list MUST be rejected even if the underlying credential technically possesses broader capability.

## Security-settings read access

When an injection requires repository Administration read access to verify GitHub security settings, that authority exists solely for the injection preflight and assimilation verification. It does not become a general `SECURITY_READ_TOKEN` capability for the receiving project.

The preferred mechanism is a short-lived installation token or equivalent ephemeral credential minted from a pre-authorized injection-only GitHub App or service identity. The token MUST be limited to the authorized receiving repository or repositories and to the least permissions required by the injection check.

No credential value may be committed, logged, stored in AI-HANDOFF, stored in AI-CONFLICTS, written to findings/artifacts, or copied into a receiving repository as durable project state.

## Automatic shutdown

The injection credential path MUST be disabled immediately when any of the following occurs:

- assimilation completes;
- the authorized injection window expires;
- the injection is cancelled or blocked;
- target repository identity no longer matches the authorization;
- the receiving project withdraws its expectation/authorization;
- prerequisite verification determines the credential is no longer required.

Any temporary token must then be allowed to expire or be revoked when supported. No later use is authorized without a fresh injection authorization.

## Fail-closed invariant

If injection state cannot be positively verified, credential activation is forbidden.

If an attempted credential operation is not demonstrably required for the active injection/assimilation, deny it. No agent may infer broader permission from possession of the credential, prior successful use, repository ownership, or urgency.
