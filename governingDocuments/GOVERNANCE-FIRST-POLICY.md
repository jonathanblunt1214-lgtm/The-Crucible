# Governance-first policy

1. A user instruction to **check governance** means governance takes priority over all other work.
2. The agent must detect every file currently present in `governance/` and treat any unregistered file there as newly introduced governance.
3. Newly introduced governance must be moved to its canonical location if misplaced and registered in `AI-HANDOFF.json.governingDocuments` before other work proceeds.
4. The agent must then reread the entire governance set: `AGENTS.md`, `AI-CONFLICTS.json`, `DEVLOG.md`, every path in `AI-HANDOFF.json.governingDocuments`, and every file currently under `governance/`.
5. `AI-CONFLICTS.json` is mandatory and may never be bypassed, disabled, or treated as advisory only.
6. Any `active` conflict blocks unrelated work. The only allowed actions are correction, evidence gathering for correction, or explicit owner-blocked escalation recorded in the ledger.
7. Any ambiguity about where a governance file belongs is resolved conservatively: keep it under `governance/`, register it, and fail closed until the owner chooses a stricter canonical path.
