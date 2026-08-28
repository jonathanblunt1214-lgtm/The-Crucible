# Development log

## Shared AI handoff

- **Agent:** GPT-5.6 Sol.
- **Dev plan:** See `AI-HANDOFF.json` for the exact active plan, test cadence policy, transport rule, verification, and remaining work.
- **Current development work:** Orchestrator and Cadence now form one governed testing system while remaining independent checks on each other rather than one unified selector.
- **Cadence authority:** Cadence decides only when categories are due: Code every push/PR, Security daily, Utility twice weekly, Maintenance weekly. It emits a due-category obligation; it does not select files or execute tests.
- **Orchestrator authority:** The Orchestrator independently decides the concrete tests and execution scope. For cadence work it resolves the due-category obligation through its category/test knowledge.
- **Checks-and-balances rule:** Before a cadence-triggered test invocation executes, reconciliation verifies that the Orchestrator selection covers every category Cadence says is due. Missing a due category fails closed. Cadence cannot choose files, and the Orchestrator cannot silently ignore a due cadence obligation.
- **Specific-request rule:** Explicit owner requests remain immediate and Orchestrator-selected. Cadence cannot delay, randomize, narrow, or replace them.
- **Workflow boundary:** Workflows transport a request or cadence window only; neither workflow chooses tests.
- **Transport replacement rule:** The `CRUCIBLE TEST REQUEST` synthetic commit transport remains temporary workaround infrastructure and must be replaced as soon as a supported direct integration/connection exists, under the owner's standing authorization.
- **Run governance:** Long-running Orchestrator test commands emit progress every 60 seconds; failures persist under `governingDocuments/known-bugs` and require passing exact-test re-test before resolution.
- **Verification state:** Checks-and-balances implementation is being verified on `development`; no promotion to main/release is authorized by this work.

## Command log archive

Chain-of-custody record for recent units of work. Newest first; maximum 10 sessions and 180 days. Older history remains available through Git history.

### Session: Orchestrator/Cadence checks and balances — 2026-08-28T01:15:00Z — GPT-5.6 Sol

- Read current handoff, development log, Orchestrator cadence layer, entry point, and regression tests — started 2026-08-28T01:15:00Z, finished 2026-08-28T01:16:00Z, exit 0.
- Separated cadence frequency authority into `src/testCadencePolicy.js`; Cadence now emits due-category obligations only — started 2026-08-28T01:16:00Z, finished 2026-08-28T01:17:00Z, exit 0.
- Kept Orchestrator selection independent and added fail-closed reconciliation proving its cadence selection covers every due category before execution — started 2026-08-28T01:17:00Z, finished 2026-08-28T01:18:00Z, exit 0.

### Session: Orchestrator cadence baseline correction — 2026-08-28T01:00:00Z — GPT-5.6 Sol

- Self-Test #174 exposed duplicate scheduled audits in the Code baseline plus a stale workflow-contract assertion; corrected with test-only every-push Code cadence and preserved scheduled audits — started 2026-08-28T01:00:00Z, finished 2026-08-28T01:05:47Z, exit 0.

### Session: owner-defined Orchestrator category cadence — 2026-08-28T00:42:00Z — GPT-5.6 Sol

- Defined Code every-push, Security daily, Utility twice-weekly, and Maintenance weekly while preserving immediate explicit-request behavior — started 2026-08-28T00:42:00Z, finished 2026-08-28T00:58:42Z, exit 0.

### Session: temporary test-transport governance — 2026-08-28T00:30:00Z — GPT-5.6 Sol

- Recorded that synthetic commit-message request transport is temporary workaround infrastructure and must be replaced when direct integration exists under standing owner authorization — started 2026-08-28T00:29:30Z, finished 2026-08-28T00:31:00Z, exit 0.

### Session: system-wide code test request — 2026-08-28T00:12:00Z — GPT-5.6 Sol

- Passed owner request `run a system wide code test` without ChatGPT selecting tests; Orchestrator selected and executed the Code scope — started 2026-08-28T00:11:44Z, finished 2026-08-28T00:12:30Z, exit 0.

### Session: Orchestrator progress and known-bug governance — 2026-08-28T00:04:30Z — GPT-5.6 Sol

- Added 60-second progress heartbeat and severity-ordered known-bug lifecycle with mandatory passing exact-test re-verification — started 2026-08-28T00:04:30Z, finished 2026-08-28T00:11:00Z, exit 0.

### Session: random-category proof correction — 2026-08-27T23:52:00Z — GPT-5.6 Sol

- Verified Orchestrator independently chose Security for an explicit random-category request and corrected related regression assertions — started 2026-08-27T23:52:00Z, finished 2026-08-27T23:58:30Z, exit 0.

### Session: natural-language Orchestrator transport — 2026-08-27T23:47:00Z — GPT-5.6 Sol

- Added temporary natural-language request transport while retaining Orchestrator-only test selection — started 2026-08-27T23:47:00Z, finished 2026-08-27T23:52:00Z, exit 0.

### Session: governed manual test requests — 2026-08-27T23:28:00Z — GPT-5.6 Sol

- Established governed request gateway and corrected connector mutation through an atomic clean-tree commit — started 2026-08-27T23:28:00Z, finished 2026-08-27T23:45:00Z, exit 0.

### Session: category-order regression fix — 2026-08-27T23:22:00Z — GPT-5.6 Sol

- Corrected category ordering after all 34 classified test files were selected successfully — started 2026-08-27T23:22:00Z, finished 2026-08-27T23:23:30Z, exit 0.
