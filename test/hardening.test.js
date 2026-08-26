const test = require('node:test');
const assert = require('node:assert/strict');
const { configurationDigest, verifyConfigurationDigest } = require('../src/integrity');
const { auditExceptions } = require('../src/exceptions');
const { languageFindings, stripComments } = require('../src/syntax');
const { changedRanges, patchesOverlap } = require('../src/collisions');
const { restrictInvocation } = require('../src/runner');
const { validateConfig } = require('../src/config');
const { auditDependencyPolicy } = require('../src/dependencies');
const { verifyReproducibility } = require('../src/reproducibility');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function repository(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-hardening-'));
  execFileSync('git', ['init'], { cwd:root, windowsHide:true });
  for (const [file, value] of Object.entries(files)) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive:true }); fs.writeFileSync(target, value); }
  execFileSync('git', ['add', '.'], { cwd:root, windowsHide:true });
  return root;
}

test('configuration digest is stable and detects protection changes', () => {
  const value = { schemaVersion:1, project:{ name:'Fixture' }, commands:{ verify:[{ name:'Test', run:'node' }] }, privacy:{ githubIdentity:'octocat' } };
  const digest = configurationDigest(value);
  verifyConfigurationDigest({ ...value, integrity:{ digest:`sha256:${digest}` } });
  assert.throws(() => verifyConfigurationDigest({ ...value, security:{ enabled:false }, integrity:{ digest:`sha256:${digest}` } }), /does not match/);
});

test('exception governance rejects expired broad unused and changed exceptions', () => {
  const snapshot = { files:['fixtures/a.txt'], entries:new Map([['fixtures/a.txt', { sha256:'a'.repeat(64) }]]) };
  const findings = auditExceptions(snapshot, { allow:[{ path:'**', reason:'test', owner:'owner', expires:'2020-01-01', sha256:'b'.repeat(64) }, 'missing/**'] }, true, new Date('2026-01-01'));
  for (const type of ['overly broad exception', 'expired exception', 'exception content hash changed', 'unused exception', 'exception metadata required']) assert.ok(findings.some((item) => item.type === type));
});

test('language-aware scan ignores comments and detects executable hazards', () => {
  assert.equal(languageFindings('// eval(input)', 'app.js').length, 0);
  assert.ok(languageFindings('eval(input)', 'app.js').some((item) => item.type === 'dynamic code execution'));
  assert.doesNotMatch(stripComments('# exec(value)', 'app.py'), /exec/);
});

test('collision analysis distinguishes non-overlapping changed lines', () => {
  assert.deepEqual(changedRanges('@@ -1,2 +10,3 @@'), [[10, 12]]);
  assert.equal(patchesOverlap('@@ -1 +10 @@', '@@ -1 +20 @@'), false);
  assert.equal(patchesOverlap('', '@@ -1 +20 @@'), true);
});

test('Linux isolation wraps commands and other platforms fail closed', () => {
  const wrapped = restrictInvocation({ executable:'node', args:['test.js'] }, { network:'deny', memoryMb:128, fileSizeMb:5, processes:4 }, 'linux');
  assert.equal(wrapped.executable, 'unshare');
  assert.match(wrapped.args.join(' '), /prlimit/);
  assert.throws(() => restrictInvocation({ executable:'node', args:[] }, { network:'deny' }, 'win32'), /fails closed/);
});

test('configuration rejects traversal and malformed Unicode-shaped command paths', () => {
  const value = { schemaVersion:1, project:{ name:'Fixture' }, privacy:{ githubIdentity:'octocat' }, commands:{ verify:[{ name:'Bad', run:'../node', args:['\u202e'] }] } };
  assert.throws(() => validateConfig(value), /executable name/);
});

test('dependency policy rejects Git URL and unapproved registry sources', () => {
  const root = repository({ 'package.json':JSON.stringify({ dependencies:{ one:'github:owner/repo' } }), 'package-lock.json':JSON.stringify({ packages:{ 'node_modules/two':{ resolved:'https://untrusted.invalid/two.tgz', license:'GPL-3.0-only' } } }) });
  const config = { security:{ dependencyPolicy:{ enabled:true, denyGit:true, denyHttp:true, denyLocal:true, allowedRegistryHosts:['registry.npmjs.org'], denyLicenses:['GPL-3.0-only'] } } };
  const result = auditDependencyPolicy(root, config);
  assert.ok(result.findings.some((item) => item.type === 'Git dependency is forbidden'));
  assert.ok(result.findings.some((item) => item.type === 'unapproved dependency registry'));
  assert.ok(result.findings.some((item) => item.type.startsWith('prohibited license')));
});

test('reproducibility gate compares independent staged-source builds', async () => {
  const root = repository({ 'source.txt':'same' });
  const config = { workload:{ timeoutMinutes:1, maxOutputBytes:65536 }, reproducibility:{ enabled:true, commands:[{ name:'Build', run:process.execPath, args:['-e', "require('fs').copyFileSync('source.txt','artifact.txt')"], cwd:'.' }], artifacts:['artifact.txt'] } };
  assert.deepEqual(await verifyReproducibility(root, config), { skipped:false, artifacts:1 });
});
