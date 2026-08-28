# Injection Security Gates Template

Every injected project MUST carry forward a mandatory validation chain for all tracked changes.

## Required path

`task branch -> designated development branch -> mandatory security/CI/governance gates -> required OWNER review -> production promotion`

A normal task branch MUST NOT target the production branch directly.

## Universal coverage

The rule applies to all tracked repository changes, including code, tests, docs, governance, configuration, dependencies, workflows, generated artifacts, metadata, migrations, and security changes. No category is exempt.

## Fail-closed behavior

If a required check cannot run, the change is not validated. Missing repository settings, missing credentials, unavailable external services, or other prerequisites are blockers to surface and resolve—not permission to bypass, suppress, weaken, or relabel the gate.

Security gates MUST remain at least as strong as the currently authorized repository policy. Agents may not weaken a gate merely to make a change pass.

## Credential handling

When a security check needs repository-read authority unavailable to the default GitHub token, use only a repository-approved secret with the minimum required read scope. Never commit, print, persist, or copy the secret value into `AI-HANDOFF`, `AI-CONFLICTS`, logs, findings, artifacts, or governance records.

## Promotion

Production promotion is valid only from the designated development integration branch after all required gates are green and all required review/OWNER approvals are satisfied.
