const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const {
  loadTaskRouting,
  classifyTask,
  routingRecord,
  verifyRecordedDecision,
} = require('./taskRouting');
const { crucibleError } = require('./failureCodes');

const ZERO_SHA = /^0{40,64}$/;

function fail(message) {
  throw crucibleError('CRU-0045', message);
}

function parseArgs(argv) {
  const options = { paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`Unexpected argument ${token}.`);
    const key = token.slice(2);
    if (['owner-authorized', 'automation', 'system-workflow'].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Argument --${key} requires a value.`);
    index += 1;
    if (key === 'path') options.paths.push(value);
    else options[key] = value;
  }
  return options;
}

function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: options.cwd || process.cwd(), encoding: 'utf8', windowsHide: true, input: options.input });
  if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || result.error?.message || 'unknown error').trim()}`);
  return result.stdout.trim();
}

function repositoryFromRemote(remoteUrl) {
  const value = String(remoteUrl || '').trim().replace(/\.git\/?$/, '');
  const match = value.match(/github\.com[/:]([^/\s]+\/[^/\s]+)$/i);
  if (!match) fail(`Remote URL does not identify an exact GitHub owner/repository: ${value || '(empty)'}.`);
  return match[1];
}

function currentRepository(remote = 'origin') {
  return repositoryFromRemote(git(['remote', 'get-url', remote]));
}

function inferredBranch(registry) {
  const attached = git(['branch', '--show-current']);
  if (attached) return { branch: attached, detachedAtExactTip: false };
  const refs = git(['for-each-ref', '--format=%(refname:short)', '--points-at=HEAD', 'refs/remotes/origin'])
    .split(/\r?\n/).filter(Boolean).map((ref) => ref.replace(/^origin\//, ''));
  const allowed = new Set(registry.repositories.flatMap((repository) => Object.keys(repository.branches)));
  const candidates = refs.filter((ref) => allowed.has(ref));
  if (candidates.length !== 1) return { branch: '', detachedAtExactTip: true, candidates };
  return { branch: candidates[0], detachedAtExactTip: true };
}

function selectWorktree(porcelain, branch, remoteHead) {
  const records = String(porcelain || '').trim().split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const record = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(' ');
      if (separator > 0) record[line.slice(0, separator)] = line.slice(separator + 1);
      else if (line) record[line] = true;
    }
    return record;
  });
  const attached = records.find((record) => record.branch === `refs/heads/${branch}`);
  if (attached) return attached.worktree || null;
  const exactDetached = records.filter((record) => record.detached === true && record.HEAD === remoteHead && record.worktree);
  return exactDetached.length === 1 ? exactDetached[0].worktree : null;
}

function worktreeForBranch(branch) {
  const porcelain = git(['worktree', 'list', '--porcelain']);
  const remoteHead = git(['rev-parse', `refs/remotes/origin/${branch}`]);
  return selectWorktree(porcelain, branch, remoteHead);
}

function contextFrom(options) {
  const explicit = options.branch || options.repository || options['repository-id']
    ? { branch: options.branch, repository: options.repository, repositoryId: options['repository-id'] }
    : null;
  return {
    prompt: options.prompt || '',
    paths: options.paths,
    project: options.project || '',
    operation: options.operation || 'write',
    explicit,
    ownerAuthorized: options['owner-authorized'] === true,
    automation: options.automation === true,
    systemWorkflow: options['system-workflow'] === true,
  };
}

function changedPaths(base, head) {
  if (ZERO_SHA.test(base)) fail('A new branch push is not authorized by task routing. Registering a route never creates a branch.');
  return git(['diff', '--name-only', base, head]).split(/\r?\n/).filter(Boolean);
}

function handoffAt(sha) {
  let handoff;
  try {
    handoff = JSON.parse(git(['show', `${sha}:AI-HANDOFF.json`]));
  } catch (error) {
    fail(`Cannot read AI-HANDOFF.json at pushed commit ${sha}: ${error.message}`);
  }
  return handoff;
}

function verifyPush({ input, remote = 'origin', remoteUrl } = {}) {
  const registry = loadTaskRouting();
  const repository = repositoryFromRemote(remoteUrl || git(['remote', 'get-url', remote]));
  const lines = String(input || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) fail('The pre-push hook received no ref update to verify.');
  const results = [];
  for (const line of lines) {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha) fail(`Malformed pre-push ref line: ${line}.`);
    if (ZERO_SHA.test(localSha)) {
      results.push({ status: 'deletion-not-authorized-by-routing', remoteRef });
      continue;
    }
    if (!remoteRef.startsWith('refs/heads/')) fail(`Only branch refs are supported, received ${remoteRef}.`);
    const branch = remoteRef.slice('refs/heads/'.length);
    const paths = changedPaths(remoteSha, localSha);
    const handoff = handoffAt(localSha);
    results.push(verifyRecordedDecision({ record: handoff.activePlan?.taskRouting, repository, branch, paths, prompt: handoff.activePlan?.currentPrompt }, registry));
  }
  return results;
}

function verifyCi(environment = process.env) {
  const registry = loadTaskRouting();
  const sha = environment.GITHUB_SHA;
  const branch = environment.GITHUB_REF_NAME;
  const repository = environment.GITHUB_REPOSITORY;
  if (!sha || !branch || !repository || !environment.GITHUB_REPOSITORY_ID) fail('GITHUB_SHA, GITHUB_REF_NAME, GITHUB_REPOSITORY, and GITHUB_REPOSITORY_ID are required for CI routing verification.');
  const base = environment.CRUCIBLE_BASE_SHA;
  if (!base || ZERO_SHA.test(base)) fail('CRUCIBLE_BASE_SHA must name an existing commit; routing never authorizes a new branch push.');
  const handoff = JSON.parse(fs.readFileSync('AI-HANDOFF.json', 'utf8'));
  return verifyRecordedDecision({
    record: handoff.activePlan?.taskRouting,
    repositoryId: environment.GITHUB_REPOSITORY_ID,
    repository,
    branch,
    paths: changedPaths(base, sha),
    prompt: handoff.activePlan?.currentPrompt,
  }, registry);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function run(argv = process.argv.slice(2), environment = process.env, stdin = null) {
  const [action, ...rest] = argv;
  const options = parseArgs(rest);
  const registry = loadTaskRouting(options.registry);
  if (action === 'classify') {
    const decision = classifyTask(contextFrom(options), registry);
    print(decision);
    if (decision.status !== 'ready') process.exitCode = 2;
    return decision;
  }
  if (action === 'record') {
    const context = contextFrom(options);
    const decision = classifyTask(context, registry);
    const record = routingRecord(decision, { prompt: context.prompt, paths: context.paths, selectedAt: options.at });
    const result = { taskRouting: record, devlog: `[task-routing] category=${record.category}; repositoryId=${record.repositoryId}; repository=${record.repository}; branch=${record.branch}; reason=${record.reason}` };
    print(result);
    return result;
  }
  if (action === 'prewrite') {
    const context = contextFrom(options);
    const decision = classifyTask(context, registry);
    if (decision.status !== 'ready') {
      print(decision);
      process.exitCode = 2;
      return decision;
    }
    const current = inferredBranch(registry);
    const repository = currentRepository(options.remote || 'origin');
    if (repository.toLowerCase() !== decision.repository.toLowerCase() || current.branch !== decision.branch) {
      const result = { ...decision, status: 'reroute-required', current: { repository, ...current }, checkoutPath: worktreeForBranch(decision.branch), reason: `${decision.reason} Move the task to ${decision.repository}:${decision.branch} before editing.` };
      print(result);
      process.exitCode = 2;
      return result;
    }
    const result = { ...decision, current: { repository, ...current }, record: routingRecord(decision, { prompt: context.prompt, paths: context.paths, selectedAt: options.at }) };
    print(result);
    return result;
  }
  if (action === 'verify-push') {
    const result = verifyPush({ input: stdin === null ? fs.readFileSync(0, 'utf8') : stdin, remote: options.remote || 'origin', remoteUrl: options.url });
    print({ ok: true, updates: result });
    return result;
  }
  if (action === 'verify-ci') {
    const result = verifyCi(environment);
    print(result);
    return result;
  }
  fail('Usage: taskRoutingCli.js <classify|record|prewrite|verify-push|verify-ci> [options].');
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`[The Crucible] Task routing failed closed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ZERO_SHA,
  parseArgs,
  repositoryFromRemote,
  inferredBranch,
  selectWorktree,
  worktreeForBranch,
  contextFrom,
  changedPaths,
  handoffAt,
  verifyPush,
  verifyCi,
  run,
};
