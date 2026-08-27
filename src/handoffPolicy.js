const { spawnSync } = require('node:child_process');

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function evaluateHandoffChanges(paths) {
  const changed = paths.map((value) => value.trim()).filter(Boolean);
  if (changed.length === 0) {
    return { ok: true, message: 'No changed files require a handoff update.' };
  }
  if (changed.includes('DEVLOG.md') && changed.includes('AI-HANDOFF.json')) return { ok: true, message: 'DEVLOG.md and the structured AI development plan were updated with this change.' };
  return {
    ok: false,
    message: 'Project changes must update both DEVLOG.md and AI-HANDOFF.json with the current development plan, status, verification, and remaining work.'
  };
}

function validateHandoffPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schemaVersion !== 1) return { ok:false, message:'AI-HANDOFF.json must be an object with schemaVersion 1.' };
  const active = plan.activePlan;
  if (!active || typeof active !== 'object') return { ok:false, message:'AI-HANDOFF.json requires activePlan.' };
  for (const field of ['agent', 'objective', 'currentPrompt', 'startedAt', 'lastUpdatedAt']) if (typeof active[field] !== 'string' || !active[field].trim()) return { ok:false, message:`AI-HANDOFF.json activePlan.${field} is required.` };
  if (!['active', 'handoff-ready', 'complete'].includes(active.status)) return { ok:false, message:'AI-HANDOFF.json activePlan.status must be active, handoff-ready, or complete.' };
  if (!Array.isArray(active.steps) || !active.steps.length || active.steps.some((step) => typeof step !== 'string' || !step.trim())) return { ok:false, message:'AI-HANDOFF.json activePlan.steps must contain the ordered development plan.' };
  const notes = plan.handoffNotes;
  if (!notes || typeof notes !== 'object') return { ok:false, message:'AI-HANDOFF.json requires handoffNotes.' };
  for (const field of ['completed', 'verification', 'remaining']) if (!Array.isArray(notes[field]) || notes[field].some((item) => typeof item !== 'string' || !item.trim())) return { ok:false, message:`AI-HANDOFF.json handoffNotes.${field} must be an array of non-empty strings.` };
  return { ok:true, message:'Structured AI development plan is takeover-ready.' };
}

const HANDOFF_SECTION_HEADING = '## Shared AI handoff';

function validateDevlogChainOfCustody(content) {
  if (typeof content !== 'string' || !content.includes(HANDOFF_SECTION_HEADING)) {
    return { ok:false, message:'DEVLOG.md must have a "## Shared AI handoff" section.' };
  }
  const section = content.split(HANDOFF_SECTION_HEADING)[1].split(/\n##\s/)[0];
  if (!/dev plan/i.test(section) || !/AI-HANDOFF\.json/.test(section)) {
    return { ok:false, message:'DEVLOG.md\'s Shared AI handoff section must reference the dev plan in AI-HANDOFF.json (activePlan.currentPrompt, handoffNotes.completed/remaining) instead of restating it independently.' };
  }
  if (!/command log/i.test(section)) {
    return { ok:false, message:'DEVLOG.md\'s Shared AI handoff section must include a Command log: every command run for this unit of work, chain-of-custody style.' };
  }
  if (!/\bstart(?:ed)?\b[\s\S]*?\bfinish(?:ed)?\b/i.test(section)) {
    return { ok:false, message:'DEVLOG.md\'s Command log entries must record both a start time and a finish time for each command.' };
  }
  return { ok:true, message:'DEVLOG.md references the dev plan and includes a command chain-of-custody log.' };
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
  const changed = evaluateHandoffChanges(result.stdout.split(/\r?\n/));
  if (!changed.ok) return changed;
  const planResult = run('git', ['show', `${headSha}:AI-HANDOFF.json`], { encoding:'utf8', shell:false });
  if (planResult.status !== 0) return { ok:false, message:'Unable to read AI-HANDOFF.json from the head commit.' };
  let plan;
  try { plan = JSON.parse(planResult.stdout); }
  catch (error) { return { ok:false, message:`AI-HANDOFF.json is invalid JSON: ${error.message}` }; }
  const planResultCheck = validateHandoffPlan(plan);
  if (!planResultCheck.ok) return planResultCheck;
  const devlogResult = run('git', ['show', `${headSha}:DEVLOG.md`], { encoding:'utf8', shell:false });
  if (devlogResult.status !== 0) return { ok:false, message:'Unable to read DEVLOG.md from the head commit.' };
  return validateDevlogChainOfCustody(devlogResult.stdout);
}

if (require.main === module) {
  const result = checkHandoffRange(process.env.HANDOFF_BASE_SHA || '', process.env.HANDOFF_HEAD_SHA || '');
  console.log(`[AI handoff policy] ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = { evaluateHandoffChanges, validateHandoffPlan, validateDevlogChainOfCustody, checkHandoffRange };
