const fs = require('node:fs');
const { fixCommit } = require('./commit');
const { scrubPrivacy } = require('./privacy');

// This module exists only to keep The Crucible's own repository green. It
// must never be reachable for a project that adopts The Crucible: the guard
// below checks two independent, unrelated config fields so a coincidental
// projectId match alone can never satisfy it.
const ENGINE_PROJECT_ID = 'the-crucible';
const ENGINE_GITHUB_IDENTITY = 'jonathanblunt1214-lgtm';

function assertInternalProject(config) {
  const matchesProject = config.project.projectId === ENGINE_PROJECT_ID;
  const matchesIdentity = config.privacy.githubIdentity === ENGINE_GITHUB_IDENTITY;
  if (!matchesProject || !matchesIdentity) {
    throw new Error(`The internal repair system only runs against The Crucible engine's own repository (project.projectId "${ENGINE_PROJECT_ID}" and privacy.githubIdentity "${ENGINE_GITHUB_IDENTITY}"). It never modifies a project that adopts The Crucible, even when this code is run locally against another checkout.`);
  }
}

// Bundles the existing, already-safe, working-copy-only fixers (privacy
// scrubbing and commit-gate hygiene) behind one command for this
// repository's own maintenance. It applies no fix that is not already
// exposed individually via `npm run scrub:privacy` / `npm run fix:commit`;
// it never stages, commits, or pushes, and it cannot repair logic bugs,
// failing tests, or anything requiring human judgment.
function repairInternalChecks(root, config, options = {}) {
  assertInternalProject(config);
  const ref = options.ref || '--cached';
  const privacy = scrubPrivacy(root, config);
  let commit = { changed: [], review: [] };
  let skipReason = null;
  if (ref === '--cached') {
    commit = fixCommit(root, { ref });
  } else {
    skipReason = 'Commit Gate auto-fix only applies to staged working-tree changes, not already-committed history. Run "npm run repair" locally, before committing, to apply it.';
  }
  const changed = [...new Set([...privacy.changed, ...commit.changed])];
  return { changed, remaining: commit.review || [], skipReason };
}

function formatReport(result) {
  const lines = [`[The Crucible] Internal repair report: ${result.changed.length} working file(s) updated, ${result.remaining.length} issue(s) still need human review.`];
  for (const file of result.changed) lines.push(`- fixed: ${file}`);
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
