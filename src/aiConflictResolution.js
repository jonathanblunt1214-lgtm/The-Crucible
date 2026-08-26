function evaluateAIConflict({ conflictDetected, contestedMutation, ownerResolution, handoffUpdated }) {
  if (!conflictDetected) return { ok: true, decision: 'proceed', message: 'No conflicting instruction or active work was identified.' };
  if (!handoffUpdated) return { ok: false, decision: 'preserve-and-escalate', message: 'Record both sides of the AI conflict in the shared handoff before continuing.' };
  if (contestedMutation && !ownerResolution) return { ok: false, decision: 'preserve-and-escalate', message: 'Refusing the contested mutation until the repository owner explicitly resolves this conflict.' };
  if (!ownerResolution) return { ok: true, decision: 'report-only', message: 'Conflict preserved and reported. Do not perform a contested mutation without explicit owner resolution.' };
  return { ok: true, decision: 'owner-resolved', message: 'The recorded conflict has an explicit repository-owner resolution.' };
}

if (require.main === module) {
  const result = evaluateAIConflict({
    conflictDetected: process.env.CRUCIBLE_AI_CONFLICT === 'true',
    contestedMutation: process.env.CRUCIBLE_CONTESTED_MUTATION === 'true',
    ownerResolution: (process.env.CRUCIBLE_OWNER_RESOLUTION || '').trim(),
    handoffUpdated: process.env.CRUCIBLE_HANDOFF_UPDATED === 'true'
  });
  console.log(`[AI conflict resolution] ${result.decision}: ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = { evaluateAIConflict };
