const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/config');

function fixture() {
  return {
    schemaVersion:1,
    project:{ name:'Fixture' },
    privacy:{ githubIdentity:'octocat' },
    commands:{ verify:[{ name:'Test', run:'node', args:['--test'] }] },
  };
}

test('validates and supplies bounded workload defaults', () => {
  const config = validateConfig(fixture());
  assert.deepEqual(config.project, { name:'Fixture', projectId:null, mainRepository:null, repositories:[], folderTopology:null });
  assert.equal(config.suite.mode, 'all');
  assert.deepEqual(config.workload, { workers:4, cycles:2, timeoutMinutes:4, maxOutputBytes:1048576, heartbeatSeconds:60, execution:{ network:'allow', memoryMb:null, fileSizeMb:null, processes:null, denyBackground:true } });
  assert.equal(config.privacy.scanContactInformation, false);
  assert.deepEqual(config.privacy.allow, []);
  assert.equal(config.clutter.blockTrackedIgnored, false);
  assert.equal(config.commands.verify[0].run, 'node');
  assert.deepEqual(config.security, { enabled:true, allow:[], allowBinaries:[], maxTextBytes:1048576, dependencyAudit:[], provenanceAudit:[], dependencyPolicy:{ enabled:false, denyGit:true, denyHttp:true, denyLocal:false, allowedRegistryHosts:[], denyLicenses:[] }, malwareScan:{ enabled:false } });
  assert.deepEqual(config.authenticity, { claims:[], requireArtifacts:false });
  assert.deepEqual(config.reproducibility, { enabled:false, commands:[], artifacts:[] });
});

test('validates a multi-repository project with one Main repository role independent of repository name', () => {
  const value = fixture();
  value.project = {
    name:'Product suite',
    projectId:'product-suite',
    mainRepository:'octocat/customer-portal',
  };
  assert.deepEqual(validateConfig(value).project, { ...value.project, repositories:[], folderTopology:null });

  value.project.folderTopology = { mode:'explicit', folders:[
    { path:'app', roles:['influences-main'], links:['123'] },
    { path:'tests', roles:['checks-only'], links:['123'] },
    { path:'old', roles:['archive'], links:[] },
  ] };
  assert.equal(validateConfig(value).project.folderTopology.folders[2].roles[0], 'archive');
  value.project.folderTopology.folders[2].roles = ['archive', 'independent'];
  assert.throws(() => validateConfig(value), /independent folder/);
});

test('rejects unsafe Main repository names and local repository lists', () => {
  const unsafe = fixture();
  unsafe.project.mainRepository = 'https://github.com/octocat/customer-portal';
  assert.throws(() => validateConfig(unsafe), /unsafe repository identifier/);

  const localList = fixture();
  localList.project.mainRepository = 'octocat/customer-portal';
  localList.project.repositories = ['octocat/customer-portal', 'octocat/worker'];
  assert.throws(() => validateConfig(localList), /supplied by the Main repository manifest/);
});

test('requires shell-free evidence commands for declared claims', () => {
  const value = fixture();
  value.authenticity = { claims:[{ name:'Repository inventory is current', run:'npm', args:['run', 'inventory:verify'] }] };
  assert.equal(validateConfig(value).authenticity.claims[0].name, 'Repository inventory is current');
  value.authenticity.claims[0].run = '../fake-proof';
  assert.throws(() => validateConfig(value), /executable name/);
});

test('authenticity learning eligibility requires explicit bounded fields and rejects extras', () => {
  const value = fixture();
  value.authenticity = { claims:[{ name:'Bounded suite claim', run:'node', args:['--test'], learning:{ claimBoundary:'exact commit and runtime', generalizationBoundary:'no wider than the exact commit and runtime', expectedOutcome:'configured tests pass', environment:'governed test runner' } }] };
  assert.deepEqual(validateConfig(value).authenticity.claims[0].learning, value.authenticity.claims[0].learning);
  delete value.authenticity.claims[0].learning.claimBoundary;
  assert.throws(() => validateConfig(value), /learning\.claimBoundary is required/);
  value.authenticity.claims[0].learning.claimBoundary = 'exact commit'; value.authenticity.claims[0].learning.confidence = 1;
  assert.throws(() => validateConfig(value), /learning contains unknown field.*confidence/);
});

test('validates narrow privacy path exemptions', () => {
  const value = fixture();
  value.privacy.allow = ['src/data/**'];
  assert.deepEqual(validateConfig(value).privacy.allow, ['src/data/**']);
  value.privacy.allow = [42];
  assert.throws(() => validateConfig(value), /privacy.allow/);
});

test('validates bounded shell-free Security Gate configuration', () => {
  const value = fixture();
  value.security = { allow:['fixtures/**'], allowBinaries:['vendor/tool.exe'], dependencyAudit:[{ name:'Audit', run:'npm', args:['audit'] }] };
  const config = validateConfig(value);
  assert.equal(config.security.dependencyAudit[0].run, 'npm');
  const unsafe = fixture();
  unsafe.security = { dependencyAudit:[{ name:'Unsafe', run:'../audit' }] };
  assert.throws(() => validateConfig(unsafe), /executable name/);
  const invalidToggle = fixture();
  invalidToggle.security = { enabled:'no' };
  assert.throws(() => validateConfig(invalidToggle), /must be a boolean/);
});

test('rejects shell-like executable paths and paths outside the repository', () => {
  const executablePath = fixture();
  executablePath.commands.verify[0].run = '../tool';
  assert.throws(() => validateConfig(executablePath), /executable name/);
  const cwdEscape = fixture();
  cwdEscape.commands.verify[0].cwd = '../outside';
  assert.throws(() => validateConfig(cwdEscape), /cannot escape/);
  const artifactEscape = fixture();
  artifactEscape.artifacts = ['../secret'];
  assert.throws(() => validateConfig(artifactEscape), /safe repository-relative/);
});

test('rejects missing verification and unbounded stress settings', () => {
  const missing = fixture();
  missing.commands.verify = [];
  assert.throws(() => validateConfig(missing), /at least one/);
  const unbounded = fixture();
  unbounded.workload = { workers:99 };
  assert.throws(() => validateConfig(unbounded), /1 through 8/);
});

test('bounds workload.heartbeatSeconds and lets it be tuned down toward the requested 60s cadence', () => {
  const tuned = fixture();
  tuned.workload = { heartbeatSeconds:15 };
  assert.equal(validateConfig(tuned).workload.heartbeatSeconds, 15);
  const unbounded = fixture();
  unbounded.workload = { heartbeatSeconds:1 };
  assert.throws(() => validateConfig(unbounded), /5 through 300/);
});

test('clutter utility audit detects generated, empty, and duplicate tracked content from a snapshot', () => {
  const { auditClutter } = require('../src/clutter');
  const snapshot = {
    files:['src/empty.js', 'dist/bundle.js', 'src/a.js', 'src/b.js'],
    entries:new Map([
      ['src/empty.js', { size:0, sha256:'empty' }],
      ['dist/bundle.js', { size:12, sha256:'bundle' }],
      ['src/a.js', { size:10, sha256:'same' }],
      ['src/b.js', { size:10, sha256:'same' }],
    ]),
  };
  const result = auditClutter('/unused', { clutter:{ allow:[], blockTrackedIgnored:false, allowDuplicateContent:false } }, snapshot);
  assert.equal(result.files, 4);
  assert.ok(result.findings.some((item) => item.type === 'empty tracked file' && item.path === 'src/empty.js'));
  assert.ok(result.findings.some((item) => item.type === 'generated or temporary path' && item.path === 'dist/bundle.js'));
  assert.ok(result.findings.some((item) => item.type === 'duplicate tracked content' && /src\/a\.js == src\/b\.js/.test(item.path)));
});

test('interactive suite configuration persists selected categories without re-asking configured topology', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { configureSuite } = require('../src/configureSuite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-configure-suite-'));
  const target = path.join(dir, '.thecrucible.json');
  fs.writeFileSync(target, JSON.stringify({ project:{ folderTopology:{ mode:'explicit', folders:[{ path:'src', roles:['influences-main'], links:[] }] } }, suite:{ mode:'all' } }), 'utf8');
  const answers = ['selected', 'security, privacy'];
  const prompt = { question: async () => answers.shift() };
  const suite = await configureSuite(target, { prompt });
  assert.deepEqual(suite, { mode:'selected', categories:['security', 'privacy'] });
  const persisted = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepEqual(persisted.suite, suite);
  assert.equal(answers.length, 0);
});
