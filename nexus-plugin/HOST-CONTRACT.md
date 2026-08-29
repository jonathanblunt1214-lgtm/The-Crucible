# Host contract

The Crucible plugin is host-independent plugin source. Nexus remains the authority for authorization, UI rendering, filesystem mutation, account identity, storage, security screening, enable/disable lifecycle, and marketplace distribution.

## Required API

The plugin targets Nexus plugin API v1 with these capability calls.

### `workspace:read`

The host must authorize the active project root independently of plugin input.

- `{ operation: "list", path: "governingDocuments", recursive: true, textOnly: true }` returns `{ files: string[] | {path:string}[] }`.
- `{ operation: "read", path, encoding: "utf-8" }` returns `{ content: string }`.

The host must reject absolute paths, traversal, symlink escapes, binary reads, and paths outside the authorized project.

### `workspace:write`

- `operation: "write"` accepts bounded UTF-8 `files` and an explicit `overwrite` boolean.
- `operation: "delete"` accepts bounded `paths`.
- `operation: "move"` accepts bounded `{from,to}` pairs and an explicit `overwrite` boolean.

The host must repeat project-boundary validation for every source and destination, perform atomic writes/moves where the platform supports them, and reject a destructive overwrite unless explicitly authorized.

### `account:private`

All storage must be keyed by the authenticated Nexus account **and** plugin namespace. The plugin sends `namespace: "the-crucible"`.

- `status` returns `{ ok:true, signedIn:true }` only for an authenticated account eligible for private storage.
- `record` appends bounded JSON-safe metadata for that authenticated account.
- `list` returns only records for that same account and namespace; optional `projectRef` filtering is host-side.

A project path or repository file is never a valid backing store for this capability. Account-private records must not be visible to another Nexus account, another plugin namespace, project collaborators merely because they can read the project, or marketplace users.

## Configuration UI

The `project-actions` default response advertises:

- `configuration.type = "governance-editor"`
- root `governingDocuments`
- operations `list`, `read`, `create`, `update`, `move`, `delete`
- destructive confirmation requirement

A compatible Nexus host should render this as the plugin's configuration menu. The plugin does not inject renderer JavaScript into Nexus and does not depend on Crucible-specific host code.

## Lifecycle

Import/install must leave the plugin disabled. Enable/disable invokes `onActivate`/`onDeactivate`. Upgrading a plugin must stage and screen the replacement before atomically replacing the installed version, preserve disabled/enabled intent without activating unreviewed code, and make rollback possible if activation fails.

## Failure behavior

Unsupported capabilities or operations must return an error. Nexus and the plugin must not fabricate a successful configuration, injection, private tracking, security screen, signature check, or marketplace publication.
