---
name: research
description: Run the bounded Google coding-resource research coordinator with its governed limits intact.
---

# Crucible governed research run

## Configuration

These environment variables must be set before running. Do not substitute
values to fit the current platform, and do not invent paths:

```
CRUCIBLE_LEARNING_PROJECT_ID
CRUCIBLE_LEARNING_ROOT
CRUCIBLE_SOURCE_QUEUE
CRUCIBLE_GOOGLE_MAX_QUERIES
CRUCIBLE_PYTHON
```

## Sequence

1. Verify `CRUCIBLE_PYTHON` exists and can `import pypdf`. If not, fail closed
   and report the exact validation error verbatim.
2. `npm run learning:google-research-readiness`
3. `npm run learning:google-research -- <approved topics...>`

## Governed bounds

The bounds are defined in code and policy, not here. Before running, read the
current versions of:

- `governingDocuments/scientific-learning-policy.md` — the permanent learning
  invariants, promotion boundary, project isolation, and contradiction handling.
- `src/automatedGoogleResearch.js` — the executable bounds: approved-topic
  ceiling, minimum research interval, per-query rate/timeout/size limits, the
  fixed search host and path, admitted host suffixes, and the kill-switch file.
- `src/scientificLearning.js` — the candidate/proof schemas and state machine.

Never weaken, edit, or work around any of those bounds to obtain a result. If
a bound blocks the run, that is the outcome to report.

## Reporting

Report queries run, topics due versus skipped, novel URLs, duplicates, blocked
searches, retrieval outcomes, candidate IDs, classifications, and exact
blockers. Quote real command output.

If extraction is blocked after searches complete, emit the structured partial
report with the completed search outcomes and the exact blocker, and retain
the failing exit status. Never present a blocked run as a success.
