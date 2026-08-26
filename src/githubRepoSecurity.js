const ENGINE_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';

async function githubRequest(apiBase, path, token, fetchImpl) {
  return fetchImpl(`${apiBase}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

async function fetchRepositorySecurity(apiBase, repository, token, fetchImpl) {
  const repoResponse = await githubRequest(apiBase, `/repos/${repository}`, token, fetchImpl);
  if (!repoResponse.ok) return { repository, reachable: false, statusCode: repoResponse.status };
  const repo = await repoResponse.json();
  const analysis = repo.security_and_analysis || {};
  const alertsResponse = await githubRequest(apiBase, `/repos/${repository}/vulnerability-alerts`, token, fetchImpl);
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
  const token = environment.GITHUB_TOKEN;
  const repository = environment.GITHUB_REPOSITORY;
  if (!token || !repository) return { skipped: true, disabled: false, findings: [], results: [] };
  const apiBase = environment.GITHUB_API_URL || 'https://api.github.com';
  const targets = [...new Set([repository, ENGINE_REPOSITORY])];
  const findings = [];
  const results = [];
  for (const target of targets) {
    const status = await fetchRepositorySecurity(apiBase, target, token, fetchImpl);
    results.push(status);
    if (!status.reachable) {
      findings.push({ repository: target, type: 'unable to verify required GitHub security settings', detail: `HTTP ${status.statusCode}` });
      continue;
    }
    const missing = missingRequirements(status);
    if (missing.length) findings.push({ repository: target, type: `required GitHub security settings disabled: ${missing.join(', ')}` });
  }
  return { skipped: false, disabled: false, findings, results };
}

module.exports = { ENGINE_REPOSITORY, fetchRepositorySecurity, missingRequirements, auditGithubRepositorySecurity };
