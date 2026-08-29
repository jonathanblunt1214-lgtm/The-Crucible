'use strict';

const PLUGIN_ID = 'the-crucible';
const PLUGIN_NAME = 'The Crucible';
const VERSION = '0.0.1';
const GOVERNANCE_ROOT = 'governingDocuments';

const BOOTSTRAP_FILES = Object.freeze([
  Object.freeze({
    path: 'governingDocuments/README.md',
    content: '# The Crucible governance\n\nThis governance tree is managed as normal project source. The Nexus plugin can list, open, create, edit, move, and delete text files under `governingDocuments/` when the user explicitly performs those actions. Plugin installation or enablement alone never changes this project.\n'
  }),
  Object.freeze({
    path: 'governingDocuments/crucible-plugin-governance.md',
    content: '# The Crucible plugin governance\n\n- Auto Inject is opt-in and requires explicit selection and confirmation.\n- Auto Inject never overwrites an existing governance file unless overwrite is separately authorized.\n- Governance files remain project-visible source and follow the project\'s normal review, validation, and branch rules.\n- Injection-history records are stored only through Nexus account-private storage for the authenticated account that performed the injection.\n- The plugin never receives shell, Git-write, unrestricted network, secret-store, or arbitrary filesystem authority.\n'
  })
]);

function action(id, label, description, extra = {}) {
  return Object.freeze({ id, label, description, ...extra });
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isGovernancePath(value, { allowRoot = false } = {}) {
  const normalized = normalizePath(value);
  if (normalized === GOVERNANCE_ROOT) return allowRoot;
  if (!normalized.startsWith(`${GOVERNANCE_ROOT}/`)) return false;
  const relative = normalized.slice(GOVERNANCE_ROOT.length + 1);
  if (!relative || relative === '.' || relative === '..') return false;
  return !relative.split('/').some((part) => !part || part === '.' || part === '..');
}

function requireGovernanceFile(value) {
  const normalized = normalizePath(value);
  if (!isGovernancePath(normalized)) throw new Error('Governance operations are restricted to files inside governingDocuments/.');
  return normalized;
}

async function accountStatus() {
  const status = await nexus.call('account:private', { operation: 'status', namespace: PLUGIN_ID });
  if (!status || status.ok !== true || status.signedIn !== true) throw new Error('Sign in to Nexus before using account-private Crucible injection tracking.');
  return status;
}

async function listGovernance() {
  const result = await nexus.call('workspace:read', { operation: 'list', path: GOVERNANCE_ROOT, recursive: true, textOnly: true });
  return {
    ok: true,
    root: GOVERNANCE_ROOT,
    files: (result?.files || []).map((item) => typeof item === 'string' ? item : item.path).filter((item) => isGovernancePath(item)).sort()
  };
}

async function readGovernance(payload) {
  const path = requireGovernanceFile(payload.path);
  const result = await nexus.call('workspace:read', { operation: 'read', path, encoding: 'utf-8' });
  return { ok: true, path, content: String(result?.content || '') };
}

async function writeGovernance(payload) {
  const path = requireGovernanceFile(payload.path);
  if (typeof payload.content !== 'string') throw new Error('Governance content must be text.');
  const result = await nexus.call('workspace:write', {
    operation: 'write',
    overwrite: payload.overwrite === true,
    files: [{ path, content: payload.content, encoding: 'utf-8' }]
  });
  nexus.emitTelemetry('crucible.governance.write', { version: VERSION, path, overwrite: payload.overwrite === true });
  return { ok: true, path, result };
}

async function deleteGovernance(payload) {
  const path = requireGovernanceFile(payload.path);
  if (payload.confirmed !== true) return { ok: false, requiresConfirmation: true, path };
  const result = await nexus.call('workspace:write', { operation: 'delete', paths: [path] });
  nexus.emitTelemetry('crucible.governance.delete', { version: VERSION, path });
  return { ok: true, path, result };
}

async function moveGovernance(payload) {
  const from = requireGovernanceFile(payload.from);
  const to = requireGovernanceFile(payload.to);
  if (from === to) throw new Error('Source and destination governance paths are identical.');
  if (payload.confirmed !== true) return { ok: false, requiresConfirmation: true, from, to };
  const result = await nexus.call('workspace:write', {
    operation: 'move',
    overwrite: payload.overwrite === true,
    moves: [{ from, to }]
  });
  nexus.emitTelemetry('crucible.governance.move', { version: VERSION, from, to, overwrite: payload.overwrite === true });
  return { ok: true, from, to, result };
}

async function previewAutoInject() {
  const existing = await listGovernance().catch(() => ({ files: [] }));
  const present = new Set(existing.files);
  return {
    ok: true,
    selectedByDefault: false,
    requiresConfirmation: true,
    writes: BOOTSTRAP_FILES.map((file) => ({ path: file.path, exists: present.has(file.path), defaultOverwrite: false }))
  };
}

async function autoInject(payload) {
  if (payload.selected !== true || payload.confirmed !== true) {
    return { ok: false, requiresSelection: true, requiresConfirmation: true, message: 'Auto Inject is off by default and requires explicit selection plus confirmation.' };
  }
  await accountStatus();
  const files = BOOTSTRAP_FILES.map((file) => ({ path: file.path, content: file.content, encoding: 'utf-8' }));
  const write = await nexus.call('workspace:write', { operation: 'write', overwrite: payload.overwrite === true, files });
  const written = (write?.written || files).map((item) => typeof item === 'string' ? item : item.path).filter(Boolean);
  const tracking = await nexus.call('account:private', {
    operation: 'record',
    namespace: PLUGIN_ID,
    record: {
      schemaVersion: 1,
      pluginVersion: VERSION,
      action: 'auto-inject',
      projectRef: payload.projectRef || null,
      files: written,
      timestamp: new Date().toISOString()
    }
  });
  if (!tracking || tracking.ok !== true) throw new Error('Injection completed but account-private tracking could not be confirmed. Review the project before retrying.');
  nexus.emitTelemetry('crucible.plugin.auto-injected', { version: VERSION, fileCount: written.length });
  return { ok: true, written, accountPrivateTracking: true, message: 'The Crucible governance bootstrap was injected and recorded in the current Nexus account.' };
}

async function trackingList(payload) {
  await accountStatus();
  return nexus.call('account:private', { operation: 'list', namespace: PLUGIN_ID, projectRef: payload.projectRef || null });
}

async function projectAction(payload = {}) {
  switch (payload.actionId) {
    case 'crucible-auto-inject-preview': return previewAutoInject();
    case 'crucible-auto-inject': return autoInject(payload);
    case 'crucible-governance-list': return listGovernance();
    case 'crucible-governance-read': return readGovernance(payload);
    case 'crucible-governance-write': return writeGovernance(payload);
    case 'crucible-governance-delete': return deleteGovernance(payload);
    case 'crucible-governance-move': return moveGovernance(payload);
    case 'crucible-tracking-list': return trackingList(payload);
    default:
      return {
        plugin: PLUGIN_NAME,
        pluginId: PLUGIN_ID,
        version: VERSION,
        configuration: {
          type: 'governance-editor',
          root: GOVERNANCE_ROOT,
          textOnly: true,
          operations: ['list', 'read', 'create', 'update', 'move', 'delete'],
          destructiveOperationsRequireConfirmation: true
        },
        actions: [
          action('crucible-auto-inject', 'Auto Inject The Crucible', 'Inject the bundled governance bootstrap only after explicit selection and confirmation.', { selectable: true, selectedByDefault: false, requiresConfirmation: true }),
          action('crucible-configure-governance', 'Configure Crucible governance', 'Manage every text file inside governingDocuments/ through the Nexus plugin configuration surface.', { opensConfiguration: true }),
          action('crucible-private-tracking', 'My Crucible injection history', 'View injection records stored only for the currently authenticated Nexus account.', { accountPrivate: true })
        ]
      };
  }
}

register({
  onActivate() { nexus.emitTelemetry('crucible.plugin.activated', { version: VERSION }); },
  onDeactivate() { nexus.emitTelemetry('crucible.plugin.deactivated', { version: VERSION }); },
  slots: {
    'project-actions': projectAction,
    'inspector-panel': async (payload = {}) => ({
      title: 'The Crucible',
      pluginId: PLUGIN_ID,
      version: VERSION,
      projectRef: payload.projectRef || null,
      governance: await listGovernance().catch(() => ({ root: GOVERNANCE_ROOT, files: [] })),
      autoInject: { selectedByDefault: false, requiresConfirmation: true },
      injectionHistoryVisibility: 'current authenticated Nexus account only'
    }),
    'command-palette': async () => ({
      commands: [
        action('crucible.configure', 'Crucible: Configure governance', 'Open the governance editor.', { opensConfiguration: true }),
        action('crucible.inject', 'Crucible: Auto Inject', 'Preview and explicitly confirm Auto Inject.', { selectable: true, selectedByDefault: false }),
        action('crucible.history', 'Crucible: My injection history', 'View account-private injection history.', { accountPrivate: true })
      ]
    })
  }
});
