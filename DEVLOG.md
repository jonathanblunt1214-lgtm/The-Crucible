# Development log

## Shared AI handoff

- **Agent:** GPT-5.6 Sol.
- **Execution mode:** `regular/default`; the owner explicitly rejected the earlier product Work-mode handoff, and this attended task is being executed directly through the available GitHub connector on the explicitly authorized `Plug-in` branch.
- **Dev plan:** See `AI-HANDOFF.json` for the exact active plugin plan, owner prompt, branch authorization, security boundary, verification, and remaining work.
- **Actual current step:** The standalone Crucible Nexus plugin v0.0.1 is on `Plug-in`. A release-format review found and corrected the unsigned artifact to Nexus's exact `nexus-plugin-package` format and excluded development-only scripts/tests from the shipped payload before exact-tip CI verification.
- **Plugin configuration:** The runtime advertises a generic governance editor rooted at `governingDocuments/` with list/read/create/update/move/delete operations. Plugin-side guards reject paths outside that tree; the Nexus host contract independently requires project-root authorization, traversal/symlink rejection, bounded UTF-8 operations, atomic mutation where supported, and confirmation for destructive actions.
- **Private tracking:** Auto Inject requires an authenticated Nexus account and records only bounded metadata through `account:private` after a successful write. The plugin does not store an injection-history ledger in the project, repository, plugin folder, or governance tree.
- **Security/release boundary:** Runtime capabilities are limited to `ui:slot`, `workspace:read`, `workspace:write`, `account:private`, and `telemetry:emit`; no shell/process, Git-write, unrestricted-network, or secret-store capability is requested. Release signing requires an externally supplied protected signing key and never commits private signing material.
- **Verification state:** The plugin includes VM/lifecycle regressions, source-contract verification, a Nexus-compatible deterministic unsigned package, SPDX SBOM, host/security/release docs, and dedicated cross-platform Node 20/22/24 workflow plus core Crucible regression job. Fresh exact-tip hosted checks remain required after the package-format correction commit. No `main`/`release` promotion is authorized.

## Command log archive

Chain-of-custody record for recent units of work. Newest first; maximum 10 sessions and 180 days. Older history remains available through Git history. Every entry pruned from this archive is also recorded, as a full DEVLOG.md snapshot with a plain-language summary, in `Devlog-Pruned` on `Archive`.

### Session: build the standalone Nexus plugin v0.0.1 on Plug-in — 2026-08-29T13:32:48Z — GPT-5.6 Sol — mode:regular/default

Plain-language summary: The owner corrected the implementation location: all Crucible plugin source must live on The Crucible's exact `Plug-in` branch, not inside Nexus. This session re-read that branch's governance and conflict state, then built a self-contained v0.0.1 Nexus plugin with least privilege, explicit Auto Inject, a full governance-file configuration contract, account-private injection tracking, release/security documentation, deterministic packaging and signing hooks, an SPDX SBOM, VM-level tests, and dedicated cross-platform CI. A release-format review then changed the artifact to Nexus's exact importable package format and kept development-only files out of the shipped payload.

- Re-read `DEVLOG.md`, `AI-HANDOFF.json`, `AGENTS.md`, `AI-CONFLICTS.json`, every listed governing document, the `Plug-in` branch tip, testing/security policy, and root package state; confirmed no open AI conflict and explicit owner authorization for the exact `Plug-in` branch — started 2026-08-29T13:32:48Z, finished 2026-08-29T13:35:00Z, exit 0 diagnostic.
- Inspected the current Nexus plugin API/lifecycle contract as host reference only and designed the standalone package so Crucible-specific runtime/UI/account behavior does not need to live in the Nexus source repository — started 2026-08-29T13:35:00Z, finished 2026-08-29T13:35:40Z, exit 0 design.
- Prepared `nexus-plugin/nexus.plugin.json`, self-contained `index.js`, package/release verification and signing scripts, `HOST-CONTRACT.md`, `SECURITY.md`, `CHANGELOG.md`, README, SPDX SBOM, VM/lifecycle regressions, root plugin scripts, and `.github/workflows/nexus-plugin.yml` — started 2026-08-29T13:35:40Z, finished 2026-08-29T13:38:20Z, exit 0 source preparation.
- Created atomic commit `f1e2e88e2e4e5ee0145bce280dd2d9d1a522d8af` with paired handoff/DEVLOG state and fast-forwarded only `Plug-in` after confirming the branch had not moved — started 2026-08-29T13:38:20Z, finished 2026-08-29T13:40:30Z, exit 0.
- Reviewed Nexus's importer format and corrected the generated artifact from a source-package label to exact `nexus-plugin-package` format; limited shipped files to runtime, manifest, docs, license, and SBOM so development tests/signing scripts are not part of install-time screening — started 2026-08-29T13:40:30Z, finished 2026-08-29T13:41:20Z, exit 0 correction preparation.

### Session: install the governing documents an adopter's AI-HANDOFF.json actually names — 2026-08-28T12:26:47Z — Claude — mode:regular/default

Plain-language summary: The owner asked for the one-time setup that connects a new project to this tool to also install the governing documents it tells that project's AI agents to read, if those documents aren't already there. Checking, the setup was indeed incomplete: it handed new projects an AI-HANDOFF.json with no such list at all, and even if one existed, two of the files it would need to point at were never actually copied over. This session added that list and made the setup copy those two files in too, but only when a project doesn't already have its own copy, so nothing gets overwritten. While testing the fix, a separate real bug turned up in the setup script itself: it checked for changed files in a way that goes blind whenever a brand-new folder appears, which silently would have broken this exact fix for every new project. That got fixed too, and re-tested four different ways to be sure.

- Read `templates/connect-workflow.yml`, `templates/ai-handoff.example.json`, `templates/the-crucible-design-brief.md`, and `README.md`'s step-by-step setup instructions to understand what the one-time install currently does versus what an adopter's own `governingDocuments` map would need to exist — started 2026-08-28T12:20:00Z, finished 2026-08-28T12:23:00Z, exit 0 diagnostic.
- Added `governingDocuments` and `sessionPolicy.recheckGoverningDocuments` to the adopter handoff template, updated the connect workflow to copy conditional governing templates without overwrites, corrected fresh untracked-directory detection to `git status --porcelain -uall`, and verified four disposable-repository scenarios — started 2026-08-28T12:23:00Z, finished 2026-08-28T12:48:00Z, exit 0.
- Added workflow regressions, updated README setup documentation, ran `npm run test:all` (318/318), and ran the full pre-push audit set successfully — started 2026-08-28T12:48:00Z, finished 2026-08-28T12:52:40Z, exit 0.
- Repaired the later CodeQL escaping finding, refreshed injection-monitor handoff state, and normalized paired bookkeeping for the validated promotion — started 2026-08-28T21:43:00Z, finished 2026-08-28T22:05:00Z, exit 0.

### Session: correct Devlog-Pruned to full snapshots plus plain-language summaries — 2026-08-28T12:15:00Z — Claude — mode:regular/default

Plain-language summary: The owner pointed out that only saving the removed session excerpt wasn't good enough — they wanted the whole DEVLOG.md file preserved as it looked right before each prune, and they wanted it to read in plain English, not just commands and diffs. This session rebuilt the archiving tool to do both.

- Confirmed the prior archive gap was scope rather than copy corruption, changed `src/handoffPolicy.js` to archive complete DEVLOG snapshots with safe fences, added snapshot parsing and plain-language-summary enforcement, and added regressions — started 2026-08-28T12:15:00Z, finished 2026-08-28T12:40:00Z, exit 0.
- Rebuilt `Devlog-Pruned` on `Archive` in the corrected format and ran `npm run test:all` plus the full pre-push audits successfully — started 2026-08-28T12:40:00Z, finished 2026-08-28T12:48:40Z, exit 0.

### Session: preserve pruned DEVLOG history in Devlog-Pruned on Archive — 2026-08-28T11:37:00Z — Claude — mode:regular/default

Plain-language summary: Per the owner's instruction, built the first version of the tool that copies pruned DEVLOG.md entries to a permanent archive file on `Archive`, then changed retention to a 364-day floor with automatically doubling capacity rather than deleting recent history by count.

- Added `prunedDevlogEntries`, `effectiveDevlogPrunedCapacity`, and `appendToDevlogPrunedLedger`, regression-tested them against real history, and pushed the first archive entries under the narrow owner-authorized `Archive` exception — started 2026-08-28T11:37:00Z, finished 2026-08-28T12:02:00Z, exit 0.
- Documented the branch/retention rule and ran the full test/audit set successfully — started 2026-08-28T12:02:00Z, finished 2026-08-28T12:06:40Z, exit 0.

### Session: broaden public API-key detection beyond Google/Firebase — 2026-08-28T11:19:00Z — Claude — mode:regular/default

Plain-language summary: Expanded Security's review-triggering public API-key catalog beyond Google/Firebase to Stripe publishable keys, Mapbox public tokens, and a carefully bounded generic API-key-name fallback while preserving the rule that detected values are never persisted.

- Confirmed existing detector scope, implemented known-provider and name-context fallback rules with deduplication/false-positive guards, added five regressions, and manually exercised representative shapes — started 2026-08-28T11:19:00Z, finished 2026-08-28T11:33:00Z, exit 0.
- Ran `npm run test:all` (307/307) and the complete audit set successfully — started 2026-08-28T11:33:30Z, finished 2026-08-28T11:34:00Z, exit 0.

### Session: prohibit API identifier persistence — 2026-08-28T11:11:01Z — GPT-5.6 Sol — mode:regular/default

Plain-language summary: Added regression enforcement that detected API identifiers can be flagged for security review but their matched values may not appear in persisted findings, reports, logs, artifacts, handoff, or DEVLOG state.

- Refreshed Security and handoff state, added repository-audit and generated-artifact non-persistence regressions, and governed the invariant without recording a detected value — started 2026-08-28T11:11:01Z, finished 2026-08-28T11:14:00Z, exit 0.
- Inspected hosted checks; CodeQL passed while the handoff policy rejected only the sequential connector bookkeeping shape, leading to a paired correction — started 2026-08-28T11:14:39Z, finished 2026-08-28T11:17:28Z, exit 1 diagnostic for expected bookkeeping-shape failure.

### Session: catch Firebase public-key security posture — 2026-08-28T10:48:00Z — GPT-5.6 Sol — mode:regular/default

- Refreshed current handoff/governance and Security implementation, traced the Nexus miss to absence of a Google/Firebase Web API-key detector, added the review-triggering finding and synthetic regressions, and advanced paired governance without recording a key value — started 2026-08-28T10:48:00Z, finished 2026-08-28T10:55:20Z, exit 0.

### Session: mode-aware AI handoff — 2026-08-28T10:13:26Z — Codex — mode:regular/default

- Synchronized the clean development checkout, located the structured handoff validator, verified focused handoff/governance surfaces, corrected a trailing blank line, ran governed selected tests and pre-push audits, pushed the mode-aware handoff commit, dispatched exact-tip workflows, and verified chain-of-custody mode enforcement — started 2026-08-28T10:12:50Z, finished 2026-08-28T10:19:28Z, exit 0.

### Session: executable Adapt Persevere Overcome governance — 2026-08-28T09:47:00Z — Codex — mode:regular/default

- Synchronized development, verified reconciliation/recovery/ambiguity/retry behavior, ran governed change-impact and complete explicit tests, completed pre-push audits, pushed verified commits, and confirmed exact-commit hosted handoff, CodeQL, and all nine Self-Test jobs green — started 2026-08-28T09:44:00Z, finished 2026-08-28T09:56:39Z, exit 0 after correcting one unsupported test invocation.

### Session: isolate ambiguity and enforce current test standards — 2026-08-28T09:19:00Z — GPT-5.6 Sol — mode:regular/default

- Added the owner testing rule, changed Orchestrator selection so unresolved tests are isolated rather than guessed, made incomplete classification coverage non-passing while safe classified tests continue, updated stale strict-classification contracts, and corrected hosted bookkeeping/self-match issues — started 2026-08-28T09:19:00Z, finished 2026-08-28T09:39:14Z, exit 0 correction pending fresh CI at that historical point.
