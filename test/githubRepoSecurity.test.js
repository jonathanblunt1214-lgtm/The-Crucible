const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ENGINE_REPOSITORY, PROJECT_REPOSITORY_MANIFEST, MISSING_PERMISSION_HINT, PERMISSION_REMEDIATION, settingsUrl, validateLinkedBranches, groupBranchesByLink, fetchProjectRepositories, auditGithubRepositorySecurity, formatReport, publishReport } = require('../src/githubRepoSecurity');

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
function fetchImplFor(statusByRepository, manifestRepositories = null) {
  return async (url) => {
    if (url.includes(`/contents/${PROJECT_REPOSITORY_MANIFEST}`)) {
      if (!manifestRepositories) return { ok:false, status:404 };
      const entries = manifestRepositories.map((name, index) => ({ id:index + 100, name }));
      return { ok:true, status:200, json:async () => ({ encoding:'base64', sha:'manifest-sha', content:Buffer.from(JSON.stringify({ schemaVersion:2, branches:{ main:[entries[0]], 'Development-branch':entries.slice(1) } })).toString('base64') }) };
    }
    const identityMatch = url.match(/\/repositories\/(\d+)$/);
    if (identityMatch) { const index = Number(identityMatch[1]) - 100; return { ok:true, status:200, json:async () => ({ id:Number(identityMatch[1]), full_name:manifestRepositories[index] }) }; }
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

test('pairs main and development branches by the case-insensitive suffix after the final role separator', () => {
  assert.deepEqual(validateLinkedBranches(['main-123', 'development-123', 'Main-456', 'development-456']), {
    123:{ main:'main-123', development:'development-123' },
    456:{ main:'Main-456', development:'development-456' },
  });
  assert.throws(() => validateLinkedBranches(['main-123', 'development-456']), /matching main and development branches together/);
  assert.throws(() => validateLinkedBranches(['main-123', 'Main-123', 'development-123']), /more than one main branch/);
});

test('groups slash-style branches by the case-insensitive text after the final slash', () => {
  assert.deepEqual(groupBranchesByLink(['ABC/123', 'xyz/123', 'team/456', 'release/456', 'standalone']), {
    123:['ABC/123', 'xyz/123'],
    456:['team/456', 'release/456'],
  });
  assert.deepEqual(groupBranchesByLink(['ABC/Case', 'xyz/case']), { case:['ABC/Case', 'xyz/case'] });
});

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

test('globally checks every configured project repository plus the Crucible engine', async () => {
  const repositories = ['octocat/customer-portal', 'octocat/orders-api', 'octocat/worker'];
  const fetchImpl = fetchImplFor(Object.fromEntries([...repositories, ENGINE_REPOSITORY].map((repository) => [repository, {}])), repositories);
  const result = await auditGithubRepositorySecurity({
    project:{ mainRepository:'octocat/customer-portal' },
    githubSecurity:{ enabled:true },
  }, { GITHUB_TOKEN:'token', GITHUB_REPOSITORY:'octocat/orders-api' }, fetchImpl);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.results.map((item) => item.repository).sort(), [...repositories, ENGINE_REPOSITORY].sort());
  assert.deepEqual(result.manifestSnapshot.branchRepositories, { main:['octocat/customer-portal'], 'Development-branch':['octocat/orders-api', 'octocat/worker'] });
  assert.ok(result.results.every((item) => item.gate.operation === 'verify GitHub repository security settings'));
  assert.equal(result.results.find((item) => item.repository === 'octocat/orders-api').gate.crossRepository, false);
  assert.equal(result.results.find((item) => item.repository === 'octocat/customer-portal').gate.mainRepository, 'octocat/customer-portal');
  assert.ok(result.results.every((item) => item.gate.manifestSha === 'manifest-sha'));
});

test('reports an unlisted caller and a repository renamed since configuration', async () => {
  const originalRepoResponse = repoResponse;
  const result = await auditGithubRepositorySecurity({
    project:{ mainRepository:'octocat/customer-portal' },
    githubSecurity:{ enabled:true },
  }, { GITHUB_TOKEN:'token', GITHUB_REPOSITORY:'octocat/unlisted' }, async (url, init) => {
    if (url.includes(`/contents/${PROJECT_REPOSITORY_MANIFEST}`)) return { ok:true, status:200, json:async () => ({ encoding:'base64', sha:'snapshot-sha', content:Buffer.from(JSON.stringify({ schemaVersion:2, branches:{ main:[{ id:100, name:'octocat/customer-portal' }], 'Development-branch':[{ id:101, name:'octocat/old-api' }] } })).toString('base64') }) };
    if (url.endsWith('/repositories/100')) return { ok:true, status:200, json:async () => ({ id:100, full_name:'octocat/customer-portal' }) };
    if (url.endsWith('/repositories/101')) return { ok:true, status:200, json:async () => ({ id:101, full_name:'octocat/current-api' }) };
    if (url.endsWith('/vulnerability-alerts')) return { ok:true, status:204 };
    if (url.includes('/repos/octocat/old-api')) {
      const response = originalRepoResponse();
      response.json = async () => ({ ...(await originalRepoResponse().json()), full_name:'octocat/current-api' });
      return response;
    }
    return originalRepoResponse();
  });
  assert.ok(result.findings.some((finding) => /calling repository is missing/.test(finding.type)));
  const renamed = result.findings.find((finding) => /project manifest repository name is stale/.test(finding.type));
  assert.equal(renamed.repository, 'octocat/current-api');
  assert.match(renamed.remediation, new RegExp(PROJECT_REPOSITORY_MANIFEST.replace(/\./g, '\\.')));
});

test('fails closed when the Main repository manifest cannot be pulled or is invalid', async () => {
  const missing = await auditGithubRepositorySecurity({ project:{ mainRepository:'octocat/customer-portal' }, githubSecurity:{ enabled:true } }, { GITHUB_TOKEN:'token', GITHUB_REPOSITORY:'octocat/customer-portal' }, fetchImplFor({ [ENGINE_REPOSITORY]:{} }));
  assert.ok(missing.findings.some((finding) => /unable to pull the current project repository list/.test(finding.type)));
  assert.deepEqual(missing.results.map((item) => item.repository), [ENGINE_REPOSITORY]);

  await assert.rejects(() => fetchProjectRepositories('https://api.github.com', 'octocat/customer-portal', 'token', async () => ({ ok:true, status:200, json:async () => ({ encoding:'base64', content:Buffer.from('{').toString('base64') }) })), /invalid JSON/);
});

test('repository API access is read-only and retries bounded transient failures', async () => {
  let calls = 0;
  const methods = [];
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN:'secret-token', GITHUB_REPOSITORY:ENGINE_REPOSITORY }, async (url, init) => {
    methods.push(init.method);
    calls += 1;
    if (calls < 3) return { ok:false, status:503 };
    if (url.endsWith('/vulnerability-alerts')) return { ok:true, status:204 };
    return repoResponse();
  });
  assert.equal(result.findings.length, 0);
  assert.ok(calls >= 4);
  assert.ok(methods.every((method) => method === 'GET'));
  assert.doesNotMatch(formatReport(result), /secret-token/);
});

test('repository API retries bounded network or timeout errors without exposing the token', async () => {
  let calls = 0;
  const result = await auditGithubRepositorySecurity(config(), { GITHUB_TOKEN:'never-print-this', GITHUB_REPOSITORY:ENGINE_REPOSITORY }, async (url) => {
    calls += 1;
    if (calls < 3) throw new Error('temporary timeout');
    if (url.endsWith('/vulnerability-alerts')) return { ok:true, status:204 };
    return repoResponse();
  });
  assert.equal(result.findings.length, 0);
  assert.ok(calls >= 4);
  assert.doesNotMatch(JSON.stringify(result), /never-print-this/);
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
  const report = formatReport({ results: [{ repository: 'octocat/example', gate:{ sourceRepository:'octocat/example', targetRepository:'octocat/example', operation:'verify GitHub repository security settings', mainRepository:'octocat/example' } }, { repository: ENGINE_REPOSITORY }], findings: [] });
  assert.match(report, /2 repositories checked, 0 issue\(s\)/);
  assert.match(report, /Repository gate: octocat\/example -> octocat\/example/);
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
