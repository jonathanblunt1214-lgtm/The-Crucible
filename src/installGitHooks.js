const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOKS_DIR = '.githooks';

function installGitHooks(root = process.cwd(), options = {}) {
  const runGit = options.exec || ((args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' }));
  const hooksDir = path.join(root, HOOKS_DIR);
  if (!fs.existsSync(hooksDir)) return { installed: false, reason: `${HOOKS_DIR} directory not found` };

  const hooks = fs.readdirSync(hooksDir).filter((name) => fs.statSync(path.join(hooksDir, name)).isFile());
  for (const name of hooks) fs.chmodSync(path.join(hooksDir, name), 0o755);

  try { runGit(['config', 'core.hooksPath', HOOKS_DIR]); }
  catch { return { installed: false, reason: 'not a Git repository, or Git is unavailable' }; }

  return { installed: true, hooks };
}

if (require.main === module) {
  const result = installGitHooks();
  if (result.installed) console.log(`[The Crucible] Local Git hooks installed and executable: ${result.hooks.join(', ')}`);
  else console.log(`[The Crucible] Skipped local Git hook installation (${result.reason}).`);
}

module.exports = { HOOKS_DIR, installGitHooks };
