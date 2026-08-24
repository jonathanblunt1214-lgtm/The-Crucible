# The Crucible

The Crucible is a repository-independent GitHub Actions quality gate. A project opts in by adding `.thecrucible.json` and a small caller workflow. The project remains independent: The Crucible does not copy application code between repositories, does not require another application, and does not receive write access to the project.

## Exactly what it does

### On every push and pull request

The caller workflow checks out the project commit that triggered the run, checks out an exact pinned commit of this repository into `.the-crucible-runtime`, and runs with read-only contents and pull-request permissions.

The engine then:

1. Loads `.thecrucible.json` from the project.
2. Rejects malformed configuration, unsupported schema versions, absolute paths, parent-directory traversal, unbounded workload values, and executable paths embedded in configuration.
3. Audits every Git-tracked project file for clutter.
4. Audits staged tracked text for personal identifiers, credentials, and private keys.
5. Runs the Security Gate against the staged Git snapshot before any project preparation or heavy workload begins.
6. On pull requests, reports files that overlap another open pull request before workload execution.
7. Pre-checks the exact staged snapshot locally (or commit SHA in CI), then parses changed JSON/JavaScript and runs only configured checks whose path patterns match changed files.

## Language-aware pre-check report

`npm run precheck` combines the Commit Gate with changed-file code checks. Built-in parsing reads the staged or committed snapshot, not an unrelated working copy. Projects can add `codeCheck.commands` with `include` path patterns; `{files}` in an argument expands to only the matching changed paths. Commands without `{files}` run once when a matching file changes, which is useful for an affected package's test suite.

Every required action in this report uses exactly one class: `safe auto-fix`, `test failure`, `security concern`, or `human code review required`. In GitHub Actions, the same report is appended to the run's latest job summary through `GITHUB_STEP_SUMMARY`, alongside the existing checks. Safe auto-fixes keep the existing review-and-restage flow through `npm run fix:commit`; the pre-check never silently rewrites application code. Parser failures and checks without a deterministic repair require human review. Configure test, security, and review commands with the corresponding `failureAction` value.
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

### Collision protection

For pull-request runs, the reusable workflow uses read-only pull-request access to compare the current PR's changed files with every other open PR. Any overlap fails before the heavy workload and reports only PR numbers, titles, and paths. Outside a GitHub pull-request context the collision audit skips safely. It never closes, modifies, approves, or merges a pull request.

### Weekly

At 04:47 UTC every Sunday, the caller runs the clutter, privacy, and Security Gates, the full configured workload, artifact verification, and safe Git maintenance.

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

The duplicated commit SHA is intentional. The workflow itself and the engine checkout are pinned to the same immutable version. Updating The Crucible requires an explicit project commit changing both values.

Every change to this repository is independently exercised on Linux, Windows, and macOS with supported Node.js versions before that commit should be adopted by another project. A project should pin only a commit whose **The Crucible Self-Test** matrix has passed.

For private projects, this repository's **Settings → Actions → General → Access** setting must permit reusable-workflow access from other repositories owned by the same account or organization.

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

### `workload`

- `workers`: Concurrent workers, from 1 through 8. Default: 4.
- `cycles`: Complete verification cycles per worker, from 1 through 20. Default: 2.
- `timeoutMinutes`: Maximum time for each command, from 1 through 30. Default: 4.

The number of verification command executions is:

```text
workers × cycles × number of verify commands
```

## What it deliberately does not do

The Crucible does not silently delete clutter, automatically fix application code, upload project source elsewhere, collect telemetry, read unrelated repositories, expose repository secrets, modify branch protection, approve pull requests, publish releases, or push commits. It reports failures and leaves changes under the repository owner's control.

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
