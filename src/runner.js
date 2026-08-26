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

function runCommand(root, command, timeoutMs, suffix = '') {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(root, command.cwd);
    if (!cwd.startsWith(`${path.resolve(root)}${path.sep}`) && cwd !== path.resolve(root)) return reject(new Error(`${command.name} escapes the repository.`));
    const invocation = resolveSpawn(command);
    const child = spawn(invocation.executable, invocation.args, { cwd, shell:false, windowsHide:true, stdio:['ignore', 'pipe', 'pipe'], env:{ ...process.env, CI:'true' } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command.name}${suffix} exceeded the configured timeout.`)); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`${command.name}${suffix} could not start: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command.name}${suffix} failed with exit code ${code}.\n${output.slice(-4000)}`));
    });
  });
}

async function runCrucible(root, config) {
  const timeoutMs = config.workload.timeoutMinutes * 60_000;
  for (const command of config.commands.prepare) await runCommand(root, command, timeoutMs);
  const jobs = [];
  for (let worker = 1; worker <= config.workload.workers; worker += 1) {
    jobs.push((async () => {
      for (let cycle = 1; cycle <= config.workload.cycles; cycle += 1) {
        for (const command of config.commands.verify) await runCommand(root, command, timeoutMs, ` [worker ${worker}, cycle ${cycle}]`);
      }
    })());
  }
  await Promise.all(jobs);
  const missing = config.artifacts.filter((relative) => !fs.existsSync(path.resolve(root, relative)));
  if (missing.length) throw new Error(`Expected artifact(s) missing: ${missing.join(', ')}`);
  return { workers:config.workload.workers, cycles:config.workload.cycles, commands:config.commands.verify.length, artifacts:config.artifacts.length };
}

module.exports = { resolveSpawn, runCommand, runCrucible };
