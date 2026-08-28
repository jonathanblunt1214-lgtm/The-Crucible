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
  const executionMode = active.executionMode;
  if (!executionMode || typeof executionMode !== 'object' || Array.isArray(executionMode)) return { ok:false, message:'AI-HANDOFF.json activePlan.executionMode is required.' };
  if (!['regular/default', 'work'].includes(executionMode.mode)) return { ok:false, message:'AI-HANDOFF.json activePlan.executionMode.mode must be regular/default or work.' };
  for (const field of ['purpose', 'selectionReason']) if (typeof executionMode[field] !== 'string' || !executionMode[field].trim()) return { ok:false, message:`AI-HANDOFF.json activePlan.executionMode.${field} is required.` };
  if (executionMode.agent !== active.agent) return { ok:false, message:'AI-HANDOFF.json activePlan.executionMode.agent must identify the agent that used the recorded mode.' };
  if (typeof executionMode.distinction !== 'string' || !/agent/i.test(executionMode.distinction) || !/workflow/i.test(executionMode.distinction)) return { ok:false, message:'AI-HANDOFF.json activePlan.executionMode.distinction must explain that execution mode is separate from agent identity and workflow.' };
  if (!['active', 'handoff-ready', 'complete'].includes(active.status)) return { ok:false, message:'AI-HANDOFF.json activePlan.status must be active, handoff-ready, or complete.' };
  if (!Array.isArray(active.steps) || !active.steps.length || active.steps.some((step) => typeof step !== 'string' || !step.trim())) return { ok:false, message:'AI-HANDOFF.json activePlan.steps must contain the ordered development plan.' };
  const notes = plan.handoffNotes;
  if (!notes || typeof notes !== 'object') return { ok:false, message:'AI-HANDOFF.json requires handoffNotes.' };
  for (const field of ['completed', 'verification', 'remaining']) if (!Array.isArray(notes[field]) || notes[field].some((item) => typeof item !== 'string' || !item.trim())) return { ok:false, message:`AI-HANDOFF.json handoffNotes.${field} must be an array of non-empty strings.` };
  return { ok:true, message:'Structured AI development plan is takeover-ready.' };
}

const HANDOFF_SECTION_HEADING = '## Shared AI handoff';
const ARCHIVE_SECTION_HEADING = '## Command log archive';
const ARCHIVE_ENTRY_HEADING = /^### Session: /m;
const ARCHIVE_ENTRY_TIMESTAMP = /^### Session: .+? — (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) — .+$/gm;
const MAX_ARCHIVE_SESSIONS = 10;
const MAX_ARCHIVE_AGE_DAYS = 180;

function extractSection(content, headingText) {
  const escaped = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}.*$`, 'm').exec(content);
  if (!match) return null;
  return content.slice(match.index + match[0].length).split(/\n##\s/)[0];
}

function validateDevlogChainOfCustody(content, now = new Date()) {
  if (typeof content !== 'string') {
    return { ok:false, message:'DEVLOG.md must have a "## Shared AI handoff" section.' };
  }
  const handoffSection = extractSection(content, HANDOFF_SECTION_HEADING);
  if (handoffSection === null) {
    return { ok:false, message:'DEVLOG.md must have a "## Shared AI handoff" section.' };
  }
  if (!/dev plan/i.test(handoffSection) || !/AI-HANDOFF\.json/.test(handoffSection)) {
    return { ok:false, message:'DEVLOG.md\'s Shared AI handoff section must reference the dev plan in AI-HANDOFF.json (activePlan.currentPrompt, handoffNotes.completed/remaining) instead of restating it independently.' };
  }
  const archiveSection = extractSection(content, ARCHIVE_SECTION_HEADING);
  if (archiveSection === null) {
    return { ok:false, message:'DEVLOG.md must have a "## Command log archive" section: the chain-of-custody record of the most recent sessions.' };
  }
  const entries = archiveSection.match(new RegExp(ARCHIVE_ENTRY_HEADING, 'gm')) || [];
  if (entries.length === 0) {
    return { ok:false, message:'DEVLOG.md\'s Command log archive must include at least one "### Session:" entry for the current session.' };
  }
  if (entries.length > MAX_ARCHIVE_SESSIONS) {
    return { ok:false, message:`DEVLOG.md's Command log archive holds ${entries.length} sessions - prune the oldest down to ${MAX_ARCHIVE_SESSIONS} or fewer before pushing.` };
  }
  const maxAgeMs = MAX_ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000;
  const timestampPattern = new RegExp(ARCHIVE_ENTRY_TIMESTAMP);
  let timestampMatch;
  while ((timestampMatch = timestampPattern.exec(archiveSection))) {
    const entryDate = new Date(timestampMatch[1]);
    if (!Number.isNaN(entryDate.getTime()) && now.getTime() - entryDate.getTime() > maxAgeMs) {
      return { ok:false, message:`DEVLOG.md's Command log archive has a session from ${timestampMatch[1]}, older than the ${MAX_ARCHIVE_AGE_DAYS}-day backup limit - prune it before pushing, even though the archive is within the ${MAX_ARCHIVE_SESSIONS}-session cap.` };
    }
  }
  const newestEntry = archiveSection.split(/^### Session: /m)[1] || '';
  if (!/\bstart(?:ed)?\b[\s\S]*?\bfinish(?:ed)?\b/i.test(newestEntry)) {
    return { ok:false, message:'DEVLOG.md\'s newest Command log archive entry must record both a start time and a finish time for each command.' };
  }
  return { ok:true, message:`DEVLOG.md references the dev plan and maintains a command chain-of-custody archive (${entries.length}/${MAX_ARCHIVE_SESSIONS} sessions, none older than ${MAX_ARCHIVE_AGE_DAYS} days).` };
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

module.exports = { evaluateHandoffChanges, validateHandoffPlan, validateDevlogChainOfCustody, checkHandoffRange, MAX_ARCHIVE_SESSIONS, MAX_ARCHIVE_AGE_DAYS };
