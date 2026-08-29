# The Crucible — Nexus plugin

This branch is the standalone Nexus plugin package for The Crucible. Plugin files live at the branch root; there is no extra `plugins/the-crucible/` wrapper because this branch contains only plugin-related material.

## Canonical-source rule

Shared Crucible governance is **not copied into this branch**. The default `main` branch of `jonathanblunt1214-lgtm/The-Crucible` is the canonical source for shared policy and reference material. The plugin exposes links to those canonical files and, when **Auto Inject** is explicitly selected and confirmed, writes only `governingDocuments/CRUCIBLE-REFERENCES.json` into the target project.

That reference manifest points back to the canonical `main` files. Project-specific governance can then be added as a local overlay under `governingDocuments/` without forking or duplicating shared Crucible policy text.

## Behavior

The plugin is optional and disabled until the Nexus user installs and enables it. Auto Inject is off by default and requires explicit selection plus confirmation. Installing or enabling the plugin alone does not modify a project.

The plugin requests only Nexus UI-slot, workspace read/write, and telemetry capabilities. It does not request Git write, shell/process execution, secrets, arbitrary filesystem access, or unrestricted network access.

## Scientific learning

Version 0.1.0 adds project-isolated scientific learning under `governingDocuments/.crucible-learning/<projectId>/`. Candidate evidence is strictly validated and always enters as `Insufficient Evidence`. Separate actions declare a falsifiable hypothesis, record a bounded controlled experiment, confirm causal isolation, record independent verification, promote verified knowledge, retrieve records, quarantine/reject evidence, and roll back a knowledge version.

Promotion is fail-closed. Raw telemetry, correlations, retrieval, repeated observations, guesses, incomplete observations, untested hypotheses, and one-off repairs can never promote. Verification must match the exact tested property and experiment boundary. Conflicts with active verified knowledge are classified as `Crucible Issue` and quarantined instead of overwriting knowledge. Retrieval returns records but never satisfies a proof gate.

Plugin telemetry contains only non-evidentiary action metadata and is never read by the learning state machine. Weekly authenticated encrypted exchange remains unavailable in the plugin until Nexus provides a trusted cryptographic and OIDC identity capability; the plugin does not downgrade that core requirement or request secrets/network access to work around it.

## Canonical references

The reference manifest points at the default branch for shared material including `AGENTS.md`, `README.md`, AI conflict and required-check templates, agent boundaries, and the injection prerequisite/monitoring/native-validation/credential templates. These files stay in one canonical location instead of being duplicated in the plugin branch and every receiving repository.

## Project-specific overrides

Use the plugin configuration surface to create, edit, move, or delete project-specific text under `governingDocuments/`. Shared canonical documents should remain references unless a local copy is mechanically required by the project or a deliberate project-specific override is needed.

## Verification

Run `npm test` and `npm run verify` from this branch. Nexus still performs its own security screening before a plugin can be installed or published through the Nexus marketplace flow.
