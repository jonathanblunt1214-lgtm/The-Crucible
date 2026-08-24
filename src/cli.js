#!/usr/bin/env node
const path = require('node:path');
const { loadConfig } = require('./config');
const { auditClutter } = require('./clutter');
const { runCrucible } = require('./runner');
const { maintain } = require('./maintenance');
const { auditPrivacy, scrubPrivacy } = require('./privacy');

async function main() {
  const action = process.argv[2] || 'run';
  const root = path.resolve(process.env.CRUCIBLE_PROJECT_ROOT || process.cwd());
  const config = loadConfig(root, process.env.CRUCIBLE_CONFIG || '.thecrucible.json');
  if (action === 'validate') return console.log(`[The Crucible] Valid configuration for ${config.project.name}.`);
  if (action === 'privacy') {
    const result = auditPrivacy(root, config);
    if (result.findings.length) throw new Error(`Personal identifiers detected:\n${result.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n')}`);
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
  if (action === 'maintain') {
    const result = maintain(root);
    return console.log(`[The Crucible] Git integrity and safe repacking passed at ${result.head}.\nBefore:\n${result.before}\nAfter:\n${result.after}`);
  }
  if (action !== 'run') throw new Error(`Unknown action: ${action}`);
  const privacy = auditPrivacy(root, config);
  if (privacy.findings.length) throw new Error(`Personal identifiers detected:\n${privacy.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n')}`);
  const clutter = auditClutter(root, config);
  if (clutter.findings.length) throw new Error(`Clutter detected:\n${clutter.findings.map((item) => `- ${item.type}: ${item.path}`).join('\n')}`);
  const result = await runCrucible(root, config);
  console.log(`[The Crucible] PASS: ${config.project.name} completed ${result.workers * result.cycles * result.commands} verification command runs with ${result.artifacts} required artifact(s).`);
}

main().catch((error) => { console.error(`[The Crucible] FAIL: ${error.message}`); process.exitCode = 1; });
