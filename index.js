'use strict';

const PLUGIN_ID = 'the-crucible';
const PLUGIN_NAME = 'The Crucible';
const VERSION = '0.0.1';
const GOVERNANCE_ROOT = 'governingDocuments';
const REFERENCE_MANIFEST = `${GOVERNANCE_ROOT}/CRUCIBLE-REFERENCES.json`;
const BRANCH_LINK_MANIFEST = `${GOVERNANCE_ROOT}/BRANCH-LINKS.json`;
const CANONICAL_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';
const CANONICAL_BRANCH = 'main';

const CANONICAL_DOCUMENTS = Object.freeze([
  'AGENTS.md',
  'README.md',
  'templates/ai-conflict-resolution.md',
  'templates/required-check-rollout.md',
  'templates/agent-boundaries.md',
  'governingDocuments/branch-linking-policy.md',
  'governingDocuments/BRANCH-LINKS.json',
  'governingDocuments/templates/injection-prerequisites.md',
  'governingDocuments/templates/injection-monitoring.md',
  'governingDocuments/templates/injection-monitor-task.md',
  'governingDocuments/templates/injection-native-validation.md',
  'governingDocuments/templates/injection-credential-scope.md',
  'governingDocuments/templates/INJECTION-PREREQUISITES.example.json'
]);

function canonicalUrl(path) {
  return `https://github.com/${CANONICAL_REPOSITORY}/blob/${CANONICAL_BRANCH}/${path}`;
}

function canonicalReferenceManifest() {
  return {
    schemaVersion: 1,
    source: {
      repository: CANONICAL_REPOSITORY,
      branch: CANONICAL_BRANCH,
      policy: 'reference-shared-content-from-default-branch'
    },
    documents: CANONICAL_DOCUMENTS.map((path) => ({ path, url: canonicalUrl(path) })),
    localOverlayRoot: GOVERNANCE_ROOT,
    branchLinkManifest: BRANCH_LINK_MANIFEST,
    note: 'Shared Crucible governance is referenced from the default branch. Branch relationships are project data, not inferred from example names.'
  };
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isGovernancePath(value) {
  const normalized = normalizePath(value);
  if (!normalized.startsWith(`${GOVERNANCE_ROOT}/`)) return false;
  const relative = normalized.slice(GOVERNANCE_ROOT.length + 1);
  return Boolean(relative) && !relative.split('/').some((part) => !part || part === '.' || part === '..');
}

function requireGovernancePath(value) {
  const normalized = normalizePath(value);
  if (!isGovernancePath(normalized)) throw new Error('Governance operations are restricted to files inside governingDocuments/.');
  return normalized;
}

function normalizeBranchName(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty branch name.`);
  return value.trim();
}

function normalizeRequiredPaths(link) {
  const raw = link.requiredPaths ?? link.requiredMainPaths ?? [];
  if (!Array.isArray(raw)) throw new Error('canonical-reference required paths must be an array.');
  return raw.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error('canonical-reference required paths must be non-empty strings.');
    return normalizePath(item);
  });
}

function classifyBranchLinks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('BRANCH-LINKS.json must contain an object.');
  if (raw.schemaVersion !== 1) throw new Error('BRANCH-LINKS.json schemaVersion must be 1.');
  if (!Array.isArray(raw.links)) throw new Error('BRANCH-LINKS.json links must be an array.');

  const canonicalReferences = [];
  const pairedRelationships = [];
  for (const link of raw.links) {
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error('BRANCH-LINKS.json link entries must be objects.');
    const relationship = link.relationship || link.type;
    if (relationship === 'canonical-reference') {
      const sourceBranch = normalizeBranchName(link.branch ?? link.sourceBranch, 'canonical-reference source branch');
      const targetBranch = normalizeBranchName(link.dependsOn ?? link.targetBranch ?? raw.canonicalBranch, 'canonical-reference target branch');
      canonicalReferences.push({
        relationship: 'canonical-reference',
        sourceBranch,
        targetBranch,
        requiredPaths: normalizeRequiredPaths(link),
        automaticRepair: link.automaticRepair || null
      });
      continue;
    }
    if (relationship === 'paired' || relationship === 'lifecycle-pair') {
      const rawBranches = link.branches || [link.branch, link.pairedWith].filter(Boolean);
      if (!Array.isArray(rawBranches) || rawBranches.length < 2) throw new Error('paired relationship must declare at least two branches.');
      const branches = rawBranches.map((entry, index) => {
        if (typeof entry === 'string') return { branch: normalizeBranchName(entry, `paired branch ${index + 1}`), role: null };
        if (!entry || typeof entry !== 'object') throw new Error('paired relationship branch entries must be strings or objects.');
        return { branch: normalizeBranchName(entry.branch ?? entry.name, `paired branch ${index + 1}`), role: typeof entry.role === 'string' ? entry.role : null };
      });
      pairedRelationships.push({ relationship: 'paired', branches });
      continue;
    }
    throw new Error(`Unsupported branch relationship: ${String(relationship)}`);
  }
  return { schemaVersion: 1, canonicalReferences, pairedRelationships };
}

function action(id, label, description, extra = {}) {
  return Object.freeze({ id, label, description, ...extra });
}

async function listLocalGovernance() {
  const result = await nexus.call('workspace:read', { operation: 'list', path: GOVERNANCE_ROOT, recursive: true, textOnly: true });
  return (result?.files || [])
    .map((item) => typeof item === 'string' ? item : item.path)
    .filter((item) => isGovernancePath(item))
    .sort();
}

async function readWorkspaceText(path) {
  const result = await nexus.call('workspace:read', { operation: 'read', path, encoding: 'utf-8' });
  return String(result?.content || '');
}

async function readBranchRelationships() {
  try {
    const parsed = JSON.parse(await readWorkspaceText(BRANCH_LINK_MANIFEST));
    return { ok: true, declared: true, manifestPath: BRANCH_LINK_MANIFEST, ...classifyBranchLinks(parsed) };
  } catch (error) {
    if (/not found/i.test(String(error?.message || ''))) {
      return { ok: true, declared: false, manifestPath: BRANCH_LINK_MANIFEST, schemaVersion: 1, canonicalReferences: [], pairedRelationships: [] };
    }
    return { ok: false, declared: true, manifestPath: BRANCH_LINK_MANIFEST, error: String(error?.message || error) };
  }
}

async function readLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  return { ok: true, path, content: await readWorkspaceText(path) };
}

async function writeLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  if (path === REFERENCE_MANIFEST && payload.allowReferenceManifestEdit !== true) {
    throw new Error('CRUCIBLE-REFERENCES.json is managed by Auto Inject. Use explicit reference-manifest override only when intentionally replacing canonical references.');
  }
  if (typeof payload.content !== 'string') throw new Error('Governance content must be text.');
  const result = await nexus.call('workspace:write', {
    operation: 'write',
    overwrite: payload.overwrite === true,
    files: [{ path, content: payload.content, encoding: 'utf-8' }]
  });
  nexus.emitTelemetry('crucible.governance.write', { version: VERSION, path, overwrite: payload.overwrite === true });
  return { ok: true, path, result };
}

async function deleteLocalGovernance(payload) {
  const path = requireGovernancePath(payload.path);
  if (payload.confirmed !== true) return { ok: false, requiresConfirmation: true, path };
  const result = await nexus.call('workspace:write', { operation: 'delete', paths: [path] });
  nexus.emitTelemetry('crucible.governance.delete', { version: VERSION, path });
  return { ok: true, path, result };
}

async function moveLocalGovernance(payload) {
  const from = requireGovernancePath(payload.from);
  const to = requireGovernancePath(payload.to);
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
  let exists = false;
  try { await readWorkspaceText(REFERENCE_MANIFEST); exists = true; } catch (_) {}
  return {
    ok: true,
    selectedByDefault: false,
    requiresConfirmation: true,
    writes: [{ path: REFERENCE_MANIFEST, exists, defaultOverwrite: false }],
    canonicalDocuments: canonicalReferenceManifest().documents,
    branchRelationshipRule: 'Project-specific branch names and dependency paths come from governingDocuments/BRANCH-LINKS.json; examples are never treated as naming rules.'
  };
}

async function autoInject(payload) {
  if (payload.selected !== true || payload.confirmed !== true) {
    return { ok: false, requiresSelection: true, requiresConfirmation: true, message: 'Auto Inject is off by default and requires explicit selection plus confirmation.' };
  }
  const manifest = `${JSON.stringify(canonicalReferenceManifest(), null, 2)}\n`;
  const result = await nexus.call('workspace:write', {
    operation: 'write',
    overwrite: payload.overwrite === true,
    files: [{ path: REFERENCE_MANIFEST, content: manifest, encoding: 'utf-8' }]
  });
  nexus.emitTelemetry('crucible.plugin.auto-injected', { version: VERSION, referenceCount: CANONICAL_DOCUMENTS.length });
  return {
    ok: true,
    written: [REFERENCE_MANIFEST],
    canonicalRepository: CANONICAL_REPOSITORY,
    canonicalBranch: CANONICAL_BRANCH,
    branchLinkManifest: BRANCH_LINK_MANIFEST,
    message: 'The Crucible reference manifest was installed. Branch relationships remain project-specific and are read from governingDocuments/BRANCH-LINKS.json when present.',
    result
  };
}

async function projectAction(payload = {}) {
  switch (payload.actionId) {
    case 'crucible-auto-inject-preview': return previewAutoInject();
    case 'crucible-auto-inject': return autoInject(payload);
    case 'crucible-branch-links-read': return readBranchRelationships();
    case 'crucible-governance-list': return { ok: true, localFiles: await listLocalGovernance(), canonical: canonicalReferenceManifest().documents };
    case 'crucible-governance-read': return readLocalGovernance(payload);
    case 'crucible-governance-write': return writeLocalGovernance(payload);
    case 'crucible-governance-delete': return deleteLocalGovernance(payload);
    case 'crucible-governance-move': return moveLocalGovernance(payload);
    default:
      return {
        plugin: PLUGIN_NAME,
        pluginId: PLUGIN_ID,
        version: VERSION,
        canonicalSource: { repository: CANONICAL_REPOSITORY, branch: CANONICAL_BRANCH },
        configuration: {
          type: 'governance-reference-and-overlay',
          referenceManifest: REFERENCE_MANIFEST,
          branchLinkManifest: BRANCH_LINK_MANIFEST,
          branchRelationshipTypes: ['canonical-reference', 'paired'],
          branchNamesAreProjectData: true,
          sharedDocumentsAreReadOnlyReferences: true,
          localOverlayRoot: GOVERNANCE_ROOT,
          localOperations: ['list', 'read', 'create', 'update', 'move', 'delete'],
          destructiveOperationsRequireConfirmation: true
        },
        actions: [
          action('crucible-auto-inject', 'Auto Inject The Crucible', 'Install canonical references after explicit confirmation.', { selectable: true, selectedByDefault: false, requiresConfirmation: true }),
          action('crucible-branch-links-read', 'Inspect branch relationships', 'Identify project-declared paired and canonical-reference relationships without relying on example branch names.'),
          action('crucible-configure-governance', 'Configure project governance', 'Manage project-specific governance overlays without copying canonical Crucible policy files.', { opensConfiguration: true }),
          action('crucible-open-canonical', 'Open canonical Crucible governance', 'Use the default Crucible branch as the shared source of truth.', { references: canonicalReferenceManifest().documents })
        ]
      };
  }
}

register({
  onActivate() { nexus.emitTelemetry('crucible.plugin.activated', { version: VERSION }); },
  onDeactivate() { nexus.emitTelemetry('crucible.plugin.deactivated', { version: VERSION }); },
  slots: {
    'project-actions': projectAction,
    'inspector-panel': async () => ({
      title: PLUGIN_NAME,
      pluginId: PLUGIN_ID,
      version: VERSION,
      canonicalSource: { repository: CANONICAL_REPOSITORY, branch: CANONICAL_BRANCH },
      referenceManifest: REFERENCE_MANIFEST,
      branchLinkManifest: BRANCH_LINK_MANIFEST,
      branchRelationships: await readBranchRelationships(),
      localGovernanceFiles: await listLocalGovernance().catch(() => []),
      canonicalDocuments: canonicalReferenceManifest().documents,
      autoInject: { selectedByDefault: false, requiresConfirmation: true }
    }),
    'command-palette': async () => ({
      commands: [
        action('crucible.inject', 'Crucible: Auto Inject references', 'Install the reference manifest after explicit confirmation.', { selectable: true, selectedByDefault: false }),
        action('crucible.links', 'Crucible: Inspect branch relationships', 'Read project-specific branch-link governance without assuming naming conventions.'),
        action('crucible.configure', 'Crucible: Configure local governance', 'Manage project-specific governance overlays.'),
        action('crucible.canonical', 'Crucible: Open canonical governance', 'Open shared governance from the default Crucible branch.', { references: canonicalReferenceManifest().documents })
      ]
    })
  }
});
