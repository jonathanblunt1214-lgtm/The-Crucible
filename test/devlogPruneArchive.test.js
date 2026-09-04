const test = require('node:test');
const assert = require('node:assert/strict');
const { collectPruneSnapshots, plainLanguageSummary } = require('../src/devlogPruneArchive');

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
