const fs = require('node:fs');
const path = require('node:path');

// The current documented set of GITHUB_TOKEN permission scopes. An
// unrecognized key here does not merely fail to grant access - it makes
// GitHub reject the entire workflow file as invalid, taking down every job
// in it. Keep this list current with GitHub's docs.
const VALID_PERMISSION_KEYS = new Set([
  'actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions',
  'id-token', 'issues', 'packages', 'pages', 'pull-requests', 'repository-projects',
  'security-events', 'statuses', 'models',
]);

function findPermissionsBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)permissions:\s*(.*?)\s*$/.exec(lines[i]);
    if (!match) continue;
    const [, indent, inline] = match;
    if (inline && inline !== '{}') continue; // scalar form (read-all/write-all) - nothing to validate
    const entries = [];
    let endLine = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j].trim()) continue;
      const entryMatch = /^(\s*)([A-Za-z0-9_-]+):\s*\S/.exec(lines[j]);
      if (!entryMatch || entryMatch[1].length <= indent.length) break;
      entries.push({ key: entryMatch[2], line: j + 1 });
      endLine = j;
    }
    blocks.push({ startLine: i + 1, endLine: endLine + 1, entries });
  }
  return blocks;
}

function workflowFiles(root, extraDirs = []) {
  const dirs = [path.join(root, '.github', 'workflows'), ...extraDirs.map((dir) => path.resolve(root, dir))];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (/\.ya?ml$/i.test(entry)) files.push(path.join(dir, entry));
    }
  }
  return files;
}

function auditWorkflowPermissions(root, extraDirs = []) {
  const findings = [];
  const files = workflowFiles(root, extraDirs);
  for (const filePath of files) {
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    const text = fs.readFileSync(filePath, 'utf8');
    for (const block of findPermissionsBlocks(text)) {
      for (const entry of block.entries) {
        if (!VALID_PERMISSION_KEYS.has(entry.key)) findings.push({ path: relative, line: entry.line, key: entry.key, type: `unknown permissions key "${entry.key}"` });
      }
    }
  }
  return { files: files.length, findings };
}

// Removes exactly the line(s) identified as an unrecognized permissions key,
// nothing else. Safe because an unrecognized key never granted any real
// access in the first place (GitHub rejects the whole file instead), so
// deleting it cannot reduce what the workflow's token can do - it can only
// restore the file to something GitHub will parse.
function fixWorkflowPermissions(root, extraDirs = []) {
  const audit = auditWorkflowPermissions(root, extraDirs);
  const byFile = new Map();
  for (const finding of audit.findings) {
    if (!byFile.has(finding.path)) byFile.set(finding.path, []);
    byFile.get(finding.path).push(finding);
  }
  const changed = [];
  const removed = [];
  const repoRoot = path.resolve(root);
  for (const [relative, findings] of byFile) {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${repoRoot}${path.sep}`)) continue;
    const lines = fs.readFileSync(absolute, 'utf8').split('\n');
    const removedLines = new Set(findings.map((item) => item.line));
    const kept = lines.filter((_, index) => !removedLines.has(index + 1));
    fs.writeFileSync(absolute, kept.join('\n'), 'utf8');
    changed.push(relative);
    removed.push(...findings);
  }
  return { changed, removed };
}

module.exports = { VALID_PERMISSION_KEYS, findPermissionsBlocks, workflowFiles, auditWorkflowPermissions, fixWorkflowPermissions };
