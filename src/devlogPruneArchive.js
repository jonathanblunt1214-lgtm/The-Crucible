const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { devlogPruneSnapshot, appendToDevlogPrunedLedger } = require('./handoffPolicy');
const { crucibleError } = require('./failureCodes');

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ZERO_SHA = /^0{40}$/;

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    input: options.input,
    env: options.env || process.env,
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || 'git command failed').trim();
    throw crucibleError('CRU-0038', `git ${args.join(' ')}: ${detail}`);
  }
  return result;
}

function plainLanguageSummary(devlog) {
  const archive = String(devlog || '').split(/^## Command log archive\s*$/m)[1] || '';
  const newest = archive.split(/^### Session: /m)[1] || '';
  const match = /^Plain-language summary:\s*(.+)$/m.exec(newest);
  return match ? match[1].trim() : 'A development push pruned the bounded DEVLOG command archive.';
}

function collectPruneSnapshots(baseSha, headSha, runGit = git) {
  if (!SHA_PATTERN.test(baseSha) || !SHA_PATTERN.test(headSha)) {
    throw crucibleError('CRU-0038', 'DEVLOG archive synchronization requires exact 40-character base and head SHAs.');
  }
  if (ZERO_SHA.test(baseSha) || baseSha.toLowerCase() === headSha.toLowerCase()) return [];
  const commits = runGit(['rev-list', '--reverse', '--ancestry-path', `${baseSha}..${headSha}`]).stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const snapshots = [];
  for (const commit of commits) {
    const parent = runGit(['rev-parse', `${commit}^`]).stdout.trim();
    const oldDevlog = runGit(['show', `${parent}:DEVLOG.md`]).stdout;
    const newDevlog = runGit(['show', `${commit}:DEVLOG.md`]).stdout;
    const committedAt = new Date(runGit(['show', '-s', '--format=%cI', commit]).stdout.trim());
    const snapshot = devlogPruneSnapshot(oldDevlog, newDevlog, committedAt, {
      commit: commit.slice(0, 7),
      summary: plainLanguageSummary(newDevlog),
    });
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}

function archiveLedgerAt(archiveHead, runGit = git) {
  const result = runGit(['show', `${archiveHead}:Devlog-Pruned`], { allowFailure: true });
  return result.status === 0 ? result.stdout : '';
}

function createArchiveCommit(archiveHead, ledger, headSha, runGit = git) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-devlog-archive-'));
  const indexPath = path.join(temporary, 'index');
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: 'The Crucible DEVLOG archiver',
    GIT_AUTHOR_EMAIL: 'crucible-devlog-archiver',
    GIT_COMMITTER_NAME: 'The Crucible DEVLOG archiver',
    GIT_COMMITTER_EMAIL: 'crucible-devlog-archiver',
  };
  try {
    const blob = runGit(['hash-object', '-w', '--stdin'], { input: ledger, env }).stdout.trim();
    runGit(['read-tree', archiveHead], { env });
    runGit(['update-index', '--add', '--cacheinfo', `100644,${blob},Devlog-Pruned`], { env });
    const tree = runGit(['write-tree'], { env }).stdout.trim();
    const commit = runGit(['commit-tree', tree, '-p', archiveHead], {
      input: `Archive DEVLOG prune from ${headSha.slice(0, 7)}\n`,
      env,
    }).stdout.trim();
    const changed = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', commit], { env }).stdout.trim();
    if (changed !== 'Devlog-Pruned') {
      throw crucibleError('CRU-0038', `Archive synchronization refused a commit touching anything except Devlog-Pruned: ${changed || 'no changed path'}`);
    }
    return commit;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function synchronizeDevlogPrunes({ baseSha, headSha, runGit = git, maxAttempts = 3 }) {
  const snapshots = collectPruneSnapshots(baseSha, headSha, runGit);
  if (!snapshots.length) return { updated: false, snapshots: 0, message: 'No DEVLOG sessions were pruned in this development range.' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    runGit(['fetch', '--no-tags', 'origin', 'Archive']);
    const archiveHead = runGit(['rev-parse', 'origin/Archive']).stdout.trim();
    const currentLedger = archiveLedgerAt(archiveHead, runGit);
    const nextLedger = appendToDevlogPrunedLedger(currentLedger, snapshots);
    if (nextLedger === currentLedger) {
      return { updated: false, snapshots: snapshots.length, message: 'Every detected DEVLOG prune is already recorded on Archive.' };
    }
    const commit = createArchiveCommit(archiveHead, nextLedger, headSha, runGit);
    const pushed = runGit(['push', 'origin', `${commit}:refs/heads/Archive`], { allowFailure: true });
    if (pushed.status === 0) {
      return { updated: true, snapshots: snapshots.length, commit, message: `Archived ${snapshots.length} DEVLOG prune snapshot(s) in ${commit}.` };
    }
    if (attempt === maxAttempts) {
      const detail = (pushed.stderr || pushed.stdout || 'push rejected').trim();
      throw crucibleError('CRU-0038', `Unable to append Devlog-Pruned after ${maxAttempts} attempts: ${detail}`);
    }
  }
  throw crucibleError('CRU-0038', 'DEVLOG archive synchronization exhausted without a result.');
}

if (require.main === module) {
  try {
    const result = synchronizeDevlogPrunes({
      baseSha: process.env.DEVLOG_BASE_SHA || '',
      headSha: process.env.DEVLOG_HEAD_SHA || '',
    });
    console.log(`[DEVLOG archive] ${result.message}`);
  } catch (error) {
    console.error(`[DEVLOG archive] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  plainLanguageSummary,
  collectPruneSnapshots,
  synchronizeDevlogPrunes,
};
