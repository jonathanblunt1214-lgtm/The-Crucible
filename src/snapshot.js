const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function stagedSnapshot(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd:root, encoding:'utf8', windowsHide:true }).split('\0').filter(Boolean);
  const entries = new Map();
  for (const file of files) {
    let buffer;
    try { buffer = execFileSync('git', ['show', `:${file}`], { cwd:root, encoding:'buffer', windowsHide:true, maxBuffer:25 * 1024 * 1024 }); }
    catch { continue; }
    entries.set(file, { buffer, size:buffer.length, sha256:crypto.createHash('sha256').update(buffer).digest('hex') });
  }
  return { files, entries };
}

module.exports = { stagedSnapshot };
