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

## Credential handling

When a security check needs repository-read authority unavailable to the default GitHub token, use only a repository-approved secret with the minimum required read scope. Never commit, print, persist, or copy the secret value into AI-HANDOFF, AI-CONFLICTS, logs, findings, artifacts, or governance records.

The absence of such a credential means the required check is blocked; it does not mean the check may be skipped.

## Promotion

Production promotion is valid only from the designated development integration branch after all required gates are green and all required review and OWNER approvals are satisfied.

If the receiving project does not yet have a designated development integration branch, the injection must stop before production mutation and report the missing prerequisite rather than target production directly.