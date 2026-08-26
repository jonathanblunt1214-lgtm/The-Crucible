const { spawnSync } = require('node:child_process');

const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;
const SAFE_WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;

function validateRequest({ mode, defaultBranch, workflowPath, checkName, promotionConfirmed }) {
  if (!['report', 'activate'].includes(mode)) return { ok: false, message: 'Mode must be either report or activate.' };
  if (!SAFE_BRANCH.test(defaultBranch || '') || defaultBranch.includes('..')) return { ok: false, message: 'Default branch must be a plain branch name.' };
  if (!SAFE_WORKFLOW.test(workflowPath || '')) return { ok: false, message: 'Workflow path must name a YAML file directly under .github/workflows/.' };
  if (typeof checkName !== 'string' || !checkName.trim()) return { ok: false, message: 'Required check name must be provided.' };
  if (mode === 'report') return { ok: true, message: `Report-only rollout is safe. Do not require "${checkName}" until ${workflowPath} is explicitly promoted to ${defaultBranch}.` };
  if (promotionConfirmed !== true) return { ok: false, message: `Refusing to require "${checkName}": explicit promotion to ${defaultBranch} has not been confirmed.` };
  return { ok: true };
}

function checkRequiredCheckBoundary(request, run = spawnSync) {
  const validation = validateRequest(request);
  if (!validation.ok || request.mode === 'report') return validation;
  const remoteRef = `refs/remotes/origin/${request.defaultBranch}`;
  const object = `${remoteRef}:${request.workflowPath}`;
  const result = run('git', ['cat-file', '-e', object], { encoding: 'utf8', shell: false });
  if (result.status !== 0) return { ok: false, message: `Refusing to require "${request.checkName}": ${request.workflowPath} does not exist on ${remoteRef}. Fetch and verify the explicit promotion first.` };
  return { ok: true, message: `Safe to require "${request.checkName}": explicit promotion is confirmed and ${request.workflowPath} exists on ${remoteRef}.` };
}

if (require.main === module) {
  const result = checkRequiredCheckBoundary({
    mode: process.env.CRUCIBLE_ENFORCEMENT_MODE || '',
    defaultBranch: process.env.CRUCIBLE_DEFAULT_BRANCH || '',
    workflowPath: process.env.CRUCIBLE_WORKFLOW_PATH || '',
    checkName: process.env.CRUCIBLE_CHECK_NAME || '',
    promotionConfirmed: process.env.CRUCIBLE_PROMOTION_CONFIRMED === 'true'
  });
  console.log(`[Required-check boundary] ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = { validateRequest, checkRequiredCheckBoundary };
