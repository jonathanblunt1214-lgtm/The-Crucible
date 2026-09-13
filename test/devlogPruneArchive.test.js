const test = require('node:test');
const assert = require('node:assert/strict');
const { collectPruneSnapshots, plainLanguageSummary, synchronizeDevlogPrunes } = require('../src/devlogPruneArchive');

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const OLD = `# Development log

## Shared AI handoff

See the dev plan in AI-HANDOFF.json.

## Command log archive

### Session: newest — 2026-09-04T12:00:00Z — Codex — mode:regular/default

Plain-language summary: Kept current work.

- command started and finished.

### Session: oldest — 2026-08-01T12:00:00Z — Codex — mode:regular/default

Plain-language summary: Preserve this before pruning.

- command started and finished.
`;
const NEW = OLD.replace(/\n### Session: oldest[\s\S]*$/, '\n');

test('plainLanguageSummary reads the newest bounded command entry', () => {
  assert.equal(plainLanguageSummary(NEW), 'Kept current work.');
});

test('collectPruneSnapshots records the complete pre-prune DEVLOG at the responsible commit', () => {
  const responses = new Map([
    [`rev-list --reverse --ancestry-path ${BASE}..${HEAD}`, `${HEAD}\n`],
    [`rev-parse ${HEAD}^`, `${BASE}\n`],
    [`show ${BASE}:DEVLOG.md`, OLD],
    [`show ${HEAD}:DEVLOG.md`, NEW],
    [`show -s --format=%cI ${HEAD}`, '2026-09-04T12:30:00Z\n'],
  ]);
  const runGit = (args) => {
    const key = args.join(' ');
    assert.ok(responses.has(key), `unexpected git command: ${key}`);
    return { status: 0, stdout: responses.get(key), stderr: '' };
  };
  const snapshots = collectPruneSnapshots(BASE, HEAD, runGit);
  assert.equal(snapshots.length, 1);
  assert.match(snapshots[0].heading, /2026-09-04T12:30:00\.000Z — pruned by commit bbbbbbb/);
  assert.match(snapshots[0].text, /Plain-language summary: Kept current work\./);
  assert.ok(snapshots[0].text.includes(OLD), 'the full pre-prune DEVLOG must be retained verbatim');
});

test('collectPruneSnapshots is a no-op for an unchanged exact tip', () => {
  assert.deepEqual(collectPruneSnapshots(BASE, BASE, () => assert.fail('git must not run')), []);
});

test('collectPruneSnapshots refuses an untrusted range with a diagnosable code', () => {
  assert.throws(
    () => collectPruneSnapshots('development', HEAD, () => assert.fail('git must not run')),
    (error) => error.crucibleCode === 'CRU-0038' && /exact 40-character/.test(error.message),
  );
});

// The ledger this archiver protects grows without bound by design, and on 2026-09-10 it
// crossed the 1 MiB stdout default. `git show` failed for want of buffer, the failure was
// swallowed, an unreadable ledger was treated as an empty one, and the commit that
// followed deleted 14 of 15 snapshots while reporting success. These two tests pin the
// distinction that prevents it: absent is empty, unreadable is a refusal.
function pruneRangeResponses() {
  return new Map([
    [`rev-list --reverse --ancestry-path ${BASE}..${HEAD}`, `${HEAD}\n`],
    [`rev-parse ${HEAD}^`, `${BASE}\n`],
    [`show ${BASE}:DEVLOG.md`, OLD],
    [`show ${HEAD}:DEVLOG.md`, NEW],
    [`show -s --format=%cI ${HEAD}`, '2026-09-04T12:30:00Z\n'],
    ['fetch --no-tags origin Archive', ''],
    ['rev-parse origin/Archive', `${'c'.repeat(40)}\n`],
  ]);
}

test('an unreadable Devlog-Pruned is refused, never rewritten as if it were empty', () => {
  const responses = pruneRangeResponses();
  const attempted = [];
  const runGit = (args, options = {}) => {
    const key = args.join(' ');
    attempted.push(key);
    if (key === `show ${'c'.repeat(40)}:Devlog-Pruned`) {
      // What an over-limit read looks like: non-zero status, no usable stdout.
      return { status: null, stdout: '', stderr: '', error: new Error('spawnSync git ENOBUFS') };
    }
    if (responses.has(key)) return { status: 0, stdout: responses.get(key), stderr: '' };
    assert.fail(`unexpected git command after an unreadable ledger: ${key}`);
  };
  assert.throws(
    () => synchronizeDevlogPrunes({ baseSha: BASE, headSha: HEAD, runGit, maxAttempts: 1 }),
    (error) => error.crucibleCode === 'CRU-0038' && /never an empty ledger/.test(error.message),
  );
  // The decisive assertion: nothing was written or pushed.
  assert.ok(!attempted.some((key) => key.startsWith('hash-object')), 'no blob may be written');
  assert.ok(!attempted.some((key) => key.startsWith('push')), 'no push may be attempted');
});

test('a Devlog-Pruned that genuinely does not exist yet is treated as empty', () => {
  const responses = pruneRangeResponses();
  const archiveHead = 'c'.repeat(40);
  let written = '';
  const runGit = (args, options = {}) => {
    const key = args.join(' ');
    if (key === `show ${archiveHead}:Devlog-Pruned`) {
      return { status: 128, stdout: '', stderr: `fatal: path 'Devlog-Pruned' does not exist in '${archiveHead}'` };
    }
    if (key === 'hash-object -w --stdin') { written = options.input; return { status: 0, stdout: 'blob1\n', stderr: '' }; }
    if (key.startsWith('read-tree') || key.startsWith('update-index')) return { status: 0, stdout: '', stderr: '' };
    if (key === 'write-tree') return { status: 0, stdout: 'tree1\n', stderr: '' };
    if (key.startsWith('commit-tree')) return { status: 0, stdout: 'commit1\n', stderr: '' };
    if (key.startsWith('diff-tree')) return { status: 0, stdout: 'Devlog-Pruned\n', stderr: '' };
    if (key.startsWith('push')) return { status: 0, stdout: '', stderr: '' };
    if (responses.has(key)) return { status: 0, stdout: responses.get(key), stderr: '' };
    assert.fail(`unexpected git command: ${key}`);
  };
  const result = synchronizeDevlogPrunes({ baseSha: BASE, headSha: HEAD, runGit, maxAttempts: 1 });
  assert.equal(result.updated, true);
  assert.match(written, /## Snapshot:/);
  assert.ok(written.includes(OLD), 'the first snapshot must still carry the full pre-prune DEVLOG');
});
