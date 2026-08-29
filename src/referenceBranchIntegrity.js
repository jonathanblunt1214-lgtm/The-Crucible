'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const MANIFEST_PATH = '.crucible-main-references.json';
const DEFAULT_EXCLUDED_BRANCHES = new Set(['main', 'development', 'release', 'Archive', 'ci-monitor', 'crucible-canonical']);
const TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.json', '.yml', '.yaml', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
  '.toml', '.ini', '.cfg', '.conf', '.xml', '.html', '.css', '.sh', '.ps1', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.cs', '.env', '.example'
]);
const MAX_SCAN_FILES = 2500;
const MAX_TEXT_BYTES = 1024 * 1024;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSafeRepositoryPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
  return !normalized.split('/').some((part) => !part || part === '.' || part === '..');
}

function looksTextLike(filePath) {
  const base = path.posix.basename(filePath);
  const ext = path.posix.extname(base).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return !ext && /^[A-Za-z0-9._-]+$/.test(base);
}

function extractMainReferences(text, repository) {
  const value = String(text || '');
  const found = new Set();
  const inline = /\bmain:([A-Za-z0-9._/-]+)/g;
  for (const match of value.matchAll(inline)) {
    if (isSafeRepositoryPath(match[1])) found.add(match[1]);
  }
  if (repository) {
    const repo = escapeRegex(repository);
    const urlPatterns = [
      new RegExp(`https://github\\.com/${repo}/blob/main/([A-Za-z0-9._~%+@/-]+)`, 'g'),
      new RegExp(`https://raw\\.githubusercontent\\.com/${repo}/main/([A-Za-z0-9._~%+@/-]+)`, 'g')
    ];
    for (const pattern of urlPatterns) {
      for (const match of value.matchAll(pattern)) {
        let decoded = match[1];
        try { decoded = decodeURIComponent(decoded); } catch {}
        if (isSafeRepositoryPath(decoded)) found.add(decoded);
      }
    }
  }
  return [...found].sort();
}

function resolveJsonPointer(document, pointer) {
  if (pointer === '') return { exists: true, value: document };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return { exists: false };
  let current = document;
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) return { exists: false };
    current = current[token];
  }
  return { exists: true, value: current };
}

function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${MANIFEST_PATH} must contain a JSON object.`);
  if (raw.schemaVersion !== 1) throw new Error(`${MANIFEST_PATH} schemaVersion must be 1.`);
  if (raw.canonicalBranch !== undefined && raw.canonicalBranch !== 'main') throw new Error(`${MANIFEST_PATH} canonicalBranch must be main.`);
  if (!Array.isArray(raw.references)) throw new Error(`${MANIFEST_PATH} references must be an array.`);
  return raw.references.map((entry) => {
    const normalized = typeof entry === 'string' ? { path: entry } : { ...entry };
    if (!isSafeRepositoryPath(normalized.path)) throw new Error(`${MANIFEST_PATH} contains an unsafe path.`);
    if (normalized.contains !== undefined && !Array.isArray(normalized.contains)) throw new Error(`${MANIFEST_PATH} contains must be an array when present.`);
    if (normalized.jsonPointers !== undefined && !Array.isArray(normalized.jsonPointers)) throw new Error(`${MANIFEST_PATH} jsonPointers must be an array when present.`);
    return normalized;
  });
}

function governingPathsFromHandoff(content) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { return []; }
  const governing = parsed?.governingDocuments;
  if (!governing || typeof governing !== 'object' || Array.isArray(governing)) return [];
  return Object.keys(governing).filter(isSafeRepositoryPath).sort();
}

function validateContract(reference, content) {
  const findings = [];
  for (const token of reference.contains || []) {
    if (typeof token !== 'string' || !content.includes(token)) findings.push(`required text is missing: ${JSON.stringify(token)}`);
  }
  if ((reference.jsonPointers || []).length) {
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      return [...findings, 'target is not valid JSON but jsonPointers were declared'];
    }
    for (const pointer of reference.jsonPointers) {
      if (!resolveJsonPointer(parsed, pointer).exists) findings.push(`required JSON pointer is missing: ${pointer}`);
    }
  }
  return findings;
}

function auditReferenceBranch({ branch, repository, files, readBranchFile, readMainFile }) {
  const findings = [];
  const references = new Map();
  const addReference = (reference, source) => {
    const current = references.get(reference.path) || { path: reference.path, contains: [], jsonPointers: [], sources: [] };
    current.sources.push(source);
    for (const token of reference.contains || []) if (!current.contains.includes(token)) current.contains.push(token);
    for (const pointer of reference.jsonPointers || []) if (!current.jsonPointers.includes(pointer)) current.jsonPointers.push(pointer);
    references.set(reference.path, current);
  };

  if (files.includes(MANIFEST_PATH)) {
    try {
      const manifest = JSON.parse(readBranchFile(MANIFEST_PATH));
      for (const reference of normalizeManifest(manifest)) addReference(reference, MANIFEST_PATH);
    } catch (error) {
      findings.push({ branch, source: MANIFEST_PATH, target: null, issue: error.message });
    }
  }

  for (const file of files) {
    if (file === MANIFEST_PATH || !looksTextLike(file)) continue;
    let content;
    try { content = readBranchFile(file); } catch { continue; }
    for (const target of extractMainReferences(content, repository)) addReference({ path: target }, file);
  }

  const checkedTargets = new Set();
  const queue = [...references.values()];
  while (queue.length) {
    const reference = queue.shift();
    if (checkedTargets.has(reference.path)) continue;
    checkedTargets.add(reference.path);
    let content;
    try { content = readMainFile(reference.path); } catch { content = null; }
    if (content === null || content === undefined) {
      findings.push({ branch, source: reference.sources.join(', '), target: reference.path, issue: 'referenced main file does not exist' });
      continue;
    }
    for (const issue of validateContract(reference, content)) {
      findings.push({ branch, source: reference.sources.join(', '), target: reference.path, issue });
    }
    if (reference.path === 'AI-HANDOFF.json' || reference.path.endsWith('/AI-HANDOFF.json')) {
      for (const governingPath of governingPathsFromHandoff(content)) {
        if (!checkedTargets.has(governingPath)) queue.push({ path: governingPath, contains: [], jsonPointers: [], sources: [`${reference.path} governingDocuments`] });
      }
    }
  }

  return { branch, referenceCount: checkedTargets.size, findings };
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options }).trimEnd();
}

function makeGitAdapter({ cwd = process.cwd(), remote = 'origin', canonicalBranch = 'main' } = {}) {
  const mainRef = `refs/remotes/${remote}/${canonicalBranch}`;
  const read = (ref, filePath) => {
    const size = Number(git(['cat-file', '-s', `${ref}:${filePath}`], { cwd }));
    if (!Number.isFinite(size) || size > MAX_TEXT_BYTES) throw new Error('file exceeds text scan limit');
    return git(['show', `${ref}:${filePath}`], { cwd });
  };
  return {
    listBranches() {
      return git(['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}`], { cwd })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((ref) => ref.replace(new RegExp(`^${escapeRegex(remote)}/`), ''))
        .filter((branch) => branch && branch !== 'HEAD');
    },
    listFiles(branch) {
      const ref = `refs/remotes/${remote}/${branch}`;
      const files = git(['ls-tree', '-r', '--name-only', ref], { cwd }).split(/\r?\n/).filter(Boolean);
      if (files.length > MAX_SCAN_FILES) throw new Error(`branch has ${files.length} files; limit is ${MAX_SCAN_FILES}`);
      return files;
    },
    readBranchFile(branch, filePath) { return read(`refs/remotes/${remote}/${branch}`, filePath); },
    readMainFile(filePath) { return read(mainRef, filePath); }
  };
}

function auditAllReferenceBranches({ repository = process.env.GITHUB_REPOSITORY || '', excludedBranches = DEFAULT_EXCLUDED_BRANCHES, adapter = makeGitAdapter() } = {}) {
  const reports = [];
  const findings = [];
  for (const branch of adapter.listBranches()) {
    if (excludedBranches.has(branch) || branch.startsWith('crucible-recovery-')) continue;
    let files;
    try { files = adapter.listFiles(branch); } catch (error) {
      findings.push({ branch, source: null, target: null, issue: `unable to enumerate branch: ${error.message}` });
      continue;
    }
    const report = auditReferenceBranch({
      branch,
      repository,
      files,
      readBranchFile: (filePath) => adapter.readBranchFile(branch, filePath),
      readMainFile: adapter.readMainFile
    });
    reports.push(report);
    findings.push(...report.findings);
  }
  return { reports, findings };
}

function formatReport(result) {
  const referenced = result.reports.filter((report) => report.referenceCount > 0);
  const lines = [`[The Crucible] Third-branch main-reference integrity: ${result.findings.length} issue(s) across ${referenced.length} referencing branch(es).`];
  for (const report of referenced) lines.push(`- ${report.branch}: ${report.referenceCount} canonical main target(s) checked.`);
  for (const finding of result.findings) lines.push(`- BROKEN ${finding.branch}${finding.source ? ` via ${finding.source}` : ''}${finding.target ? ` -> main:${finding.target}` : ''}: ${finding.issue}`);
  if (!result.findings.length) lines.push('- All discovered third-branch references to main remain resolvable and compatible.');
  return lines.join('\n');
}

function main() {
  const result = auditAllReferenceBranches();
  const report = formatReport(result);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Third-branch main-reference integrity\n\n\`\`\`text\n${report}\n\`\`\`\n`, 'utf8');
  }
  if (result.findings.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  MANIFEST_PATH,
  DEFAULT_EXCLUDED_BRANCHES,
  extractMainReferences,
  resolveJsonPointer,
  normalizeManifest,
  governingPathsFromHandoff,
  validateContract,
  auditReferenceBranch,
  auditAllReferenceBranches,
  formatReport,
  makeGitAdapter,
  isSafeRepositoryPath,
  looksTextLike
};
