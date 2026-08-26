const test = require('node:test');
const assert = require('node:assert/strict');
const { extractStepNames, generatedBlock, auditDocSync, syncReadme, MARKER_START, MARKER_END } = require('../src/docSync');

test('extractStepNames skips mechanical checkout steps and keeps everything else in order', () => {
  const workflow = [
    'jobs:',
    '  verify:',
    '    steps:',
    '      - name: Check out the caller repository',
    '        uses: actions/checkout@abc',
    '      - name: Check out the pinned Crucible engine',
    '        uses: actions/checkout@abc',
    '      - uses: actions/setup-node@abc',
    "      - name: Validate .thecrucible.json",
    '        run: node cli.js validate',
  ].join('\n');
  assert.deepEqual(extractStepNames(workflow), ['Validate .thecrucible.json']);
});

test('the real workflow file matches the currently committed README block', () => {
  const result = auditDocSync('.');
  assert.deepEqual(result, { inSync: true, findings: [] });
});

test('reports out of sync when the marker block is stale, and syncReadme fixes it', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-docsync-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), [
    'jobs:',
    '  verify:',
    '    steps:',
    '      - name: Check out the caller repository',
    '      - name: One',
    '      - name: Two',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'README.md'), [
    '# Project',
    '',
    MARKER_START,
    '1. Stale step.',
    MARKER_END,
    '',
  ].join('\n'));
  const before = auditDocSync(root);
  assert.equal(before.inSync, false);
  assert.match(before.findings[0].type, /out of date/);
  const result = syncReadme(root);
  assert.equal(result.changed, true);
  const after = auditDocSync(root);
  assert.deepEqual(after, { inSync: true, findings: [] });
  assert.equal(generatedBlock(root), [MARKER_START, '1. One.', '2. Two.', MARKER_END].join('\n'));
});

test('CRLF line endings (as Windows checkouts produce) are not treated as drift', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-docsync-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), [
    'jobs:',
    '  verify:',
    '    steps:',
    '      - name: One',
    '      - name: Two',
    '',
  ].join('\r\n'));
  const crlfBlock = [MARKER_START, '1. One.', '2. Two.', MARKER_END].join('\r\n');
  fs.writeFileSync(path.join(root, 'README.md'), ['# Project', '', crlfBlock, ''].join('\r\n'));
  assert.deepEqual(auditDocSync(root), { inSync: true, findings: [] });
  assert.deepEqual(syncReadme(root), { changed: false });
});

test('syncReadme refuses to guess where the list belongs when markers are missing', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-docsync-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'the-crucible.yml'), '');
  fs.writeFileSync(path.join(root, 'README.md'), '# Project\n');
  assert.throws(() => syncReadme(root), /missing the generated workflow-steps markers/);
  assert.deepEqual(auditDocSync(root).inSync, false);
});
