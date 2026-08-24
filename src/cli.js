#!/usr/bin/env node
const path = require('node:path');
const { loadConfig } = require('./config');
const { auditClutter } = require('./clutter');
const { runCrucible } = require('./runner');
const { maintain } = require('./maintenance');
const { auditPrivacy, scrubPrivacy } = require('./privacy');
const { auditSecurity, auditArtifactSecurity } = require('./security');
const { runCommand } = require('./runner');
const { auditCollisions } = require('./collisions');

async function securityGate(root, config) {
  const result = auditSecurity(root, config);
  if (result.skipped) return result;
  if (result.findings.length) throw new Error(`Security Gate detected suspicious content:\n${result.findings.map((item) => `- ${item.type}: ${item.path}${item.line ? `:${item.line}` : ''}`).join('\n')}`);
  for (const command of config.security.dependencyAudit) await runCommand(root, command, config.workload.timeoutMinutes * 60_000);
  return result;
}

async function main() {
  const action = process.argv[2] || 'run';
  const root = path.resolve(process.env.CRUCIBLE_PROJECT_ROOT || process.cwd());
  const config = loadConfig(root, process.env.CRUCIBLE_CONFIG || '.thecrucible.json');
  if (action === 'validate') return console.log(`[The Crucible] Valid configuration for ${config.project.name}.`);
  if (action === 'privacy') {
    const result = auditPrivacy(root, config);
    if (result.findings.length) {
      const scrubbed = scrubPrivacy(root, config);
      const locations = result.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n');
      const files = scrubbed.changed.length ? scrubbed.changed.map((file) => `- ${file}`).join('\n') : '- no writable text file could be sanitized';
      throw new Error(`Personal identifiers detected and the working copies were automatically sanitized.\n${locations}\nCleaned working files:\n${files}\nReview the cleaned files, stage them, and commit again. The original staged content remains blocked until you replace it.`);
    }
    return console.log(`[The Crucible] Privacy audit passed across ${result.files} tracked files. Allowed public identity: ${config.privacy.githubIdentity}.`);
  }
  if (action === 'scrub') {
    const result = scrubPrivacy(root, config);
    console.log(`[The Crucible] Privacy scrubber sanitized ${result.changed.length} file(s). Review, stage, and rerun the privacy audit before committing.`);
    return;
  }
  if (action === 'clutter') {
    const result = auditClutter(root, config);
    if (result.findings.length) throw new Error(`Clutter detected:\n${result.findings.map((item) => `- ${item.type}: ${item.path}`).join('\n')}`);
    return console.log(`[The Crucible] Clutter audit passed across ${result.files} tracked files.`);
  }
  if (action === 'security') {
    const result = await securityGate(root, config);
    return console.log(result.skipped ? '[The Crucible] Security Gate is explicitly disabled.' : `[The Crucible] Security Gate passed across ${result.files} tracked files and ${config.security.dependencyAudit.length} dependency audit command(s).`);
  }
  if (action === 'collisions') {
    const result = await auditCollisions();
    if (result.findings.length) throw new Error(`Overlapping open pull requests detected:\n${result.findings.map((item) => `- PR #${item.number} (${item.title}): ${item.paths.join(', ')}`).join('\n')}`);
    return console.log(result.skipped ? '[The Crucible] Collision audit skipped outside a pull-request context.' : '[The Crucible] Collision audit passed with no overlapping open pull requests.');
  }
  if (action === 'maintain') {
    const result = maintain(root);
    return console.log(`[The Crucible] Git integrity and safe repacking passed at ${result.head}.\nBefore:\n${result.before}\nAfter:\n${result.after}`);
  }
  if (action !== 'run') throw new Error(`Unknown action: ${action}`);
  const privacy = auditPrivacy(root, config);
  if (privacy.findings.length) throw new Error(`Personal identifiers detected:\n${privacy.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n')}`);
  const clutter = auditClutter(root, config);
  if (clutter.findings.length) throw new Error(`Clutter detected:\n${clutter.findings.map((item) => `- ${item.type}: ${item.path}`).join('\n')}`);
  await securityGate(root, config);
  const result = await runCrucible(root, config);
  const artifactSecurity = auditArtifactSecurity(root, config);
  if (artifactSecurity.findings.length) throw new Error(`Generated artifact security scan failed:\n${artifactSecurity.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n')}`);
  console.log(`[The Crucible] PASS: ${config.project.name} completed ${result.workers * result.cycles * result.commands} verification command runs with ${result.artifacts} required artifact(s).`);
}

main().catch((error) => { console.error(`[The Crucible] FAIL: ${error.message}`); process.exitCode = 1; });

module.exports = { securityGate };
