const fs = require('node:fs');
const path = require('node:path');

function safeMessage(error) {
  if (!error) return null;
  const firstLine = String(error.message || error).split(/\r?\n/, 1)[0];
  return firstLine
    .replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/gi, '[REDACTED]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 500);
}

function readReport(reportFile) {
  try { return JSON.parse(fs.readFileSync(reportFile, 'utf8')); }
  catch { return null; }
}

function suggestedFix(action) {
  const suggestions = {
    validate:'Review .thecrucible.json against the documented schema and correct the reported configuration field.',
    governance:'Narrow or remove the exception, add required ownership and expiry metadata, then rerun governance.',
    clutter:'Remove the reported generated, temporary, duplicate, or ignored tracked file, or add a narrowly governed exception when it is intentional.',
    privacy:'Remove or replace the reported personal information or credential, rotate any exposed credential, stage the reviewed correction, and rerun the privacy gate.',
    security:'Inspect the reported file and line. Remove unsafe behavior or payloads; if it is an inert test fixture, use the narrowest governed exception and rerun the Security Gate.',
    authenticity:'Correct the claim or its evidence command so the configured evidence proves the exact claim at this commit.',
    collisions:'Coordinate with the overlapping pull request, rebase or separate the shared changes, then rerun collision checking.',
    reproducibility:'Remove nondeterministic inputs such as timestamps, random values, environment-dependent paths, or unstable dependency output, then compare clean builds again.',
    maintain:'Repair the runner checkout or Git object database and rerun integrity checking; do not publish from a damaged checkout.',
    run:'Start with the first failed preparation, verification, artifact, timeout, or isolation message; reproduce that command locally and correct it before rerunning Crucible.',
  };
  return suggestions[action] || 'Review the failed action and its bounded error summary, correct the underlying project or configuration issue, and rerun Crucible.';
}

function writeReport({ root, config, action, status, error = null }) {
  const configuredPath = process.env.CRUCIBLE_REPORT_PATH;
  if (!configuredPath) return null;
  const reportFile = path.resolve(root, configuredPath);
  fs.mkdirSync(path.dirname(reportFile), { recursive:true });
  const existing = readReport(reportFile);
  const report = existing && Array.isArray(existing.results) ? existing : {
    schemaVersion:1,
    project:{ name:config?.project?.name || path.basename(root), repository:process.env.GITHUB_REPOSITORY || null },
    commit:process.env.GITHUB_SHA || null,
    workflow:{ runId:process.env.GITHUB_RUN_ID || null, runAttempt:process.env.GITHUB_RUN_ATTEMPT || null },
    startedAt:new Date().toISOString(),
    results:[],
  };
  report.results.push({ action, status, timestamp:new Date().toISOString(), ...(error ? { error:safeMessage(error), suggestedFix:suggestedFix(action) } : {}) });
  report.completedAt = new Date().toISOString();
  const temporary = `${reportFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
  fs.renameSync(temporary, reportFile);
  return reportFile;
}

module.exports = { writeReport, safeMessage, suggestedFix };
