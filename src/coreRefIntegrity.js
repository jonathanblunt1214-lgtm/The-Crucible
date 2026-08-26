const fs = require('node:fs');
const { ENGINE_REPOSITORY } = require('./githubRepoSecurity');
const { assertWellFormedApiUrl, assertSafeCommitSha } = require('./apiGuard');

// A pinned commit's own content cannot be silently altered - git content-
// addressing already guarantees that; the SHA itself is the checksum. What
// isn't guaranteed is that the SHA a caller's core_ref names is a genuine,
// reviewed release rather than a re-pin to an abandoned, reverted, or
// never-merged commit (a rollback/downgrade, not a hash collision). This
// gate checks the pin's provenance, not the content underneath it.

async function githubRequest(apiBase, path, token, fetchImpl) {
  const url = `${apiBase}${path}`;
  assertWellFormedApiUrl(url);
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchImpl(url, { headers });
}

async function auditCoreRefIntegrity(coreRef, environment = process.env, fetchImpl = globalThis.fetch) {
  if (!coreRef) return { skipped: true, findings: [] };
  try {
    assertSafeCommitSha(coreRef);
  } catch (error) {
    return { skipped: false, findings: [{ type: 'core_ref is not a plain commit SHA', detail: error.message, remediation: 'Set core_ref to an exact, full commit SHA from The Crucible - not a branch name, tag, or anything else.' }] };
  }
  const apiBase = environment.GITHUB_API_URL || 'https://api.github.com';
  const token = environment.GITHUB_TOKEN;
  const findings = [];

  const commitResponse = await githubRequest(apiBase, `/repos/${ENGINE_REPOSITORY}/commits/${coreRef}`, token, fetchImpl);
  if (commitResponse.status === 404) {
    findings.push({ type: 'the pinned commit does not exist in The Crucible engine repository', detail: null, remediation: `Confirm core_ref (${coreRef}) is an exact, correctly-typed commit SHA from ${ENGINE_REPOSITORY}.` });
    return { skipped: false, findings };
  }
  if (!commitResponse.ok) {
    findings.push({ type: 'unable to verify the pinned commit exists', detail: `HTTP ${commitResponse.status}`, remediation: 'Re-run once the GitHub API is reachable - this status does not confirm the commit is missing, only that it could not be checked (for example, a rate limit or a transient outage).' });
    return { skipped: false, findings };
  }

  const compareResponse = await githubRequest(apiBase, `/repos/${ENGINE_REPOSITORY}/compare/${coreRef}...main`, token, fetchImpl);
  if (!compareResponse.ok) {
    findings.push({ type: 'unable to verify the pinned commit is reachable from main', detail: `HTTP ${compareResponse.status}`, remediation: 'Re-run once the GitHub API is reachable; if this persists, check githubstatus.com before assuming it is a configuration problem.' });
  } else {
    const compare = await compareResponse.json();
    if (!['identical', 'ahead'].includes(compare.status)) {
      findings.push({ type: `the pinned commit is not reachable from The Crucible's main branch (compare status: ${compare.status})`, detail: 'It may have been abandoned, reverted, or never merged - a rollback to an unreviewed commit looks exactly like this.', remediation: `Re-pin core_ref to a commit that is actually on ${ENGINE_REPOSITORY}'s main branch.` });
    }
  }

  const checksResponse = await githubRequest(apiBase, `/repos/${ENGINE_REPOSITORY}/commits/${coreRef}/check-runs`, token, fetchImpl);
  if (!checksResponse.ok) {
    findings.push({ type: "unable to verify the pinned commit's Self-Test result", detail: `HTTP ${checksResponse.status}`, remediation: 'Re-run once the GitHub API is reachable.' });
  } else {
    const checks = await checksResponse.json();
    const runs = (checks.check_runs || []).filter((run) => run.name.startsWith('The Crucible'));
    const failing = runs.filter((run) => run.conclusion !== 'success');
    if (!runs.length) {
      findings.push({ type: 'no Self-Test run is recorded for the pinned commit', detail: null, remediation: `Pin only a commit whose Self-Test matrix has actually run and passed on ${ENGINE_REPOSITORY}.` });
    } else if (failing.length) {
      findings.push({ type: "the pinned commit's Self-Test did not pass", detail: failing.map((run) => `${run.name}: ${run.conclusion}`).join(', '), remediation: 'Re-pin core_ref to a commit whose full Self-Test matrix passed.' });
    }
  }

  return { skipped: false, findings };
}

function formatReport(coreRef, result) {
  const lines = [`[The Crucible] Pinned commit integrity report for ${coreRef}: ${result.findings.length} issue(s).`];
  for (const finding of result.findings) {
    lines.push(`- ${finding.type}${finding.detail ? ` (${finding.detail})` : ''}`);
    lines.push(`  Fix: ${finding.remediation}`);
  }
  if (!result.findings.length) lines.push('- Reachable from main with a passing Self-Test. No action required.');
  return lines.join('\n');
}

function publishReport(report, environment = process.env) {
  if (!environment.GITHUB_STEP_SUMMARY) return false;
  fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, `## The Crucible pinned commit integrity\n\n\`\`\`text\n${report}\n\`\`\`\n\n`, 'utf8');
  return true;
}

module.exports = { auditCoreRefIntegrity, formatReport, publishReport };
