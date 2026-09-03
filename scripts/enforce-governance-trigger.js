#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function hasAny(text, needles) {
  const lower = String(text || '').toLowerCase();
  return needles.some((needle) => lower.includes(String(needle).toLowerCase()));
}

function main() {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());
  const handoffPath = path.join(repoRoot, 'AI-HANDOFF.json');
  const manifestPath = path.join(repoRoot, 'governance', 'GOVERNANCE-TRIGGER-MANIFEST.json');
  const checkGovernancePath = path.join(repoRoot, 'governance', 'CHECK-GOVERNANCE.md');
  const triggerPath = path.join(repoRoot, 'governance', 'CHECK-GOVERNANCE-TRIGGER.md');
  const checkerScript = path.join(repoRoot, 'scripts', 'governance', 'check-governance.js');

  [handoffPath, manifestPath, checkGovernancePath, triggerPath, checkerScript].forEach((p) => {
    if (!fs.existsSync(p)) throw new Error(`Missing required governance trigger path: ${p}`);
  });

  const handoff = readJson(handoffPath);
  const manifest = readJson(manifestPath);
  const governingDocuments = Array.isArray(handoff.governingDocuments) ? handoff.governingDocuments : [];
  const currentPrompt = (((handoff || {}).activePlan || {}).currentPrompt || '');
  const checkGovernanceText = readText(checkGovernancePath);
  const triggerText = readText(triggerPath);

  for (const requiredPath of manifest.requiredHandoffFields.governingDocumentsMustContain || []) {
    if (!governingDocuments.includes(requiredPath)) {
      throw new Error(`AI-HANDOFF.json.governingDocuments missing required path: ${requiredPath}`);
    }
  }

  for (const requiredPath of manifest.requiredScripts || []) {
    if (!fs.existsSync(path.join(repoRoot, requiredPath))) {
      throw new Error(`Required governance script missing: ${requiredPath}`);
    }
  }

  if (hasAny(currentPrompt, manifest.triggerPhrases || [])) {
    if (!hasAny(currentPrompt, manifest.requiredFirstRead || [])) {
      throw new Error('Current prompt contains check governance but does not route the agent to the required governance files first.');
    }
  }

  if (!/read\s+`?governance\/CHECK-GOVERNANCE\.md`?/i.test(triggerText) && !/Read `governance\/CHECK-GOVERNANCE\.md`/i.test(triggerText)) {
    throw new Error('Trigger contract does not explicitly require reading governance/CHECK-GOVERNANCE.md first.');
  }

  if (!/detect newly dropped governance files/i.test(checkGovernanceText) && !/detect newly dropped governance files/i.test(triggerText)) {
    throw new Error('Governance trigger files do not explicitly require detection of newly dropped governance files.');
  }

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    currentPrompt,
    governingDocumentsCount: governingDocuments.length
  }, null, 2));
}

main();
