# Host contract

This plugin targets Nexus plugin API version 1 and uses only capabilities currently allowed by Nexus manifests:

- `ui:slot`
- `workspace:read`
- `workspace:write`
- `telemetry:emit`

The plugin contributes `project-actions`, `inspector-panel`, and `command-palette` slots.

## Workspace calls

The plugin expects the Nexus host to provide bounded project-workspace operations through the generic capability handlers:

- `workspace:read` with `operation: "list"` or `operation: "read"`.
- `workspace:write` with `operation: "write"`, `operation: "move"`, or `operation: "delete"`.

All plugin-managed paths are restricted to `governingDocuments/`. Destructive operations require an explicit confirmation flag at the plugin boundary.

## Shared references

Canonical Crucible policies are referenced from the default `main` branch of `jonathanblunt1214-lgtm/The-Crucible`. The plugin deliberately does not need a network capability because it does not download or embed those shared files. Nexus may open the returned GitHub references for the user through its normal host UI.
