const { auditGithubRepositorySecurity } = require('./githubRepoSecurity');
const { auditGlobalRepositoryGovernance } = require('./globalRepositoryGovernance');

async function runHostedMultiRepositoryIntegration(environment = process.env, fetchImpl = globalThis.fetch) {
  const mainRepository = environment.CRUCIBLE_MAIN_REPOSITORY;
  if (!mainRepository) throw new Error('CRUCIBLE_MAIN_REPOSITORY is required.');
  const security = await auditGithubRepositorySecurity({ project:{ mainRepository }, githubSecurity:{ enabled:true } }, environment, fetchImpl);
  if (security.skipped || security.findings.length) throw new Error(`Repository security integration failed with ${security.findings.length} finding(s).`);
  const governance = await auditGlobalRepositoryGovernance(security.manifestSnapshot, environment, fetchImpl);
  if (governance.skipped || governance.findings.length) throw new Error(`Repository governance integration failed with ${governance.findings.length} finding(s).`);
  return { repositories:governance.repositories, manifestSha:governance.manifestSha };
}

if (require.main === module) runHostedMultiRepositoryIntegration().then((result) => console.log(`[The Crucible] Hosted multi-repository integration passed ${result.repositories} members at manifest ${result.manifestSha}.`)).catch((error) => { console.error(`[The Crucible] ${error.message}`); process.exitCode = 1; });

module.exports = { runHostedMultiRepositoryIntegration };
