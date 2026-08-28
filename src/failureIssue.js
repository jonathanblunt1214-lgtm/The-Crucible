const fs = require('node:fs');
const { assertWellFormedApiUrl, assertSafeRepository } = require('./apiGuard');

const ISSUE_TITLE = '[The Crucible] Gate failure';
const ISSUE_MARKER = '<!-- the-crucible-gate-failure -->';

function readReport(reportPath) {
  if (!reportPath) return null;
  try { return JSON.parse(fs.readFileSync(reportPath, 'utf8')); }
  catch { return null; }
}

function safeRunValue(value, fallback) {
  return /^\d+$/.test(String(value || '')) ? String(value) : fallback;
}

function failureSummary(report) {
  const failures = Array.isArray(report?.results) ? report.results.filter((result) => result.status === 'failed').slice(-5) : [];
  if (!failures.length) return '- The workflow failed before a gate-specific report was available. Open the linked run for the failing step.';
  return failures.map((result) => {
    const action = String(result.action || 'unknown').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80) || 'unknown';
    const error = String(result.error || 'No bounded error summary was recorded.').replace(/[\r\n]+/g, ' ').slice(0, 500);
    const fix = String(result.suggestedFix || 'Review the failed action and rerun Crucible.').replace(/[\r\n]+/g, ' ').slice(0, 700);
    return `- **${action}**: ${error}\n  - **Suggested repair:** ${fix}`;
  }).join('\n');
}

function buildFailureNotice(report, environment = process.env) {
  const repository = assertSafeRepository(environment.GITHUB_REPOSITORY);
  const runId = safeRunValue(environment.GITHUB_RUN_ID, 'unknown');
  const attempt = safeRunValue(environment.GITHUB_RUN_ATTEMPT, 'unknown');
  const sha = /^[0-9a-f]{7,40}$/i.test(environment.GITHUB_SHA || '') ? environment.GITHUB_SHA : 'unknown';
  const server = environment.GITHUB_SERVER_URL || 'https://github.com';
  assertWellFormedApiUrl(server);
  const runUrl = runId === 'unknown' ? `${server}/${repository}/actions` : `${server}/${repository}/actions/runs/${runId}`;
  return `${ISSUE_MARKER}\nThe linked Crucible gate failed in **${repository}**.\n\n- Run: ${runUrl}\n- Attempt: ${attempt}\n- Commit: \`${sha}\`\n- Report artifact: \`the-crucible-report-${runId}-${attempt}\`\n\n### Reported failure\n\n${failureSummary(report)}\n\nThis issue is the single current Crucible failure report for the repository. Later failed runs update this report in place until the underlying failure is resolved.`;
}

async function githubRequest(apiBase, path, token, options, fetchImpl) {
  const url = `${apiBase}${path}`;
  assertWellFormedApiUrl(url);
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub issue API returned HTTP ${response.status}.`);
  return response;
}

async function publishFailureIssue(environment = process.env, fetchImpl = globalThis.fetch) {
  const repository = assertSafeRepository(environment.GITHUB_REPOSITORY);
  const token = environment.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required to create or update the Crucible failure issue.');
  const apiBase = environment.GITHUB_API_URL || 'https://api.github.com';
  const report = readReport(environment.CRUCIBLE_REPORT_PATH);
  const notice = buildFailureNotice(report, environment);
  const openResponse = await githubRequest(apiBase, `/repos/${repository}/issues?state=open&per_page=100`, token, { method:'GET' }, fetchImpl);
  const issues = await openResponse.json();
  const existing = issues.find((issue) => !issue.pull_request && (issue.title === ISSUE_TITLE || String(issue.body || '').includes(ISSUE_MARKER)));
  if (existing) {
    await githubRequest(apiBase, `/repos/${repository}/issues/${existing.number}`, token, { method:'PATCH', body:JSON.stringify({ body:notice }) }, fetchImpl);
    return { action:'updated', number:existing.number };
  }
  const createdResponse = await githubRequest(apiBase, `/repos/${repository}/issues`, token, { method:'POST', body:JSON.stringify({ title:ISSUE_TITLE, body:notice }) }, fetchImpl);
  const created = await createdResponse.json();
  return { action:'created', number:created.number };
}

module.exports = { ISSUE_TITLE, ISSUE_MARKER, buildFailureNotice, failureSummary, publishFailureIssue };
