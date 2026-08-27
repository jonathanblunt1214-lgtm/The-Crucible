const test = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_BRANCHES, REQUIRED_FILES, REQUIRED_RULESETS, auditGlobalRepositoryGovernance } = require('../src/globalRepositoryGovernance');

test('globally verifies required branches, governance files, CODEOWNERS, and active rulesets at one manifest snapshot', async () => {
  const calls = [];
  const result = await auditGlobalRepositoryGovernance({ repositories:['octocat/main-app', 'octocat/api'], branchRepositories:{ main:['octocat/main-app'], 'Development-branch':['octocat/api'] }, mainRepository:'octocat/main-app', manifestSha:'fixed-sha' }, { GITHUB_TOKEN:'token' }, async (url, init) => {
    calls.push({ url, method:init.method });
    if (url.endsWith('/contents/.github/CODEOWNERS')) return { ok:true, status:200, json:async () => ({ encoding:'base64', content:Buffer.from('.thecrucible-repositories.json @octocat').toString('base64') }) };
    if (url.includes('/rulesets?')) return { ok:true, status:200, json:async () => REQUIRED_RULESETS.map((name) => ({ name, enforcement:'active' })) };
    if (url.endsWith('/contents/.thecrucible-global.json')) return { ok:true, status:200, json:async () => ({ encoding:'base64', sha:'policy-sha', content:Buffer.from(JSON.stringify({ schemaVersion:1, preferences:[], rules:[], settings:[] })).toString('base64') }) };
    return { ok:true, status:200, json:async () => ({}) };
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.manifestSha, 'fixed-sha');
  assert.equal(calls.length, 2 * (1 + REQUIRED_FILES.length + 2) + 1);
  assert.ok(calls.some((call) => call.url.includes('/repos/octocat/main-app/branches/main')));
  assert.ok(calls.some((call) => call.url.includes('/repos/octocat/api/branches/Development-branch')));
  assert.ok(!calls.some((call) => call.url.includes('/repos/octocat/main-app/branches/Development-branch')));
  assert.equal(result.globalPolicySha, 'policy-sha');
  assert.ok(calls.every((call) => call.method === 'GET'));
});

test('fails closed for missing branches, files, review protection, and rulesets', async () => {
  const result = await auditGlobalRepositoryGovernance({ repositories:['octocat/main-app'], branchRepositories:{ main:['octocat/main-app'], 'Development-branch':['octocat/main-app'] }, mainRepository:'octocat/main-app', manifestSha:'fixed-sha' }, { GITHUB_TOKEN:'token' }, async (url) => {
    if (url.includes('/rulesets?')) return { ok:true, status:200, json:async () => [] };
    return { ok:false, status:404, json:async () => ({}) };
  });
  assert.ok(result.findings.some((finding) => /required branch/.test(finding.type)));
  assert.ok(result.findings.some((finding) => /governance file/.test(finding.type)));
  assert.ok(result.findings.some((finding) => /CODEOWNERS/.test(finding.type)));
  assert.ok(result.findings.some((finding) => /ruleset/.test(finding.type)));
});
