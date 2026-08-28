const path = require('node:path');
const { spawn } = require('node:child_process');
const { changedPaths, readCandidate } = require('./commit');
const { resolveSpawn } = require('./runner');
const { reconcileDecision } = require('./governingDecision');

const ACTION_CLASSES = Object.freeze([
  'safe auto-fix',
  'test failure',
  'security concern',
  'human code review required',
]);

function matches(pattern, relative) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\0/g, '.*');
  return new RegExp(`^${escaped}$`).test(relative.replace(/\\/g, '/'));
}

function selectChanged(paths, include) {
  return paths.filter((relative) => include.some((pattern) => matches(pattern, relative)));
}

function parseCandidate(relative, content) {
  const extension = path.extname(relative).toLowerCase();
  try {
    if (extension === '.json') JSON.parse(content);
    else if (['.js', '.cjs', '.mjs'].includes(extension)) {
      const syntaxContent = content.replace(/^#![^\r\n]*(?:\r?\n|$)/, '');
      new Function(syntaxContent); // Syntax only; never executed. Node accepts a leading CLI shebang.
    }
    else return null;
    return null;
  } catch (error) {
    return {
      action:'human code review required',
      check:'parser',
      errorCode:`CRUCIBLE_PARSE_${extension === '.json' ? 'JSON' : 'JAVASCRIPT'}_SYNTAX`,
      path:relative,
      detail:error.message.split(/\r?\n/)[0],
      decision:{ status:'blocked', action:'block-known-unsafe', principle:'overcome', evidenceSource:'repository' },
    };
  }
}

function expandArgs(args, files) {
  const expanded = [];
  for (const arg of args) {
    if (arg === '{files}') expanded.push(...files);
    else expanded.push(arg);
  }
  return expanded;
}

function runCheckCommandOnce(root, command, files, timeoutMs) {
  return new Promise((resolve) => {
    const invocation = resolveSpawn({ ...command, args:expandArgs(command.args, files) });
    const cwd = path.resolve(root, command.cwd);
    const child = spawn(invocation.executable, invocation.args, { cwd, shell:false, windowsHide:true, stdio:['ignore', 'pipe', 'pipe'], env:{ ...process.env, CI:'true' } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
    const finish = (result) => resolve(result);
    const timer = setTimeout(() => { child.kill(); finish({ ok:false, reason:'timeout', detail:'exceeded the configured timeout' }); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); finish({ ok:false, reason:'start error', detail:`could not start: ${error.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) finish({ ok:true });
      else finish({ ok:false, reason:`exit ${code}`, exitCode:code, detail:`exit ${code}: ${output.trim().split(/\r?\n/).slice(-1)[0] || 'no output'}` });
    });
  });
}

async function runCheckCommand(root, command, files, timeoutMs, runOnce = runCheckCommandOnce) {
  const first = await runOnce(root, command, files, timeoutMs);
  if (first.ok || first.exitCode !== undefined || first.reason !== 'start error') return { ...first, attempts: 1 };
  const second = await runOnce(root, command, files, timeoutMs);
  return { ...second, attempts: 2, recovered: second.ok };
}

async function auditCode(root, config, options = {}) {
  const ref = options.ref || '--cached';
  const paths = options.paths || changedPaths(root, ref);
  const findings = [];
  for (const relative of paths) {
    if (!/\.(?:json|[cm]?js)$/i.test(relative)) continue;
    const finding = parseCandidate(relative, readCandidate(root, relative, ref));
    if (finding) findings.push(finding);
  }
  const commands = config.codeCheck ? config.codeCheck.commands : [];
  for (const command of commands) {
    const files = selectChanged(paths, command.include);
    if (!files.length) continue;
    const result = await runCheckCommand(root, command, files, config.workload.timeoutMinutes * 60_000);
    if (!result.ok) {
      const actionCode = command.failureAction.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
      const reasonCode = result.exitCode === null || result.exitCode === undefined
        ? result.reason.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()
        : `EXIT_${result.exitCode}`;
      const decision = await reconcileDecision({
        condition: `${command.name}: ${result.reason}`,
        knownUnsafe: result.exitCode !== null && result.exitCode !== undefined,
        evidence: [
          { source:'configuration', inspect:async () => ({ resolved:false, detail:`configured command ${command.run} with ${files.length} matching changed file(s)` }) },
          { source:'tool', inspect:async () => ({ resolved:false, detail:`command attempted ${result.attempts || 1} time(s): ${result.detail}` }) },
        ],
        semantic: command.failureAction === 'human code review required',
        highRisk: command.failureAction === 'security concern',
      });
      findings.push({ action:decision.status === 'needs-review' ? 'human code review required' : command.failureAction, errorCode:`CRUCIBLE_${actionCode}_${reasonCode}`, check:command.name, paths:files, detail:result.detail, decision });
    }
  }
  return { ref, paths, findings, commands:commands.length };
}

module.exports = { ACTION_CLASSES, auditCode, expandArgs, matches, parseCandidate, selectChanged, runCheckCommand, runCheckCommandOnce };
