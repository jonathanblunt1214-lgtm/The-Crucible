const { execFileSync } = require('node:child_process');

const CLUTTER = /(^|\/)(?:node_modules|dist|out|build|coverage|tmp|temp|logs?)(?:\/|$)|(?:~|\.bak|\.old|\.orig|\.rej|\.tmp|\.log|\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

function git(root, args) { return execFileSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true }).trim(); }
function glob(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function auditClutter(root, config) {
  const files = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const allow = config.clutter.allow.map(glob);
  const findings = [];
  const hashes = new Map();
  for (const file of files) {
    if (allow.some((rule) => rule.test(file))) continue;
    const size = Number(git(root, ['cat-file', '-s', `:${file}`]));
    if (size === 0) findings.push({ type:'empty tracked file', path:file });
    if (CLUTTER.test(file)) findings.push({ type:'generated or temporary path', path:file });
    const hash = git(root, ['rev-parse', `:${file}`]);
    hashes.set(hash, [...(hashes.get(hash) || []), file]);
  }
  if (config.clutter.blockTrackedIgnored) for (const file of git(root, ['ls-files', '-ci', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    if (!allow.some((rule) => rule.test(file))) findings.push({ type:'tracked file is ignored', path:file });
  }
  if (!config.clutter.allowDuplicateContent) for (const paths of hashes.values()) {
    if (paths.length > 1) findings.push({ type:'duplicate tracked content', path:paths.join(' == ') });
  }
  return { files:files.length, findings };
}

module.exports = { CLUTTER, auditClutter, glob };
