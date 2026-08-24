const { execFileSync } = require('node:child_process');

function git(root, args, inherit = false) {
  const result = execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true, stdio:inherit ? 'inherit' : undefined });
  return typeof result === 'string' ? result.trim() : '';
}

function maintain(root) {
  const before = git(root, ['count-objects', '-v']);
  git(root, ['fsck', '--full', '--strict', '--no-dangling'], true);
  git(root, ['repack', '-Ad'], true);
  git(root, ['prune-packed'], true);
  git(root, ['fsck', '--full', '--strict', '--no-dangling'], true);
  const after = git(root, ['count-objects', '-v']);
  return { before, after, head:git(root, ['rev-parse', 'HEAD']) };
}

module.exports = { maintain };
