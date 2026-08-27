const fs = require('node:fs');
const { assertWellFormedApiUrl, assertSafeRepository } = require('./apiGuard');

const ENGINE_REPOSITORY = 'jonathanblunt1214-lgtm/The-Crucible';
const PROJECT_REPOSITORY_MANIFEST = '.thecrucible-repositories.json';
const MISSING_PERMISSION_HINT = 'no token with repository-administration read access was available (GITHUB_TOKEN cannot be granted this - there is no such "permissions:" key)';
const PERMISSION_REMEDIATION = 'GITHUB_TOKEN can never read these settings: "administration" is not a valid GitHub Actions "permissions:" key for any token, so no workflow-level permission grants it. Create a fine-grained personal access token scoped to this repository with the read-only "Administration" repository permission, store it as a repository secret, and pass it to the caller workflow as `secrets.security_read_token` (see templates/caller-workflow.yml). Without that secret this check always reports "unable to verify" rather than a false pass.';

function settingsUrl(repository) {
  return `https://github.com/${repository}/settings/security_analysis`;
}

async function githubRequest(apiBase, path, token, fetchImpl) {
  const url = `${apiBase}${path}`;
  assertWellFormedApiUrl(url);
  let lastResponse;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      lastResponse = await fetchImpl(url, { method:'GET', redirect:'error', signal:controller.signal, headers:{ Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28' } });
      lastError = null;
    } catch (error) { lastError = error; }
    finally { clearTimeout(timeout); }
    if (lastError) {
      if (attempt === 3) throw lastError;
      continue;
    }
    if (![429, 502, 503, 504].includes(lastResponse.status) || attempt === 3) return lastResponse;
  }
  return lastResponse;
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
    repository: repo.full_name || repository,
    configuredRepository: repository,
    reachable: true,
    dependabotAlerts: alertsResponse.status === 204,
    dependabotSecurityUpdates: analysis.dependabot_security_updates?.status === 'enabled',
    secretScanning: analysis.secret_scanning?.status === 'enabled',
    pushProtection: analysis.secret_scanning_push_protection?.status === 'enabled',
  };
}

function linkedBranchIdentity(branch) {
  const lower = branch.toLowerCase();
  if (lower === 'main') return { role:'main', link:'default' };
  if (lower === 'development-branch') return { role:'development', link:'default' };
  const match = branch.match(/^(main|development)-(.+)$/i);
  return match ? { role:match[1].toLowerCase(), link:match[2].toLowerCase() } : null;
}

function validateLinkedBranches(branchNames) {
  const links = new Map();
  for (const branch of branchNames) {
    const identity = linkedBranchIdentity(branch);
    if (!identity) continue;
    const pair = links.get(identity.link) || {};
    if (pair[identity.role]) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} assigns more than one ${identity.role} branch to link ${identity.link}.`);
    pair[identity.role] = branch;
    links.set(identity.link, pair);
  }
  if (!links.size) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} must contain at least one linked main/development branch pair.`);
  for (const [link, pair] of links) if (!pair.main || !pair.development) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} link ${link} must keep its matching main and development branches together.`);
  return Object.fromEntries(links);
}

function groupBranchesByLink(branchNames) {
  const groups = new Map();
  for (const branch of branchNames) {
    const slash = branch.lastIndexOf('/');
    if (slash < 1 || slash === branch.length - 1) continue;
    const link = branch.slice(slash + 1).toLowerCase();
    const members = groups.get(link) || [];
    members.push(branch);
    groups.set(link, members);
  }
  return Object.fromEntries([...groups].filter(([, members]) => members.length > 1));
}

async function fetchProjectRepositories(apiBase, mainRepository, token, fetchImpl) {
  assertSafeRepository(mainRepository);
  const response = await githubRequest(apiBase, `/repos/${mainRepository}/contents/${PROJECT_REPOSITORY_MANIFEST}`, token, fetchImpl);
  if (!response.ok) throw new Error(`HTTP ${response.status} reading ${PROJECT_REPOSITORY_MANIFEST} from Main repository ${mainRepository}`);
  const payload = await response.json();
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') throw new Error(`${PROJECT_REPOSITORY_MANIFEST} must be returned as base64 file content.`);
  const bytes = Buffer.from(payload.content.replace(/\s/g, ''), 'base64');
  if (!bytes.length || bytes.length > 131072) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} must be a non-empty file no larger than 128 KiB.`);
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new Error(`${PROJECT_REPOSITORY_MANIFEST} is invalid JSON: ${error.message}`); }
  if (!manifest || manifest.schemaVersion !== 2 || !manifest.branches || Array.isArray(manifest.branches) || typeof manifest.branches !== 'object') throw new Error(`${PROJECT_REPOSITORY_MANIFEST} must use schemaVersion 2 and divide repositories underneath branch names.`);
  const branchNames = Object.keys(manifest.branches);
  const branchLinks = validateLinkedBranches(branchNames);
  const slashBranchLinks = groupBranchesByLink(branchNames);
  const branchEntries = [];
  for (const branch of branchNames) {
    if (!/^(?!\.)(?!.*\.\.)(?!.*[~^:?*\\\[\]])[A-Za-z0-9._/-]+$/.test(branch) || branch.endsWith('/') || branch.endsWith('.')) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} contains an unsafe branch name: ${branch}`);
    const entries = manifest.branches[branch];
    if (!Array.isArray(entries) || entries.length < 1) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} branch ${branch} must list at least one repository.`);
    for (const entry of entries) branchEntries.push({ branch, entry });
  }
  if (branchEntries.length < 2 || branchEntries.length > 50) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} must contain 2 through 50 branch-to-repository assignments.`);
  const identities = [];
  const resolvedById = new Map();
  for (const { branch, entry } of branchEntries) {
    if (!entry || !Number.isSafeInteger(entry.id) || entry.id < 1 || typeof entry.name !== 'string') throw new Error(`${PROJECT_REPOSITORY_MANIFEST} repositories require a positive GitHub id and owner/repository name.`);
    const configuredName = assertSafeRepository(entry.name);
    let resolved = resolvedById.get(entry.id);
    if (!resolved) {
      const identityResponse = await githubRequest(apiBase, `/repositories/${entry.id}`, token, fetchImpl);
      if (!identityResponse.ok) throw new Error(`HTTP ${identityResponse.status} resolving stable repository id ${entry.id}`);
      const identity = await identityResponse.json();
      if (identity.id !== entry.id || typeof identity.full_name !== 'string') throw new Error(`GitHub returned an invalid identity for repository id ${entry.id}.`);
      resolved = { id:entry.id, configuredName, currentName:assertSafeRepository(identity.full_name) };
      resolvedById.set(entry.id, resolved);
      identities.push(resolved);
    } else if (resolved.configuredName.toLowerCase() !== configuredName.toLowerCase()) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} assigns conflicting names to stable repository id ${entry.id}.`);
  }
  if (new Set(identities.map((entry) => entry.currentName.toLowerCase())).size !== identities.length) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} contains duplicate repository identities.`);
  const mainBranches = Object.values(branchLinks).map((pair) => pair.main);
  const mainEntries = mainBranches.flatMap((branch) => manifest.branches[branch]);
  if (!mainEntries.some((entry) => entry.name.toLowerCase() === mainRepository.toLowerCase())) throw new Error(`${PROJECT_REPOSITORY_MANIFEST} main section must include the configured Main repository ${mainRepository}.`);
  const mainIdentity = identities.find((entry) => entry.configuredName.toLowerCase() === mainRepository.toLowerCase());
  const branchRepositories = Object.fromEntries(branchNames.map((branch) => [branch, manifest.branches[branch].map((entry) => resolvedById.get(entry.id).currentName)]));
  return { repositories:identities.map((entry) => entry.currentName), branchRepositories, branchLinks, slashBranchLinks, identities, mainRepository:mainIdentity.currentName, manifestSha:payload.sha || null };
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
  let configuredRepositories = [repository];
  let manifestSnapshot = null;
  const findings = [];
  if (config.project?.mainRepository) {
    try {
      const manifest = await fetchProjectRepositories(apiBase, config.project.mainRepository, token, fetchImpl);
      configuredRepositories = manifest.repositories;
      manifestSnapshot = manifest;
    } catch (error) {
      configuredRepositories = [];
      findings.push({ repository:config.project.mainRepository, type:'unable to pull the current project repository list from the Main repository', detail:error.message, remediation:`Store a valid ${PROJECT_REPOSITORY_MANIFEST} on the Main repository's default branch and grant the gate token Contents: read access.` });
    }
  }
  const targets = [...new Map([...configuredRepositories, ENGINE_REPOSITORY].map((target) => [target.toLowerCase(), target])).values()];
  const results = [];
  for (const identity of manifestSnapshot?.identities || []) {
    if (identity.configuredName.toLowerCase() !== identity.currentName.toLowerCase()) findings.push({ repository:identity.currentName, type:`project manifest repository name is stale: ${identity.configuredName}`, remediation:`Replace ${identity.configuredName} with ${identity.currentName} for stable repository id ${identity.id} in ${PROJECT_REPOSITORY_MANIFEST}.` });
  }
  if (config.project?.mainRepository && configuredRepositories.length && !configuredRepositories.some((target) => target.toLowerCase() === repository.toLowerCase())) {
    findings.push({ repository, type: 'calling repository is missing from the Main repository project manifest', remediation: `Add the current repository name ${repository} to ${PROJECT_REPOSITORY_MANIFEST} in the Main repository, or run this global project check from a listed repository.` });
  }
  for (const target of targets) {
    try {
      assertSafeRepository(target);
    } catch (error) {
      findings.push({ repository: target, type: 'unable to verify required GitHub security settings', detail: error.message, remediation: 'GITHUB_REPOSITORY should always be a plain "owner/repo" string, set automatically by GitHub Actions - if it is not, something upstream of this gate is misconfigured.' });
      continue;
    }
    const status = await fetchRepositorySecurity(apiBase, target, token, fetchImpl);
    status.gate = {
      sourceRepository: repository,
      targetRepository: status.repository,
      operation: 'verify GitHub repository security settings',
      crossRepository: repository.toLowerCase() !== status.repository.toLowerCase(),
      mainRepository: config.project?.mainRepository || repository,
      manifestSha: manifestSnapshot?.manifestSha || null,
    };
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
  return { skipped: false, disabled: false, findings, results, manifestSnapshot };
}

function formatReport(result) {
  const lines = [`[The Crucible] GitHub repository security settings report: ${result.results.length} repositor${result.results.length === 1 ? 'y' : 'ies'} checked, ${result.findings.length} issue(s).`];
  for (const status of result.results) {
    if (status.gate) lines.push(`- Repository gate: ${status.gate.sourceRepository} -> ${status.gate.targetRepository} (${status.gate.operation}; Main repository: ${status.gate.mainRepository}).`);
  }
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

module.exports = { ENGINE_REPOSITORY, PROJECT_REPOSITORY_MANIFEST, MISSING_PERMISSION_HINT, PERMISSION_REMEDIATION, linkedBranchIdentity, validateLinkedBranches, groupBranchesByLink, githubRequest, settingsUrl, fetchProjectRepositories, fetchRepositorySecurity, missingRequirements, auditGithubRepositorySecurity, formatReport, publishReport };
