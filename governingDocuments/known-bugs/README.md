# Known bugs governance

This folder is a governed record of test failures discovered by the Orchestrator.

## Criticality order

Known bugs are stored and read in this order:

1. `critical`
2. `high`
3. `medium`
4. `low`

The automatic default derives from the failing governed main test category:

- Security → `critical`
- Code → `high`
- Utility → `medium`
- Maintenance → `low`

If one failing run spans more than one main category, the highest criticality present controls the bug's position. An owner may explicitly raise criticality when impact warrants it; the Orchestrator does not silently lower an existing severity.

## Required lifecycle

1. A failing Orchestrator-owned test invocation writes its category results, exact test files, commit, exit status, and criticality to `KNOWN-BUGS.json`.
2. The entry stays `open` and unchecked while the defect is being repaired.
3. After a repair, run `node src/testCadence.js verify-bug <bug-id>`. The Orchestrator re-runs the exact recorded tests.
4. A failed re-test appends evidence and leaves the bug open.
5. Only a passing re-test may set `status: "resolved"` and `checked: true`.
6. Ledger validation fails closed if a bug is manually checked off without a recorded passing re-test.

Self-Test preserves the governed known-bug ledger as a failure artifact so category failure evidence survives the CI job even though workflow permissions remain read-only.

## Progress updates

For a test command that runs longer than one minute, the Orchestrator emits a progress update every 60 seconds until that test command ends. The governed maximum interval is 90 seconds; the configured interval is deliberately the stricter 60-second value.
