# Project branch relationship linking

Crucible supports multiple branch relationship structures and must identify them from project metadata and observed dependencies, never from example branch names.

A **paired** relationship connects two branches that serve coordinated roles in one project lifecycle. The branch names are arbitrary. The project declares both branch names and each branch's role explicitly. No naming pattern, shared prefix, numeric suffix, or example such as `project-123` / `project-abc` has semantic meaning by itself.

A **canonical-reference** relationship connects a dependent branch to another branch whose files, runtime contract, generated assets, or governance are consumed by reference rather than duplicated. Both branch names are arbitrary. The project declares the dependent branch, the canonical branch it depends on, and any required canonical paths. A branch is never treated as special because it happens to be named `Plug-in`, `main`, `extension`, or anything else.

Injected projects keep two synchronized project-local views of this relationship data: `governingDocuments/BRANCH-LINKS.json` is the governance ledger that agents must re-read, and `.crucible-branch-links.json` is the operational mirror used by automated checks. Injection initializes an empty schema when the project has not declared relationships yet; it must never copy Crucible's own repository-specific branch links into another project. If either file already contains project relationships, injection validates them and refuses to silently replace or contradict them.

The schema supports more than one relationship in the same repository. Each entry is classified by its explicit `relationship` value and required fields:

- `paired`: exactly two explicit branch records, each with a project-defined `name` and `role`.
- `canonical-reference`: an explicit dependent `branch`, explicit `dependsOn` canonical branch, and optional `requiredPaths` describing canonical files/contracts the dependent branch relies on.

Canonical-reference discovery remains active as defense in depth. Recognized branch-qualified references, repository URLs, and reference manifests can reveal an undeclared dependency, but discovery is evidence to reconcile with the project ledger—not a branch-name heuristic.

After the canonical branch changes, Crucible automatically repairs deterministic reference drift when it has an exact rename or explicitly declared mapping. It rewrites only recognized references, commits the repair normally to the affected dependent branch, and retests. It must not force-push, merge, rebase, weaken a contract, invent a semantic replacement, or guess project intent. A non-deterministic semantic break fails closed.

Injected projects carry the same relative filenames as the canonical Crucible `governingDocuments` tree. Missing governance files are created as project-local reference/overlay documents, existing project files are preserved, project-local ledgers remain project-local, and `AI-HANDOFF.json` is updated so every mirrored governance filename—including this policy and `BRANCH-LINKS.json`—is part of the project's re-read contract.
