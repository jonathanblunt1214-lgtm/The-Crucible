const test = require('node:test');
const assert = require('node:assert/strict');
const { PROJECT_REPOSITORY_MANIFEST, ENGINE_REPOSITORY } = require('../src/githubRepoSecurity');
const { REQUIRED_RULESETS } = require('../src/globalRepositoryGovernance');
const { runHostedMultiRepositoryIntegration } = require('../src/hostedMultiRepositoryIntegration');

function environment(overrides = {}) {
  return { GITHUB_TOKEN:'token', GITHUB_REPOSITORY:'octocat/main-app', CRUCIBLE_MAIN_REPOSITORY:'octocat/main-app', ...overrides };
}

function analysisResponse() {
  return { ok:true, status:200, json:async () => ({ security_and_analysis:{ dependabot_security_updates:{ status:'enabled' }, secret_scanning:{ status:'enabled' }, secret_scanning_push_protection:{ status:'enabled' } } }) };
}

function passingFetchImpl() {
  return async (url) => {
    if (url.includes(`/contents/${PROJECT_REPOSITORY_MANIFEST}`)) {
      return { ok:true, status:200, json:async () => ({ encoding:'base64', sha:'manifest-sha', content:Buffer.from(JSON.stringify({ schemaVersion:2, branches:{ main:[{ id:100, name:'octocat/main-app' }], 'Development-branch':[{ id:100, name:'octocat/main-app' }] } })).toString('base64') }) };
    }
    if (url.endsWith('/repositories/100')) return { ok:true, status:200, json:async () => ({ id:100, full_name:'octocat/main-app' }) };
    if (url.endsWith('/vulnerability-alerts')) return { ok:true, status:204 };
    if (url.includes('/rulesets?')) return { ok:true, status:200, json:async () => REQUIRED_RULESETS.map((name) => ({ name, enforcement:'active' })) };
    if (url.endsWith('/contents/.github/CODEOWNERS')) return { ok:true, status:200, json:async () => ({ encoding:'base64', content:Buffer.from(`${PROJECT_REPOSITORY_MANIFEST} @octocat`).toString('base64') }) };
    if (url.endsWith('/contents/.thecrucible-global.json')) return { ok:true, status:200, json:async () => ({ encoding:'base64', sha:'policy-sha', content:Buffer.from(JSON.stringify({ schemaVersion:1, preferences:[], rules:[], settings:[] })).toString('base64') }) };
    if (/\/branches\//.test(url)) return { ok:true, status:200, json:async () => ({}) };
    if (/\/contents\//.test(url)) return { ok:true, status:200, json:async () => ({}) };
    return analysisResponse();
  };
}

test('requires CRUCIBLE_MAIN_REPOSITORY and never calls fetch without it', async () => {
  let called = false;
  await assert.rejects(
    runHostedMultiRepositoryIntegration({ GITHUB_TOKEN:'token', GITHUB_REPOSITORY:'octocat/main-app' }, async () => { called = true; }),
    /CRUCIBLE_MAIN_REPOSITORY is required/
  );
  assert.equal(called, false);
});

test('passes end to end: repository security settings and global governance both clean at one manifest snapshot', async () => {
  const result = await runHostedMultiRepositoryIntegration(environment(), passingFetchImpl());
  assert.equal(result.repositories, 1);
  assert.equal(result.manifestSha, 'manifest-sha');
});

test('fails when the repository security gate finds a problem, before governance ever runs', async () => {
  let governanceCalled = false;
  const fetchImpl = async (url, init) => {
    if (url.includes('/rulesets?') || /\/branches\//.test(url) || (/\/contents\//.test(url) && !url.includes(PROJECT_REPOSITORY_MANIFEST))) governanceCalled = true;
    if (url.endsWith('/vulnerability-alerts')) return { ok:false, status:403 };
    return passingFetchImpl()(url, init);
  };
  await assert.rejects(runHostedMultiRepositoryIntegration(environment(), fetchImpl), /Repository security integration failed with \d+ finding\(s\)/);
  assert.equal(governanceCalled, false);
});

test('fails when repository security passes but global governance finds a problem', async () => {
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/contents/.github/CODEOWNERS')) return { ok:false, status:404 };
    return passingFetchImpl()(url, init);
  };
  await assert.rejects(runHostedMultiRepositoryIntegration(environment(), fetchImpl), /Repository governance integration failed with \d+ finding\(s\)/);
});

test('fails closed when the security audit is skipped (no token or repository in the environment)', async () => {
  await assert.rejects(
    runHostedMultiRepositoryIntegration({ CRUCIBLE_MAIN_REPOSITORY:'octocat/main-app' }, passingFetchImpl()),
    /Repository security integration failed/
  );
});

test('always includes the Crucible engine repository itself among the security targets', async () => {
  const checked = new Set();
  const fetchImpl = async (url, init) => {
    const match = url.match(/\/repos\/([^/]+\/[^/]+)(?:\/|$)/);
    if (match && !url.includes('/contents/') && !url.includes('/branches/')) checked.add(match[1]);
    return passingFetchImpl()(url, init);
  };
  await runHostedMultiRepositoryIntegration(environment(), fetchImpl);
  assert.ok(checked.has(ENGINE_REPOSITORY), `expected ${ENGINE_REPOSITORY} to be checked, got: ${[...checked].join(', ')}`);
});
