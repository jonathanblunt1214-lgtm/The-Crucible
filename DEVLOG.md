# Development log

## Shared AI handoff

- **Agent:** Codex.
- **Current plan:** Repair the repository identifier guard exposed by Nexus PR #119, preserve its URL/path-injection boundary, verify the complete Crucible suite, push only to `development`, and confirm hosted CI before Nexus pins the new immutable revision.
- **Current development work:** The genuine pull-request Crucible run for Nexus reached every prior gate successfully, then rejected the valid GitHub repository identifier `jonathanblunt1214-lgtm/Nexus-`. Updated `src/apiGuard.js` to apply the stricter no-trailing-hyphen rule to the owner segment while allowing GitHub-valid trailing hyphens in the repository segment. Added positive and negative regression cases and documented the boundary.
- **Files changed:** `src/apiGuard.js`, `test/apiGuard.test.js`, `README.md`, `AI-HANDOFF.json`, `DEVLOG.md`.
- **Verification:** Full local suite passes 172/172, including the new `Nexus-` regression and all existing unsafe-identifier cases. `lint:workflows`, `docs:check`, `validate`, `audit:clutter`, `audit:privacy`, `audit:security`, `audit:ai-conflict-governance`, and `git diff --check` pass. The standalone handoff command correctly refused invocation without its required exact 40-character base/head range; CI supplies that changed range.
- **Remaining work:** Commit and push to `development`, confirm Self-Test, AI handoff policy, AI conflict governance, and CodeQL, then update Nexus to the verified immutable Crucible commit.

Every AI agent must keep the current plan and status in this section accurate automatically and refresh it in the same commit as its work. Read it before editing; do not rely on private chat history to learn what another agent changed.

**Note (main):** this file was written on `development` and landed on `main` via the merge of PR #6 (`c574c64`, "Merge pull request #6 from jonathanblunt1214-lgtm/development"). The "not merged" line at the bottom is now stale for that reason - it has been merged. `main` and `development` share this exact history as of that merge; anything committed to either branch after that point is not reflected here until this file is updated again.

This log reflects exactly what has happened on **this branch** (`development`), commit by commit, oldest first within each day. It is generated from real git history, not a narrative summary — every entry below is a real commit that exists on this branch right now. Each branch in this repository keeps its own log describing its own actual state; this one is not copied onto `main` or `Archive`, and theirs are not copied onto this one.

## 2026-08-24

- `816427f` Create independent reusable Crucible system
- `0c5484c` Add personal identifier privacy scrubber
- `5f920de` Automate privacy scrubbing with review gate
- `49e2f33` Add pre-workload Security Gate
- `bdc0625` Merge pull request #1 (feat/security-gate)
- `9603acc` Pin workflow actions to immutable commits
- `e822940` Improve cross-project security compatibility
- `9726539` Add privacy path exemptions
- `0759b67` Add evidence-backed authenticity gate
- `1de6d71` Merge pull request #2 (codex/security-hardening)
- `21b17c0` Merge pull request #3 (codex/cross-project-compatibility)
- `a0ee5af` Complete read-only Crucible hardening
- `f84ed60` Support rule-scoped security exceptions
- `beda014` Save read-only project run reports
- `70e30ec` Add commit inspection and safe auto-fix gate
- `d8a2a7b` Test commit gate normalization and review findings
- `67c6237` Expose Crucible commit check and fix commands
- `da0f25a` Integrate commit checking into Crucible CLI
- `91e0b28` Audit the exact staged commit snapshot
- `1058778` Use GitHub commit SHA automatically in CI
- `3ee3466` Add language-aware checks to latest report
- `dac3a4c` Include exact error codes in Crucible report *(this is also `main`'s current tip)*

## 2026-08-26, morning — security gate hardening and a real outage

- `1af0700` Add CodeQL analysis and a GitHub repository security settings gate
- `a85e069` Require administration:read on the linking repository, fix false-disabled detection — **this commit broke every workflow run on every branch**: `administration` is not a valid GitHub Actions `permissions:` key, so GitHub rejected the workflow file outright.
- `ebbf6a2` Add a troubleshooting guide and actionable fix messages to the security gate
- `ca13d8b` Fix win32 npm-CLI path resolution to use path.win32 explicitly (pre-existing bug, unrelated to the outage)
- `4a32e43` Add an internal repair system scoped only to this engine's own repository
- `456c31b` Fix outage: administration is not a valid Actions permissions key — the actual fix, switching to an optional maintainer-provided PAT (`SECURITY_READ_TOKEN`) instead
- `fd9df14` Fix a real Privacy Gate finding: avoid a literal email in test fixture

## 2026-08-26, midday — the Crucible/adopter boundary

- `891d7a6` Add agent-boundaries.md: explicit AI-agent rules for the Crucible link
- `a72cb1b` State outright in agent-boundaries.md that the link is one-way
- `f6f3e67` Reverse ownership framing: installed-to-run-Crucible files belong to Crucible
- `7bca25a` State outright that access to The Crucible is one-shot and severed after use
- `36e36d7` Add a one-time, self-revoking connect workflow to install the design brief
- `8cf6b05` Sever the link if the installed design brief is deleted, with a loud notice
- `6f1a7f8` Add pinned-commit integrity verification and connection-point input validation
- `3417f4d` Add autonomous canonical recovery for Crucible (from a parallel session; force-push-to-`main` recovery workflow — see "Autonomous internal recovery" in README)
- `cf24abb` Merge codex/cross-project-compatibility into development
- `5ee249a` Merge claude/github-connection-zvp5z9 into development
- `9bd47cd` Resolve merged development gate configuration
- `1c493ab` Create issues for failed Crucible gates
- `ca5924f` Fix reusable workflow report path context
- `967829e` Label suggested repairs in failure issues

## 2026-08-26, afternoon — closing the remaining gap, then a real CI drive-to-green

- `389c583` Port engine-code scan and expanded spyware coverage from claude/github-connection-zvp5z9 — the one commit from that branch not yet merged; the branch was then archived rather than left dangling.
- `0578002` Fix README to match exactly what the workflow and CLI actually run — corrected step order and added four previously-undocumented steps.
- `05d8d7e` Auto-generate README's workflow-step list so it can't silently drift — `npm run docs:sync` / `npm run docs:check`, wired into Self-Test.
- `8aa4aaa` Add AGENTS.md/CLAUDE.md so every AI agent working here sees the same branch policy.
- `d996ca2` Fix docs:check failing on Windows due to CRLF line endings — real bug, caught by PR #6's own Self-Test run.
- `59f2790` Fix precheck checking GitHub's synthetic PR merge commit — Self-Test's `precheck`/`run` steps fell back to `GITHUB_SHA` (a synthetic PR merge commit on `pull_request` events) instead of the actual head commit.

**Result:** PR #6 (`development` → `main`) went from failing on four independent causes (a real CRLF bug, a missing `SECURITY_READ_TOKEN` secret, CodeQL's "Default setup" conflicting with the repo's own `codeql.yml`, and the synthetic-merge-commit bug) to fully green across every job. It is not merged; merging remains an explicit decision for the repository owner.
