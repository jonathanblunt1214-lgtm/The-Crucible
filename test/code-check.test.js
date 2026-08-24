const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTION_CLASSES, expandArgs, parseCandidate, selectChanged } = require('../src/code-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyCommit, formatReport, publishReport } = require('../src/precheck');

test('pre-check exposes exactly the four report action classes', () => {
  assert.deepEqual(ACTION_CLASSES, ['safe auto-fix', 'test failure', 'security concern', 'human code review required']);
});

test('language-aware parser checks changed JSON and JavaScript without executing them', () => {
  assert.equal(parseCandidate('package.json', '{"ok":true}'), null);
  assert.equal(parseCandidate('src/good.js', 'const answer = 42;'), null);
  assert.equal(parseCandidate('README.md', 'not code'), null);
  assert.ok(parseCandidate('bad.json', '{'));
  assert.equal(parseCandidate('bad.json', '{').action, 'human code review required');
});

test('pre-check is appended to the latest GitHub report with its action labels', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-report-'));
  const target = path.join(directory, 'summary.md');
  assert.equal(publishReport('[The Crucible] Pre-check report\n- [safe auto-fix] Commit Gate: a.js', { GITHUB_STEP_SUMMARY:target }), true);
  const report = fs.readFileSync(target, 'utf8');
  assert.match(report, /The Crucible latest report/);
  assert.match(report, /\[safe auto-fix\]/);
});

test('configured checks select only matching changed files and expand file arguments', () => {
  const selected = selectChanged(['src/a.js', 'docs/a.md', 'test/a.test.js'], ['src/**', 'test/*.test.js']);
  assert.deepEqual(selected, ['src/a.js', 'test/a.test.js']);
  assert.deepEqual(expandArgs(['lint', '--', '{files}'], selected), ['lint', '--', 'src/a.js', 'test/a.test.js']);
});

test('commit findings use the requested action classes in the unified report', () => {
  assert.equal(classifyCommit({ type:'trailing-whitespace', fixable:true }).action, 'safe auto-fix');
  assert.equal(classifyCommit({ type:'merge-conflict-marker', fixable:false }).action, 'security concern');
  const report = formatReport({ paths:['a.js'], findings:[{ action:'test failure', check:'Affected tests', paths:['a.js'] }] });
  assert.match(report, /\[test failure\] Affected tests: a\.js/);
});
