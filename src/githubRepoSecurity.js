const fs = require('node:fs');
const { assertWellFormedApiUrl, assertSafeRepository } = require('./apiGuard');

const ENGINE_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';
const MISSING_PERMISSION_HINT = 'no token with repository-administration read access was available (GITHUB_TOKEN cannot be granted this - there is no such "permissions:" key)';
const PERMISSION_REMEDIATION = 'GITHUB_TOKEN can never read these settings: "administration" is not a valid GitHub Actions "permissions:" key for any token, so no workflow-level permission grants it. Create a fine-grained personal access token scoped to this repository with the read-only "Administration" repository permission, store it as a repository secret, and pass it to the caller workflow as `secrets.security_read_token` (see templates/caller-workflow.yml). Without that secret this check always reports "unable to verify" rather than a false pass.';

function settingsUrl(repository) {
  return `https://github.com/${repository}/settings/security_analysis`;
}

async function githubRequest(apiBase, path, token, fetchImpl) {
  const url = `${apiBase}${path}`;
  assertWellFormedApiUrl(url);
  return fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

async function fetchRepositorySecurity(apiBase, repository, token, fetchImpl) {
  const repoResponse = await githubRequest(apiBase, `/repos/${repository}`, token, fetchImpl);
  if (!repoResponse.ok) return { repository, reachable: false, statusCode: repoResponse.status, reason: `HTTP ${repoResponse.status}` };
  const repo = await repoResponse.json();
  // GitHub omits `security_and_analysis` entirely (still HTTP 200) when the
  // caller lacks administration:read, instead of returning an error. Treat
  // that omission as unverifiable rather than "everything is disabled".
  if (!repo.security_and_analysis) return { repository, reachable: false, statusCode: repoResponse.status, reason: MISSING_PERMISSION_HINT };
  const analysis = repo.security_and_analysis;
  const alertsResponse = await githubRequest(apiBase, `/repos/${repository}/vulnerability-alerts`, token, fetchImpl);
  // 204 = enabled, 404 = confirmed disabled. Any other status (403/401/5xx)
  // means we could not determine the real state and must not guess.
  if (alertsResponse.status !== 204 && alertsResponse.status !== 404) {
    return { repository, reachable: false, statusCode: alertsResponse.status, reason: alertsResponse.status === 403 ? MISSING_PERMISSION_HINT : `HTTP ${alertsResponse.status}` };
  }
  return {
    repository,
    reachable: true,
    dependabotAlerts: alertsResponse.status === 204,
    dependabotSecurityUpdates: analysis.dependabot_security_updates?.status === 'enabled',
    secretScanning: analysis.secret_scanning?.status === 'enabled',
    pushProtection: analysis.secret_scanning_push_protection?.status === 'enabled',
  };
}

function missingRequirements(status) {
  const missing = [];
  if (!status.dependabotAlerts) missing.push('Dependabot alerts');
  if (!status.dependabotSecurityUpdates) missing.push('Dependabot security updates');
  if (!status.secretScanning) missing.push('secret scanning');
  if (!status.pushProtection) missing.push('push protection');
  return missing;
}

async function auditGithubRepositorySecurity(config, environment = process.env, fetchImpl = globalThis.fetch) {
  if (config.githubSecurity && config.githubSecurity.enabled === false) return { skipped: true, disabled: true, findings: [], results: [] };
  // GITHUB_TOKEN can never read repository-administration settings (no such
  // permissions: key exists for it), so a maintainer-provided PAT with
  // read-only Administration access takes priority when present.
  const token = environment.CRUCIBLE_SECURITY_READ_TOKEN || environment.GITHUB_TOKEN;
  const repository = environment.GITHUB_REPOSITORY;
  if (!token || !repository) return { skipped: true, disabled: false, findings: [], results: [] };
  const apiBase = environment.GITHUB_API_URL || 'https://api.github.com';
  const targets = [...new Set([repository, ENGINE_REPOSITORY])];
  const findings = [];
  const results = [];
  for (const target of targets) {
    try {
      assertSafeRepository(target);
    } catch (error) {
      findings.push({ repository: target, type: 'unable to verify required GitHub security settings', detail: error.message, remediation: 'GITHUB_REPOSITORY should always be a plain "owner/repo" string, set automatically by GitHub Actions - if it is not, something upstream of this gate is misconfigured.' });
      continue;
    }
    const status = await fetchRepositorySecurity(apiBase, target, token, fetchImpl);
    results.push(status);
    if (!status.reachable) {
      const isPermissionIssue = status.reason === MISSING_PERMISSION_HINT;
      findings.push({
        repository: target,
        type: 'unable to verify required GitHub security settings',
        detail: status.reason,
        remediation: isPermissionIssue ? PERMISSION_REMEDIATION : `Confirm ${target} exists and that the workflow's token can reach the GitHub API, then re-run.`,
      });
      continue;
    }
    const missing = missingRequirements(status);
    if (missing.length) {
      findings.push({
        repository: target,
        type: `required GitHub security settings disabled: ${missing.join(', ')}`,
        remediation: `Open ${settingsUrl(target)} and enable: ${missing.join(', ')}.`,
      });
    }
  }
  return { skipped: false, disabled: false, findings, results };
}

function formatReport(result) {
  const lines = [`[The Crucible] GitHub repository security settings report: ${result.results.length} repositor${result.results.length === 1 ? 'y' : 'ies'} checked, ${result.findings.length} issue(s).`];
  for (const finding of result.findings) {
    lines.push(`- ${finding.repository}: ${finding.type}${finding.detail ? ` (${finding.detail})` : ''}`);
    lines.push(`  Fix: ${finding.remediation}`);
  }
  if (!result.findings.length) lines.push('- No action required.');
  return lines.join('\n');
}

function publishReport(report, environment = process.env) {
  if (!environment.GITHUB_STEP_SUMMARY) return false;
  fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, `## The Crucible GitHub repository security settings\n\n\`\`\`text\n${report}\n\`\`\`\n\n`, 'utf8');
  return true;
}

module.exports = { ENGINE_REPOSITORY, MISSING_PERMISSION_HINT, PERMISSION_REMEDIATION, settingsUrl, fetchRepositorySecurity, missingRequirements, auditGithubRepositorySecurity, formatReport, publishReport };
