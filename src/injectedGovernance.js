'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANONICAL_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';
const CANONICAL_BRANCH = 'main';

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

function canonicalUrl(relativePath) {
  return `https://github.com/${CANONICAL_REPOSITORY}/blob/${CANONICAL_BRANCH}/governingDocuments/${relativePath}`;
}

function projectMarkdown(relativePath) {
  const title = path.posix.basename(relativePath).replace(/\.md$/i, '');
  return `# ${title} — injected project governance\n\nThis file intentionally mirrors the canonical Crucible governing-document filename \`${relativePath}\` so an injected project always carries the same governance names as Crucible's canonical \`governingDocuments\` tree.\n\nCanonical policy: ${canonicalUrl(relativePath)}\n\nApply that canonical policy to this repository as a project-local overlay. Do not copy canonical policy text here merely to make the project self-contained; keep project-specific additions below and follow the current canonical \`main\` document for shared rules.\n\nFor branches that do not follow the normal paired naming convention such as \`project-123\` / \`project-abc\`, use \`.crucible-branch-links.json\` to declare a canonical-reference dependency explicitly. A branch such as \`Plug-in\` can therefore be governed as directly dependent on \`main\` even though its name makes it look unrelated. When canonical \`main\` renames a referenced path, Crucible may automatically rewrite recognized references on that linked branch, commit the deterministic repair, and retest. It must never invent semantic replacements when no deterministic repair exists.\n\n## Project-specific overlay\n\nAdd only repository-specific governance here.\n`;
}

function projectJson(relativePath, sourceRoot) {
  if (relativePath === 'known-bugs/KNOWN-BUGS.json') {
    return `${JSON.stringify({ schemaVersion: 1, severityOrder: ['critical', 'high', 'medium', 'low'], bugs: [] }, null, 2)}\n`;
  }
  return fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');
}

function ensureInjectedGovernance({ sourceRoot, targetRoot, handoffPath } = {}) {
  if (!sourceRoot || !targetRoot || !handoffPath) throw new Error('sourceRoot, targetRoot, and handoffPath are required');
  const canonicalFiles = walkFiles(sourceRoot);
  const created = [];
  for (const relativePath of canonicalFiles) {
    const target = path.join(targetRoot, relativePath);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = relativePath.toLowerCase().endsWith('.json')
      ? projectJson(relativePath, sourceRoot)
      : projectMarkdown(relativePath);
    fs.writeFileSync(target, content, 'utf8');
    created.push(relativePath);
  }

  const missing = canonicalFiles.filter((relativePath) => !fs.existsSync(path.join(targetRoot, relativePath)));
  if (missing.length) throw new Error(`Injected governingDocuments parity failed; missing: ${missing.join(', ')}`);

  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  handoff.governingDocuments = handoff.governingDocuments && typeof handoff.governingDocuments === 'object' && !Array.isArray(handoff.governingDocuments)
    ? handoff.governingDocuments
    : {};
  for (const relativePath of canonicalFiles) {
    const localPath = `governingDocuments/${relativePath}`;
    const branchLinking = relativePath === 'branch-linking-policy.md';
    handoff.governingDocuments[localPath] = branchLinking
      ? 'Project-local canonical-reference branch linking policy. Use .crucible-branch-links.json for branches whose main dependency is real but not expressed by project-123/project-abc naming; safe deterministic repairs are automatic and retested.'
      : `Project-local governance mirror for canonical main:governingDocuments/${relativePath}.`;
  }
  fs.writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
  return { canonicalFiles, created };
}

function main() {
  const [sourceRoot, targetRoot, handoffPath] = process.argv.slice(2);
  const result = ensureInjectedGovernance({ sourceRoot, targetRoot, handoffPath });
  console.log(`[The Crucible] Injected governingDocuments parity: ${result.canonicalFiles.length} canonical filename(s), ${result.created.length} created.`);
}

if (require.main === module) main();

module.exports = { walkFiles, canonicalUrl, projectMarkdown, projectJson, ensureInjectedGovernance };
