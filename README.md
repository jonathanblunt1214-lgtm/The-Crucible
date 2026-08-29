# The Crucible — Nexus plugin

This branch is the standalone Nexus plugin package for The Crucible. Plugin files live at the branch root; there is no extra `plugins/the-crucible/` wrapper because this branch contains only plugin-related material.

## Canonical-source rule

Shared Crucible governance is **not copied into this branch**. The default `main` branch of `jonathanblunt1214-lgtm/The-Crucible` is the canonical source for shared policy and reference material. The plugin exposes links to those canonical files and, when **Auto Inject** is explicitly selected and confirmed, writes only `governingDocuments/CRUCIBLE-REFERENCES.json` into the target project.

That reference manifest points back to the canonical `main` files. Project-specific governance can then be added as a local overlay under `governingDocuments/` without forking or duplicating shared Crucible policy text.

## Behavior

The plugin is optional and disabled until the Nexus user installs and enables it. Auto Inject is off by default and requires explicit selection plus confirmation. Installing or enabling the plugin alone does not modify a project.

The plugin requests only Nexus UI-slot, workspace read/write, and telemetry capabilities. It does not request Git write, shell/process execution, secrets, arbitrary filesystem access, or unrestricted network access.

## Canonical references

The reference manifest points at the default branch for shared material including `AGENTS.md`, `README.md`, AI conflict and required-check templates, agent boundaries, and the injection prerequisite/monitoring/native-validation/credential templates. These files stay in one canonical location instead of being duplicated in the plugin branch and every receiving repository.

## Project-specific overrides

Use the plugin configuration surface to create, edit, move, or delete project-specific text under `governingDocuments/`. Shared canonical documents should remain references unless a local copy is mechanically required by the project or a deliberate project-specific override is needed.

## Verification

Run `npm test` and `npm run verify` from this branch. Nexus still performs its own security screening before a plugin can be installed or published through the Nexus marketplace flow.
