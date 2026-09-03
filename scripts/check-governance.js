#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function matchRule(filename, rules) {
  for (const rule of rules) {
    const suffix = rule.match.replace('*', '');
    if (filename.endsWith(suffix)) return rule;
  }
  return null;
}

function canonicalTarget(relativeFile, placement) {
  const filename = path.basename(relativeFile);
  const special = (placement.specialCases || []).find((item) => item.filename === filename);
  if (special) {
    return { targetPath: special.targetPath, registerInHandoff: !!special.registerInHandoff };
  }
  const rule = matchRule(filename, placement.rules || []);
  if (!rule) {
    return { targetPath: path.join('governance', filename), registerInHandoff: true };
  }
  return {
    targetPath: path.join(rule.targetDirectory, filename),
    registerInHandoff: !!rule.registerInHandoff
  };
}

function updateHandoff(repoRoot, governanceFiles) {
  const handoffPath = path.join(repoRoot, 'AI-HANDOFF.json');
  const handoff = readJson(handoffPath);
  handoff.governingDocuments = Array.isArray(handoff.governingDocuments) ? handoff.governingDocuments : [];
  const existing = new Set(handoff.governingDocuments);
  for (const file of governanceFiles) {
    if (!existing.has(file)) {
      handoff.governingDocuments.push(file);
      existing.add(file);
    }
  }
  writeJson(handoffPath, handoff);
}

function main() {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());
  const governanceDir = path.join(repoRoot, 'governance');
  const placementPath = path.join(governanceDir, 'GOVERNANCE-PLACEMENT.json');
  const handoffPath = path.join(repoRoot, 'AI-HANDOFF.json');
  const conflictsPath = path.join(repoRoot, 'AI-CONFLICTS.json');
  const devlogPath = path.join(repoRoot, 'DEVLOG.md');
  const agentsPath = path.join(repoRoot, 'AGENTS.md');

  [governanceDir, placementPath, handoffPath, conflictsPath, devlogPath, agentsPath].forEach((p) => {
    if (!fs.existsSync(p)) throw new Error(`Required governance path missing: ${p}`);
  });

  const placement = readJson(placementPath);
  const governanceFiles = walk(governanceDir).map((file) => path.relative(repoRoot, file));
  const newlyRegistered = [];
  const moved = [];

  for (const relativeFile of governanceFiles) {
    const { targetPath, registerInHandoff } = canonicalTarget(relativeFile, placement);
    if (relativeFile !== targetPath) {
      const absoluteFrom = path.join(repoRoot, relativeFile);
      const absoluteTo = path.join(repoRoot, targetPath);
      ensureDir(path.dirname(absoluteTo));
      fs.renameSync(absoluteFrom, absoluteTo);
      moved.push({ from: relativeFile, to: targetPath });
      if (registerInHandoff) newlyRegistered.push(targetPath);
    } else if (registerInHandoff) {
      newlyRegistered.push(relativeFile);
    }
  }

  updateHandoff(repoRoot, newlyRegistered);

  const conflicts = readJson(conflictsPath);
  const active = Array.isArray(conflicts.conflicts)
    ? conflicts.conflicts.filter((c) => c.status === 'active').map((c) => c.id)
    : [];

  const result = {
    checkedAt: new Date().toISOString(),
    moved,
    registeredInHandoff: newlyRegistered,
    activeConflicts: active,
    blocked: active.length > 0
  };

  fs.writeFileSync(path.join(repoRoot, '.check-governance-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));

  if (active.length > 0) {
    throw new Error(`Governance check blocked by active conflicts: ${active.join(', ')}`);
  }
}

main();
