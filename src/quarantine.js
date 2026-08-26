const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Security Gate and malware-scan findings are detected against the staged
// Git snapshot before any prepare/verify command runs, so a flagged file is
// never executed by the job that found it - and the ephemeral runner it ran
// on is destroyed afterward regardless. There is no persistent, air-gapped
// environment this engine can build inside GitHub Actions to "isolate" a
// running process in the literal sense. What is real and worth doing: the
// exact flagged bytes otherwise disappear with the runner the moment the
// job ends, leaving only a type/path/line in the log. This preserves them
// as a separate, clearly-labeled quarantine directory - never unpacked back
// into the checkout, never part of the normal project report - so a human
// can retrieve and inspect exactly what tripped the gate.
const QUARANTINE_DIR = '.the-crucible-quarantine';

function readBlob(root, file) {
  return execFileSync('git', ['show', `:${file}`], { cwd: root, encoding: 'buffer', windowsHide: true });
}

function quarantineFindings(root, findings, options = {}) {
  const flaggedPaths = [...new Set(findings.map((item) => item.path).filter(Boolean))];
  if (!flaggedPaths.length) return { quarantined: [] };
  const quarantineRoot = path.resolve(root, QUARANTINE_DIR);
  const quarantined = [];
  for (const file of flaggedPaths) {
    const dest = path.resolve(quarantineRoot, file);
    if (dest !== quarantineRoot && !dest.startsWith(`${quarantineRoot}${path.sep}`)) continue;
    let buffer = options.snapshot?.entries?.get(file)?.buffer;
    if (!buffer) { try { buffer = readBlob(root, file); } catch { /* not a tracked file, e.g. a generated artifact - fall through */ } }
    if (!buffer) { try { buffer = fs.readFileSync(path.resolve(root, file)); } catch { continue; } }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    quarantined.push(file);
  }
  return { quarantined };
}

function quarantineNote(quarantine) {
  if (!quarantine.quarantined.length) return '';
  return `\nFlagged file(s) copied, unmodified, to ${QUARANTINE_DIR}/ for isolated inspection - see the "the-crucible-quarantine" workflow artifact. They are not restored into the checkout and never run.`;
}

module.exports = { QUARANTINE_DIR, quarantineFindings, quarantineNote };
