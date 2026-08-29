# Canonical-reference branch linking

Crucible supports two different branch-link relationships and must not confuse them.

The normal project relationship is the explicit paired-link convention already used for names such as `project-123` / `project-abc` (and equivalent linked main/development role pairs). Matching identifiers make the relationship visible in the branch topology.

A **canonical-reference branch** is different. Its name may look unrelated to `main`, while its files, runtime contract, generated package, or governance deliberately depend on canonical material from `main`. The Crucible repository's `Plug-in` branch is the reference example: it is intentionally plugin-only and avoids duplicating shared Crucible files, but that means changes to `main` can silently affect whether the plugin still resolves and satisfies those references.

Canonical-reference relationships MUST be declared in `.crucible-branch-links.json` on the canonical branch. A declaration makes the otherwise implicit dependency part of project governance. Reference discovery remains active as defense in depth, so an undeclared branch that contains recognized `main:<path>`, same-repository GitHub `blob/main/...`, raw-main URLs, or `.crucible-main-references.json` references is still checked.

After a canonical `main` update, Crucible must not stop at reporting a deterministic reference break. When Git identifies a canonical path rename, Crucible automatically rewrites only recognized reference syntax on each affected linked third branch, updates `.crucible-main-references.json` path fields when applicable, commits the repair to that branch with a normal non-force push, fetches the branch again, and reruns the integrity audit. The repair is complete only when the retest passes.

Automatic repair is deliberately bounded. Crucible may follow an exact rename or another explicitly declared deterministic mapping. It must not guess a semantic replacement, invent project behavior, weaken a contract, delete a requirement, force-push, merge, or rebase the linked branch merely to make a check green. When no deterministic repair exists, the gate fails closed with the unresolved dependency instead of pretending it was fixed.

Injected projects carry the same relative filenames as the canonical Crucible `governingDocuments` tree. The injection process derives that filename set from the pinned Crucible runtime instead of maintaining a hand-written duplicate list. Existing project-specific governance files are preserved; missing Markdown files are created as local reference/overlay documents, project known-bug JSON starts as an empty local ledger, and project `AI-HANDOFF.json` is updated so every mirrored governance file is actually named and re-readable. This filename-parity invariant includes this branch-linking policy, so injected projects are taught both the normal paired-link model and the canonical-reference model.
