const { spawnSync } = require('node:child_process');

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function evaluateHandoffChanges(paths) {
  const changed = paths.map((value) => value.trim()).filter(Boolean);
  if (changed.length === 0) {
    return { ok: true, message: 'No changed files require a handoff update.' };
  }
  if (changed.includes('DEVLOG.md')) {
    return { ok: true, message: 'DEVLOG.md was updated with this change.' };
  }
  return {
    ok: false,
    message: 'Project changes must update DEVLOG.md with the current plan, status, verification, and remaining work.'
  };
}

function checkHandoffRange(baseSha, headSha, run = spawnSync) {
  if (!SHA_PATTERN.test(baseSha) || !SHA_PATTERN.test(headSha)) {
    return { ok: false, message: 'The AI handoff policy requires exact 40-character base and head commit SHAs.' };
  }

  const result = run('git', ['diff', '--name-only', baseSha, headSha], {
    encoding: 'utf8',
    shell: false
  });
  if (result.status !== 0) {
    return { ok: false, message: `Unable to inspect the change range: ${(result.stderr || '').trim() || 'git diff failed'}` };
  }
  return evaluateHandoffChanges(result.stdout.split(/\r?\n/));
}

if (require.main === module) {
  const result = checkHandoffRange(process.env.HANDOFF_BASE_SHA || '', process.env.HANDOFF_HEAD_SHA || '');
  console.log(`[AI handoff policy] ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = { evaluateHandoffChanges, checkHandoffRange };
