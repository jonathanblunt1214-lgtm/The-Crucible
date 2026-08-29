'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STATE_FILE = '.crucible-injection-state.json';
const OVERRIDE_ROOT = '.crucible-overrides/governingDocuments';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileHash(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function safeRelative(value) {
  const normalized = normalizeRelative(value);
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !normalized.split('/').some((part) => !part || part === '.' || part === '..');
}

function walk(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to reconcile symbolic link inside governingDocuments: ${relative}`);
    if (entry.isDirectory()) out.push(...walk(absolute, relative));
    else if (entry.isFile()) out.push(relative.replace(/\\/g, '/'));
    else throw new Error(`Unsupported filesystem entry inside governingDocuments: ${relative}`);
  }
  return out.sort();
}

function loadState(projectRoot) {
  const statePath = path.join(projectRoot, STATE_FILE);
  if (!fs.existsSync(statePath)) return { schemaVersion: 1, files: {}, preservedOverrides: [] };
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!state || state.schemaVersion !== 1 || typeof state.files !== 'object' || Array.isArray(state.files)) {
    throw new Error(`${STATE_FILE} is invalid or uses an unsupported schema`);
  }
  if (!Array.isArray(state.preservedOverrides)) state.preservedOverrides = [];
  return state;
}

function ensureParentDirectory(target, projectRoot) {
  const relative = path.relative(projectRoot, path.dirname(target)).split(path.sep);
  let cursor = projectRoot;
  for (const segment of relative) {
    if (!segment || segment === '.') continue;
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to traverse symbolic link while reconciling ${path.relative(projectRoot, target)}`);
      if (!stat.isDirectory()) throw new Error(`Cannot create canonical governance path because project file blocks directory: ${path.relative(projectRoot, cursor)}`);
    } else {
      fs.mkdirSync(cursor);
    }
  }
}

function uniqueOverridePath(projectRoot, relativePath) {
  const base = path.join(projectRoot, OVERRIDE_ROOT, relativePath);
  if (!fs.existsSync(base)) return base;
  let index = 1;
  while (fs.existsSync(`${base}.preserved-${index}`)) index += 1;
  return `${base}.preserved-${index}`;
}

function removeEmptyParents(start, stop) {
  let cursor = path.dirname(start);
  const boundary = path.resolve(stop);
  while (path.resolve(cursor).startsWith(`${boundary}${path.sep}`) && path.resolve(cursor) !== boundary) {
    if (!fs.existsSync(cursor) || fs.readdirSync(cursor).length) break;
    fs.rmdirSync(cursor);
    cursor = path.dirname(cursor);
  }
}

function retireOutsideParity({ projectRoot, targetRoot, relativePath, reason, state, previousEntry, actions }) {
  const source = path.join(targetRoot, relativePath);
  if (!fs.existsSync(source)) return null;

  const currentHash = fileHash(source);
  if (previousEntry?.managed && previousEntry.generatedHash === currentHash) {
    fs.rmSync(source);
    removeEmptyParents(source, targetRoot);
    actions.push({ action: 'remove-stale-managed', path: `governingDocuments/${relativePath}`, reason });
    return null;
  }

  const destination = uniqueOverridePath(projectRoot, relativePath);
  ensureParentDirectory(destination, projectRoot);
  fs.renameSync(source, destination);
  removeEmptyParents(source, targetRoot);
  const preserved = normalizeRelative(path.relative(projectRoot, destination));
  state.preservedOverrides.push({ from: `governingDocuments/${relativePath}`, to: preserved, reason });
  actions.push({ action: 'preserve-override', from: `governingDocuments/${relativePath}`, to: preserved, reason });
  return preserved;
}

function reconcileInjectedTree({
  sourceRoot,
  targetRoot,
  projectRoot,
  canonicalFiles,
  renderFile,
  sourceIdentity,
} = {}) {
  if (!sourceRoot || !targetRoot || !projectRoot || !Array.isArray(canonicalFiles) || typeof renderFile !== 'function') {
    throw new Error('sourceRoot, targetRoot, projectRoot, canonicalFiles, and renderFile are required');
  }

  const canonical = [...new Set(canonicalFiles.map(normalizeRelative))].sort();
  if (canonical.some((item) => !safeRelative(item))) throw new Error('canonical governingDocuments inventory contains an unsafe path');

  fs.mkdirSync(targetRoot, { recursive: true });
  const state = loadState(projectRoot);
  const previous = state.files || {};
  const actions = [];
  const currentFiles = walk(targetRoot);
  const canonicalSet = new Set(canonical);

  for (const currentFile of currentFiles) {
    if (canonical.some((canonicalFile) => canonicalFile.startsWith(`${currentFile}/`))) {
      throw new Error(`Cannot create canonical governance path because project file blocks directory: governingDocuments/${currentFile}`);
    }
  }

  for (const relativePath of currentFiles) {
    if (canonicalSet.has(relativePath)) continue;
    retireOutsideParity({
      projectRoot,
      targetRoot,
      relativePath,
      reason: previous[relativePath] ? 'canonical-path-removed-or-moved' : 'project-extra-outside-canonical-parity',
      state,
      previousEntry: previous[relativePath],
      actions,
    });
  }

  const nextFiles = {};
  for (const relativePath of canonical) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(targetRoot, relativePath);
    const sourceHash = fileHash(sourcePath);
    const prior = previous[relativePath] || null;
    let managed = false;

    if (fs.existsSync(targetPath)) {
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to overwrite symbolic link at governingDocuments/${relativePath}`);
      if (!stat.isFile()) throw new Error(`Canonical governance path is blocked by a non-file entry: governingDocuments/${relativePath}`);
      const currentHash = fileHash(targetPath);
      managed = Boolean(prior?.managed && prior.generatedHash && prior.generatedHash === currentHash);
    } else {
      ensureParentDirectory(targetPath, projectRoot);
      const rendered = renderFile(relativePath);
      fs.writeFileSync(targetPath, rendered);
      managed = true;
      actions.push({ action: 'create-managed', path: `governingDocuments/${relativePath}` });
    }

    if (managed) {
      const rendered = renderFile(relativePath);
      const renderedBuffer = Buffer.isBuffer(rendered) ? rendered : Buffer.from(String(rendered));
      const nextHash = sha256(renderedBuffer);
      if (fileHash(targetPath) !== nextHash) {
        fs.writeFileSync(targetPath, renderedBuffer);
        actions.push({ action: 'refresh-managed', path: `governingDocuments/${relativePath}` });
      }
      nextFiles[relativePath] = { sourceHash, generatedHash: nextHash, managed: true };
    } else {
      nextFiles[relativePath] = { sourceHash, generatedHash: null, managed: false };
      if (!prior || prior.sourceHash !== sourceHash) {
        actions.push({ action: 'preserve-local-override', path: `governingDocuments/${relativePath}` });
      }
    }
  }

  const finalFiles = walk(targetRoot);
  if (JSON.stringify(finalFiles) !== JSON.stringify(canonical)) {
    throw new Error(`Injected governingDocuments parity failed after reconciliation. canonical=${JSON.stringify(canonical)} actual=${JSON.stringify(finalFiles)}`);
  }

  const nextState = {
    schemaVersion: 1,
    source: sourceIdentity || null,
    files: nextFiles,
    preservedOverrides: state.preservedOverrides,
  };
  fs.writeFileSync(path.join(projectRoot, STATE_FILE), `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

  return { actions, state: nextState, canonicalFiles: canonical };
}

module.exports = {
  STATE_FILE,
  OVERRIDE_ROOT,
  sha256,
  safeRelative,
  walk,
  loadState,
  reconcileInjectedTree,
};
