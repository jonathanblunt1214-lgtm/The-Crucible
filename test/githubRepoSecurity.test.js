const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ENGINE_REPOSITORY, MISSING_PERMISSION_HINT, PERMISSION_REMEDIATION, settingsUrl, auditGithubRepositorySecurity, formatReport, publishReport } = require('../src/githubRepoSecurity');

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

test('prefers a maintainer-provided admin-read token over the default GITHUB_TOKEN', async () => {
  const seenAuthorization = [];
  const fetchImpl = async (url, init) => {
    seenAuthorization.push(init.headers.Authorization);
    if (url.endsWith('/vulnerability-alerts')) return { ok: true, status: 204 };
    return repoResponse();
  };
  await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'default-token', CRUCIBLE_SECURITY_READ_TOKEN: 'admin-pat', GITHUB_REPOSITORY: ENGINE_REPOSITORY }, fetchImpl);
  assert.ok(seenAuthorization.every((value) => value === 'Bearer admin-pat'));
});

test('falls back to GITHUB_TOKEN when no admin-read token is provided', async () => {
  const seenAuthorization = [];
  const fetchImpl = async (url, init) => {
    seenAuthorization.push(init.headers.Authorization);
    if (url.endsWith('/vulnerability-alerts')) return { ok: true, status: 204 };
    return repoResponse();
  };
  await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'default-token', GITHUB_REPOSITORY: ENGINE_REPOSITORY }, fetchImpl);
  assert.ok(seenAuthorization.every((value) => value === 'Bearer default-token'));
});

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
  const example = result.findings.find((item) => item.repository === 'octocat/example');
  const engine = result.findings.find((item) => item.repository === ENGINE_REPOSITORY);
  assert.match(example.type, /secret scanning/);
  assert.equal(example.remediation, `Open ${settingsUrl('octocat/example')} and enable: secret scanning.`);
  assert.match(engine.type, /Dependabot alerts/);
  assert.match(engine.remediation, /settings\/security_analysis/);
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
  assert.match(finding.remediation, /Confirm .* exists/);
});

test('reports an unverifiable-permission token instead of falsely claiming settings are disabled', async () => {
  const fetchImpl = fetchImplFor({
    'octocat/example': { noAdminAccess: true },
    [ENGINE_REPOSITORY]: {},
  });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, fetchImpl);
  const finding = result.findings.find((item) => item.repository === 'octocat/example');
  assert.match(finding.type, /unable to verify/);
  assert.equal(finding.detail, MISSING_PERMISSION_HINT);
  assert.equal(finding.remediation, PERMISSION_REMEDIATION);
});

test('reports an unverifiable-permission token when the vulnerability-alerts endpoint is forbidden', async () => {
  const fetchImpl = fetchImplFor({
    'octocat/example': { alertsStatus: 403 },
    [ENGINE_REPOSITORY]: {},
  });
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'octocat/example' }, fetchImpl);
  const finding = result.findings.find((item) => item.repository === 'octocat/example');
  assert.equal(finding.detail, MISSING_PERMISSION_HINT);
});

test('formatReport prints an actionable fix line under every finding', () => {
  const report = formatReport({
    results: [{ repository: 'octocat/example' }],
    findings: [{ repository: 'octocat/example', type: 'required GitHub security settings disabled: secret scanning', remediation: `Open ${settingsUrl('octocat/example')} and enable: secret scanning.` }],
  });
  assert.match(report, /1 repository checked, 1 issue\(s\)/);
  assert.match(report, /- octocat\/example: required GitHub security settings disabled: secret scanning/);
  assert.match(report, /\n {2}Fix: Open https:\/\/github\.com\/octocat\/example\/settings\/security_analysis and enable: secret scanning\./);
});

test('formatReport reports a clean pass with no findings', () => {
  const report = formatReport({ results: [{ repository: 'octocat/example' }, { repository: ENGINE_REPOSITORY }], findings: [] });
  assert.match(report, /2 repositories checked, 0 issue\(s\)/);
  assert.match(report, /No action required/);
});

test('publishReport appends to the GitHub Actions job summary when present', () => {
  const summaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-summary-')), 'summary.md');
  fs.writeFileSync(summaryPath, '');
  const published = publishReport('report body', { GITHUB_STEP_SUMMARY: summaryPath });
  assert.equal(published, true);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /## The Crucible GitHub repository security settings[\s\S]*report body/);
});

test('publishReport is a no-op outside GitHub Actions', () => {
  assert.equal(publishReport('report body', {}), false);
});
