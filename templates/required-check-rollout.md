# Required GitHub check rollout plan

Use this plan whenever a repository introduces a workflow whose check will later become required by branch protection or a ruleset.

## Safe enforcement boundary

1. Add the workflow on the repository's development branch and run it in report-only mode.
2. Verify the check locally and on development. Do not activate a required-check rule yet.
3. Record the workflow path, exact check name, default branch, verification, and promotion decision in the repository handoff or development log.
4. Ask the repository owner for explicit promotion approval. Never merge, push, or otherwise modify a protected/default branch implicitly.
5. After the owner promotes the workflow, fetch the default branch and run the Crucible preflight below.
6. Only when the preflight passes may a human or separately authorized tool add the check to branch protection or a ruleset.
7. Verify a pull request can produce the named check before considering rollout complete.

```text
CRUCIBLE_ENFORCEMENT_MODE=activate
CRUCIBLE_DEFAULT_BRANCH=main
CRUCIBLE_WORKFLOW_PATH=.github/workflows/policy.yml
CRUCIBLE_CHECK_NAME=Policy check
CRUCIBLE_PROMOTION_CONFIRMED=true
npm run audit:required-check
```

For development/reporting use `CRUCIBLE_ENFORCEMENT_MODE=report` and leave promotion confirmation false. A report-mode pass is not authorization to change branch protection.

## Stop conditions

Stop without changing repository settings if promotion is unapproved, the workflow is absent from `origin/<default-branch>`, the exact check name is uncertain, or the check has not appeared on a representative pull request. Report the unmet condition and preserve the current protections.
