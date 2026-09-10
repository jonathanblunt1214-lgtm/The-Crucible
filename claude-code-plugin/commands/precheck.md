---
name: precheck
description: Run The Crucible's pre-push verification and audit suite, reporting each command's real exit status.
---

# Crucible pre-push verification

Run each command separately from the repository root and report its **real**
exit status. Do not chain them into one invocation whose output gets
truncated.

```
npm run validate
npm run docs:check
npm run lint:workflows
npm run audit:clutter
npm run audit:privacy
npm run audit:security
npm run audit:ai-conflict-governance
npm run audit:governance
npm run audit:design-brief
npm run audit:core-ref
npm run audit:authenticity
git diff --check
npm run test:all
```

Consult `package.json`'s `scripts` for the authoritative list; if it defines
audit or validation scripts not named above, run those too and say which you
added.

## Reporting

Produce a table of command → exit code, and quote actual output for anything
non-zero. Never report a check as passing without having observed its zero
exit status.

## On failure

Diagnose the real cause. For what counts as an acceptable resolution — and
what does not — follow `AGENTS.md`, `governingDocuments/known-bugs/README.md`,
and the Security Gate's own contract in `src/security.js` as they currently
stand, rather than any remembered summary of them.
