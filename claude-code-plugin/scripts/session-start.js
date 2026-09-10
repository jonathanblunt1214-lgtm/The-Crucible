#!/usr/bin/env node
'use strict';

// The Crucible - SessionStart hook.
//
// Reports observable facts about the current checkout so the session starts
// from real state rather than assumption. It deliberately does NOT restate
// this repository's policy: shared governance is canonical in AGENTS.md and
// the documents AI-HANDOFF.json names, and this hook points at them instead
// of paraphrasing rules that can change.
//
// Advisory only: prints context, always exits 0, never edits a file, and stays
// silent outside a Crucible checkout.

const fs = require('node:fs');
const path = require('node:path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const handoffPath = path.join(root, 'AI-HANDOFF.json');
if (!fs.existsSync(handoffPath)) process.exit(0); // Not a Crucible project.

const handoff = readJson(handoffPath);
if (!handoff) {
  console.log('[The Crucible] AI-HANDOFF.json is present but could not be parsed. Read it directly before acting.');
  process.exit(0);
}

const lines = ['[The Crucible] Governed repository detected. Read AGENTS.md, DEVLOG.md\'s Shared AI handoff, and every governing document below, and follow them as they currently stand, before acting.'];

const documents = Object.keys(handoff.governingDocuments || {});
if (documents.length) {
  const branchQualified = documents.filter((name) => /^[A-Za-z0-9._-]+:/.test(name));
  const local = documents.filter((name) => !/^[A-Za-z0-9._-]+:/.test(name));
  lines.push(`governingDocuments (${documents.length}): ${local.join(', ')}`);
  if (branchQualified.length) {
    lines.push(`Branch-qualified entries, which name a file on that branch rather than a path here: ${branchQualified.join(', ')}`);
  }
}

const lastActionAt = handoff.sessionPolicy?.lastActionAt;
const parsed = Date.parse(lastActionAt);
if (Number.isFinite(parsed)) {
  const idleMinutes = Math.floor((Date.now() - parsed) / 60000);
  lines.push(`sessionPolicy.lastActionAt is ${lastActionAt} (${idleMinutes} minute(s) ago). Apply AGENTS.md's governing-document recheck rule to that figure.`);
} else {
  lines.push('sessionPolicy.lastActionAt is missing or unparseable. Read AGENTS.md\'s recheck rule and treat this accordingly.');
}

const prompt = handoff.activePlan?.currentPrompt;
if (typeof prompt === 'string' && prompt.trim()) {
  const condensed = prompt.replace(/\s+/g, ' ').trim();
  lines.push(`activePlan.currentPrompt: ${condensed.length > 300 ? `${condensed.slice(0, 300)}...` : condensed}`);
}

const remaining = handoff.activePlan?.handoffNotes?.remaining;
if (Array.isArray(remaining) && remaining.length) {
  lines.push(`activePlan.handoffNotes.remaining lists ${remaining.length} outstanding item(s).`);
}

const conflicts = readJson(path.join(root, 'AI-CONFLICTS.json'));
if (conflicts) {
  const open = Array.isArray(conflicts.conflicts)
    ? conflicts.conflicts.filter((item) => item && item.status !== 'resolved').length
    : 0;
  if (open) lines.push(`AI-CONFLICTS.json records ${open} unresolved conflict(s). Follow the conflict-resolution procedure the governing documents name.`);
}

lines.push('Before any commit, push, branch, or promotion, read AGENTS.md\'s branch policy and follow it as written.');
lines.push('Run /crucible:handoff for the full read.');

console.log(lines.join('\n'));
process.exit(0);
