# Development log

## Shared AI handoff

- **Agent:** Claude.
- **Dev plan:** See `AI-HANDOFF.json`'s `activePlan.currentPrompt` for the exact, verbatim owner request driving this work, and `activePlan.steps`/`handoffNotes.completed`/`handoffNotes.remaining` for the plan and what is finished versus left to do. This section no longer restates that plan - it references it and adds the command-level record below.
- **Command log** (chain of custody - every command run for this unit of work, start and finish time, exit status):
  - `npm test` (before this change) — started 2026-08-27T20:48:13Z, finished 2026-08-27T20:48:16Z, exit 1 (2 expected failures: the new DEVLOG-format test and the new checkHandoffRange DEVLOG test, both failing because this file and the test fixtures hadn't been updated yet)
  - `npm run lint:workflows` — started 2026-08-27T20:49:02Z, finished 2026-08-27T20:49:02Z, exit 0
  - `npm run docs:check` — started 2026-08-27T20:49:02Z, finished 2026-08-27T20:49:02Z, exit 0
  - `npm run validate` — started 2026-08-27T20:49:02Z, finished 2026-08-27T20:49:02Z, exit 0
  - `npm run audit:clutter` — started 2026-08-27T20:49:08Z, finished 2026-08-27T20:49:10Z, exit 0
  - `npm run audit:privacy` — started 2026-08-27T20:49:10Z, finished 2026-08-27T20:49:10Z, exit 0
  - `npm run audit:security` — started 2026-08-27T20:49:10Z, finished 2026-08-27T20:49:11Z, exit 0
  - `npm test` (final, after writing this DEVLOG entry and AI-HANDOFF.json) — see the Verification bullet below for its recorded result; run once more directly before `git commit`/`git push` in this same unit of work.
  - `git add AGENTS.md AI-HANDOFF.json DEVLOG.md src/handoffPolicy.js test/handoffPolicy.test.js test/workflow.test.js`, `git commit`, `git push -u origin development` — run after the final `npm test` pass, per this repository's local pre-push hook (which re-runs the full suite and every audit itself before allowing the push through).
- **Current development work:** Per the owner's explicit request, turned `DEVLOG.md` into an enforced chain of custody. `src/handoffPolicy.js` gained `validateDevlogChainOfCustody`, wired into `checkHandoffRange`: the AI handoff policy check now fails a commit whose `DEVLOG.md` (at the pushed head) lacks a `Shared AI handoff` section referencing the dev plan in `AI-HANDOFF.json`, or lacks a `Command log` with at least one start/finish pair. `validateHandoffPlan` also now requires `activePlan.currentPrompt` (the verbatim triggering prompt) as a required non-empty field, alongside the existing `agent`/`objective`/`startedAt`/`lastUpdatedAt`. Documented all of this in a new `AGENTS.md` section, "`DEVLOG.md` is a chain of custody". This is honestly scoped: CI can verify the required section and pattern exist, but it cannot verify that literally every command an agent ran is listed - that remains on the agent's own honesty, same as every other rule in this file.
- **Files changed:** `AGENTS.md`, `AI-HANDOFF.json`, `DEVLOG.md`, `src/handoffPolicy.js`, `test/handoffPolicy.test.js`, `test/workflow.test.js`.
- **Verification:** Full local suite passes (211/211 after adding: the `currentPrompt` rejection case, the DEVLOG chain-of-custody unit tests, the `checkHandoffRange` DEVLOG-content test, and the AGENTS.md/DEVLOG.md/AI-HANDOFF.json structural test in `workflow.test.js`). `lint:workflows`, `docs:check`, `validate`, `audit:clutter`, `audit:privacy`, and `audit:security` all pass (see Command log above for exact timestamps).
- **Remaining work:** Push this commit to `development`, confirm all six checks (Block locked monitoring PRs, AI handoff policy, AI conflict governance, Sync CI monitoring branch, CodeQL, Self-Test) go green - the AI handoff policy check is the interesting one here since it now runs the new `validateDevlogChainOfCustody` logic against this exact file for the first time - then fast-forward `release` to pick this up for `main` too. `guard-ci-monitor-pr.yml` still has not been exercised live; per the standing rule in `AGENTS.md`, do not deliberately trigger it just to test it. The owner still needs to add `block` as a required status check on `main` (Settings -> Branches -> Branch protection rules) if not already done - no tool available here can do that remotely. Still blocked on owner-supplied resources, not a code gap: the hosted multi-repository integration workflow and `connect-workflow.yml`'s `activate` phase both need a real target repository/token to actually be exercised.

Every AI agent must keep the current plan and status in this section accurate automatically and refresh it in the same commit as its work, including the Command log for whatever it actually ran. Read it before editing; do not rely on private chat history to learn what another agent changed.

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

## 2026-08-27, morning — a local pre-push gate, commit-hygiene tuning, and a real Windows bug

- `48db90f` Add a local pre-push hook running the fast verification suite — `.githooks/pre-push` plus `src/installGitHooks.js`, wired into npm's `prepare` lifecycle so a lost executable bit self-heals on the next install, prompted by a bug the owner shared from another repository (a non-executable tracked hook that Git silently skips).
- `c6b1625` Fix Windows CI: skip exact chmod-mode check on win32 — real bug in the previous commit's own test: `fs.chmodSync` cannot set true POSIX executable bits on NTFS, so the exact-`0o755` assertion was always false there. The commit that introduced this (`48db90f`, amended in place) also tripped the repo's own commit-subject-length gate at 79 characters against a 72-character cap; amended to a 52-character subject and force-pushed with the owner's explicit approval, since that gate is `fixable:false` by design.
- `ec8de1f` Raise commit-subject length cap from 72 to 80 characters — at the owner's explicit request.
- `1c141c1` Raise commit-subject length cap from 80 to 120 characters — a further explicit owner request.

## 2026-08-27, mid-morning — Codex's multi-repository governance work

- `f5cb442` Accept valid trailing-hyphen repository names
- `cb8dd6d` Allow verified direct Crucible promotions
- `9d52a29` Remove workflow trailing whitespace
- `da39554` Add AI-link governance bootstrap — rewrote `templates/connect-workflow.yml` from a single-shot install script into a two-phase `install`/`activate` flow; `activate` now re-verifies both AI governance checks actually succeeded on a representative PR before applying zero-bypass branch rulesets.
- `7e6ba23` Add global project topology governance — categorized selectable suite execution, multi-repository project topology with a Main-repository manifest and immutable snapshots, global/local natural-language policy scopes, explicit folder-topology setup for multi-folder projects, and a report-only hosted multi-repository integration workflow. **Shipped with a real bug**: its own committed `AI-HANDOFF.json` claimed the clutter audit passed, but the commit never added the `.thecrucible.json` exception its two new (intentionally identical) example templates needed — see next entry.

## 2026-08-27, midday — a genuine 9-way CI failure, fixed and guarded against recurring

- `f0f3c88` Fix Self-Test: allow the intentionally identical policy templates — `templates/thecrucible-global.example.json` and `templates/thecrucible-local.example.json` are meant to start byte-for-byte identical (both scopes share one schema), so the clutter audit's duplicate-content check failed all 9 OS/Node jobs. Added the same kind of `clutter.allow` exception already used once before for `ai-conflicts.example.json`.
- `cf0fcb0` Guard against the clutter regression reaching development again — root-caused *why* `7e6ba23` shipped broken: `npm test` and `npm run audit:clutter` are separate commands, and the only existing clutter-audit test coverage ran against a synthetic fixture, never the real repository. Added a self-check test running the real audit against this repository's own tracked files, inside `npm test` itself; proved it's a real guard by reverting the fix and watching the new test fail with the identical finding before restoring it.

## 2026-08-27, afternoon — a heartbeat feature, and a Copilot Autofix catch-up

- `a0cf985` Add a still-running heartbeat to the workload runner — requested directly by the owner. `workload.heartbeatSeconds` (bounded 5–300, default 60) prints a "still running" progress line while a command is actively executing; the timer starts only after the child process spawns and clears the instant it closes, errors, or times out, so it cannot fire when nothing is running.
- `641cbac`, `2d4abe9` Two GitHub Copilot Autofix commits the owner accepted directly on GitHub, each correctly fixing a real CodeQL "Incomplete string escaping or encoding" finding (a dot-only `.replace()` building a `RegExp` from a filename, missing the rest of the metacharacter set) in `test/githubRepoSecurity.test.js` and `test/globalPolicy.test.js`. Copilot Autofix has no awareness of this repository's handoff protocol, so neither commit updated `DEVLOG.md`/`AI-HANDOFF.json`, and `AI handoff policy` correctly failed both pushes.
- `f764336` Update Shared AI handoff after Copilot Autofix commits — supplies the missing handoff update for the two commits above; both underlying fixes were kept as-is.

**Result:** `development` went from a genuine 9-way CI failure (`7e6ba23`) to fully green, gained a regression guard against that specific failure recurring, and gained a new opt-in progress-visibility feature. PR #8 (`development` → `main`) opened with all 27 checks green; merging remains an explicit decision for the repository owner. Separately, PR #7 (the permanent CI-monitoring event hook) was merged by the owner during this window and can never fire again — real-time CI-failure notification in this session is down to the 60-minute hourly fallback poll until a replacement hook is created.
