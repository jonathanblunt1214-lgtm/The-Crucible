const fs = require('node:fs');
const { auditCommit } = require('./commit');
const { auditCode } = require('./code-check');
const { formatDecision } = require('./governingDecision');

function classifyCommit(item) {
  return {
    ...item,
    action:item.fixable ? 'safe auto-fix' : item.type === 'merge-conflict-marker' ? 'security concern' : 'human code review required',
    check:'Commit Gate',
    errorCode:`CRUCIBLE_COMMIT_${item.type.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`,
  };
}

function formatReport(result) {
  const lines = [`[The Crucible] Pre-check report: ${result.paths.length} changed path(s), ${result.findings.length} action(s).`];
  for (const finding of result.findings) {
    const targets = finding.path || (finding.paths || []).join(', ') || 'repository';
    lines.push(`- [${finding.action}] ${finding.errorCode}: ${finding.check}: ${targets}${finding.detail ? ` (${finding.detail})` : ''}`);
    if (finding.decision) lines.push(`  Governing decision: ${formatDecision(finding.decision)}.`);
  }
  if (!result.findings.length) lines.push('- No action required.');
  return lines.join('\n');
}

function publishReport(report, environment = process.env) {
  if (!environment.GITHUB_STEP_SUMMARY) return false;
  fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, `## The Crucible latest report\n\n\`\`\`text\n${report}\n\`\`\`\n\n`, 'utf8');
  return true;
}

async function runPrecheck(root, config, options = {}) {
  const ref = options.ref || '--cached';
  const commit = auditCommit(root, { ref });
  const code = await auditCode(root, config, { ref, paths:commit.paths });
  const findings = [...commit.findings.map(classifyCommit), ...code.findings];
  return { ref, paths:commit.paths, findings, decisions:findings.filter((item) => item.decision).map((item) => item.decision) };
}

module.exports = { classifyCommit, formatReport, publishReport, runPrecheck };
