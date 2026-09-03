#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { auditClutter } = require('./clutter');
const { runCrucible } = require('./runner');
const { maintain } = require('./maintenance');
const { auditPrivacy, scrubPrivacy } = require('./privacy');
const { auditSecurity, auditArtifactSecurity } = require('./security');
const { auditGithubRepositorySecurity, formatReport: formatGithubSecurityReport, publishReport: publishGithubSecurityReport } = require('./githubRepoSecurity');
const { runCommand } = require('./runner');
const { auditCollisions } = require('./collisions');
const { auditCommit, fixCommit } = require('./commit');
const { repairInternalChecks, formatReport: formatRepairReport, publishReport: publishRepairReport } = require('./repair');
const { VALID_PERMISSION_KEYS, auditWorkflowPermissions } = require('./workflowLint');
const { auditDesignBrief, formatSeveredNotice, publishSeveredNotice } = require('./designBriefGate');
const { auditCoreRefIntegrity, formatReport: formatCoreRefReport, publishReport: publishCoreRefReport } = require('./coreRefIntegrity');
const { formatReport, publishReport, runPrecheck } = require('./precheck');
const { verifyClaims } = require('./authenticity');
const { stagedSnapshot } = require('./snapshot');
const { auditExceptions } = require('./exceptions');
const { auditDependencyPolicy } = require('./dependencies');
const { verifyReproducibility } = require('./reproducibility');
const { writeReport } = require('./report');
const { publishFailureIssue } = require('./failureIssue');
const { auditDocSync, syncReadme } = require('./docSync');
const { auditMalware } = require('./malwareScan');
const { quarantineFindings, quarantineNote } = require('./quarantine');
const { auditAIConflictLedger } = require('./aiConflictLedger');
const { categoryEnabled } = require('./suiteSelection');
const { auditGlobalRepositoryGovernance } = require('./globalRepositoryGovernance');
const { auditCirculationLinkage, BASELINE_FILE } = require('./circulationLinkage');
const { crucibleError, failureCode, describeCode, auditFailureCodes, UNCODED, resolveFailureLog } = require('./failureCodes');

const action = process.argv[2] || 'run';
const root = path.resolve(process.env.CRUCIBLE_PROJECT_ROOT || process.cwd());
let activeConfig = null;
const ACTION_CATEGORIES = Object.freeze({
  'core-ref':'repository', circulation:'repository', 'failure-codes':'quality', precheck:'quality', clutter:'hygiene', privacy:'privacy', security:'security',
  'github-security':'repository', authenticity:'quality', collisions:'repository', maintain:'hygiene', 'workflow-lint':'hygiene', reproducibility:'quality',
});

function designBriefGate(root) {
  const result = auditDesignBrief(root);
  if (!result.severed) return result;
  const notice = formatSeveredNotice(process.env.GITHUB_REPOSITORY);
  console.error(notice);
  publishSeveredNotice(notice);
  throw crucibleError('CRU-0001', 'The Crucible link is severed: THE-CRUCIBLE-DESIGN-BRIEF.md was deleted after being installed. See the notice above.');
}

async function coreRefGate() {
  const coreRef = process.env.CRUCIBLE_CORE_REF;
  const result = await auditCoreRefIntegrity(coreRef);
  if (result.skipped) return result;
  const report = formatCoreRefReport(coreRef, result);
  console.log(report);
  publishCoreRefReport(report);
  if (result.findings.length) throw crucibleError('CRU-0002', 'Pinned Crucible commit failed integrity verification. See the report above.');
  return result;
}

async function precheckGate(root, config) {
  const ref = process.env.CRUCIBLE_COMMIT_REF || process.env.GITHUB_SHA || '--cached';
  const result = await runPrecheck(root, config, { ref });
  const report = formatReport(result);
  console.log(report);
  publishReport(report);
  if (result.findings.length) throw crucibleError('CRU-0003', 'Pre-check requires the actions listed in the report.');
  return result;
}

function commitGate(root) {
  const ref = process.env.CRUCIBLE_COMMIT_REF || process.env.GITHUB_SHA || '--cached';
  const result = auditCommit(root, { ref });
  if (result.findings.length) throw crucibleError('CRU-0004', `Commit Gate found ${result.findings.length} issue(s).`);
  return result;
}

async function securityGate(root, config, snapshot = null) {
  const result = auditSecurity(root, config, snapshot);
  if (result.skipped) return result;
  if (result.findings.length) {
    const quarantine = quarantineFindings(root, result.findings, { snapshot });
    const error = new Error(`Security Gate detected suspicious content:\n${result.findings.map((item) => `- ${item.type}: ${item.path}${item.line ? `:${item.line}` : ''}`).join('\n')}${quarantineNote(quarantine)}`);
    error.findings = result.findings;
    error.quarantined = quarantine.quarantined;
    throw error;
  }
  const dependencies = auditDependencyPolicy(root, config);
  if (dependencies.findings.length) throw crucibleError('CRU-0005', `Dependency policy failed:\n${dependencies.findings.map((item) => `- ${item.type}: ${item.path}`).join('\n')}`);
  for (const command of config.security.dependencyAudit) await runCommand(root, command, config.workload.timeoutMinutes * 60_000);
  for (const command of config.security.provenanceAudit) await runCommand(root, command, config.workload.timeoutMinutes * 60_000, ' [provenance]');
  const malware = auditMalware(root, config, { snapshot });
  if (malware.findings.length) {
    const quarantine = quarantineFindings(root, malware.findings, { snapshot });
    const error = new Error(`Malware scan detected issues:\n${malware.findings.map((item) => `- ${item.type}${item.path ? `: ${item.path}` : ''}${item.detail ? ` (${item.detail})` : ''}`).join('\n')}${quarantineNote(quarantine)}`);
    error.findings = malware.findings;
    error.quarantined = quarantine.quarantined;
    throw error;
  }
  return result;
}

async function githubSecurityGate(config) {
  const result = await auditGithubRepositorySecurity(config);
  if (result.skipped) return result;
  const report = formatGithubSecurityReport(result);
  console.log(report);
  publishGithubSecurityReport(report);
  if (result.findings.length) throw crucibleError('CRU-0006', 'GitHub repository security settings gate requires the fixes listed in the report above. See "GitHub repository security settings gate" in README.md for the full walkthrough.');
  const globalGovernance = await auditGlobalRepositoryGovernance(result.manifestSnapshot);
  if (globalGovernance.findings.length) throw crucibleError('CRU-0007', `Global repository governance gate failed at manifest ${globalGovernance.manifestSha || 'unknown'}:\n${globalGovernance.findings.map((item) => `- ${item.repository}: ${item.type}`).join('\n')}`);
  return result;
}

function workflowLintGate(root) {
  const extraDirs = (process.env.CRUCIBLE_WORKFLOW_LINT_DIRS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const result = auditWorkflowPermissions(root, extraDirs);
  if (result.findings.length) {
    const details = result.findings.map((item) => `- ${item.path}:${item.line}: ${item.type}`).join('\n');
    // Three different defects reach here and they have different fixes: an unrecognized key is
    // deleted, an unavailable context is moved, a non-additive on-error step gains
    // continue-on-error. The code says which, so the immune system is not left guessing.
    const rules = new Set(result.findings.map((item) => item.rule));
    if (rules.has('on-error-additive') && rules.size === 1) {
      throw crucibleError('CRU-0028', `On-error diagnosis may never decide a job's own result:\n${details}\nAGENTS.md requires every if: failure() step to be additive, so the job still fails on the step that really failed.`);
    }
    throw crucibleError(rules.has('job-env-context') ? 'CRU-0027' : 'CRU-0008', `GitHub rejects this workflow file as invalid:\n${details}\nAn unrecognized key does not just fail to grant access - GitHub rejects the entire workflow file as invalid, so every job in it stops running. Valid keys are: ${[...VALID_PERMISSION_KEYS].sort().join(', ')}.`);
  }
  return result;
}

async function authenticityGate(root, config) {
  return verifyClaims(root, config);
}

function governanceGate(root, config, suppliedSnapshot = null) {
  if (config.governance.failOnDisabledSecurity && !config.security.enabled) throw crucibleError('CRU-0009', 'Configuration governance forbids disabling the Security Gate.');
  const conflicts = auditAIConflictLedger(root);
  if (conflicts.findings.length) throw crucibleError('CRU-0010', `AI conflict governance failed:\n${conflicts.findings.map((item) => `- ${item.type}: ${item.path} (${item.detail})`).join('\n')}`);
  const snapshot = suppliedSnapshot || stagedSnapshot(root);
  const findings = auditExceptions(snapshot, { 'clutter.allow':config.clutter.allow, 'privacy.allow':config.privacy.allow, 'security.allow':config.security.allow, 'security.allowBinaries':config.security.allowBinaries }, config.governance.requireExceptionMetadata);
  if (findings.length) throw crucibleError('CRU-0011', `Exception governance failed:\n${findings.map((item) => `- ${item.type}: ${item.group} ${item.path}`).join('\n')}`);
  return { exceptions:Object.values({ a:config.clutter.allow, b:config.privacy.allow, c:config.security.allow, d:config.security.allowBinaries }).flat().length, conflicts:conflicts.conflicts };
}

async function main() {
  if (action === 'report-init') return console.log('[The Crucible] Report initialized.');
  if (action === 'docs-sync') {
    const result = syncReadme(root);
    return console.log(result.changed ? '[The Crucible] README.md generated sections updated. Review and commit the change.' : '[The Crucible] README.md generated sections already match their source.');
  }
  if (action === 'docs-check') {
    const result = auditDocSync(root);
    if (!result.inSync) throw crucibleError('CRU-0012', `README.md is out of date:\n${result.findings.map((item) => `- ${item.type}${item.detail ? ` (${item.detail})` : ''}`).join('\n')}\nRun \`npm run docs:sync\`, review the diff, and commit it.`);
    return console.log('[The Crucible] README.md generated sections match their source.');
  }
  if (action === 'failure-issue') {
    const result = await publishFailureIssue();
    return console.log(`[The Crucible] Failure issue #${result.number} ${result.action}.`);
  }
  const config = loadConfig(root, process.env.CRUCIBLE_CONFIG || '.thecrucible.json');
  activeConfig = config;
  const actionCategory = ACTION_CATEGORIES[action];
  if (actionCategory && !categoryEnabled(config.suite, actionCategory) && !(actionCategory === 'repository' && categoryEnabled(config.suite, 'resilience'))) return console.log(`[The Crucible] Skipped ${action}: ${actionCategory} is not selected in the persisted suite configuration.`);
  if (action === 'validate') return console.log(`[The Crucible] Valid configuration for ${config.project.name}.`);
  if (action === 'commit') { const result = commitGate(root); return console.log(`[The Crucible] Commit Gate passed ${result.paths.length} changed path(s).`); }
  if (action === 'precheck') { await precheckGate(root, config); return; }
  if (action === 'fix-commit') { const result = fixCommit(root, { ref:process.env.CRUCIBLE_COMMIT_REF || '--cached' }); return console.log(`[The Crucible] Commit fixer updated ${result.changed.length} working file(s).`); }
  if (action === 'governance') { const result = governanceGate(root, config); return console.log(`[The Crucible] Configuration and AI conflict governance passed ${result.exceptions} exception(s) and ${result.conflicts} recorded conflict(s).`); }
  if (action === 'ai-conflicts') {
    const result = auditAIConflictLedger(root);
    if (result.findings.length) throw crucibleError('CRU-0010', `AI conflict governance failed:\n${result.findings.map((item) => `- ${item.type}: ${item.path} (${item.detail})`).join('\n')}`);
    return console.log(`[The Crucible] AI conflict governance passed ${result.conflicts} recorded conflict(s).`);
  }
  if (action === 'reproducibility') { const result = await verifyReproducibility(root, config); return console.log(result.skipped ? '[The Crucible] Reproducibility Gate is not enabled.' : `[The Crucible] Reproducibility Gate passed ${result.artifacts} artifact(s).`); }
  if (action === 'design-brief') {
    designBriefGate(root);
    return console.log('[The Crucible] Link is intact: THE-CRUCIBLE-DESIGN-BRIEF.md is present, or was never installed.');
  }
  if (action === 'circulation') {
    // The baseline is resolved against the same configured project root as the sources it
    // measures. Rooting one at CRUCIBLE_PROJECT_ROOT and the other at the caller's working
    // directory reports a missing baseline for a project that has one.
    const result = auditCirculationLinkage({ root: path.join(root, 'src'), baselineFile: path.join(root, BASELINE_FILE) });
    if (!result.ok) { console.error(`[The Crucible] FAIL: ${result.reason}`); process.exitCode = 1; return; }
    return console.log(`[The Crucible] Fly-by-wire: ${result.reason}`);
  }
  if (action === 'core-ref') {
    const result = await coreRefGate();
    if (result.skipped) console.log('[The Crucible] Pinned commit integrity check skipped: no CRUCIBLE_CORE_REF set.');
    return;
  }
  if (action === 'repair') {
    const ref = process.env.CRUCIBLE_COMMIT_REF || process.env.GITHUB_SHA || '--cached';
    const result = repairInternalChecks(root, config, { ref });
    const report = formatRepairReport(result);
    console.log(report);
    publishRepairReport(report);
    return;
  }
  if (action === 'privacy') {
    const result = auditPrivacy(root, config);
    if (result.findings.length) {
      const scrubbed = scrubPrivacy(root, config);
      const locations = result.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n');
      const files = scrubbed.changed.length ? scrubbed.changed.map((file) => `- ${file}`).join('\n') : '- no writable text file could be sanitized';
      throw crucibleError('CRU-0013', `Personal identifiers detected and the working copies were automatically sanitized.\n${locations}\nCleaned working files:\n${files}\nReview the cleaned files, stage them, and commit again. The original staged content remains blocked until you replace it.`);
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
    if (result.findings.length) throw crucibleError('CRU-0014', `Clutter detected:\n${result.findings.map((item) => `- ${item.type}: ${item.path}`).join('\n')}`);
    return console.log(`[The Crucible] Clutter audit passed across ${result.files} tracked files.`);
  }
  if (action === 'workflow-lint') {
    const result = workflowLintGate(root);
    return console.log(`[The Crucible] Workflow permissions lint passed across ${result.files} workflow file(s).`);
  }
  if (action === 'security') {
    const result = await securityGate(root, config);
    return console.log(result.skipped ? '[The Crucible] Security Gate is explicitly disabled.' : `[The Crucible] Security Gate passed across ${result.files} tracked files and ${config.security.dependencyAudit.length} dependency audit command(s).`);
  }
  if (action === 'github-security') {
    const result = await githubSecurityGate(config);
    if (result.skipped) console.log(result.disabled ? '[The Crucible] GitHub repository security settings gate is explicitly disabled.' : '[The Crucible] GitHub repository security settings gate skipped outside a GitHub Actions context.');
    return;
  }
  if (action === 'collisions') {
    const result = await auditCollisions();
    if (result.findings.length) throw crucibleError('CRU-0015', `Overlapping open pull requests detected:\n${result.findings.map((item) => `- PR #${item.number} (${item.title}): ${item.paths.join(', ')}`).join('\n')}`);
    return console.log(result.skipped ? '[The Crucible] Collision audit skipped outside a pull-request context.' : '[The Crucible] Collision audit passed with no overlapping open pull requests.');
  }
  if (action === 'authenticity') {
    const result = await authenticityGate(root, config);
    return console.log(`[The Crucible] Authenticity Gate passed ${result.claims} evidence-backed claim(s).`);
  }
  if (action === 'maintain') {
    const result = maintain(root);
    return console.log(`[The Crucible] Git integrity and safe repacking passed at ${result.head}.\nBefore:\n${result.before}\nAfter:\n${result.after}`);
  }
  if (action === 'failure-codes') {
    const result = auditFailureCodes();
    if (!result.ok) throw crucibleError(result.code, result.reason);
    return console.log(`[The Crucible] Failure-code coverage: ${result.reason}`);
  }
  if (action !== 'run') throw crucibleError('CRU-0016', `Unknown action: ${action}`);
  const snapshot = stagedSnapshot(root);
  const selected = config.suite.categories;
  if (categoryEnabled(config.suite, 'governance')) { designBriefGate(root); governanceGate(root, config, snapshot); }
  if (categoryEnabled(config.suite, 'repository') || categoryEnabled(config.suite, 'resilience')) { await coreRefGate(); await githubSecurityGate(config); }
  if (categoryEnabled(config.suite, 'quality')) await precheckGate(root, config);
  if (categoryEnabled(config.suite, 'privacy')) {
    const privacy = auditPrivacy(root, config, snapshot);
    if (privacy.findings.length) throw crucibleError('CRU-0013', `Personal identifiers detected:\n${privacy.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n')}`);
  }
  if (categoryEnabled(config.suite, 'hygiene')) {
    const clutter = auditClutter(root, config, snapshot);
    if (clutter.findings.length) throw crucibleError('CRU-0014', `Clutter detected:\n${clutter.findings.map((item) => `- ${item.type}: ${item.path}`).join('\n')}`);
    workflowLintGate(root);
  }
  if (categoryEnabled(config.suite, 'security')) await securityGate(root, config, snapshot);
  let result = null;
  if (categoryEnabled(config.suite, 'quality')) {
    await authenticityGate(root, config);
    result = await runCrucible(root, config);
    const artifactSecurity = auditArtifactSecurity(root, config);
    if (artifactSecurity.findings.length) {
      const quarantine = quarantineFindings(root, artifactSecurity.findings);
      const error = crucibleError('CRU-0017', `Generated artifact security scan failed:\n${artifactSecurity.findings.map((item) => `- ${item.type}: ${item.path}:${item.line}`).join('\n')}${quarantineNote(quarantine)}`);
      error.findings = artifactSecurity.findings;
      error.quarantined = quarantine.quarantined;
      throw error;
    }
    await verifyReproducibility(root, config);
  }
  const workload = result ? `; ${result.workers * result.cycles * result.commands} verification command runs and ${result.artifacts} required artifact(s)` : '';
  console.log(`[The Crucible] PASS: ${config.project.name} completed suite categories: ${selected.join(', ')}${workload}.`);
}

// Every failure leaves the same two traces: a coded line a person reads in the CI log, and a
// file the diagnostic organ reads afterwards.
//
// The second exists because of a specific hole. The self-test workflow hands
// `ciDiagnosticOrgan` the npm-install log no matter which step failed, so a failure four steps
// later was diagnosed against a log that could not possibly mention it - on 2026-09-02 that
// produced a report with an empty `diagnoses` array against 267 bytes of successful install
// output. Nothing downstream could fix that, because the failing step's output is not available
// to a later step. So the failing process records its own failure where the organ can find it.
// Writing it here rather than piping the step through `tee` keeps the three runner shells out of
// it entirely: no pipefail, no PowerShell redirection differences, and it works for any Crucible
// invocation rather than only the ones a workflow remembered to wrap.
function recordCodedFailure(error) {
  const file = resolveFailureLog();
  if (!file) return;
  const code = failureCode(error) || UNCODED;
  const known = describeCode(code);
  const detail = [
    `[The Crucible] FAIL: ${error.message}`,
    `failureCode: ${code}`,
    `action: ${action}`,
    known ? `meaning: ${known.meaning}` : '',
    known ? `next: ${known.next}` : '',
  ].filter(Boolean).join('\n');
  // A diagnostic that throws would replace the real failure with its own, which is the one
  // thing an on-error path may never do.
  try { fs.appendFileSync(file, `${detail}\n`, { mode: 0o600 }); }
  catch (writeError) { console.error(`[The Crucible] Coded failure could not be recorded: ${writeError.message}`); }
}

main()
  .then(() => writeReport({ root, config:activeConfig, action, status:'passed' }))
  .catch((error) => {
    try { writeReport({ root, config:activeConfig, action, status:'failed', error }); }
    catch (reportError) { console.error(`[The Crucible] Report could not be saved: ${reportError.message}`); }
    recordCodedFailure(error);
    // The code is printed even when the throw site had none: `UNCODED` says "this path has no
    // code yet" in a form the organ can classify, which is still an actionable finding rather
    // than the silence a bare message left behind.
    console.error(`[The Crucible] FAIL: [${failureCode(error) || UNCODED}] ${error.message.replace(/^\[CRU-\d{4}\] /, '')}`);
    process.exitCode = 1;
  });

module.exports = { securityGate, githubSecurityGate, authenticityGate, commitGate, precheckGate, designBriefGate, coreRefGate, governanceGate };
