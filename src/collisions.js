const fs = require('node:fs');
const { assertWellFormedApiUrl, assertSafeRepository } = require('./apiGuard');

async function githubJson(url, token, fetchImpl) {
  assertWellFormedApiUrl(url);
  const response = await fetchImpl(url, { headers:{ Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28' } });
  if (!response.ok) throw new Error(`GitHub collision query failed with HTTP ${response.status}.`);
  return response.json();
}

async function pullFiles(apiBase, repository, number, token, fetchImpl) {
  const files = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubJson(`${apiBase}/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`, token, fetchImpl);
    files.push(...batch.map((item) => item.filename));
    if (batch.length < 100) break;
  }
  return files;
}

async function auditCollisions(environment = process.env, fetchImpl = globalThis.fetch) {
  const repository = environment.GITHUB_REPOSITORY;
  const token = environment.GITHUB_TOKEN;
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!repository || !token || !eventPath || !fs.existsSync(eventPath)) return { skipped:true, findings:[] };
  assertSafeRepository(repository);
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const current = event.pull_request?.number;
  if (!current) return { skipped:true, findings:[] };
  const apiBase = environment.GITHUB_API_URL || 'https://api.github.com';
  const currentFiles = new Set(await pullFiles(apiBase, repository, current, token, fetchImpl));
  const open = await githubJson(`${apiBase}/repos/${repository}/pulls?state=open&per_page=100`, token, fetchImpl);
  const findings = [];
  for (const pull of open) {
    if (pull.number === current) continue;
    const overlap = (await pullFiles(apiBase, repository, pull.number, token, fetchImpl)).filter((file) => currentFiles.has(file));
    if (overlap.length) findings.push({ number:pull.number, title:pull.title, paths:overlap.sort() });
  }
  return { skipped:false, findings };
}

module.exports = { auditCollisions, pullFiles };
