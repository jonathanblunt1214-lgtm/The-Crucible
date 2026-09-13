const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  loadTaskRouting,
  validateTaskRouting,
  classifyTask,
  routingRecord,
  verifyRecordedDecision,
} = require('../src/taskRouting');
const {
  parseArgs,
  repositoryFromRemote,
  selectWorktree,
  changedPaths,
} = require('../src/taskRoutingCli');

const registry = loadTaskRouting();
const repositoryId = 1344890806;
const repository = 'jonathanblunt1214-lgtm/The-Crucible';

test('canonical routing registry is development-owned and uses a stable repository ID', () => {
  assert.equal(validateTaskRouting(registry), true);
  assert.deepEqual(registry.canonical, {
    repositoryId,
    repository,
    branch: 'development',
    path: 'TASK-ROUTING.json',
    reference: 'development:TASK-ROUTING.json',
  });
  assert.equal(registry.policies.canonicalCopies, 'forbidden');
  assert.equal(registry.repositories[0].id, repositoryId);
});

test('knowledge database, core learning, governance, and tests route to development', () => {
  for (const prompt of ['build the knowledge database', 'repair the scientific learning pipeline', 'update governance', 'fix testing']) {
    const result = classifyTask({ prompt, project: 'The Crucible' }, registry);
    assert.equal(result.status, 'ready', prompt);
    assert.equal(result.category, 'crucible-core', prompt);
    assert.equal(result.repositoryId, repositoryId, prompt);
    assert.equal(result.branch, 'development', prompt);
  }
  assert.equal(classifyTask({ paths: ['src/scientificLearning.js'] }, registry).branch, 'development');
});

test('MCP and named provider integrations route to Plug-in', () => {
  for (const prompt of ['add ChatGPT MCP', 'repair the Perplexity plugin', 'wire Gemini', 'change the Nexus integration']) {
    const result = classifyTask({ prompt, project: 'The Crucible' }, registry);
    assert.equal(result.status, 'ready', prompt);
    assert.equal(result.category, 'crucible-plugin', prompt);
    assert.equal(result.branch, 'Plug-in', prompt);
  }
  assert.equal(classifyTask({ paths: ['chatgpt-mcp/server.js'] }, registry).branch, 'Plug-in');
});

test('explicit registered destination overrides automatic wording but cannot create a branch or write main', () => {
  const explicit = classifyTask({
    prompt: 'task routing governance',
    paths: ['src/taskRouting.js'],
    explicit: { repositoryId, repository, branch: 'Plug-in' },
  }, registry);
  assert.equal(explicit.status, 'ready');
  assert.equal(explicit.category, 'crucible-plugin');
  assert.match(explicit.reason, /Explicit repository and branch/);
  const explicitRecord = routingRecord(explicit, { prompt: 'task routing governance', paths: ['src/taskRouting.js'] });
  assert.equal(explicitRecord.explicitOverride, true);
  assert.equal(verifyRecordedDecision({ record: explicitRecord, repositoryId, repository, branch: 'Plug-in', prompt: 'task routing governance', paths: ['src/taskRouting.js'] }, registry).ok, true);

  const unregistered = classifyTask({ prompt: 'core engine', explicit: { repositoryId, repository, branch: 'new-work' } }, registry);
  assert.equal(unregistered.status, 'blocked');
  assert.match(unregistered.reason, /never creates a branch/);

  const main = classifyTask({ prompt: 'release to main', explicit: { repositoryId, repository, branch: 'main' }, operation: 'promotion', ownerAuthorized: true, systemWorkflow: true }, registry);
  assert.equal(main.status, 'blocked');
  assert.equal(main.branch, 'main');
  assert.match(main.reason, /through release/);
});

test('multi-category paths require repository-scoped commits and conflicting signals ask one question', () => {
  const split = classifyTask({ paths: ['src/scientificLearning.js', 'chatgpt-mcp/server.js'] }, registry);
  assert.equal(split.status, 'split-required');
  assert.deepEqual(split.routes.map((route) => route.branch).sort(), ['Plug-in', 'development']);

  const conflict = classifyTask({ prompt: 'add ChatGPT MCP', paths: ['src/scientificLearning.js'] }, registry);
  assert.equal(conflict.status, 'ambiguous');
  assert.equal(conflict.requiresQuestion, true);
  assert.match(conflict.question, /Should this task use/);

  const unknown = classifyTask({ prompt: 'do the unrelated thing', project: 'unregistered project' }, registry);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.requiresQuestion, true);
  assert.match(unknown.question, /Which registered task category/);
});

test('ci-monitor is automation-only, Archive is read-only by default, and release is workflow-only', () => {
  const monitor = classifyTask({ prompt: 'sync CI monitor snapshot', operation: 'snapshot-sync' }, registry);
  assert.equal(monitor.status, 'blocked');
  assert.equal(classifyTask({ prompt: 'sync CI monitor snapshot', operation: 'snapshot-sync', automation: true }, registry).status, 'ready');

  assert.equal(classifyTask({ prompt: 'read archived reference', operation: 'read' }, registry).status, 'ready');
  assert.equal(classifyTask({ prompt: 'write historical material' }, registry).status, 'blocked');
  assert.equal(classifyTask({ prompt: 'write historical material', ownerAuthorized: true }, registry).status, 'ready');

  assert.equal(classifyTask({ prompt: 'release to main', operation: 'promotion', ownerAuthorized: true }, registry).status, 'blocked');
  const release = classifyTask({ prompt: 'release to main', operation: 'promotion', ownerAuthorized: true, systemWorkflow: true }, registry);
  assert.equal(release.status, 'ready');
  assert.equal(release.branch, 'release');
  assert.equal(release.nextBranch, 'main');
});

test('routing itself never authorizes branch creation or deletion', () => {
  for (const operation of ['create-branch', 'delete-branch']) {
    const result = classifyTask({ prompt: 'task routing', project: 'The Crucible', operation }, registry);
    assert.equal(result.status, 'blocked');
    assert.match(result.reason, new RegExp(operation));
  }
  assert.throws(() => changedPaths('0'.repeat(40), 'a'.repeat(40)), /CRU-0045.*new branch push/i);
});

test('a durable route record carries category, stable destination, reason, and prompt/path digests', () => {
  const prompt = 'implement task routing';
  const paths = ['src/taskRouting.js', 'test/taskRouting.test.js'];
  const decision = classifyTask({ prompt, paths }, registry);
  const record = routingRecord(decision, { prompt, paths, selectedAt: '2026-09-12T19:34:00Z' });
  assert.equal(record.category, 'crucible-core');
  assert.equal(record.repositoryId, repositoryId);
  assert.equal(record.repository, repository);
  assert.equal(record.branch, 'development');
  assert.equal(record.explicitOverride, false);
  assert.match(record.reason, /crucible-core/);
  assert.match(record.promptSha256, /^[a-f0-9]{64}$/);
  assert.match(record.affectedPathsSha256, /^[a-f0-9]{64}$/);
});

test('push verification blocks a wrong stable ID, repository, branch, path category, unknown path, and mixed commit', () => {
  const verifiedPaths = ['src/taskRouting.js', 'AI-HANDOFF.json', 'DEVLOG.md'];
  const record = routingRecord(classifyTask({ prompt: 'task routing', paths: verifiedPaths }, registry), { prompt: 'task routing', paths: verifiedPaths });
  const base = { record, repositoryId, repository, branch: 'development', prompt: 'task routing' };
  assert.equal(verifyRecordedDecision({ ...base, paths: verifiedPaths }, registry).ok, true);
  assert.throws(() => verifyRecordedDecision({ ...base, repositoryId: 1, paths: ['src/taskRouting.js'] }, registry), /CRU-0045.*stable ID/);
  assert.throws(() => verifyRecordedDecision({ ...base, repository: 'other/repository', paths: ['src/taskRouting.js'] }, registry), /CRU-0045.*does not match routed repository/);
  assert.throws(() => verifyRecordedDecision({ ...base, branch: 'Plug-in', paths: ['src/taskRouting.js'] }, registry), /CRU-0045.*does not match routed branch/);
  assert.throws(() => verifyRecordedDecision({ ...base, paths: ['chatgpt-mcp/server.js'] }, registry), /CRU-0045.*select crucible-plugin/);
  assert.throws(() => verifyRecordedDecision({ ...base, paths: ['unregistered.bin'] }, registry), /CRU-0045.*not registered/);
  assert.throws(() => verifyRecordedDecision({ ...base, paths: ['src/scientificLearning.js', 'chatgpt-mcp/server.js'] }, registry), /CRU-0045.*multiple categories/);
  assert.throws(() => verifyRecordedDecision({ ...base, paths: ['src/taskRouting.js'] }, registry), /CRU-0045.*affected-path digest/);
  assert.throws(() => verifyRecordedDecision({ ...base, paths: verifiedPaths, prompt: 'different prompt' }, registry), /CRU-0045.*prompt digest/);
});

test('CLI parsing is shell-free and remote identity parsing accepts HTTPS and SSH only', () => {
  assert.deepEqual(parseArgs(['--prompt', 'hello; whoami', '--path', 'src/a.js', '--path', 'test/a.test.js', '--owner-authorized']), {
    paths: ['src/a.js', 'test/a.test.js'],
    prompt: 'hello; whoami',
    'owner-authorized': true,
  });
  assert.equal(repositoryFromRemote('https://github.com/jonathanblunt1214-lgtm/The-Crucible.git'), repository);
  assert.equal(repositoryFromRemote('git@github.com:jonathanblunt1214-lgtm/The-Crucible.git'), repository);
  assert.throws(() => repositoryFromRemote('https://example.com/owner/repo.git'), /CRU-0045/);
});

test('pre-write rerouting finds an attached branch or one unambiguous exact-tip detached worktree', () => {
  const sha = 'a'.repeat(40);
  const attached = `worktree C:/work/dev\nHEAD ${'b'.repeat(40)}\nbranch refs/heads/development\n\nworktree C:/work/plugin\nHEAD ${sha}\ndetached\n`;
  assert.equal(selectWorktree(attached, 'development', 'b'.repeat(40)), 'C:/work/dev');
  assert.equal(selectWorktree(attached, 'Plug-in', sha), 'C:/work/plugin');
  assert.equal(selectWorktree(`${attached}\nworktree C:/work/plugin-two\nHEAD ${sha}\ndetached\n`, 'Plug-in', sha), null, 'two exact detached candidates must not be guessed between');
});

test('the checked-in active handoff records the same canonical route', () => {
  const handoff = JSON.parse(fs.readFileSync('AI-HANDOFF.json', 'utf8'));
  const record = handoff.activePlan.taskRouting;
  assert.equal(record.category, 'crucible-core');
  assert.equal(record.repositoryId, repositoryId);
  assert.equal(record.repository, repository);
  assert.equal(record.branch, 'development');
  assert.match(record.reason, /task-category dispatcher/);
});
