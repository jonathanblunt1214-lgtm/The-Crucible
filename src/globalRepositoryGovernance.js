const { githubRequest, PROJECT_REPOSITORY_MANIFEST } = require('./githubRepoSecurity');
const { GLOBAL_POLICY_FILE, validateGlobalPolicy } = require('./globalPolicy');

const REQUIRED_BRANCHES = ['main', 'Development-branch'];
const REQUIRED_FILES = ['AI-CONFLICTS.json', 'AI-HANDOFF.json', 'THE-CRUCIBLE-DESIGN-BRIEF.md', '.github/workflows/ai-conflict-governance.yml', '.github/workflows/ai-handoff-policy.yml'];
const REQUIRED_RULESETS = ['Crucible default branch governance', 'AI branch scope - Development-branch only'];

async function auditGlobalRepositoryGovernance(manifestSnapshot, environment = process.env, fetchImpl = globalThis.fetch) {
  if (!manifestSnapshot) return { skipped:true, findings:[], repositories:0 };
  const apiBase = environment.GITHUB_API_URL || 'https://api.github.com';
  const token = environment.CRUCIBLE_SECURITY_READ_TOKEN || environment.GITHUB_TOKEN;
  const findings = [];
  for (const repository of manifestSnapshot.repositories) {
    const assignedBranches = Object.entries(manifestSnapshot.branchRepositories || {})
      .filter(([, repositories]) => repositories.some((name) => name.toLowerCase() === repository.toLowerCase()))
      .map(([branch]) => branch);
    for (const branch of assignedBranches) {
      const response = await githubRequest(apiBase, `/repos/${repository}/branches/${encodeURIComponent(branch)}`, token, fetchImpl);
      if (!response.ok) {
        const slashLink = Object.entries(manifestSnapshot.slashBranchLinks || {}).find(([, branches]) => branches.includes(branch));
        findings.push({ repository, type:`required branch missing or unreadable: ${branch}${slashLink ? ` (linked set ${slashLink[0]})` : ''}` });
      }
    }
    for (const file of REQUIRED_FILES) {
      const response = await githubRequest(apiBase, `/repos/${repository}/contents/${file}`, token, fetchImpl);
      if (!response.ok) findings.push({ repository, type:`required governance file missing or unreadable: ${file}` });
    }
    const codeowners = await githubRequest(apiBase, `/repos/${repository}/contents/.github/CODEOWNERS`, token, fetchImpl);
    if (!codeowners.ok) findings.push({ repository, type:'manifest change protection missing: .github/CODEOWNERS is unreadable' });
    else {
      const payload = await codeowners.json();
      const text = payload.encoding === 'base64' ? Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8') : '';
      if (!text.split(/\r?\n/).some((line) => line.trim().startsWith(PROJECT_REPOSITORY_MANIFEST))) findings.push({ repository, type:`manifest change protection missing: ${PROJECT_REPOSITORY_MANIFEST} has no CODEOWNERS rule` });
    }
    const rulesets = await githubRequest(apiBase, `/repos/${repository}/rulesets?includes_parents=false`, token, fetchImpl);
    if (!rulesets.ok) findings.push({ repository, type:'expected rulesets are unreadable' });
    else {
      const entries = await rulesets.json();
      for (const name of REQUIRED_RULESETS) if (!entries.some((entry) => entry.name === name && entry.enforcement === 'active')) findings.push({ repository, type:`expected active ruleset missing: ${name}` });
    }
  }
  const globalPolicy = await githubRequest(apiBase, `/repos/${manifestSnapshot.mainRepository}/contents/${GLOBAL_POLICY_FILE}`, token, fetchImpl);
  let globalPolicySha = null;
  if (!globalPolicy.ok) findings.push({ repository:manifestSnapshot.mainRepository, type:`global project policy missing or unreadable: ${GLOBAL_POLICY_FILE}` });
  else {
    try {
      const payload = await globalPolicy.json();
      globalPolicySha = payload.sha || null;
      validateGlobalPolicy(JSON.parse(Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8')));
    } catch (error) { findings.push({ repository:manifestSnapshot.mainRepository, type:`invalid global project policy: ${error.message}` }); }
  }
  return { skipped:false, findings, repositories:manifestSnapshot.repositories.length, manifestSha:manifestSnapshot.manifestSha, globalPolicySha };
}

module.exports = { REQUIRED_BRANCHES, REQUIRED_FILES, REQUIRED_RULESETS, auditGlobalRepositoryGovernance };
