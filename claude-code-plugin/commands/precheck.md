---
name: precheck
description: Run The Crucible's pre-push verification and audit suite, reporting each command's real exit status.
---

# Crucible pre-push verification

Run the checks below from the repository root. These are the ones this
project's own chain-of-custody entries record before every push.

Run each one separately and report its **real** exit status. Do not combine
them into a single chained command whose output gets truncated — this repo's
DEVLOG notes past sessions having to re-run combined output in smaller groups
for exactly that reason.

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
```

Then run the governed test suite:

```
npm run test:all
```

Report a table of command → exit code, and quote the actual failure output for
anything non-zero. Never describe a check as passing unless you observed its
zero exit status.

If a check fails:

- Diagnose the real cause rather than re-running and hoping.
- `npm run audit:security` findings deliberately report only type, path, and
  line — never the matched value. Do not echo or persist a detected secret
  anywhere, including in your summary.
- A failing test is never dismissed as flake. `git diff --check` failing on a
  stray blank line is a real, fixable finding.
