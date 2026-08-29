# Branch and injected-governance linking

Crucible treats branch names as project data, never as global conventions. Each repository may declare multiple independent branch relationships, and every relationship is identified from explicit metadata plus observed repository references rather than from example names.

A `paired` relationship explicitly names the two branches and their roles. A `canonical-reference` relationship explicitly names the dependent branch, the canonical branch it depends on, and any required canonical paths. The names, roles, canonical branch, number of relationships, and required paths are project-specific.

Canonical-reference discovery remains active as defense in depth. Recognized branch/path references can reveal a real dependency that was not yet declared, but discovery must not manufacture a relationship merely because names resemble another project.

## Automatic repair after canonical changes

When a canonical branch changes, deterministic downstream reference repairs are automatic where Crucible has exact evidence. Exact Git renames and explicitly declared mappings may be used to rewrite recognized references, followed by a normal non-force commit to the dependent branch and a complete retest. Crucible must not stop at diagnosis when a safe deterministic repair is authorized and executable.

Semantic substitutions are different. Crucible must never guess a new API, weaken a requirement, delete a contract, force-push, merge, rebase, or invent project behavior merely to make a downstream check pass. When there is no deterministic repair, the relationship fails closed with the unresolved dependency.

## Adaptive injected governingDocuments

Injection is a reconciliation process, not a one-time copy operation. The current canonical Crucible `governingDocuments` relative file inventory is the source of truth for the active injected `governingDocuments` filename and directory structure.

On every reconciliation:

- every current canonical relative path must exist in the injected project's `governingDocuments`;
- paths newly added by canonical governance are created automatically as project-adapted governance files;
- obsolete Crucible-managed paths that were not locally changed are removed automatically;
- canonical directory moves and filename changes are reflected by retiring old paths and creating the current canonical paths;
- locally edited obsolete paths and project-created extra files are preserved outside the parity tree under `.crucible-overrides/governingDocuments/...` rather than deleted;
- existing local overrides at still-current canonical paths are preserved in place;
- symbolic links, unsafe paths, and file/directory collisions that cannot be resolved without overwriting project material fail closed;
- `.crucible-injection-state.json` records managed fingerprints and preservation history so later reconciliations can distinguish untouched generated material from developer-owned changes;
- `AI-HANDOFF.json.governingDocuments` is reconciled to the current canonical relative path set so agents do not keep stale renamed or removed governance paths.

The resulting active `governingDocuments` file list must exactly match the canonical Crucible `governingDocuments` file list by relative name after reconciliation. Project-specific material that is not part of that canonical filename set belongs in the preservation/override surface, not as an extra file inside the parity tree.

`governingDocuments/BRANCH-LINKS.json` is project-local data even though its filename follows canonical parity. It must describe the receiving repository's real relationships, not Crucible's own relationships. `.crucible-branch-links.json` is the operational mirror. The two must agree.

This model is deliberately designed for actively managed repositories: canonical governance may add, remove, rename, or move files while project developers simultaneously edit their own governance. Reconciliation adapts structure mechanically where safe, preserves local work when ownership is ambiguous, and fails closed instead of clobbering an active project.
