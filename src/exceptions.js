const { glob } = require('./clutter');

function exceptionPath(entry) { return typeof entry === 'string' ? entry : entry.path; }
function exceptionRules(entries) { return entries.map((entry) => ({ entry, rule:glob(exceptionPath(entry)) })); }

function auditExceptions(snapshot, groups, requireMetadata, today = new Date()) {
  const findings = [];
  for (const [group, entries] of Object.entries(groups)) for (const { entry, rule } of exceptionRules(entries)) {
    const pattern = exceptionPath(entry);
    const matches = snapshot.files.filter((file) => rule.test(file));
    if (/^(?:\*|\*\*|\.\*|\*\*\/\*)$/.test(pattern)) findings.push({ type:'overly broad exception', group, path:pattern });
    if (!matches.length) findings.push({ type:'unused exception', group, path:pattern });
    if (typeof entry === 'string') {
      if (requireMetadata) findings.push({ type:'exception metadata required', group, path:pattern });
      continue;
    }
    if (requireMetadata && (!entry.reason || !entry.owner || !entry.expires)) findings.push({ type:'incomplete exception metadata', group, path:pattern });
    if (entry.expires && new Date(`${entry.expires}T23:59:59Z`) < today) findings.push({ type:'expired exception', group, path:pattern });
    if (entry.sha256 && matches.some((file) => snapshot.entries.get(file)?.sha256 !== entry.sha256)) findings.push({ type:'exception content hash changed', group, path:pattern });
  }
  return findings;
}

module.exports = { exceptionPath, exceptionRules, auditExceptions };
