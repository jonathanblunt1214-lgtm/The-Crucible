const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runCommand } = require('./runner');
const { digestFile } = require('./authenticity');

function copyTracked(root, target) {
  fs.mkdirSync(target, { recursive:true });
  const files = execFileSync('git', ['ls-files', '-z'], { cwd:root, encoding:'utf8', windowsHide:true }).split('\0').filter(Boolean);
  for (const file of files) {
    const destination = path.join(target, file); fs.mkdirSync(path.dirname(destination), { recursive:true });
    fs.writeFileSync(destination, execFileSync('git', ['show', `:${file}`], { cwd:root, encoding:'buffer', windowsHide:true, maxBuffer:25 * 1024 * 1024 }));
  }
}
async function buildOnce(root, config, target) {
  copyTracked(root, target);
  const timeout = config.workload.timeoutMinutes * 60_000;
  for (const command of config.reproducibility.commands) await runCommand(target, command, timeout, ' [reproducibility]', config.workload.maxOutputBytes);
  return Object.fromEntries(config.reproducibility.artifacts.map((item) => {
    const file = path.join(target, item); if (!fs.existsSync(file)) throw new Error(`Reproducibility artifact missing: ${item}.`); return [item, digestFile(file)];
  }));
}
async function verifyReproducibility(root, config) {
  if (!config.reproducibility.enabled) return { skipped:true, artifacts:0 };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-repro-'));
  try {
    const first = await buildOnce(root, config, path.join(temporary, 'one'));
    const second = await buildOnce(root, config, path.join(temporary, 'two'));
    const changed = Object.keys(first).filter((item) => first[item] !== second[item]);
    if (changed.length) throw new Error(`Non-reproducible artifact(s): ${changed.join(', ')}.`);
    return { skipped:false, artifacts:Object.keys(first).length };
  } finally { fs.rmSync(temporary, { recursive:true, force:true }); }
}

module.exports = { copyTracked, verifyReproducibility };
