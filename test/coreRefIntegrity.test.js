const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditCoreRefIntegrity, formatReport, publishReport } = require('../src/coreRefIntegrity');

const SHA = 'a'.repeat(40);

// state: { commitMissing, commitStatus, compareStatus, checksMissing, checkRuns }
function fetchImplFor(state) {
  return async (url) => {
    if (url.endsWith(`/commits/${SHA}`)) {
      if (state.commitMissing) return { ok: false, status: 404 };
      const status = state.commitStatus ?? 200;
      return { ok: status >= 200 && status < 300, status };
    }
    if (url.includes('/compare/')) {
      if (state.compareMissing) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ status: state.compareStatus ?? 'identical' }) };
    }
    if (url.endsWith('/check-runs')) {
      if (state.checksMissing) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ check_runs: state.checkRuns ?? [{ name: 'The Crucible (ubuntu-latest, 20)', conclusion: 'success' }] }) };
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

test('skips when no core_ref is provided', async () => {
  assert.deepEqual(await auditCoreRefIntegrity(undefined, {}, async () => { throw new Error('not called'); }), { skipped: true, findings: [] });
});

test('rejects a core_ref that is not a plain commit SHA without ever calling fetch', async () => {
  const result = await auditCoreRefIntegrity('main', {}, async () => { throw new Error('fetch should not be called'); });
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].type, /not a plain commit SHA/);
});

test('passes for a commit reachable from main with a passing Self-Test', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({}));
  assert.deepEqual(result, { skipped: false, findings: [] });
});

test('fails when the commit does not exist in the engine repository', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ commitMissing: true }));
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].type, /does not exist/);
});

test('does not claim a commit is missing on a rate limit or transient error - only on a real 404', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ commitStatus: 403 }));
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].type, /unable to verify the pinned commit exists/);
  assert.doesNotMatch(result.findings[0].type, /does not exist/);
  assert.match(result.findings[0].detail, /HTTP 403/);
});

test('flags a commit that is not reachable from main (a rollback to an abandoned commit)', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ compareStatus: 'diverged' }));
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].type, /not reachable from The Crucible's main branch/);
  assert.match(result.findings[0].detail, /abandoned, reverted, or never merged/);
});

test('accepts a commit that is main itself or an ancestor of it', async () => {
  for (const status of ['identical', 'ahead']) {
    const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ compareStatus: status }));
    assert.equal(result.findings.length, 0, status);
  }
});

test('flags a commit with no recorded Self-Test run', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ checkRuns: [] }));
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].type, /no Self-Test run is recorded/);
});

test('flags a commit whose Self-Test did not pass', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ checkRuns: [{ name: 'The Crucible (windows-latest, 22)', conclusion: 'failure' }] }));
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].type, /Self-Test did not pass/);
  assert.match(result.findings[0].detail, /windows-latest, 22\): failure/);
});

test('ignores check runs unrelated to The Crucible Self-Test', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ checkRuns: [{ name: 'CodeQL', conclusion: 'failure' }] }));
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].type, /no Self-Test run is recorded/);
});

test('reports (rather than throws) when the GitHub API is unreachable', async () => {
  const result = await auditCoreRefIntegrity(SHA, {}, fetchImplFor({ compareMissing: true, checksMissing: true }));
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((item) => /unable to verify/.test(item.type)));
});

test('formatReport includes a Fix line for every finding', () => {
  const report = formatReport(SHA, { findings: [{ type: 'something is wrong', detail: 'details', remediation: 'do this' }] });
  assert.match(report, new RegExp(SHA));
  assert.match(report, /something is wrong \(details\)/);
  assert.match(report, /Fix: do this/);
});

test('publishReport appends to the job summary when present, no-ops otherwise', () => {
  const summaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-coreref-')), 'summary.md');
  fs.writeFileSync(summaryPath, '');
  assert.equal(publishReport('body', { GITHUB_STEP_SUMMARY: summaryPath }), true);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /## The Crucible pinned commit integrity[\s\S]*body/);
  assert.equal(publishReport('body', {}), false);
});
