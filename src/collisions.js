const fs = require('node:fs');

async function githubJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, { headers:{ Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28' } });
  if (!response.ok) throw new Error(`GitHub collision query failed with HTTP ${response.status}.`);
  return response.json();
}

async function pullFiles(apiBase, repository, number, token, fetchImpl) {
  const files = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubJson(`${apiBase}/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`, token, fetchImpl);
    files.push(...batch.map((item) => ({ path:item.filename, patch:item.patch || '' })));
    if (batch.length < 100) break;
  }
  return files;
}

function changedRanges(patch) {
  const ranges = [];
  for (const match of String(patch).matchAll(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g)) ranges.push([Number(match[1]), Number(match[1]) + Math.max(1, Number(match[2] || 1)) - 1]);
  return ranges;
}
function patchesOverlap(left, right) {
  const a = changedRanges(left); const b = changedRanges(right);
  if (!a.length || !b.length) return true;
  return a.some(([as, ae]) => b.some(([bs, be]) => as <= be && bs <= ae));
}

async function auditCollisions(environment = process.env, fetchImpl = globalThis.fetch) {
  const repository = environment.GITHUB_REPOSITORY;
  const token = environment.GITHUB_TOKEN;
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!repository || !token || !eventPath || !fs.existsSync(eventPath)) return { skipped:true, findings:[] };
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const current = event.pull_request?.number;
  if (!current) return { skipped:true, findings:[] };
  const apiBase = environment.GITHUB_API_URL || 'https://api.github.com';
  const currentFiles = new Map((await pullFiles(apiBase, repository, current, token, fetchImpl)).map((item) => [item.path, item]));
  const open = await githubJson(`${apiBase}/repos/${repository}/pulls?state=open&per_page=100`, token, fetchImpl);
  const findings = [];
  for (const pull of open) {
    if (pull.number === current) continue;
    if ((pull.head?.ref && pull.head.ref === event.pull_request?.base?.ref) || (pull.base?.ref && pull.base.ref === event.pull_request?.head?.ref)) continue;
    const overlap = (await pullFiles(apiBase, repository, pull.number, token, fetchImpl)).filter((file) => currentFiles.has(file.path) && patchesOverlap(currentFiles.get(file.path).patch, file.patch));
    if (overlap.length) {
      const paths = overlap.map((item) => item.path).sort();
      const executable = paths.filter((file) => !/(^|\/)(?:docs?|examples?)(\/|$)|\.(?:md|txt|rst)$/i.test(file));
      findings.push({ number:pull.number, title:pull.title, paths, severity:executable.length ? 'code' : 'documentation' });
    }
  }
  return { skipped:false, findings };
}

module.exports = { auditCollisions, pullFiles, changedRanges, patchesOverlap };
