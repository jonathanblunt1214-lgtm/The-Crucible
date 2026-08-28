# Universal Injection Security Gates

This policy applies to every future Crucible governing-document injection into every receiving project. It is not project-specific. Each future injection must preserve these controls at the receiving project's native governance level.

## Required path

`task/change branch -> designated development branch -> mandatory security, CI, governance, and integrity gates -> required review and OWNER approval -> production promotion`

A normal task or change branch must not target the production branch directly.

## Universal coverage

The rule applies to every tracked repository change, including code, tests, documentation, governance, configuration, dependencies, lockfiles, workflows, generated artifacts, metadata, migrations, security changes, automation changes, AI coordination records, and injection documents themselves.

No category is exempt. The fact that a change is urgent, small, generated, administrative, governance-related, security-related, or injected does not bypass the path.

## Fail-closed behavior

If a required check cannot run, the change is not validated. Missing repository settings, missing credentials, unavailable external services, missing branch prerequisites, or other unmet requirements are blockers to surface and resolve, not permission to bypass, suppress, weaken, rename, relabel, skip, or route around the gate.

Security and governance gates must remain at least as strong as the currently authorized repository policy. Agents may not weaken a gate merely to make a change pass.

## Injection-only credential handling

Any credential used for injection or assimilation MUST follow `governingDocuments/templates/injection-credential-scope.md`.

The credential path is disabled by default and MUST remain disabled whenever an authorized injection is not actively running. Activation requires positive verification of the injection authorization, expected receiving project, exact target repository, active injection window, and an operation explicitly required for injection/assimilation.

When a security check needs repository-read authority unavailable to the default GitHub token, use only an injection-only, least-privilege, short-lived credential mechanism. Repository Administration read access, when required, is authorized only for the exact injection security-settings verification that requires it.

The credential MUST NOT be usable for general repository work, project maintenance, release activity, production operations, issue administration, unrelated workflow execution, organization administration, or any other non-injection purpose. Any such attempt MUST fail closed even if the underlying credential technically allows it.

No durable project `SECURITY_READ_TOKEN` is to be created solely for injection when an ephemeral injection credential can satisfy the requirement.

Never commit, print, persist, or copy a credential value into AI-HANDOFF, AI-CONFLICTS, logs, findings, artifacts, governance records, or receiving-project state.

When assimilation completes, is cancelled/blocked, or the authorized injection window expires, the injection credential path MUST be disabled immediately and any temporary credential revoked when supported or otherwise allowed to expire without reuse.

## Promotion

Production promotion is valid only from the designated development integration branch after all required gates are green and all required review and OWNER approvals are satisfied.

If the receiving project does not yet have a designated development integration branch, the injection must stop before production mutation and report the missing prerequisite rather than target production directly.