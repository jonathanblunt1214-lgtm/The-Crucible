# Development log

## Shared AI handoff

- **Agent:** Claude.
- **Dev plan:** See `AI-HANDOFF.json`'s `activePlan.currentPrompt` for the exact, verbatim owner request driving this work, and `activePlan.steps`/`handoffNotes.completed`/`handoffNotes.remaining` for the plan and what is finished versus left to do. The command-level record for this and recent sessions lives below in **Command log archive**, not here.
- **Current development work:** The hourly fallback CI-monitoring routine caught a real failure: `9c16f36` (the test-coverage-diagnostic + cadence-system commit) failed `The Crucible Self-Test` on all three Windows jobs (Node 20/22/24) while all six Linux/macOS jobs passed - a genuine, deterministic, Windows-specific bug, not a flake. Pulled the actual job logs via the GitHub MCP tools and found two real bugs, both in tests added this session, not in the shipped `src/testCadence.js` logic itself: (1) `test/workflow.test.js`'s new self-test.yml assertions used bare `/- run: npm test\n/`-style regexes with no CRLF tolerance, and GitHub's Windows runners check this repository out with `\r\n` line endings (the same class of bug this repo's own history already hit once for `docs:check`) - fixed by using `\r?\n` instead of a bare `\n`. (2) `test/testCadence.test.js`'s "no unit tests assigned to a tier" test compared call executables against `process.execPath`, assuming that path was unique to the unit-test invocation - but on Windows, `resolveSpawn`'s existing npm-cli.js workaround makes every `npm run` invocation also resolve to `process.execPath`, so the assertion was comparing the wrong thing and the test's own premise didn't even hold for the tier it exercised. Rewrote it to distinguish invocations by whether `--test` appears in the args (platform-independent) instead of by executable path.
- **Files changed:** `AI-HANDOFF.json`, `DEVLOG.md`, `test/testCadence.test.js`, `test/workflow.test.js`.
- **Verification:** See the Command log archive's newest entry below for the exact commands and timestamps run to verify this change. Note: the fix itself can only be confirmed green on the real Windows CI runners, not locally (this environment is Linux) - watch the next push's Self-Test matrix for all 9 jobs green, especially the three `windows-latest` ones.
- **Remaining work:** Push this fix to `development` and confirm all 9 Self-Test matrix jobs (not just the 6 that were already green) plus the other checks are green, then fast-forward `release` to `development`'s latest tip so `main` picks up this and the prior chain-of-custody commits. `scheduled-diagnostics.yml` has not fired yet (cron-triggered) - the owner should watch its first real run to confirm it picks the right tier. `guard-ci-monitor-pr.yml` still has not been exercised live; per the standing rule in `AGENTS.md`, do not deliberately trigger it just to test it. The owner still needs to add `block` as a required status check on `main` (Settings -> Branches -> Branch protection rules) if not already done - no tool available here can do that remotely. Still blocked on owner-supplied resources, not a code gap: the hosted multi-repository integration workflow (now covered by mocked-fetch unit tests, but not a real multi-repo fleet) and `connect-workflow.yml`'s `activate` phase both need a real target repository/token to actually be exercised.

## Command log archive (last 10 sessions, newest first)

Chain-of-custody record of commands run for recent units of work, each
with a start and finish time. Capped at 10 `### Session:` entries and a
180-day backup age limit, whichever forces a prune first -
`src/handoffPolicy.js`'s `validateDevlogChainOfCustody` fails the AI
handoff policy check if either limit is exceeded, so prune the offending
entry (or entries) in the same commit that adds a new one. Older
sessions remain retrievable via `git log -p DEVLOG.md`.

### Session: pending (this commit) — 2026-08-27T21:47:17Z — Claude

- Hourly fallback CI-monitoring routine fired; checked `9c16f36` on `development` via the GitHub MCP tools and found `The Crucible Self-Test` had failed on all 3 `windows-latest` jobs (Node 20/22/24) while all 6 Linux/macOS jobs passed.
- `mcp__github__get_job_logs` on the failing `windows-latest, 24` job — identified two real, deterministic bugs (not flakes): a CRLF-unsafe regex in `test/workflow.test.js` and a Windows-specific `process.execPath` collision in `test/testCadence.test.js` (see Current development work above for detail).
- Fixed both: `\r?\n` in the two affected `workflow.test.js` regexes; rewrote the `testCadence.test.js` test to distinguish invocations by `--test` presence in args instead of comparing executables.
- `npm test` (after both fixes) — started 2026-08-27T21:46:02Z, finished 2026-08-27T21:46:05Z, exit 0 (260/260 - this environment is Linux, so it cannot itself reproduce or re-confirm the Windows-specific failure; only the next real Self-Test run on `windows-latest` can)
- `npm run lint:workflows` — started 2026-08-27T21:47:14Z, finished 2026-08-27T21:47:15Z, exit 0
- `npm run docs:check` — started 2026-08-27T21:47:15Z, finished 2026-08-27T21:47:15Z, exit 0
- `npm run validate` — started 2026-08-27T21:47:15Z, finished 2026-08-27T21:47:15Z, exit 0
- `npm run audit:clutter` — started 2026-08-27T21:47:15Z, finished 2026-08-27T21:47:16Z, exit 0
- `npm run audit:privacy` — started 2026-08-27T21:47:16Z, finished 2026-08-27T21:47:17Z, exit 0
- `npm run audit:security` — started 2026-08-27T21:47:17Z, finished 2026-08-27T21:47:17Z, exit 0
- `git add`, `git commit`, `git push -u origin development` — run after this entry and `AI-HANDOFF.json` are finalized

### Session: 9c16f36 — 2026-08-27T21:39:09Z — Claude

- `node --test test/folderTopology.test.js`, `test/snapshot.test.js`, `test/authenticity.test.js`, `test/hostedMultiRepositoryIntegration.test.js` — each iterated individually until green (14, 4, 6, and 6 tests respectively; two required real debugging: a mismatched link-answer fixture in folderTopology, and a missing paired main/Development-branch manifest entry for hostedMultiRepositoryIntegration's passing fixture)
- `npm test` (all 4 new test files integrated) — started 2026-08-27T21:24:45Z, finished 2026-08-27T21:24:49Z, exit 0 (245/245)
- `node --test test/testCadence.test.js` (new registry/orchestrator unit tests) — 12/12, exit 0
- `npm run cadence:every-push` (first real smoke test) — exit 1, 1 failed (`audit:handoff` needs a commit range it doesn't have standalone) - fixed by removing it from the registry
- `npm run cadence:every-push` (after the fix) — 12 checks, 0 failed, exit 0
- `npm run cadence:daily` (includes the full unit-test suite plus daily-tier audits) — started 2026-08-27T21:34:2xZ, finished 2026-08-27T21:34:5xZ, 15 checks, 0 failed, exit 0
- `npm run cadence:on-error -- self-test-failure` — 3 checks, 0 failed, exit 0
- `npm run cadence:on-error -- made-up` — exit 1 as expected (fails closed on an unknown trigger with a clear message)
- `npm run lint:workflows` (after adding `scheduled-diagnostics.yml` and editing `self-test.yml`) — passed, 13 workflow files
- `npm test` (after adding the new AGENTS.md/workflow.test.js assertions) — started 2026-08-27T21:36:30Z, finished 2026-08-27T21:36:33Z, exit 1, 1 failed (two AGENTS.md regexes didn't tolerate its own line-wrapping) - fixed both
- `npm test` (final, after the regex fixes) — started 2026-08-27T21:37:22Z, finished 2026-08-27T21:37:25Z, exit 0 (260/260)
- `npm run lint:workflows` — started 2026-08-27T21:39:06Z, finished 2026-08-27T21:39:06Z, exit 0
- `npm run docs:check` — started 2026-08-27T21:39:06Z, finished 2026-08-27T21:39:06Z, exit 0
- `npm run validate` — started 2026-08-27T21:39:06Z, finished 2026-08-27T21:39:07Z, exit 0
- `npm run audit:clutter` — started 2026-08-27T21:39:07Z, finished 2026-08-27T21:39:08Z, exit 0
- `npm run audit:privacy` — started 2026-08-27T21:39:08Z, finished 2026-08-27T21:39:08Z, exit 0
- `npm run audit:security` — started 2026-08-27T21:39:08Z, finished 2026-08-27T21:39:09Z, exit 0
- `git add`, `git commit`, `git push -u origin development` — run after this entry and `AI-HANDOFF.json` are finalized, per this repository's local pre-push hook (re-runs the full suite and every audit itself before allowing the push through)

### Session: eede127 — 2026-08-27T21:12:23Z — Claude

- `npm test` (baseline) — started 2026-08-27T20:54:15Z, finished 2026-08-27T20:54:19Z, exit 0 (carried over from the prior session's baseline)
- Rewrote `src/handoffPolicy.js`'s `validateDevlogChainOfCustody`: added the `Command log archive`/`### Session:` structure with a 1-10 entry cap, hardened section-extraction to line-anchored headings (fixing a real false-match bug this entry's own prose triggered), and added the 180-day age cap as a second, independent limit.
- Rewrote this file's `Shared AI handoff` and `Command log archive` sections into the new two-part structure.
- Updated `AGENTS.md`'s "`DEVLOG.md` is a chain of custody" section to document both caps.
- `npm test` (after the archive restructuring, before the age-cap and hardening work) — started 2026-08-27T21:06:53Z, finished 2026-08-27T21:06:56Z, exit 1 (3 expected failures: test regexes and fixtures still assumed the old inline-Command-log format)
- `npm test` (after fixing the parser bug and updating fixtures) — started 2026-08-27T21:12:01Z, finished 2026-08-27T21:12:04Z, exit 0 (213/213)
- `npm run lint:workflows` — started 2026-08-27T21:12:20Z, finished 2026-08-27T21:12:20Z, exit 0
- `npm run docs:check` — started 2026-08-27T21:12:20Z, finished 2026-08-27T21:12:20Z, exit 0
- `npm run validate` — started 2026-08-27T21:12:20Z, finished 2026-08-27T21:12:21Z, exit 0
- `npm run audit:clutter` — started 2026-08-27T21:12:21Z, finished 2026-08-27T21:12:22Z, exit 0
- `npm run audit:privacy` — started 2026-08-27T21:12:22Z, finished 2026-08-27T21:12:22Z, exit 0
- `npm run audit:security` — started 2026-08-27T21:12:22Z, finished 2026-08-27T21:12:23Z, exit 0
- Added two more tests per the owner's explicit request to verify the new systems: a `checkHandoffRange` integration test for the 180-day cap, and a regression test reproducing the exact prose-fools-the-parser bug found above.
- `npm test` (final, with the two new tests) — started 2026-08-27T21:14:33Z, finished 2026-08-27T21:14:36Z, exit 0 (215/215)
- `git add AGENTS.md AI-HANDOFF.json DEVLOG.md src/handoffPolicy.js test/handoffPolicy.test.js test/workflow.test.js`, `git commit`, `git push -u origin development`

### Session: 0c54c54 — 2026-08-27T20:56:21Z — Claude

- `npm test` (baseline, before this session's edits) — started 2026-08-27T20:54:15Z, finished 2026-08-27T20:54:19Z, exit 0 (211/211, confirming `e91a026` untouched)
- `npm run lint:workflows` — started 2026-08-27T20:55:05Z, finished 2026-08-27T20:55:05Z, exit 0
- `npm run docs:check` — started 2026-08-27T20:55:05Z, finished 2026-08-27T20:55:06Z, exit 0
- `npm run validate` — started 2026-08-27T20:55:06Z, finished 2026-08-27T20:55:06Z, exit 0
- `npm run audit:clutter` — started 2026-08-27T20:55:06Z, finished 2026-08-27T20:55:07Z, exit 0
- `npm run audit:privacy` — started 2026-08-27T20:55:07Z, finished 2026-08-27T20:55:08Z, exit 0
- `npm run audit:security` — started 2026-08-27T20:55:08Z, finished 2026-08-27T20:55:08Z, exit 0
- `npm test` (final) — started 2026-08-27T20:55:31Z, finished 2026-08-27T20:55:34Z, exit 0
- `git add AI-HANDOFF.json DEVLOG.md test/workflow.test.js`, `git commit`, `git push -u origin development` — pushed as `0c54c54`, confirmed all six checks green

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
