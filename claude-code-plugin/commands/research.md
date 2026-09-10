---
name: research
description: Run the bounded, credential-free Google coding-resource research coordinator with its governed limits intact.
---

# Crucible governed research run

Run the automated Google coding-resource research coordinator. It is
fail-closed by design; your job is to run it and report honestly, not to make
it appear to succeed.

## Required configuration

These must be set in the environment before running. Do not invent
substitutes, and do not silently rewrite them to fit the current platform:

```
CRUCIBLE_LEARNING_PROJECT_ID   repository-bound project identity
CRUCIBLE_LEARNING_ROOT         durable learning store root
CRUCIBLE_SOURCE_QUEUE          durable source-queue JSON path
CRUCIBLE_GOOGLE_MAX_QUERIES    per-run query ceiling (max 50)
CRUCIBLE_PYTHON                Python executable used for PDF extraction
```

## Sequence

1. Verify `CRUCIBLE_PYTHON` exists **and** can `import pypdf`. If it cannot,
   fail closed and report the exact validation error verbatim.
2. `npm run learning:google-research-readiness`
3. `npm run learning:google-research -- <approved topics...>`

## Governed bounds — never weaken any of these

- At most **50 approved topics** total; the store rejects a 51st.
- Minimum research interval is **24 hours** per topic. A run that finds
  nothing due is a valid no-op, not a failure to fix.
- Per-query bounds stay as configured: 2s minimum interval, 15s timeout, 1MB
  response cap, fixed credential-free search host and `/search` path.
- Admit only HTTPS results whose **final** host ends in `.edu`, `.org`, or
  `.gov`.
- Never use an interactive browser, login, cookies, consent acceptance,
  forms, uploads, arbitrary APIs, credentials, or any bypass.
- Respect the `GOOGLE-RESEARCH-KILL` switch file and the atomic
  project-bound research audit.
- Permanently excluded: social media, Wikipedia, Reddit, onion services, news
  aggregators, paywall or authentication bypasses, executables, and anything
  outside the admitted suffixes.
- Deduplicate requested URL, final URL, historical content hash, and bounded
  claim fingerprints before registering or emitting anything.
- New results enter **only** as `research-approved-pending-retrieval` and
  `Insufficient Evidence`.
- Search pages, snippets, rankings, citations, reputation, repetition,
  correlation, telemetry, newer dates, diffs, and model judgment are **never**
  evidence or proof.

## Reporting

Report queries run, topics due vs skipped, novel URLs, duplicates, blocked
searches, retrieval outcomes, candidate IDs, classifications, and exact
blockers. Quote real command output.

If extraction is blocked after searches complete, emit the structured partial
report with the completed search outcomes and the exact blocker, and retain
the failing exit status. Never convert a blocked run into a reported success.

Note when reading results: a **blocked** search still records the topic and
pushes its next run a full 24 hours out, so a blocked run consumes that
topic's daily window.
