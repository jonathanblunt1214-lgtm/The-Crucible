'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  STATE_FILE,
  OVERRIDE_ROOT,
  reconcileInjectedTree,
} = require('./injectedGovernanceReconcile');

const CANONICAL_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';
const DEFAULT_CANONICAL_BRANCH = 'main';
const OPERATIONAL_LINKS_FILE = '.crucible-branch-links.json';
const GOVERNANCE_LINKS_FILE = 'BRANCH-LINKS.json';

function walkFiles(root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(absolute, rel));
    else if (entry.isFile()) out.push(rel.replace(/\\/g, '/'));
  }
  return out.sort();
}

function validBranchName(value) {
  return typeof value === 'string'
    && value.trim()
    && !/[\u0000-\u001f\u007f ~^:?*[\\]/.test(value)
    && !value.startsWith('-')
    && !value.includes('..')
    && !value.endsWith('/')
    && !value.endsWith('.lock');
}

function validRepositoryPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  return !value.split('/').some((part) => !part || part === '.' || part === '..');
}

function normalizeProjectBranchLinks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('branch links must be a JSON object');
  if (raw.schemaVersion !== 1) throw new Error('branch links schemaVersion must be 1');
  if (!validBranchName(raw.canonicalBranch)) throw new Error('branch links canonicalBranch must be an explicit valid branch name');
  if (!Array.isArray(raw.links)) throw new Error('branch links links must be an array');

  const normalized = raw.links.map((link, index) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error(`branch link ${index} must be an object`);
    if (link.relationship === 'paired') {
      if (!Array.isArray(link.branches) || link.branches.length !== 2) throw new Error(`paired branch link ${index} must declare exactly two branches`);
      const branches = link.branches.map((entry) => {
        if (!entry || typeof entry !== 'object' || !validBranchName(entry.name)) throw new Error(`paired branch link ${index} contains an invalid branch`);
        if (typeof entry.role !== 'string' || !entry.role.trim()) throw new Error(`paired branch link ${index} requires explicit roles`);
        return { name: entry.name, role: entry.role };
      });
      if (branches[0].name === branches[1].name) throw new Error(`paired branch link ${index} must identify two different branches`);
      return { relationship: 'paired', branches };
    }

    if (link.relationship === 'canonical-reference') {
      if (!validBranchName(link.branch)) throw new Error(`canonical-reference link ${index} requires a dependent branch`);
      if (!validBranchName(link.dependsOn)) throw new Error(`canonical-reference link ${index} requires an explicit canonical branch`);
      if (link.branch === link.dependsOn) throw new Error(`canonical-reference link ${index} cannot depend on itself`);
      const requiredPaths = link.requiredPaths ?? link.requiredMainPaths ?? [];
      if (!Array.isArray(requiredPaths) || requiredPaths.some((item) => !validRepositoryPath(item))) {
        throw new Error(`canonical-reference link ${index} requiredPaths must contain safe repository paths`);
      }
      return { relationship: 'canonical-reference', branch: link.branch, dependsOn: link.dependsOn, requiredPaths: [...requiredPaths] };
    }

    throw new Error(`branch link ${index} relationship must be paired or canonical-reference`);
  });

  return { schemaVersion: 1, canonicalBranch: raw.canonicalBranch, links: normalized };
}

function emptyProjectBranchLinks(canonicalBranch = DEFAULT_CANONICAL_BRANCH) {
  return normalizeProjectBranchLinks({ schemaVersion: 1, canonicalBranch, links: [] });
}

function canonicalUrl(relativePath, canonicalBranch = DEFAULT_CANONICAL_BRANCH) {
  return `https://github.com/${CANONICAL_REPOSITORY}/blob/${canonicalBranch}/governingDocuments/${relativePath}`;
}

function projectMarkdown(relativePath, canonicalBranch = DEFAULT_CANONICAL_BRANCH) {
  const title = path.posix.basename(relativePath).replace(/\.md$/i, '');
  return `# ${title} — injected project governance\n\nThis file occupies the same relative governingDocuments path as canonical Crucible \`${relativePath}\`, while its content is adapted for the receiving project.\n\nCanonical policy: ${canonicalUrl(relativePath, canonicalBranch)}\n\nInjection is continuously reconcilable rather than assuming a static repository. On every reconciliation, the current canonical governingDocuments inventory is authoritative for filenames and directories. New canonical paths are created, obsolete untouched Crucible-managed paths are removed, and renamed/moved canonical paths appear at their new relative locations. If a project has edited a path that later disappears or moves, Crucible preserves that local material under \`${OVERRIDE_ROOT}/...\` instead of deleting it. Project-created extras found inside \`governingDocuments\` are preserved there too, keeping the active parity tree exact without destroying developer work. Unsafe file/directory collisions and symbolic links fail closed instead of being overwritten.\n\nProject branch relationships are never inferred from example names. The receiving repository declares its own relationships in \`${OPERATIONAL_LINKS_FILE}\` and \`governingDocuments/${GOVERNANCE_LINKS_FILE}\`. A \`paired\` relationship names both branches and their roles explicitly. A \`canonical-reference\` relationship names the dependent branch, the canonical branch it depends on, and any required canonical paths explicitly. Multiple independent relationships may coexist.\n\nCrucible may discover canonical-reference evidence from actual references as defense in depth, but discovery never turns sample names into conventions. Deterministic repairs may follow exact evidence and must be retested; semantic replacements must fail closed rather than be guessed.\n\n## Project-specific overlay\n\nKeep project-specific additions in the project preservation/override surface when they are not part of the canonical governingDocuments filename set.\n`;
}

function projectJson(relativePath, sourceRoot, canonicalBranch = DEFAULT_CANONICAL_BRANCH) {
  if (relativePath === 'known-bugs/KNOWN-BUGS.json') {
    return `${JSON.stringify({ schemaVersion: 1, severityOrder: ['critical', 'high', 'medium', 'low'], bugs: [] }, null, 2)}\n`;
  }
  if (relativePath === GOVERNANCE_LINKS_FILE) {
    return `${JSON.stringify(emptyProjectBranchLinks(canonicalBranch), null, 2)}\n`;
  }
  return fs.readFileSync(path.join(sourceRoot, relativePath));
}

function readAndNormalizeLinks(filePath) {
  return normalizeProjectBranchLinks(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function ensureInjectedGovernance({ sourceRoot, targetRoot, handoffPath, canonicalBranch = DEFAULT_CANONICAL_BRANCH } = {}) {
  if (!sourceRoot || !targetRoot || !handoffPath) throw new Error('sourceRoot, targetRoot, and handoffPath are required');
  if (!validBranchName(canonicalBranch)) throw new Error('canonicalBranch must be an explicit valid branch name');

  const canonicalFiles = walkFiles(sourceRoot);
  const projectRoot = path.dirname(targetRoot);

  const reconciliation = reconcileInjectedTree({
    sourceRoot,
    targetRoot,
    projectRoot,
    canonicalFiles,
    renderFile(relativePath) {
      return relativePath.toLowerCase().endsWith('.json')
        ? projectJson(relativePath, sourceRoot, canonicalBranch)
        : projectMarkdown(relativePath, canonicalBranch);
    },
    sourceIdentity: {
      repository: CANONICAL_REPOSITORY,
      branch: canonicalBranch,
      root: 'governingDocuments',
    },
  });

  const governanceLinksPath = path.join(targetRoot, GOVERNANCE_LINKS_FILE);
  const operationalLinksPath = path.join(projectRoot, OPERATIONAL_LINKS_FILE);
  let branchLinks = fs.existsSync(governanceLinksPath)
    ? readAndNormalizeLinks(governanceLinksPath)
    : emptyProjectBranchLinks(canonicalBranch);

  if (fs.existsSync(operationalLinksPath)) {
    const operational = readAndNormalizeLinks(operationalLinksPath);
    if (JSON.stringify(operational) !== JSON.stringify(branchLinks)) {
      throw new Error(`${OPERATIONAL_LINKS_FILE} and governingDocuments/${GOVERNANCE_LINKS_FILE} must describe the same project relationships`);
    }
    branchLinks = operational;
  } else {
    fs.writeFileSync(operationalLinksPath, `${JSON.stringify(branchLinks, null, 2)}\n`, 'utf8');
    reconciliation.actions.push({ action: 'create-operational-branch-links', path: OPERATIONAL_LINKS_FILE });
  }

  if (fs.existsSync(governanceLinksPath)) {
    fs.writeFileSync(governanceLinksPath, `${JSON.stringify(branchLinks, null, 2)}\n`, 'utf8');
  }

  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  handoff.governingDocuments = handoff.governingDocuments && typeof handoff.governingDocuments === 'object' && !Array.isArray(handoff.governingDocuments)
    ? handoff.governingDocuments
    : {};

  const canonicalHandoffPaths = new Set(canonicalFiles.map((relativePath) => `governingDocuments/${relativePath}`));
  for (const existingPath of Object.keys(handoff.governingDocuments)) {
    if (existingPath.startsWith('governingDocuments/') && !canonicalHandoffPaths.has(existingPath)) {
      delete handoff.governingDocuments[existingPath];
    }
  }

  for (const relativePath of canonicalFiles) {
    const localPath = `governingDocuments/${relativePath}`;
    handoff.governingDocuments[localPath] = relativePath === 'branch-linking-policy.md' || relativePath === GOVERNANCE_LINKS_FILE
      ? `Project-local branch relationship governance. Relationship identity comes from explicit project metadata and observed references, never example names. Supports paired and canonical-reference links with arbitrary branch names; operational mirror: ${OPERATIONAL_LINKS_FILE}.`
      : `Project-adapted governance mirror for canonical ${canonicalBranch}:governingDocuments/${relativePath}. Injection reconciliation keeps this filename/path set aligned as canonical governance evolves.`;
  }

  handoff.injectionStructure = {
    schemaVersion: 1,
    stateFile: STATE_FILE,
    overrideRoot: OVERRIDE_ROOT,
    parityRoot: 'governingDocuments',
    parityRule: 'The active governingDocuments relative file list must exactly match the current canonical Crucible governingDocuments inventory after every reconciliation.',
    adaptationRule: 'Create new canonical paths; remove obsolete untouched Crucible-managed paths; preserve locally changed or project-created obsolete material outside the parity tree; fail closed on unsafe collisions or symbolic links.',
  };

  fs.writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');

  return {
    canonicalFiles,
    created: reconciliation.actions.filter((item) => item.action.startsWith('create-')).map((item) => item.path),
    actions: reconciliation.actions,
    branchLinks,
    state: reconciliation.state,
  };
}

function main() {
  const [sourceRoot, targetRoot, handoffPath, canonicalBranch = DEFAULT_CANONICAL_BRANCH] = process.argv.slice(2);
  const result = ensureInjectedGovernance({ sourceRoot, targetRoot, handoffPath, canonicalBranch });
  console.log(`[The Crucible] Reconciled injected governingDocuments: ${result.canonicalFiles.length} canonical filename(s), ${result.actions.length} adaptation action(s), ${result.branchLinks.links.length} project branch relationship(s) validated.`);
}

if (require.main === module) main();

module.exports = {
  STATE_FILE,
  OVERRIDE_ROOT,
  OPERATIONAL_LINKS_FILE,
  GOVERNANCE_LINKS_FILE,
  walkFiles,
  validBranchName,
  validRepositoryPath,
  normalizeProjectBranchLinks,
  emptyProjectBranchLinks,
  canonicalUrl,
  projectMarkdown,
  projectJson,
  ensureInjectedGovernance,
};
