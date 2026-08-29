# The Crucible Nexus plugin

Version **0.0.1** is the first public-development version of The Crucible as an optional Nexus plugin.

## Installation model

The plugin is not installed, enabled, or injected by default. Nexus must import or install the plugin package, security-screen it, and leave it disabled until the user explicitly enables it.

Enabling the plugin still does not inject governance. **Auto Inject The Crucible** is a separate opt-in action that starts unchecked, requires explicit selection and confirmation, and defaults to no overwrite.

## Configuration

The plugin declares a generic `governance-editor` configuration surface rooted at `governingDocuments/`. Through Nexus, a compatible host can list, read, create, update, move, and delete text governance files. Destructive operations require confirmation, and every plugin-side path is normalized and rejected if it leaves `governingDocuments/`.

Governance contents are normal project files. The plugin does not hide them from source control, project review, or the project's own validation/governance rules.

## Private injection history

Auto Inject requires an authenticated Nexus account before it writes. After a successful write, the plugin records only non-secret audit metadata through the generic `account:private` capability: plugin version, action, project reference, timestamp, and injected file paths. It never places an injection-history ledger in the project or repository.

Nexus is responsible for enforcing that `account:private` data is namespaced by plugin and accessible only to the authenticated account that owns it. See `HOST-CONTRACT.md`.

## Security model

The runtime entry is self-contained and requests only:

- `ui:slot`
- `workspace:read`
- `workspace:write`
- `account:private`
- `telemetry:emit`

It does not request shell/process execution, Git write, unrestricted network access, secret access, or arbitrary filesystem access. `scripts/verify.js` mechanically rejects an unexpected capability set or Node/process execution in the runtime entry.

## Development and release

From `nexus-plugin/`:

```text
npm test
npm run verify
npm run package
```

`npm run package` creates a deterministic source package in `dist/`, which is intentionally git-ignored. Nexus performs its own install-time screening and marketplace packaging.

For a signed release, set `NEXUS_PLUGIN_SIGNING_KEY_PEM` only in the protected release environment and run `npm run sign`. The private key is never generated, stored, or committed by this repository.

## Compatibility

The package targets Nexus plugin API v1 and declares Nexus >= 1.0.3. Full functionality requires the host operations defined in `HOST-CONTRACT.md`; unsupported operations must fail visibly rather than being simulated.
