const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE_REPOSITORY, MISSING_PERMISSION_HINT, auditGithubRepositorySecurity } = require('../src/githubRepoSecurity');

function config(overrides = {}) {
  return { githubSecurity: { enabled: true, ...overrides } };
}

function repoResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      security_and_analysis: {
        dependabot_security_updates: { status: 'enabled' },
        secret_scanning: { status: 'enabled' },
        secret_scanning_push_protection: { status: 'enabled' },
        ...overrides,
      },
    }),
  };
}

function repoResponseWithoutAdminAccess() {
  return { ok: true, status: 200, json: async () => ({}) };
}

// state per repository: { analysisOverrides, alertsStatus, repoUnreachable, noAdminAccess }
function fetchImplFor(statusByRepository) {
  return async (url) => {
    const repository = Object.keys(statusByRepository).find((candidate) => url.includes(`/repos/${candidate}`));
    const state = statusByRepository[repository];
    if (url.endsWith('/vulnerability-alerts')) {
      const alertsStatus = state.alertsStatus ?? 204;
      return { ok: alertsStatus === 204, status: alertsStatus };
    }
    if (state.repoUnreachable) return { ok: false, status: 403 };
    if (state.noAdminAccess) return repoResponseWithoutAdminAccess();
    return repoResponse(state.analysisOverrides || {});
  };
}

test('skips outside a GitHub Actions context', async () => {
  const result = await auditGithubRepositorySecurity(config(), {}, async () => { throw new Error('not called'); });
  assert.deepEqual(result, { skipped: true, disabled: false, findings: [], results: [] });
});

test('skips when explicitly disabled in project configuration', async () => {
  const result = await auditGithubRepositorySecurity(config({ enabled: false }), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, async () => { throw new Error('not called'); });
  assert.deepEqual(result, { skipped: true, disabled: true, findings: [], results: [] });
});

test('checks both the calling project repository and the linked Crucible engine repository', async () => {
  const fetchImpl = fetchImplFor({
    'octocat/example': {},
    [ENGINE_REPOSITORY]: {},
  });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, fetchImpl);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.results.map((item) => item.repository).sort(), ['octocat/example', ENGINE_REPOSITORY].sort());
});

test('does not duplicate the check when the calling repository is the engine repository', async () => {
  const fetchImpl = fetchImplFor({ [ENGINE_REPOSITORY]: {} });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: ENGINE_REPOSITORY }, fetchImpl);
  assert.equal(result.results.length, 1);
});

test('fails when a required setting is confirmed disabled on either repository', async () => {
  const fetchImpl = fetchImplFor({
    'octocat/example': { analysisOverrides: { secret_scanning: { status: 'disabled' } } },
    [ENGINE_REPOSITORY]: { alertsStatus: 404 },
  });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, fetchImpl);
  assert.equal(result.findings.length, 2);
  assert.match(result.findings.find((item) => item.repository === 'octocat/example').type, /secret scanning/);
  assert.match(result.findings.find((item) => item.repository === ENGINE_REPOSITORY).type, /Dependabot alerts/);
});

test('reports an unreachable repository instead of throwing', async () => {
  const fetchImpl = fetchImplFor({
    'octocat/example': {},
    [ENGINE_REPOSITORY]: { repoUnreachable: true },
  });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, fetchImpl);
  const finding = result.findings.find((item) => item.repository === ENGINE_REPOSITORY);
  assert.match(finding.type, /unable to verify/);
  assert.match(finding.detail, /HTTP 403/);
});

test('reports missing administration:read instead of falsely claiming settings are disabled', async () => {
  const fetchImpl = fetchImplFor({
    'octocat/example': { noAdminAccess: true },
    [ENGINE_REPOSITORY]: {},
  });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, fetchImpl);
  const finding = result.findings.find((item) => item.repository === 'octocat/example');
  assert.match(finding.type, /unable to verify/);
  assert.equal(finding.detail, MISSING_PERMISSION_HINT);
});

test('reports missing administration:read when the vulnerability-alerts endpoint is forbidden', async () => {
  const fetchImpl = fetchImplFor({
    'octocat/example': { alertsStatus: 403 },
    [ENGINE_REPOSITORY]: {},
  });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, fetchImpl);
  const finding = result.findings.find((item) => item.repository === 'octocat/example');
  assert.equal(finding.detail, MISSING_PERMISSION_HINT);
});
