# Development log

## Shared AI handoff

- **Agent:** GPT-5.6 Sol.
- **Dev plan:** See `AI-HANDOFF.json` for the exact active plan, test cadence policy, transport rule, verification, and remaining work.
- **Current development work:** Add a third independent check to the Orchestrator/Cadence system: an evidence-based closest-feature classifier for newly discovered tests that have no explicit category mapping.
- **Classifier boundary:** Existing explicit mappings remain authoritative. Only unmapped new tests reach the classifier; it compares them to known categorized feature/test evidence, accepts only a unique closest category, and fails closed on ties, no evidence, or unreadable candidates. It cannot select run scope, set cadence, or execute tests.
- **Cadence authority:** Cadence decides only when categories are due: Code every push/PR, Security daily, Utility twice weekly, Maintenance weekly.
- **Orchestrator authority:** The Orchestrator remains the sole test-selection/execution authority and consumes only validated classifications and cadence obligations.
- **Checks-and-balances rule:** Reconciliation verifies the Orchestrator selection covers every category Cadence says is due before execution. Missing due coverage fails closed.
- **Specific-request rule:** Explicit owner requests remain immediate and Orchestrator-selected; cadence and classification cannot randomize, delay, narrow, or replace them.
- **Regression correction:** Self-Test #176 exposed that `orchestratorTestsForCategories` returned legacy selection objects instead of concrete `.tests`, producing `Unclassified test "[object Object]"`. The current correction unwraps concrete test paths and protects the boundary with regression coverage.
- **Verification state:** The classifier/fix commit is being prepared on `development`; Self-Test and CodeQL must both be green before this work is complete. No promotion to main/release is authorized.

## Command log archive

Chain-of-custody record for recent units of work. Newest first; maximum 10 sessions and 180 days. Older history remains available through Git history.

### Session: independent closest-feature classifier — 2026-08-28T01:26:00Z — GPT-5.6 Sol

- Read current handoff/governance and inspected Self-Test #176 failure logs; confirmed the cadence selection-object regression — started 2026-08-28T01:26:00Z, finished 2026-08-28T01:28:00Z, exit 0.
- Re-read the complete governing-document set after the 10-minute policy threshold elapsed — started 2026-08-28T01:28:00Z, finished 2026-08-28T01:30:00Z, exit 0.
- Prepared independent closest-feature classifier, active Orchestrator classification integration, selection-object fix, regression tests, and paired governance updates — started 2026-08-28T01:30:00Z, finished 2026-08-28T01:31:00Z, exit 0.

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
