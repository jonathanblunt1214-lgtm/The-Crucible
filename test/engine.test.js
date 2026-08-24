const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { auditClutter, glob } = require('../src/clutter');
const { resolveSpawn, runCrucible } = require('../src/runner');
const { maintain } = require('../src/maintenance');

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }).trim(); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'the-crucible-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Crucible Test']);
  git(root, ['config', 'user.email', 'crucible@example.test']);
  return root;
}
function config() {
  return { project:{ name:'Fixture' }, commands:{ prepare:[], verify:[] }, artifacts:[], clutter:{ allow:[], allowDuplicateContent:false, blockTrackedIgnored:true }, privacy:{ githubIdentity:'octocat', scanContactInformation:false }, workload:{ workers:2, cycles:2, timeoutMinutes:1 } };
}

test('clutter audit reports generated, empty, ignored, and duplicate tracked files', () => {
  const root = repository();
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'same\n');
  fs.writeFileSync(path.join(root, 'copy.js'), 'same\n');
  fs.writeFileSync(path.join(root, 'empty.txt'), '');
  fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
  git(root, ['add', '.gitignore', 'copy.js', 'empty.txt']);
  git(root, ['add', '-f', 'dist/bundle.js']);
  const types = auditClutter(root, config()).findings.map((item) => item.type);
  for (const expected of ['empty tracked file', 'generated or temporary path', 'tracked file is ignored', 'duplicate tracked content']) assert.ok(types.includes(expected));
});

test('clutter allow patterns are bounded to matching paths', () => {
  assert.equal(glob('dist/**').test('dist/assets/app.js'), true);
  assert.equal(glob('dist/**').test('src/app.js'), false);
});

test('bounded workers run direct commands and verify artifacts', async () => {
  const root = repository();
  const output = path.join(root, 'artifact.txt');
  const value = config();
  value.commands.verify = [{ name:'Write artifact', run:process.execPath, args:['-e', `require('fs').writeFileSync(${JSON.stringify(output)}, 'ok')`], cwd:'.' }];
  value.artifacts = ['artifact.txt'];
  const result = await runCrucible(root, value);
  assert.equal(result.workers * result.cycles * result.commands, 4);
  assert.equal(fs.readFileSync(output, 'utf8'), 'ok');
});

test('package-manager commands retain shell-free Windows compatibility', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'runner.js'), 'utf8');
  const invocation = resolveSpawn({ run:'npm', args:['test'] }, { npm_execpath:'C:\\npm\\npm-cli.js' }, 'win32');
  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.args, ['C:\\npm\\npm-cli.js', 'test']);
  assert.match(runner, /shell:false/);
  assert.doesNotMatch(runner, /shell:true/);
});

test('direct Windows CLI runs discover the bundled npm CLI without a shell', () => {
  const runtime = { execPath:'C:\\node\\node.exe', existsSync:(candidate) => candidate === 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js' };
  const invocation = resolveSpawn({ run:'npm', args:['audit'] }, {}, 'win32', runtime);
  assert.equal(invocation.executable, runtime.execPath);
  assert.deepEqual(invocation.args, ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'audit']);
});

test('maintenance repacks without changing HEAD or the working tree', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'app.txt'), 'working\n');
  git(root, ['add', 'app.txt']);
  git(root, ['commit', '-m', 'fixture']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const result = maintain(root);
  assert.equal(result.head, head);
  assert.equal(git(root, ['status', '--porcelain']), '');
});
