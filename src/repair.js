const fs = require('node:fs');
const { fixCommit } = require('./commit');
const { scrubPrivacy } = require('./privacy');
const { fixWorkflowPermissions } = require('./workflowLint');
const { ENGINE_REPOSITORY } = require('./githubRepoSecurity');

// This module exists only to keep The Crucible's own repository green. It
// must never be reachable for a project that adopts The Crucible. The first
// two checks below rely on .thecrucible.json content alone, which someone
// could in principle copy into a different repository - so a third,
// independent check against the actual repository identity (GITHUB_REPOSITORY,
// set automatically by GitHub Actions, not read from any file this module
// controls) closes that gap. All three must agree; a coincidental match on
// any one or two of them alone can never satisfy this guard.
const ENGINE_PROJECT_ID = 'the-crucible';
const ENGINE_GITHUB_IDENTITY = 'jonathanblunt1214-lgtm';

function assertInternalProject(config, environment = process.env) {
  const matchesProject = config.project.projectId === ENGINE_PROJECT_ID;
  const matchesIdentity = config.privacy.githubIdentity === ENGINE_GITHUB_IDENTITY;
  // GITHUB_REPOSITORY is unset for local development (npm run repair on a
  // maintainer's own machine), which this guard must keep allowing - it is
  // only enforced when running in a context (CI) where it is actually set.
  const matchesRepository = !environment.GITHUB_REPOSITORY || environment.GITHUB_REPOSITORY === ENGINE_REPOSITORY;
  if (!matchesProject || !matchesIdentity || !matchesRepository) {
    throw new Error(`The internal repair system only runs against The Crucible engine's own repository (project.projectId "${ENGINE_PROJECT_ID}", privacy.githubIdentity "${ENGINE_GITHUB_IDENTITY}", and, when running in CI, GITHUB_REPOSITORY "${ENGINE_REPOSITORY}"). It never modifies a project that adopts The Crucible, even when this code is run locally against another checkout or a copied .thecrucible.json.`);
  }
}

// Bundles the existing, already-safe, working-copy-only fixers (privacy
// scrubbing and commit-gate hygiene) behind one command for this
// repository's own maintenance. It applies no fix that is not already
// exposed individually via `npm run scrub:privacy` / `npm run fix:commit`;
// it never stages, commits, or pushes, and it cannot repair logic bugs,
// failing tests, or anything requiring human judgment.
function repairInternalChecks(root, config, options = {}) {
  assertInternalProject(config, options.environment || process.env);
  const ref = options.ref || '--cached';
  const privacy = scrubPrivacy(root, config);
  const workflows = fixWorkflowPermissions(root, ['templates']);
  let commit = { changed: [], review: [] };
  let skipReason = null;
  if (ref === '--cached') {
    commit = fixCommit(root, { ref });
  } else {
    skipReason = 'Commit Gate auto-fix only applies to staged working-tree changes, not already-committed history. Run "npm run repair" locally, before committing, to apply it.';
  }
  const changed = [...new Set([...privacy.changed, ...workflows.changed, ...commit.changed])];
  return { changed, removedPermissions: workflows.removed, remaining: commit.review || [], skipReason };
}

function formatReport(result) {
  const lines = [`[The Crucible] Internal repair report: ${result.changed.length} working file(s) updated, ${result.remaining.length} issue(s) still need human review.`];
  for (const file of result.changed) lines.push(`- fixed: ${file}`);
  for (const item of result.removedPermissions || []) lines.push(`- removed unrecognized permissions key "${item.key}" from ${item.path}:${item.line} (it never granted real access; leaving it in made the whole workflow file invalid)`);
  for (const item of result.remaining) lines.push(`- needs review: ${item.type}: ${item.path}${item.line ? `:${item.line}` : ''}`);
  if (result.skipReason) lines.push(`- ${result.skipReason}`);
  if (!result.changed.length && !result.remaining.length && !result.skipReason) lines.push('- No fixable internal hygiene issues found. This cannot repair failing tests or logic bugs.');
  return lines.join('\n');
}

function publishReport(report, environment = process.env) {
  if (!environment.GITHUB_STEP_SUMMARY) return false;
  fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, `## The Crucible internal repair (engine repository only)\n\n\`\`\`text\n${report}\n\`\`\`\n\nThis diagnostic step cannot commit or push a fix. If it reports changes, run \`npm run repair\` locally, review the working-tree changes, stage, and commit them yourself.\n\n`, 'utf8');
  return true;
}

module.exports = { ENGINE_PROJECT_ID, ENGINE_GITHUB_IDENTITY, assertInternalProject, repairInternalChecks, formatReport, publishReport };
