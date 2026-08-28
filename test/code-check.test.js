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
  assert.equal(parseCandidate('src/cli.js', '#!/usr/bin/env node\nconst answer = 42;'), null);
  assert.equal(parseCandidate('README.md', 'not code'), null);
  assert.ok(parseCandidate('bad.json', '{'));
  assert.equal(parseCandidate('bad.json', '{').action, 'human code review required');
  assert.equal(parseCandidate('bad.json', '{').errorCode, 'CRUCIBLE_PARSE_JSON_SYNTAX');
});

test('pre-check is appended to the latest GitHub report with its action labels', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-report-'));
  const target = path.join(directory, 'summary.md');
  assert.equal(publishReport('[The Crucible] Pre-check report\n- [safe auto-fix] CRUCIBLE_COMMIT_TRAILING_WHITESPACE: Commit Gate: a.js', { GITHUB_STEP_SUMMARY:target }), true);
  const report = fs.readFileSync(target, 'utf8');
  assert.match(report, /The Crucible latest report/);
  assert.match(report, /\[safe auto-fix\]/);
  assert.match(report, /CRUCIBLE_COMMIT_TRAILING_WHITESPACE/);
});

test('configured checks select only matching changed files and expand file arguments', () => {
  const selected = selectChanged(['src/a.js', 'docs/a.md', 'test/a.test.js'], ['src/**', 'test/*.test.js']);
  assert.deepEqual(selected, ['src/a.js', 'test/a.test.js']);
  assert.deepEqual(expandArgs(['lint', '--', '{files}'], selected), ['lint', '--', 'src/a.js', 'test/a.test.js']);
});

test('commit findings use the requested action classes in the unified report', () => {
  assert.equal(classifyCommit({ type:'trailing-whitespace', fixable:true }).action, 'safe auto-fix');
  assert.equal(classifyCommit({ type:'trailing-whitespace', fixable:true }).errorCode, 'CRUCIBLE_COMMIT_TRAILING_WHITESPACE');
  assert.equal(classifyCommit({ type:'merge-conflict-marker', fixable:false }).action, 'security concern');
  const report = formatReport({ paths:['a.js'], findings:[{ action:'test failure', errorCode:'CRUCIBLE_TEST_FAILURE_EXIT_1', check:'Affected tests', paths:['a.js'] }] });
  assert.match(report, /\[test failure\] CRUCIBLE_TEST_FAILURE_EXIT_1: Affected tests: a\.js/);
});

test('Code standing category produces executable V8 coverage for each core Code feature module', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..');
  const coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-code-coverage-'));
  const env = { ...process.env, NODE_V8_COVERAGE: coverageDir };
  const driver = spawnSync(process.execPath, ['-e', "require('./src/code-check').parseCandidate('sample.js', 'const answer = 42;')"], { cwd:root, env, encoding:'utf8', shell:false });
  assert.equal(driver.status, 0, driver.stderr || driver.stdout);
  const suite = spawnSync(process.execPath, ['--test', 'test/engine.test.js', 'test/hostedMultiRepositoryIntegration.test.js', 'test/repositoryOperation.test.js', 'test/suiteSelection.test.js'], { cwd:root, env, encoding:'utf8', shell:false });
  assert.equal(suite.status, 0, suite.stderr || suite.stdout);
  const coverageFiles = fs.readdirSync(coverageDir).filter((name) => name.endsWith('.json'));
  assert.ok(coverageFiles.length > 0, 'V8 did not emit executable coverage data');
  const scripts = coverageFiles.flatMap((name) => JSON.parse(fs.readFileSync(path.join(coverageDir, name), 'utf8')).result || []);
  const requiredModules = ['src/code-check.js', 'src/engine.js', 'src/hostedMultiRepositoryIntegration.js', 'src/repositoryOperation.js', 'src/suiteSelection.js'];
  for (const modulePath of requiredModules) {
    const normalizedSuffix = `/${modulePath}`;
    const covered = scripts.find((script) => String(script.url || '').replace(/\\/g, '/').endsWith(normalizedSuffix));
    assert.ok(covered, `${modulePath} produced no V8 coverage record`);
    assert.ok((covered.functions || []).some((fn) => (fn.ranges || []).some((range) => range.count > 0)), `${modulePath} was loaded but no executable function range ran`);
  }
});

test('CLI runs end to end without a shell and rejects an unknown command', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..');
  const validate = spawnSync(process.execPath, ['src/cli.js', 'validate'], { cwd:root, encoding:'utf8', shell:false });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  const invalid = spawnSync(process.execPath, ['src/cli.js', 'definitely-not-a-command'], { cwd:root, encoding:'utf8', shell:false });
  assert.notEqual(invalid.status, 0);
  assert.match(`${invalid.stderr || ''}${invalid.stdout || ''}`, /unknown|command|usage/i);
});

test('dependency policy accepts an ordinary staged registry dependency without false positives', () => {
  const { execFileSync } = require('node:child_process');
  const { auditDependencyPolicy } = require('../src/dependencies');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-dependency-code-'));
  execFileSync('git', ['init'], { cwd:root, stdio:'ignore', windowsHide:true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies:{ example:'^1.2.3' } }), 'utf8');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages:{ 'node_modules/example':{ resolved:'https://registry.npmjs.org/example/-/example-1.2.3.tgz', license:'MIT' } } }), 'utf8');
  execFileSync('git', ['add', 'package.json', 'package-lock.json'], { cwd:root, stdio:'ignore', windowsHide:true });
  const result = auditDependencyPolicy(root, { security:{ dependencyPolicy:{ enabled:true, denyGit:true, denyHttp:true, denyLocal:true, allowedRegistryHosts:['registry.npmjs.org'], denyLicenses:['GPL-3.0'] } } });
  assert.equal(result.skipped, false);
  assert.equal(result.packages, 1);
  assert.deepEqual(result.findings, []);
});
