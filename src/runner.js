const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function resolveSpawn(command, environment = process.env, platform = process.platform, runtime = {}) {
  const runtimeExecutable = runtime.execPath || process.execPath;
  const exists = runtime.existsSync || fs.existsSync;
  if (platform === 'win32' && command.run.toLowerCase() === 'npm') {
    const pathImpl = path.win32;
    const candidates = [
      environment.npm_execpath,
      pathImpl.resolve(pathImpl.dirname(runtimeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      pathImpl.resolve(pathImpl.dirname(runtimeExecutable), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      environment.APPDATA && pathImpl.resolve(environment.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].filter(Boolean);
    const npmCli = candidates.find((candidate) => candidate === environment.npm_execpath || exists(candidate));
    if (npmCli) return { executable:runtimeExecutable, args:[npmCli, ...command.args] };
  }
  return { executable:command.run, args:command.args };
}

function restrictInvocation(invocation, limits, platform = process.platform) {
  if (!limits) return invocation;
  const requested = limits.network === 'deny' || limits.memoryMb || limits.fileSizeMb || limits.processes;
  if (!requested) return invocation;
  if (platform !== 'linux') throw new Error('Strict workload isolation is supported only on Linux runners and fails closed elsewhere.');
  let executable = invocation.executable; let args = invocation.args;
  if (limits.memoryMb || limits.fileSizeMb || limits.processes) {
    const flags = [];
    if (limits.memoryMb) flags.push(`--as=${limits.memoryMb * 1024 * 1024}`);
    if (limits.fileSizeMb) flags.push(`--fsize=${limits.fileSizeMb * 1024 * 1024}`);
    if (limits.processes) flags.push(`--nproc=${limits.processes}`);
    args = [...flags, '--', executable, ...args]; executable = 'prlimit';
  }
  if (limits.network === 'deny') { args = ['--net', '--', executable, ...args]; executable = 'unshare'; }
  return { executable, args };
}

function runCommand(root, command, timeoutMs, suffix = '', maxOutputBytes = 1_048_576, limits = null) {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(root, command.cwd);
    if (!cwd.startsWith(`${path.resolve(root)}${path.sep}`) && cwd !== path.resolve(root)) return reject(new Error(`${command.name} escapes the repository.`));
    const invocation = restrictInvocation(resolveSpawn(command), limits);
    const child = spawn(invocation.executable, invocation.args, { cwd, shell:false, detached:process.platform !== 'win32', windowsHide:true, stdio:['ignore', 'pipe', 'pipe'], env:{ ...process.env, CI:'true' } });
    let output = '';
    const capture = (chunk, stream) => { output = `${output}${chunk}`.slice(-maxOutputBytes); stream.write(chunk); };
    child.stdout.on('data', (chunk) => capture(chunk, process.stdout));
    child.stderr.on('data', (chunk) => capture(chunk, process.stderr));
    const terminate = () => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell:false, windowsHide:true, stdio:'ignore' });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const timer = setTimeout(() => { terminate(); reject(new Error(`${command.name}${suffix} exceeded the configured timeout.`)); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`${command.name}${suffix} could not start: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (limits?.denyBackground) terminate();
      if (code === 0) resolve();
      else reject(new Error(`${command.name}${suffix} failed with exit code ${code}.\n${output.slice(-4000)}`));
    });
  });
}

async function runCrucible(root, config) {
  const timeoutMs = config.workload.timeoutMinutes * 60_000;
  for (const command of config.commands.prepare) await runCommand(root, command, timeoutMs, '', config.workload.maxOutputBytes, config.workload.execution);
  const jobs = [];
  for (let worker = 1; worker <= config.workload.workers; worker += 1) {
    jobs.push((async () => {
      for (let cycle = 1; cycle <= config.workload.cycles; cycle += 1) {
        for (const command of config.commands.verify) await runCommand(root, command, timeoutMs, ` [worker ${worker}, cycle ${cycle}]`, config.workload.maxOutputBytes, config.workload.execution);
      }
    })());
  }
  await Promise.all(jobs);
  const missing = config.artifacts.filter((relative) => !fs.existsSync(path.resolve(root, relative)));
  if (missing.length) throw new Error(`Expected artifact(s) missing: ${missing.join(', ')}`);
  return { workers:config.workload.workers, cycles:config.workload.cycles, commands:config.commands.verify.length, artifacts:config.artifacts.length };
}

module.exports = { resolveSpawn, restrictInvocation, runCommand, runCrucible };
