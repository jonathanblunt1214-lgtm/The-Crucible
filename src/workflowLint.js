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

// A second way a workflow file is rejected outright, learned the hard way on 2026-09-02.
//
// `${{ runner.temp }}` was written into a job-level `env:` block. It looks reasonable and it is
// exactly what the same expression means one level down inside a step - but the `runner` context
// does not exist yet when job-level `env` is evaluated. GitHub does not warn or substitute an
// empty string: it refuses to compile the workflow, so the run is created with ZERO jobs and
// reports a bare failure. The whole nine-job Self-Test matrix disappeared on two commits and the
// only visible symptom was a red run with nothing in it.
//
// That is the same class of defect as an unrecognized permissions key, which is why it belongs
// beside it: not a policy preference, a file GitHub will not parse. The permissions linter
// existed and passed, because it only ever looked at permission keys.
const JOB_ENV_CONTEXTS = new Set(['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs']);

// Where in the document a line sits, by indentation. Enough to tell a job-level `env:` from a
// step-level one, which is the whole distinction that matters here.
function pathAt(lines, index) {
  const stack = [];
  for (let i = 0; i <= index; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const keyMatch = /^(\s*)(-\s+)?([A-Za-z0-9_.-]+):/.exec(line);
    if (!keyMatch) continue;
    const indent = keyMatch[1].length + (keyMatch[2] ? keyMatch[2].length : 0);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key: keyMatch[3] });
  }
  return stack.map((item) => item.key);
}

// Job-level `env:` blocks and the contexts each entry references.
function findJobEnvContexts(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)env:\s*$/.exec(lines[i]);
    if (!match) continue;
    const segments = pathAt(lines, i);
    // jobs -> <job id> -> env, and never inside a step.
    if (segments[0] !== 'jobs' || segments.length !== 3 || segments.includes('steps')) continue;
    const indent = match[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j].trim() || /^\s*#/.test(lines[j])) continue;
      const entry = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[j]);
      if (!entry || entry[1].length <= indent) break;
      for (const expression of entry[3].matchAll(/\$\{\{\s*([A-Za-z0-9_-]+)\s*\./g)) {
        found.push({ line: j + 1, key: entry[2], context: expression[1] });
      }
    }
  }
  return found;
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
    for (const use of findJobEnvContexts(text)) {
      if (JOB_ENV_CONTEXTS.has(use.context)) continue;
      findings.push({ path: relative, line: use.line, key: use.key, context: use.context, type: `the "${use.context}" context is not available in a job-level env block (allowed: ${[...JOB_ENV_CONTEXTS].sort().join(', ')})` });
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
    // Only unrecognized permission keys are safe to delete. A bad context is a real value the
    // workflow means to use, so removing the line would silently change what the job does.
    if (finding.context) continue;
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

module.exports = { VALID_PERMISSION_KEYS, JOB_ENV_CONTEXTS, findPermissionsBlocks, findJobEnvContexts, pathAt, workflowFiles, auditWorkflowPermissions, fixWorkflowPermissions };
