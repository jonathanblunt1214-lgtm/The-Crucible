'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MANIFEST_PATH = '.crucible-main-references.json';
const LINK_MANIFEST_PATH = '.crucible-branch-links.json';
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
    const patterns = [
      new RegExp(`https://github\\.com/${repo}/blob/main/([A-Za-z0-9._~%+@/-]+)`, 'g'),
      new RegExp(`https://raw\\.githubusercontent\\.com/${repo}/main/([A-Za-z0-9._~%+@/-]+)`, 'g')
    ];
    for (const pattern of patterns) {
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

function normalizeBranchLinks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${LINK_MANIFEST_PATH} must contain a JSON object.`);
  if (raw.schemaVersion !== 1) throw new Error(`${LINK_MANIFEST_PATH} schemaVersion must be 1.`);
  if (raw.canonicalBranch !== 'main') throw new Error(`${LINK_MANIFEST_PATH} canonicalBranch must be main.`);
  if (!Array.isArray(raw.links)) throw new Error(`${LINK_MANIFEST_PATH} links must be an array.`);
  return raw.links.map((link) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error(`${LINK_MANIFEST_PATH} link entries must be objects.`);
    if (typeof link.branch !== 'string' || !link.branch.trim()) throw new Error(`${LINK_MANIFEST_PATH} link branch is required.`);
    if (link.relationship !== 'canonical-reference') throw new Error(`${LINK_MANIFEST_PATH} relationship must be canonical-reference.`);
    if (link.dependsOn !== 'main') throw new Error(`${LINK_MANIFEST_PATH} dependsOn must be main.`);
    const requiredMainPaths = link.requiredMainPaths || [];
    if (!Array.isArray(requiredMainPaths) || requiredMainPaths.some((item) => !isSafeRepositoryPath(item))) throw new Error(`${LINK_MANIFEST_PATH} requiredMainPaths must contain safe repository paths.`);
    return { ...link, requiredMainPaths };
  });
}

function governingPathsFromHandoff(content) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { return []; }
  const governing = parsed?.governingDocuments;
  if (!governing || typeof governing !== 'object' || Array.isArray(governing)) return [];
  return Object.keys(governing)
    .filter((documentPath) => !/^[A-Za-z0-9._-]+:/.test(documentPath) && isSafeRepositoryPath(documentPath))
    .sort();
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

function auditReferenceBranch({ branch, repository, files, readBranchFile, readMainFile, declaredReferences = [] }) {
  const findings = [];
  const references = new Map();
  const addReference = (reference, source) => {
    const current = references.get(reference.path) || { path: reference.path, contains: [], jsonPointers: [], sources: [] };
    current.sources.push(source);
    for (const token of reference.contains || []) if (!current.contains.includes(token)) current.contains.push(token);
    for (const pointer of reference.jsonPointers || []) if (!current.jsonPointers.includes(pointer)) current.jsonPointers.push(pointer);
    references.set(reference.path, current);
  };

  for (const target of declaredReferences) addReference({ path: target }, LINK_MANIFEST_PATH);

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
    for (const issue of validateContract(reference, content)) findings.push({ branch, source: reference.sources.join(', '), target: reference.path, issue });
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
    cwd,
    remote,
    canonicalBranch,
    listBranches() {
      return git(['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}`], { cwd })
        .split(/\r?\n/).filter(Boolean)
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

function declaredLinks(adapter) {
  try { return normalizeBranchLinks(JSON.parse(adapter.readMainFile(LINK_MANIFEST_PATH))); }
  catch (error) {
    if (/does not exist|Not a valid object name|exists on disk/i.test(error.message || '')) return [];
    throw error;
  }
}

function auditAllReferenceBranches({ repository = process.env.GITHUB_REPOSITORY || '', excludedBranches = DEFAULT_EXCLUDED_BRANCHES, adapter = makeGitAdapter() } = {}) {
  const reports = [];
  const findings = [];
  let links = [];
  try { links = declaredLinks(adapter); }
  catch (error) { findings.push({ branch: 'main', source: LINK_MANIFEST_PATH, target: null, issue: error.message }); }
  const linkMap = new Map(links.map((link) => [link.branch, link]));

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
      readMainFile: adapter.readMainFile,
      declaredReferences: linkMap.get(branch)?.requiredMainPaths || []
    });
    report.linked = linkMap.has(branch);
    reports.push(report);
    findings.push(...report.findings);
  }
  for (const link of links) {
    if (!adapter.listBranches().includes(link.branch)) findings.push({ branch: link.branch, source: LINK_MANIFEST_PATH, target: null, issue: 'declared canonical-reference branch does not exist' });
  }
  return { reports, findings, links };
}

function renameMapFromGit(before, after, { cwd = process.cwd() } = {}) {
  const map = new Map();
  if (!before || !after || /^0+$/.test(before)) return map;
  const lines = git(['diff', '--name-status', '-M', before, after], { cwd }).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const parts = line.split('\t');
    if (/^R\d+$/.test(parts[0]) && isSafeRepositoryPath(parts[1]) && isSafeRepositoryPath(parts[2])) map.set(parts[1], parts[2]);
  }
  return map;
}

function rewriteRecognizedReferences(content, repository, renames) {
  let next = String(content);
  for (const [from, to] of renames) {
    next = next.replace(new RegExp(`\\bmain:${escapeRegex(from)}(?=$|[^A-Za-z0-9._/-])`, 'g'), `main:${to}`);
    if (repository) {
      next = next.replaceAll(`https://github.com/${repository}/blob/main/${from}`, `https://github.com/${repository}/blob/main/${to}`);
      next = next.replaceAll(`https://raw.githubusercontent.com/${repository}/main/${from}`, `https://raw.githubusercontent.com/${repository}/main/${to}`);
    }
  }
  return next;
}

function rewriteReferenceManifest(content, renames) {
  const parsed = JSON.parse(content);
  const references = normalizeManifest(parsed);
  let changed = false;
  for (let i = 0; i < parsed.references.length; i += 1) {
    const current = references[i].path;
    const replacement = renames.get(current);
    if (!replacement) continue;
    if (typeof parsed.references[i] === 'string') parsed.references[i] = replacement;
    else parsed.references[i].path = replacement;
    changed = true;
  }
  return { changed, content: `${JSON.stringify(parsed, null, 2)}\n` };
}

function repairBranchForRenames({ branch, repository, renames, adapter = makeGitAdapter() }) {
  if (!renames.size) return { branch, changedFiles: [], committed: false };
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-reference-repair-'));
  const worktree = path.join(tempRoot, 'worktree');
  const remoteRef = `refs/remotes/${adapter.remote}/${branch}`;
  const changedFiles = [];
  try {
    git(['worktree', 'add', '--detach', worktree, remoteRef], { cwd: adapter.cwd });
    const files = git(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: worktree }).split(/\r?\n/).filter(Boolean);
    if (files.length > MAX_SCAN_FILES) throw new Error(`branch has ${files.length} files; limit is ${MAX_SCAN_FILES}`);
    for (const file of files) {
      if (!looksTextLike(file)) continue;
      const absolute = path.join(worktree, file);
      const stat = fs.statSync(absolute);
      if (stat.size > MAX_TEXT_BYTES) continue;
      const original = fs.readFileSync(absolute, 'utf8');
      let next = rewriteRecognizedReferences(original, repository, renames);
      if (file === MANIFEST_PATH) {
        try {
          const manifestRepair = rewriteReferenceManifest(next, renames);
          next = manifestRepair.content;
        } catch {}
      }
      if (next !== original) {
        fs.writeFileSync(absolute, next, 'utf8');
        changedFiles.push(file);
      }
    }
    if (!changedFiles.length) return { branch, changedFiles, committed: false };
    git(['config', 'user.name', 'github-actions[bot]'], { cwd: worktree });
    git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], { cwd: worktree });
    git(['add', '--', ...changedFiles], { cwd: worktree });
    git(['commit', '-m', 'Repair canonical main references'], { cwd: worktree });
    git(['push', adapter.remote, `HEAD:refs/heads/${branch}`], { cwd: worktree });
    git(['fetch', '--no-tags', adapter.remote, `+refs/heads/${branch}:refs/remotes/${adapter.remote}/${branch}`], { cwd: adapter.cwd });
    return { branch, changedFiles, committed: true };
  } finally {
    try { git(['worktree', 'remove', '--force', worktree], { cwd: adapter.cwd }); } catch {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function repairAllReferenceBranches({ repository = process.env.GITHUB_REPOSITORY || '', before = process.env.CRUCIBLE_MAIN_BEFORE || '', after = process.env.CRUCIBLE_MAIN_AFTER || '', adapter = makeGitAdapter() } = {}) {
  const initial = auditAllReferenceBranches({ repository, adapter });
  const renames = renameMapFromGit(before, after, { cwd: adapter.cwd });
  const repaired = [];
  const eligibleBranches = new Set(initial.findings.filter((finding) => finding.issue === 'referenced main file does not exist' && renames.has(finding.target)).map((finding) => finding.branch));
  for (const branch of eligibleBranches) repaired.push(repairBranchForRenames({ branch, repository, renames, adapter }));
  const final = auditAllReferenceBranches({ repository, adapter });
  return { initial, final, renames: Object.fromEntries(renames), repaired };
}

function formatReport(result) {
  const referenced = result.reports.filter((report) => report.referenceCount > 0 || report.linked);
  const lines = [`[The Crucible] Third-branch main-reference integrity: ${result.findings.length} issue(s) across ${referenced.length} linked/referencing branch(es).`];
  for (const report of referenced) lines.push(`- ${report.branch}: ${report.referenceCount} canonical main target(s) checked${report.linked ? '; explicit canonical-reference link declared' : ''}.`);
  for (const finding of result.findings) lines.push(`- BROKEN ${finding.branch}${finding.source ? ` via ${finding.source}` : ''}${finding.target ? ` -> main:${finding.target}` : ''}: ${finding.issue}`);
  if (!result.findings.length) lines.push('- All discovered and explicitly linked third-branch references to main remain resolvable and compatible.');
  return lines.join('\n');
}

function formatRepairReport(result) {
  const lines = [formatReport(result.final)];
  const commits = result.repaired.filter((item) => item.committed);
  lines.push(`[The Crucible] Automatic reference repair: ${commits.length} branch(es) repaired and retested.`);
  for (const item of commits) lines.push(`- ${item.branch}: ${item.changedFiles.join(', ')}`);
  if (!commits.length && Object.keys(result.renames).length) lines.push('- Canonical renames were detected, but no recognized linked-branch references required rewriting.');
  if (result.final.findings.length) lines.push('- Remaining failures require a deterministic declared mapping or human semantic decision; Crucible did not guess.');
  return lines.join('\n');
}

function publish(report) {
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Third-branch main-reference integrity\n\n\`\`\`text\n${report}\n\`\`\`\n`, 'utf8');
}

function main() {
  if (process.argv[2] === 'repair') {
    const result = repairAllReferenceBranches();
    publish(formatRepairReport(result));
    if (result.final.findings.length) process.exitCode = 1;
    return;
  }
  const result = auditAllReferenceBranches();
  publish(formatReport(result));
  if (result.findings.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  MANIFEST_PATH,
  LINK_MANIFEST_PATH,
  DEFAULT_EXCLUDED_BRANCHES,
  extractMainReferences,
  resolveJsonPointer,
  normalizeManifest,
  normalizeBranchLinks,
  governingPathsFromHandoff,
  validateContract,
  auditReferenceBranch,
  auditAllReferenceBranches,
  renameMapFromGit,
  rewriteRecognizedReferences,
  rewriteReferenceManifest,
  repairBranchForRenames,
  repairAllReferenceBranches,
  formatReport,
  formatRepairReport,
  makeGitAdapter,
  isSafeRepositoryPath,
  looksTextLike
};
