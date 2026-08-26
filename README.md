# The Crucible

The Crucible is a repository-independent GitHub Actions quality gate. A project opts in by adding `.thecrucible.json` and a small caller workflow. The project remains independent: The Crucible does not copy application code between repositories, does not require another application, and does not receive write access to the project.

## Exactly what it does

### On every push and pull request

The caller workflow checks out the project commit that triggered the run, checks out an exact pinned commit of this repository into `.the-crucible-runtime`, and runs with read-only contents and pull-request permissions. That checkout uses `persist-credentials: false` and lives only inside that one ephemeral runner: the project has no standing access to this repository, only a one-shot, read-only checkout for the duration of a single check, severed the moment the runner is destroyed. No project that adopts The Crucible can change anything in this repository, during a run or after one.

The engine then:

1. Confirms `THE-CRUCIBLE-DESIGN-BRIEF.md`, if it was ever installed via `connect-workflow.yml`, has not since been deleted - fails immediately, before anything else, if it has (see "Severing: what happens if the installed design brief is deleted" below).
2. Confirms the pinned `core_ref` commit exists, is reachable from The Crucible's `main` branch, and has a passing Self-Test recorded for it - see "Pinned commit integrity" below.
3. Loads `.thecrucible.json` from the project.
4. Rejects malformed configuration, unsupported schema versions, absolute paths, parent-directory traversal, unbounded workload values, and executable paths embedded in configuration.
5. Audits every Git-tracked project file for clutter.
6. Audits staged tracked text for personal identifiers, credentials, and private keys.
7. Runs the Security Gate against the staged Git snapshot before any project preparation or heavy workload begins.
8. Checks that Dependabot alerts, Dependabot security updates, secret scanning, and secret scanning push protection are enabled on both the calling project's repository and the linked Crucible engine repository.
9. On pull requests, reports files that overlap another open pull request before workload execution.
10. Pre-checks the exact staged snapshot locally (or commit SHA in CI), then parses changed JSON/JavaScript and runs only configured checks whose path patterns match changed files.

## Language-aware pre-check report

`npm run precheck` combines the Commit Gate with changed-file code checks. Built-in parsing reads the staged or committed snapshot, not an unrelated working copy. Projects can add `codeCheck.commands` with `include` path patterns; `{files}` in an argument expands to only the matching changed paths. Commands without `{files}` run once when a matching file changes, which is useful for an affected package's test suite.

Every required action in this report uses exactly one class: `safe auto-fix`, `test failure`, `security concern`, or `human code review required`. Those are headings, followed by an exact machine-readable error code such as `CRUCIBLE_COMMIT_TRAILING_WHITESPACE`, `CRUCIBLE_PARSE_JSON_SYNTAX`, or `CRUCIBLE_TEST_FAILURE_EXIT_1`. Command failures preserve the real process exit code. In GitHub Actions, the same report is appended to the run's latest job summary through `GITHUB_STEP_SUMMARY`, alongside the existing checks. Safe auto-fixes keep the existing review-and-restage flow through `npm run fix:commit`; the pre-check never silently rewrites application code. Parser failures and checks without a deterministic repair require human review. Configure test, security, and review commands with the corresponding `failureAction` value.
7. Runs each configured `security.dependencyAudit` command directly, without a shell.
8. Runs each `commands.prepare` entry once, in order.
9. Starts the configured number of workers concurrently.
10. Each worker runs every `commands.verify` entry, in order, for the configured number of cycles.
11. Terminates a command when it exceeds `workload.timeoutMinutes`.
12. Fails if a command cannot start or exits with a nonzero status.
13. Confirms every configured artifact exists after the workload.
14. Scans configured generated text artifacts for credential exposure.
15. Reports one passing or failing check named **The Crucible**.

Commands are launched directly with an executable and argument array. They are not concatenated into a shell command. This prevents configuration values from being interpreted as shell operators. Each configured working directory must remain inside the project repository.

The concurrent workload deliberately runs verification commands against the same checkout. This can reveal nondeterministic tests, unsafe concurrent writes, incomplete builds, shared temporary-file collisions, and hidden process-launch failures. Projects whose build command cannot safely run concurrently should configure one worker or provide a dedicated concurrency-safe verification command.

### Every 24 hours

At 03:17 UTC, the caller runs configuration validation and the clutter audit without repeating the full workload.

The clutter audit examines tracked files only and reports:

- Empty tracked files.
- Tracked paths normally associated with generated output or temporary data, including `node_modules`, `dist`, `out`, `build`, `coverage`, temporary directories, logs, backup files, rejected patches, operating-system metadata, and similar artifacts.
- Files that are both Git-tracked and matched by `.gitignore`.
- Byte-for-byte duplicate tracked content, unless `allowDuplicateContent` is enabled.

The audit never deletes or rewrites a project file. A project can exempt an intentional path with `clutter.allow`. Exemptions affect clutter reporting only; they do not grant execution permission or weaken GitHub permissions.

### Personal-identifier protection

Every project declares one public identity in `privacy.githubIdentity`. For these repositories that value is `jonathanblunt1214-lgtm`. The privacy gate permits that GitHub username and its matching `users.noreply.github.com` commit email. It also permits non-personal technical examples such as `git@github.com` and addresses on reserved `example` domains.

The privacy gate blocks recognized GitHub access tokens, private-key blocks, personal Windows user-profile paths, personal Google Drive paths, phone numbers, and all other ordinary email addresses. It reads the Git index rather than only the working copy, so a secret already staged for commit cannot be hidden by changing the unstaged file afterward. It reports the file, line, and category but never prints the detected secret value.

The normal `privacy` action is self-scrubbing. When it detects protected data, it automatically sanitizes the corresponding working files and then fails the gate. It deliberately leaves the original staged snapshot unchanged and blocked. The output lists only categories, locations, and cleaned filenames. The user must inspect the working changes, stage the cleaned versions, and commit again. A second privacy run reads the newly staged content and passes only when the protected values are gone. GitHub Actions performs the same sanitization in its temporary runner, but it cannot commit or push the repair; the developer must apply and review the cleanup locally.

Running `node src/cli.js privacy` performs this automatically when necessary. `node src/cli.js scrub` remains available for an explicit scrub without first auditing the staged snapshot. Both paths replace recognized values with neutral markers such as `REDACTED_EMAIL`, `USER_HOME`, `DRIVE_HOME`, `REDACTED_PHONE`, `REDACTED_GITHUB_TOKEN`, and `REDACTED_PRIVATE_KEY`. Neither path stages, commits, pushes, or deletes files.

No pattern-based tool can reliably recognize every human name, street address, biographical fact, or identifier in arbitrary prose. The scrubber guarantees detection for the categories listed above; sensitive prose still requires human review. It never searches other repositories, account data, browser data, or commit history.

### Security Gate

The Security Gate runs before preparation commands and the concurrent verification workload. Like the privacy gate, it reads the staged Git snapshot so changing only the unstaged working copy cannot conceal introduced content. It reports only the category, file, and line where applicable; it never prints a detected secret or payload.

The built-in scan fails on high-confidence indicators of:

- Encoded PowerShell execution and download-and-execute command chains.
- Common reverse-shell payloads and dynamic execution of base64 or URI-decoded code.
- Credential-store theft combinations, keylogging combined with transmission, and covert screenshot or clipboard exfiltration behavior.
- Recognized AWS, Slack, npm, and Stripe live credentials. GitHub credentials and private keys remain covered by the privacy gate.
- Tracked Windows PE, ELF, and Mach-O executables, plus suspicious executable/library extensions, unless the exact intentional paths are allowlisted.

`security.dependencyAudit` adds ecosystem-specific vulnerability checks. Each entry uses the same bounded, shell-free command model as other Crucible commands and runs before preparation. For example, a Node project with a lockfile can configure `npm audit --audit-level=high --omit=dev`. A nonzero audit result blocks the workload. The engine does not silently install a scanner, send source code to a service, or assume one package manager for every repository.

`security.allow` exempts intentional text fixtures from pattern scanning. `security.allowBinaries` exempts intentional executable artifacts from binary blocking. Both are path-pattern allowlists and should be as narrow as possible. Neither grants execution permission, and neither changes the repository.

This is a defense-in-depth gate, not an antivirus or sandbox. Static patterns and dependency advisories cannot detect every exploit, malicious program, spyware technique, supply-chain compromise, or future zero-day. Passing means none of the configured known indicators or dependency audit failures were found; it is not a guarantee that code is safe.

After the workload, The Crucible scans configured text artifacts for recognized credentials and client-visible secret exposure before reporting success. This catches secrets introduced by generation or bundling even when they were not present in the staged source snapshot.

### GitHub repository security settings gate

Passing static and dependency scanning is not enough if GitHub's own repository-level protections are turned off. Alongside the Security Gate, The Crucible checks the live GitHub repository settings for **Dependabot alerts**, **Dependabot security updates**, **secret scanning**, and **secret scanning push protection**, and fails the run if any of them is disabled.

This requirement applies to two repositories on every run:

- The calling project's own repository (`GITHUB_REPOSITORY`).
- The linked Crucible engine repository, `jonathanblunt1214-lgtm/The-Crucible`, that every caller pins and checks out into `.the-crucible-runtime`. A project that trusts this engine to gate its code should also be able to trust that this engine's own repository keeps the same protections turned on.

The gate reads settings through the GitHub REST API; it never modifies them. Reading `security_and_analysis` and vulnerability-alert status requires a token with read-only **Administration** repository access — and **the automatic `GITHUB_TOKEN` can never have that access**, because `administration` is not a valid GitHub Actions `permissions:` key for any token (an earlier version of this gate incorrectly asked callers to add `administration: read` to their workflow's `permissions:` block; that is invalid YAML and breaks the entire workflow file outright, it does not merely fail to grant access). The only way to satisfy this check is a maintainer-provided fine-grained personal access token, scoped to the repository being checked, with the read-only Administration permission, stored as a repository secret and threaded through as `secrets.security_read_token` (see `templates/caller-workflow.yml`). Without that secret — on the calling repository, on this engine repository, or both — GitHub returns a normal response with the security settings silently left out rather than an error, so this gate reports the repository as unverified rather than guessing or assuming it is safe, and blocks the run exactly as it would for a confirmed-disabled setting. Outside a GitHub Actions context (no `GITHUB_TOKEN`/`GITHUB_REPOSITORY`, for example running `node src/cli.js` locally) the gate skips safely rather than blocking local development. Set `githubSecurity.enabled` to `false` to explicitly opt a project out.

### Severing: what happens if the installed design brief is deleted

Installing `THE-CRUCIBLE-DESIGN-BRIEF.md` via `templates/connect-workflow.yml` (step 10 below) is optional, but once it exists it is not something a passing CI run gets to make disappear quietly. Before anything else runs, every check confirms this file is either present, or was never installed in this repository's history at all - both of those pass. If it was ever committed here and is now missing, that is treated as this repository withdrawing from the connection: every Crucible check fails, on every branch, until the file is restored, with a loud notice (printed to the log and appended to the run's job summary) explaining exactly why and what to do about it.

This is deliberate, not a bug to work around. There are exactly two legitimate responses to a severed link: restore the file by re-running `connect-workflow.yml`, or actually end the connection by removing the caller workflow and `.thecrucible.json` entirely. Deleting the design brief while leaving the caller workflow in place is not a valid state - it doesn't disable The Crucible, it just fails every check until one of those two things happens.

### Pinned commit integrity

A pinned commit's own content cannot be silently altered - git identifies a commit by the hash of its content, so "the same SHA with different code" is not a thing that can happen without the hash changing too. What a technical check *can* catch is a different problem: `core_ref` getting re-pinned, deliberately or by mistake, to a real commit that is nonetheless the wrong one - one that was reverted, abandoned on an unmerged branch, or never had its Self-Test pass. That looks exactly like a legitimate update to anyone skimming a diff, but it's a downgrade to a version of The Crucible that was never cleared for use.

Before validating configuration, every run checks the pinned `core_ref` against The Crucible's own repository: that the commit exists, that it is reachable from `main` (an ancestor of it or `main` itself - not an orphaned or reverted commit), and that its Self-Test matrix actually recorded a pass. Any of those failing blocks the run with a report naming exactly which check failed and why. This only verifies the pin's provenance; it cannot verify intent - a human with legitimate repository access can still choose to re-pin to an old commit on purpose. Requiring review on the caller workflow file (see the `CODEOWNERS` recommendation above) is what makes that a decision someone has to notice and approve, rather than one this check alone can prevent.

### Collision protection

For pull-request runs, the reusable workflow uses read-only pull-request access to compare the current PR's changed files with every other open PR. Any overlap fails before the heavy workload and reports only PR numbers, titles, and paths. Outside a GitHub pull-request context the collision audit skips safely. It never closes, modifies, approves, or merges a pull request.

### Weekly

At 04:47 UTC every Sunday, the caller runs the clutter, privacy, and Security Gates, the GitHub repository security settings gate, the full configured workload, artifact verification, and safe Git maintenance.

Git maintenance performs:

1. `git count-objects -v` to record the checkout's object-storage state.
2. `git fsck --full --strict --no-dangling` to verify object integrity and connectivity.
3. `git repack -Ad` to combine reachable Git objects into efficient pack files.
4. `git prune-packed` to remove loose copies of objects already preserved in pack files.
5. A second strict integrity verification.
6. A second object-storage report for comparison.

This is Git's equivalent of safely reorganizing repository storage. It does not rebase. It also does **not** squash, amend, force-push, delete branches, delete tags, change commit IDs, or update the remote repository. GitHub controls and maintains the physical storage of GitHub-hosted repositories; a GitHub Actions runner cannot defragment GitHub's servers. The weekly operation proves that the repository can be integrity-checked and cleanly repacked, and it is useful when run locally against a persistent clone.

## Files added to a project

Only two project files are required:

- `.thecrucible.json` contains project-specific commands, artifacts, workload bounds, and intentional clutter exemptions.
- `.github/workflows/the-crucible.yml` calls the reusable workflow in this repository.

There is no runtime dependency in the application being tested. The engine exists only in GitHub Actions or when explicitly run by a developer.

## Install in another repository

1. Copy `templates/thecrucible.example.json` to the project root as `.thecrucible.json`.
2. Replace its example commands and artifact paths with real project values.
3. Copy `templates/caller-workflow.yml` to `.github/workflows/the-crucible.yml`.
4. Replace both `REPLACE_WITH_EXACT_COMMIT_SHA` values with the same tested commit SHA from this repository.
5. Commit and push both files.
6. In the project repository's branch protection or ruleset, require the check named **The Crucible**.
7. In the project repository's **Settings → Code security and analysis** page, enable Dependabot alerts, Dependabot security updates, secret scanning, and push protection. The GitHub repository security settings gate fails the run until all four are turned on.
8. Optional but recommended: create a fine-grained personal access token scoped to this repository with the read-only **Administration** permission, and add it as a repository secret named `SECURITY_READ_TOKEN`. The template already forwards it to the gate as `secrets.security_read_token`. Without it, step 7's settings can never actually be verified — GitHub's automatic `GITHUB_TOKEN` has no way to be granted this access, so the gate always reports that repository as unverified (and fails, the same as a confirmed-disabled setting) until this secret exists.
9. Append `templates/agent-boundaries.md` to this project's AI agent instructions (`CLAUDE.md`, `AGENTS.md`, or whatever file your tooling reads). It states, in terms meant for an agent rather than a human, that everything installed here to run The Crucible - `.thecrucible.json`, the caller workflow, the pin, the checked-out engine code - belongs to The Crucible and is off-limits to modify, that CI failures here get a visible human-reviewed fix rather than autonomous self-repair, and that a pinned commit that fails to resolve is a link problem to report - not a bug to chase into this project's own permissions or workflow files. See "Why `agent-boundaries.md` exists" below for what this is protecting against.
10. Copy `templates/connect-workflow.yml` to `.github/workflows/connect-the-crucible.yml`, replace its `REPLACE_WITH_EXACT_COMMIT_SHA`, commit and push it, then run it once from the Actions tab (`workflow_dispatch`). It writes `THE-CRUCIBLE-DESIGN-BRIEF.md` - a longer, standalone version of `agent-boundaries.md`'s rules with the full design explained - into the project root, as the one and only commit it will ever make. Once it has run, **delete `.github/workflows/connect-the-crucible.yml` (the workflow file only, never the design-brief commit it produced)**: this removes the `contents: write` permission it briefly held, which is otherwise never granted anywhere in The Crucible's design. This step is optional - `agent-boundaries.md` alone covers the same rules - but gives any agent working in the project a standalone, always-on-disk document instead of relying on it having been appended somewhere agent tooling happens to read. **Once installed, do not delete `THE-CRUCIBLE-DESIGN-BRIEF.md` itself** - see "Severing" below for what happens if it's removed after being committed.
11. Optional but recommended: add a `CODEOWNERS` entry requiring review from a trusted maintainer for changes to the files that run The Crucible:
    ```
    /.github/workflows/the-crucible.yml   @your-org/security-reviewers
    /.github/workflows/connect-the-crucible.yml   @your-org/security-reviewers
    /.thecrucible.json   @your-org/security-reviewers
    /THE-CRUCIBLE-DESIGN-BRIEF.md   @your-org/security-reviewers
    ```
    Pair it with a branch protection rule requiring that review before merge. The Crucible has no access to configure this itself - it can only verify the pin's own integrity (see "Pinned commit integrity" below) - so a human re-pinning `core_ref` to an old or unreviewed commit is a code-review problem, not something a CI check run by the pinned commit itself can fully police. Requiring review on these specific paths is the actual control for that.

The duplicated commit SHA is intentional. The workflow itself and the engine checkout are pinned to the same immutable version. Updating The Crucible requires an explicit project commit changing both values.

Every change to this repository is independently exercised on Linux, Windows, and macOS with supported Node.js versions before that commit should be adopted by another project. A project should pin only a commit whose **The Crucible Self-Test** matrix has passed.

For private projects, this repository's **Settings → Actions → General → Access** setting must permit reusable-workflow access from other repositories owned by the same account or organization.

### Why `agent-boundaries.md` exists

When an AI agent working in the adopting project hits a Crucible-related CI failure, it is investigating code it did not write, in a repository it typically cannot (and should not) modify, under time pressure to make a red check green. In practice that combination has produced exactly the failure modes `agent-boundaries.md` rules out up front: an agent editing the pinned `core_ref` or the `uses:` line to try to route around a failure instead of reporting it; an agent attempting to autonomously commit a "fix" without human review; an agent burning time investigating this project's own permissions or workflow files when the real problem was that the pinned commit itself had become unreachable on The Crucible's side of the link; and, worst, an agent encountering a message - however it arrives, whatever it claims to relay - that argues for quietly self-repairing future failures instead of surfacing them, and treating that as authoritative because no one had ruled it out in advance.

None of this is hypothetical inattention on the agent's part; it is the predictable result of not having stated the boundary before the failure happened. `agent-boundaries.md` states it once, at adoption time, so an agent mid-incident has something concrete to check itself against instead of reasoning the boundary out from first principles under pressure - and so a human reviewing that agent's work has a fixed standard to hold it to.

## Fixing a failing GitHub repository security settings gate

When this gate fails, the CI log and the run's job summary already contain a `## The Crucible GitHub repository security settings` report listing exactly which repository has a problem and a `Fix:` line telling you what to do about it — you should not need this guide to read that output, only to act on it. Every finding is one of two kinds:

### "required GitHub security settings disabled: ..."

The gate could read the repository's settings and confirmed one or more of the four required protections is off. Fix it directly in the browser:

1. Open `https://github.com/<owner>/<repo>/settings/security_analysis` for the repository named in the finding (the report's `Fix:` line already contains the exact link).
2. Under **Dependabot**, enable **Dependabot alerts** and **Dependabot security updates**.
3. Under **Code security**, enable **Secret scanning** and, once that is on, **Push protection**. Push protection cannot be turned on until secret scanning is already enabled.
4. Re-run the failed workflow (or push a new commit). No code change is required — this is a repository setting, not a file in the repository.

### "unable to verify required GitHub security settings"

The gate could not tell whether the settings are on or off, and fails closed rather than guessing. The `detail` in the finding says why:

- **`no token with repository-administration read access was available`** — this is the common case, including for this engine's own repository. `GITHUB_TOKEN` can never satisfy this: `administration` is not a valid GitHub Actions `permissions:` key for any token, so there is no `permissions:` change that grants it (an earlier version of this gate asked for exactly that and it made the whole workflow file invalid — see the note at the top of the "GitHub repository security settings gate" section above). Fix it by creating a fine-grained personal access token scoped to the repository named in the finding, with the read-only **Administration** permission, and storing it as a repository secret named `SECURITY_READ_TOKEN`. `templates/caller-workflow.yml` already forwards a secret with that name to the gate as `secrets.security_read_token` — if your caller workflow still fails on this, confirm the secret exists on the repository named in the finding (the calling repository and the linked engine repository are checked, and each needs its own secret) and that you copied the template's `secrets:` block rather than a `uses:` line without one.
- **`HTTP 404` / a repository-not-found style detail** — the repository name The Crucible tried to check does not exist or is misspelled. For the calling project this should not happen (it comes from `GITHUB_REPOSITORY`, set automatically by GitHub Actions); for the linked engine repository, confirm the pinned commit SHA in your caller workflow still points at `jonathanblunt1214-lgtm/The-Crucible`.
- **Any other `HTTP` status** — a transient GitHub API problem or an outage. Re-running the workflow is usually sufficient; if it persists, check [githubstatus.com](https://www.githubstatus.com/) before assuming it is a Crucible bug.

### If you disagree with the requirement itself

Set `githubSecurity.enabled` to `false` in `.thecrucible.json` to opt the project out entirely (see the [configuration reference](#githubsecurity) below). Prefer fixing the underlying settings first — this is a repository-level opt-out, not a way to silence one specific finding.

## Configuration reference

### `schemaVersion`

Must be `1`. Unknown versions fail closed.

### `project`

- `name`: Human-readable project name used in results.
- `projectId`: Optional stable identifier for grouping multiple repositories outside the engine. The engine does not transmit or aggregate project data by itself.

### `commands.prepare`

Optional commands run once and sequentially before stress workers start. Use this for locked dependency installation or required code generation.

### `commands.verify`

Required commands run by every worker during every cycle. Tests, linting, type checking, builds, export verification, and deterministic code checkers belong here.

Each command supports:

- `name`: Label displayed in failures.
- `run`: Executable name such as `npm`, `node`, `python`, `dotnet`, or `cargo`. Paths and shell expressions are rejected.
- `args`: Argument array passed directly to the executable.
- `cwd`: Optional repository-relative working directory. It cannot escape the repository.

### `artifacts`

Optional repository-relative files or directories that must exist after verification. Missing artifacts fail the run.

### `clutter.allow`

Optional path patterns for intentionally tracked files that would otherwise be reported. `*` matches within one path segment, `**` crosses directories, and `?` matches one character.

### `clutter.allowDuplicateContent`

Defaults to `false`. Set it to `true` only when identical tracked files are an intentional project requirement.

### `clutter.blockTrackedIgnored`

Defaults to `false` for cross-project compatibility. Enable it when a project treats any file that is both tracked and ignored as a blocking repository error.

### `privacy.githubIdentity`

Required GitHub username that may remain as the project's sole explicitly allowed public personal identity. Its corresponding GitHub noreply email is also allowed so private email addresses never need to appear in commits.

### `privacy.scanContactInformation`

Defaults to `false` because email addresses and phone numbers are often legitimate application data, operational identities, or documentation. Enable it for repositories whose policy forbids all contact information. High-confidence credentials, private keys, and personal machine paths remain blocked regardless. Public package-maintainer emails in recognized dependency lockfiles are not treated as personal identifiers.

### `privacy.allow`

Optional path patterns excluded from the privacy audit and scrubber. This is intended for narrowly identified project data that must never be rewritten automatically. It does not exempt those paths from the separate Security Gate.

### `security`

- `enabled`: Defaults to `true`. Setting it to `false` is an explicit project-level opt-out of both static scanning and dependency audit commands.
- `allow`: Optional path patterns excluded from text scanning. Intended for narrow security-test fixtures that deliberately contain recognizable payload examples.
- `allowBinaries`: Optional path patterns for reviewed executable or library files that must be tracked intentionally.
- `maxTextBytes`: Maximum bytes scanned per text file, from 1,024 through 5,242,880. Default: 1,048,576. Binary recognition is still performed before this limit is applied.
- `dependencyAudit`: Up to ten optional vulnerability-audit commands. Each has `name`, `run`, `args`, and optional `cwd`, and runs directly without shell interpretation under the normal command timeout.

### `authenticity.claims`

Optional evidence commands for important project claims. Each claim has a human-readable `name` plus shell-free `run`, `args`, and optional `cwd` fields. The Authenticity Gate runs these checks before preparation and the heavy workload and fails when any declared evidence cannot be produced. This makes configured claims testable and prevents Crucible from treating an unsupported assertion as success; it cannot establish every possible real-world fact or guarantee that arbitrary prose is truthful.

### `githubSecurity`

- `enabled`: Defaults to `true`. Setting it to `false` is an explicit project-level opt-out of the entire GitHub repository security settings gate described above, including the linked Crucible engine repository check.

### `workload`

- `workers`: Concurrent workers, from 1 through 8. Default: 4.
- `cycles`: Complete verification cycles per worker, from 1 through 20. Default: 2.
- `timeoutMinutes`: Maximum time for each command, from 1 through 30. Default: 4.

The number of verification command executions is:

```text
workers × cycles × number of verify commands
```

## What it deliberately does not do

The Crucible does not silently delete clutter, automatically fix application code, upload project source elsewhere, collect telemetry, read unrelated repositories, expose repository secrets, modify branch protection, approve pull requests, or publish releases. Adopting-project findings are report-only unless a separate external-repair feature is explicitly enabled. Internal recovery is different: it can commit and promote a verified restoration only inside The Crucible's own repository.

## Local use

Run these commands from this repository while pointing `CRUCIBLE_PROJECT_ROOT` at the project being checked:

```powershell
$env:CRUCIBLE_PROJECT_ROOT = 'C:\path\to\project'
node src/cli.js validate
node src/cli.js clutter
node src/cli.js privacy
node src/cli.js security
node src/cli.js scrub
node src/cli.js run
node src/cli.js maintain
```

`maintain` changes only the local clone's internal `.git` object packing. The built-in Security Gate is read-only. All other changes can come only from the privacy scrubber or project commands explicitly listed in the project's own `.thecrucible.json`; The Crucible never stages, commits, pushes, or automatically deletes files.

## Autonomous internal recovery (this engine's own repository only)

**This system is not part of the gate an adopting project runs and it never repairs application code.** Every 15 minutes, `canonical-snapshot.yml` checks out `main`, runs the full deterministic verification set, and updates `crucible-canonical` only when those checks pass. A failing candidate therefore cannot replace the last verified snapshot.

When The Crucible's own Self-Test fails on `main`, `internal-recovery.yml` restores the complete tracked tree from `crucible-canonical`, creates a recovery commit and an auditable `crucible-recovery-<run-id>` branch, verifies the restored tree again, and promotes that commit to `main` with an exact force-with-lease check. The lease prevents recovery from overwriting any newer concurrent work. The promoted commit triggers Self-Test again automatically.

The local deterministic fixer remains available for maintainers:

```
node src/cli.js repair
```

`npm run repair` itself applies only the existing privacy, commit-hygiene, and workflow-permission fixers to a local working copy. Autonomous recovery does not depend on guessing how to repair arbitrary logic: it restores the last complete tree that passed verification.

Three safeguards keep local repair from touching an adopting project: `.thecrucible.json` must identify the engine project and maintainer, and GitHub Actions must report the actual repository as `jonathanblunt1214-lgtm/The-Crucible`. Autonomous recovery has stricter workflow-level gates: it accepts only a failed Self-Test from this repository's `main`, reads only the fixed canonical branch, and contains no issue, dispatch, or adopting-repository trigger.
