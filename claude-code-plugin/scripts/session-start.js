#!/usr/bin/env node
'use strict';

// The Crucible - SessionStart hook.
//
// AGENTS.md requires every agent to read DEVLOG.md's shared handoff and every
// file named in AI-HANDOFF.json's governingDocuments before acting, and to
// treat a gap of more than 10 minutes since sessionPolicy.lastActionAt as a
// fresh session. This hook surfaces that requirement, and the current staleness,
// at session start.
//
// It is advisory only: it prints context and always exits 0. It never blocks a
// session, and it never edits a file.

const fs = require('node:fs');
const path = require('node:path');

const STALE_MINUTES = 10;
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
  console.log('[The Crucible] AI-HANDOFF.json is present but could not be parsed. Read it manually before acting.');
  process.exit(0);
}

const lines = ['[The Crucible] Governed repository detected. AGENTS.md requires a handoff read before any action.'];

const documents = Object.keys(handoff.governingDocuments || {});
if (documents.length) {
  const local = documents.filter((name) => !/^[A-Za-z0-9._-]+:/.test(name));
  const branchQualified = documents.filter((name) => /^[A-Za-z0-9._-]+:/.test(name));
  lines.push(`Governing documents to have read (${documents.length}): ${local.join(', ')}`);
  if (branchQualified.length) {
    lines.push(`Branch-qualified entries (not files on this branch): ${branchQualified.join(', ')}`);
  }
}

const lastActionAt = handoff.sessionPolicy?.lastActionAt;
const parsed = Date.parse(lastActionAt);
if (Number.isFinite(parsed)) {
  const idleMinutes = Math.floor((Date.now() - parsed) / 60000);
  if (idleMinutes >= STALE_MINUTES) {
    lines.push(`Last recorded action was ${idleMinutes} minute(s) ago (>= ${STALE_MINUTES}). Treat this as a FRESH session: re-read AGENTS.md, DEVLOG.md's Shared AI handoff, and every governing document before acting.`);
  } else {
    lines.push(`Last recorded action was ${idleMinutes} minute(s) ago (< ${STALE_MINUTES}).`);
  }
} else {
  lines.push('sessionPolicy.lastActionAt is missing or unparseable. Treat this as a fresh session and re-read the governing documents.');
}

const prompt = handoff.activePlan?.currentPrompt;
if (typeof prompt === 'string' && prompt.trim()) {
  const condensed = prompt.replace(/\s+/g, ' ').trim();
  lines.push(`activePlan.currentPrompt: ${condensed.length > 300 ? `${condensed.slice(0, 300)}...` : condensed}`);
}

const remaining = handoff.activePlan?.handoffNotes?.remaining;
if (Array.isArray(remaining) && remaining.length) {
  lines.push(`Remaining work (${remaining.length} item(s)) is recorded in AI-HANDOFF.json's handoffNotes.remaining.`);
}

const conflicts = readJson(path.join(root, 'AI-CONFLICTS.json'));
if (conflicts) {
  const open = Array.isArray(conflicts.conflicts)
    ? conflicts.conflicts.filter((item) => item && item.status !== 'resolved').length
    : 0;
  if (open) lines.push(`AI-CONFLICTS.json records ${open} unresolved conflict(s). Resolve per templates/ai-conflict-resolution.md; never silently pick a side.`);
}

lines.push('Branch policy: develop on `development` unless the owner named another branch in that exact request. Never push directly to `main`; promote through `release`. Never create or delete a branch without explicit permission.');
lines.push('Run /crucible:handoff for the full read.');

console.log(lines.join('\n'));
process.exit(0);
