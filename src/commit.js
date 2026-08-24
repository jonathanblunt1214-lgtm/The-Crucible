const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.json', '.jsx',
  '.md', '.mjs', '.py', '.rb', '.rs', '.sh', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

function git(root, args) {
  return execFileSync('git', args, { cwd:root, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] });
}

function isTextPath(relative) {
  const basename = path.basename(relative);
  return TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase()) || ['Dockerfile', 'Makefile', '.gitignore'].includes(basename);
}

function changedPaths(root, ref = '--cached') {
  const args = ref === '--cached'
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', ref];
  return git(root, args).split(/\r?\n/).filter(Boolean);
}

function readCandidate(root, relative, ref = '--cached') {
  if (ref !== '--cached') return git(root, ['show', `${ref}:${relative}`]);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Path escapes repository: ${relative}`);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

function inspectText(relative, content) {
  const findings = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) findings.push({ type:'trailing-whitespace', path:relative, line:index + 1, fixable:true });
    if (/^(<{7}|={7}|>{7})(?: |$)/.test(line)) findings.push({ type:'merge-conflict-marker', path:relative, line:index + 1, fixable:false });
  });
  if (content && !content.endsWith('\n')) findings.push({ type:'missing-final-newline', path:relative, fixable:true });
  return findings;
}

function normalizeText(content) {
  const normalized = content.split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n');
  return normalized && !normalized.endsWith('\n') ? `${normalized}\n` : normalized;
}

function inspectCommitMessage(root, ref) {
  if (ref === '--cached') return [];
  const subject = git(root, ['log', '-1', '--format=%s', ref]).trim();
  const findings = [];
  if (!subject) findings.push({ type:'empty-commit-subject', path:'COMMIT_MESSAGE', fixable:false });
  if (/^(wip|fixup!|squash!)/i.test(subject)) findings.push({ type:'temporary-commit-subject', path:'COMMIT_MESSAGE', fixable:false });
  if (subject.length > 72) findings.push({ type:'long-commit-subject', path:'COMMIT_MESSAGE', detail:`${subject.length} characters`, fixable:false });
  return findings;
}

function auditCommit(root, options = {}) {
  const ref = options.ref || '--cached';
  const paths = changedPaths(root, ref);
  const findings = inspectCommitMessage(root, ref);
  for (const relative of paths) {
    if (!isTextPath(relative)) continue;
    findings.push(...inspectText(relative, readCandidate(root, relative, ref)));
  }
  return { ref, paths, findings, fixable:findings.filter((item) => item.fixable), review:findings.filter((item) => !item.fixable) };
}

function fixCommit(root, options = {}) {
  const ref = options.ref || '--cached';
  if (ref !== '--cached') throw new Error('Committed history is read-only. Safe fixes are only applied to working files for the staged commit.');
  const audit = auditCommit(root, { ref });
  const changed = [];
  for (const relative of new Set(audit.fixable.map((item) => item.path))) {
    if (relative === 'COMMIT_MESSAGE') continue;
    const absolute = path.resolve(root, relative);
    if (!fs.existsSync(absolute) || !isTextPath(relative)) continue;
    const before = fs.readFileSync(absolute, 'utf8');
    const after = normalizeText(before);
    if (after !== before) {
      fs.writeFileSync(absolute, after, 'utf8');
      changed.push(relative);
    }
  }
  return { ...audit, changed };
}

module.exports = { auditCommit, changedPaths, fixCommit, inspectText, normalizeText };
