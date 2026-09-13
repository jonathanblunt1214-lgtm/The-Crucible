// Picking up where another AI stopped.
//
// The failure this prevents is specific and expensive: an agent arrives, finds the repository in
// a state it does not recognise, decides the fastest route is to start over, and overwrites work
// a predecessor already finished and verified. It looks like progress and it is destruction.
//
// The division of labour, which the rest of this file exists to keep honest:
//
//   Continuation inspection  - where work stopped.
//   Mutation claims          - what this agent owns.
//   AI-CONFLICTS.json        - which scope is frozen, and only that scope.
//   Governance gates         - whether mutation may proceed at all.
//   DEVLOG.md                - what already happened.
//
// A global lock would be far easier to write than scoped freezing, and it would be wrong: it
// converts one disputed file into a stopped project, which is precisely the outcome that makes
// agents start ignoring the governance instead of using it.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { crucibleError } = require('./failureCodes');
const { activeClaims, contestedScopes, auditMutationClaims, scopesOverlap, ownerLabel, sameOwner, normalizeScopePath } = require('./mutationClaims');
const { auditAIConflictLedger } = require('./aiConflictLedger');

const DEFAULT_GOVERNANCE_CHECKS = Object.freeze(['audit:coordination', 'audit:ai-conflict-governance']);
const SESSION_HEADING = /^### Session: (.+?) — (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) — (.+)$/gm;

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw crucibleError('CRU-0037', `${path.basename(file)} could not be parsed, so the governed state cannot be read: ${error.message}`); }
}

function gitState(root) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = git(root, ['status', '--porcelain']);
  // Porcelain paths can be quoted or renamed ("R  old -> new"); take the destination path.
  const uncommitted = status ? status.split(/\r?\n/).filter(Boolean).map((line) => {
    const value = line.slice(3).trim();
    const arrow = value.indexOf(' -> ');
    return normalizeScopePath((arrow >= 0 ? value.slice(arrow + 4) : value).replace(/^"|"$/g, ''));
  }) : [];
  return { head, branch, clean: uncommitted.length === 0, uncommitted };
}

// Where the predecessor actually stopped. Steps in this repository are plain strings, so the
// structured forms are tried first and the string list is the documented legacy fallback rather
// than the primary path.
function resolveCurrentStep(active) {
  if (!active || typeof active !== 'object') return { currentStep: null, source: 'none', stepCount: 0 };
  const steps = Array.isArray(active.steps) ? active.steps : [];
  const label = (step) => (typeof step === 'string' ? step : (step && (step.text || step.step || step.summary)) || null);

  if (typeof active.currentStep === 'string' && active.currentStep.trim()) return { currentStep: active.currentStep, source: 'explicit', stepCount: steps.length };
  const inProgress = steps.find((step) => step && typeof step === 'object' && ['in-progress', 'in_progress', 'active', 'started'].includes(step.status));
  if (inProgress) return { currentStep: label(inProgress), source: 'in-progress', stepCount: steps.length };
  const unfinished = steps.find((step) => step && typeof step === 'object' && !['done', 'complete', 'completed', 'finished'].includes(step.status));
  if (unfinished) return { currentStep: label(unfinished), source: 'first-unfinished', stepCount: steps.length };
  // Legacy: an ordered list of strings with no status, where the last entry is the newest record.
  if (steps.length) return { currentStep: label(steps[steps.length - 1]), source: 'legacy-last-step', stepCount: steps.length };
  return { currentStep: null, source: 'none', stepCount: 0 };
}

function inspectHandoff(root) {
  const plan = readJson(path.join(root, 'AI-HANDOFF.json'));
  if (!plan) return { present: false, objective: null, status: null, currentStep: null, currentStepSource: 'none', stepCount: 0, claims: [], blockers: [], nextActions: [], completed: [], verification: [] };
  const active = plan.activePlan || {};
  const notes = plan.handoffNotes || {};
  const step = resolveCurrentStep(active);
  return {
    present: true,
    agent: active.agent || null,
    objective: active.objective || null,
    status: active.status || null,
    currentStep: step.currentStep,
    currentStepSource: step.source,
    stepCount: step.stepCount,
    claims: Array.isArray(plan.mutationClaims) ? plan.mutationClaims : [],
    completed: Array.isArray(notes.completed) ? notes.completed : [],
    verification: Array.isArray(notes.verification) ? notes.verification : [],
    nextActions: Array.isArray(notes.remaining) ? notes.remaining : [],
    blockers: Array.isArray(notes.open) ? notes.open : [],
  };
}

// A conflict awaits the owner only when the record says so. Inferring it from "open" would label
// every ordinary AI-to-AI disagreement an owner escalation, which both misreports the state and
// trains the owner to ignore the flag.
function awaitsOwner(conflict) {
  if (conflict.escalatedToOwner === true) return true;
  if (conflict.deliberation && conflict.deliberation.corroboration && conflict.deliberation.corroboration.escalatedToOwner === true) return true;
  if (conflict.resolution && typeof conflict.resolution.decision === 'string' && /owner/i.test(conflict.resolution.decision) && !conflict.resolution.decidedBy) return true;
  return false;
}

// A conflict that names no scope freezes everything. That is not laziness, it is the safe reading:
// a record that does not say what is disputed gives no basis for deciding what is safe, so the
// conservative answer is "all of it" until someone narrows it. A record CAN say so explicitly with
// repositoryWide, and one that names a scope freezes only that scope.
function freezeKind(conflict) {
  if (conflict.repositoryWide === true) return 'repository-wide';
  if (conflict.contestedScope && (Array.isArray(conflict.contestedScope.paths) || Array.isArray(conflict.contestedScope.regions))) return 'scoped';
  return 'repository-wide';
}

function inspectConflicts(root) {
  const ledger = readJson(path.join(root, 'AI-CONFLICTS.json'));
  const conflicts = ledger && Array.isArray(ledger.conflicts) ? ledger.conflicts : [];
  const audit = auditAIConflictLedger(root);
  const open = conflicts.filter((conflict) => conflict && conflict.status === 'open');
  const classified = open.map((conflict) => ({
    id: conflict.id,
    contestedAction: conflict.contestedAction || null,
    freeze: freezeKind(conflict),
    contestedScope: conflict.contestedScope || null,
    awaitingOwner: awaitsOwner(conflict),
  }));
  return {
    present: Boolean(ledger),
    total: conflicts.length,
    open: classified,
    // Still open for AI-to-AI deliberation: nobody has escalated it yet.
    inDeliberation: classified.filter((item) => !item.awaitingOwner),
    awaitingOwner: classified.filter((item) => item.awaitingOwner),
    repositoryWideStops: classified.filter((item) => item.freeze === 'repository-wide'),
    frozenScopes: contestedScopes(conflicts),
    findings: audit.findings,
  };
}

function inspectDevlog(root) {
  const file = path.join(root, 'DEVLOG.md');
  if (!fs.existsSync(file)) return { present: false, sessions: 0, latest: null, order: 'none' };
  const content = fs.readFileSync(file, 'utf8');
  const entries = [...content.matchAll(SESSION_HEADING)].map((match, index) => ({ index, title: match[1], at: match[2], rest: match[3] }));
  if (!entries.length) return { present: true, sessions: 0, latest: null, order: 'none' };
  // The convention in this repository is newest-first, but the latest entry is chosen by timestamp
  // rather than by position, so a change of convention cannot silently make this report the oldest
  // session as the newest one.
  const latest = entries.reduce((newest, entry) => (Date.parse(entry.at) > Date.parse(newest.at) ? entry : newest), entries[0]);
  const order = entries.length < 2 ? 'single' : (Date.parse(entries[0].at) >= Date.parse(entries[entries.length - 1].at) ? 'newest-first' : 'append-only');
  return { present: true, sessions: entries.length, latest: `${latest.title} — ${latest.at} — ${latest.rest}`, latestAt: latest.at, order };
}

function runCheck(root, script) {
  const result = spawnSync('npm', ['run', '--silent', script], { cwd: root, encoding: 'utf8' });
  return { script, ok: result.status === 0, detail: String(result.stdout || result.stderr || '').trim().split(/\r?\n/).slice(-1)[0] || '' };
}

// Reading may skip these; they are slow. Mutating may not, and the difference is represented in
// the report rather than left to the caller's memory.
function inspectGovernance(root, { runChecks = false, checks = DEFAULT_GOVERNANCE_CHECKS } = {}) {
  if (!runChecks) {
    return { ran: false, verified: false, checks: [], note: `Governance checks were skipped, so this inspection is read-only. Re-run with runChecks to verify: ${checks.join(', ')}.` };
  }
  const results = checks.map((script) => runCheck(root, script));
  const allPassed = results.every((item) => item.ok);
  return { ran: true, verified: allPassed, allPassed, checks: results };
}

function inspectForContinuation(root, options = {}) {
  const gitInfo = gitState(root);
  const handoff = inspectHandoff(root);
  const conflicts = inspectConflicts(root);
  const devlog = inspectDevlog(root);
  const governance = inspectGovernance(root, options);
  const claimAudit = auditMutationClaims(handoff.claims);

  // Blockers stop everything. Only genuinely repository-wide conditions belong here; a dispute
  // over one file is a frozen scope, checked per-mutation, not a blocker.
  const blockers = [];
  if (!handoff.present) blockers.push('AI-HANDOFF.json is missing, so there is no takeover-ready plan to continue from.');
  if (claimAudit.findings.length) blockers.push(`Mutation claims are inconsistent: ${claimAudit.findings.map((item) => item.detail).join(' ')}`);
  for (const stop of conflicts.repositoryWideStops) blockers.push(`Conflict ${stop.id} freezes the whole repository${stop.contestedScope ? '' : ' because it names no contestedScope'}${stop.awaitingOwner ? ' and awaits a repository-owner decision' : ''}.`);
  if (governance.ran && !governance.allPassed) blockers.push(`Governance checks failed: ${governance.checks.filter((item) => !item.ok).map((item) => item.script).join(', ')}.`);

  const inspectionComplete = handoff.present && conflicts.present;
  const governanceVerified = governance.verified === true;

  return {
    resumeFrom: gitInfo.head,
    branch: gitInfo.branch,
    git: gitInfo,
    handoff,
    conflicts,
    devlog,
    governance,
    heldScopes: activeClaims(handoff.claims).map((claim) => ({ taskId: claim.taskId, owner: ownerLabel(claim.owner), scope: claim.scope })),
    frozenScopes: conflicts.frozenScopes,
    // A predecessor's uncommitted work. Never discarded; overlap with it is checked per-mutation.
    uncommittedPaths: gitInfo.uncommitted,
    blockers,
    inspectionComplete,
    governanceVerified,
    // Mutation needs all three. Reading needs none of them.
    mayMutate: inspectionComplete && governanceVerified && blockers.length === 0,
    // Reading, testing and reviewing are always available, including on frozen and claimed scopes.
    mayInvestigate: true,
    nextActions: handoff.nextActions,
  };
}

// General readiness: the actor has read the state, the gates are verified, nothing repository-wide
// is stopping work. This does NOT authorise any particular change - see assertMutationAllowed.
function assertReadyToContinue(report, { actor } = {}) {
  if (!report || typeof report !== 'object') throw crucibleError('CRU-0037', 'Continuation requires an inspection report. Read the governed state before changing anything.');
  if (!report.inspectionComplete) throw crucibleError('CRU-0037', `${ownerLabel(actor)} has not read the governed state: AI-HANDOFF.json and AI-CONFLICTS.json must both be present and readable before mutating.`);
  if (!report.governanceVerified) {
    throw crucibleError('CRU-0037', `${ownerLabel(actor)} may not mutate: governance checks were not verified in this inspection. ${report.governance.note || 'Re-run the inspection with governance checks enabled.'} Read-only investigation, testing and review remain available.`);
  }
  if (report.blockers.length) {
    throw crucibleError('CRU-0037', `${ownerLabel(actor)} may not begin mutating yet:\n${report.blockers.map((item) => `- ${item}`).join('\n')}\nRead-only investigation, testing and review remain available throughout.`);
  }
  return { ready: true, resumeFrom: report.resumeFrom };
}

// The mutation entry point. Ownership is proved here rather than assumed, because "subject to
// claiming the scope first" in a comment is not an enforcement mechanism.
function assertMutationAllowed(report, { actor, taskId, paths = [] } = {}) {
  assertReadyToContinue(report, { actor });
  const targets = (Array.isArray(paths) ? paths : []).map(normalizeScopePath).filter(Boolean);
  if (!targets.length) throw crucibleError('CRU-0030', 'A mutation must name the paths it will change, so ownership of them can be proved.');

  for (const target of targets) {
    // Frozen scope: only the contested mutation stops, and only for scoped conflicts (a
    // repository-wide stop already appeared as a blocker above).
    for (const contested of report.frozenScopes) {
      if (scopesOverlap(contested.scope, { paths: [target] })) {
        throw crucibleError('CRU-0031', `${target} is frozen by unresolved AI conflict ${contested.id}. Read, test, review and propose against it freely; do not mutate it until the owner resolves the conflict. Unrelated scopes are unaffected.`);
      }
    }

    // A predecessor's uncommitted change to this exact path is work in progress. Overlapping it is
    // refused; unrelated uncommitted work elsewhere is left alone and does not block this change.
    if (report.uncommittedPaths.some((dirty) => scopesOverlap({ paths: [dirty] }, { paths: [target] }))) {
      throw crucibleError('CRU-0037', `${target} has uncommitted changes from a previous agent. That is work in progress and is never discarded or reset: commit it, or coordinate a handoff, before mutating this path. Unrelated uncommitted paths do not block this change.`);
    }

    // Ownership: an active claim, held by this actor, covering this path.
    const holder = activeClaims(report.handoff.claims).find((claim) => scopesOverlap(claim.scope, { paths: [target] }));
    if (!holder) throw crucibleError('CRU-0030', `${target} is not covered by any active mutation claim. Acquire a claim for it before mutating; read, test and review need no claim.`);
    if (!sameOwner(holder.owner, actor)) throw crucibleError('CRU-0030', `${target} is exclusively claimed by ${ownerLabel(holder.owner)} under task ${holder.taskId}. ${ownerLabel(actor)} may read, test, review, critique and propose changes to it, but may not mutate it until ownership is explicitly released or handed off.`);
    if (taskId && holder.taskId !== taskId) throw crucibleError('CRU-0030', `${target} is claimed under task ${holder.taskId}, not ${taskId}.`);
  }
  return { allowed: true, paths: targets };
}

function formatContinuationReport(report) {
  const lines = [];
  lines.push(`Resume from ${report.resumeFrom || 'unknown commit'} on ${report.branch || 'unknown branch'} (${report.git.clean ? 'clean tree' : `${report.git.uncommitted.length} uncommitted path(s), preserved`}).`);
  lines.push(`Plan: ${report.handoff.objective || 'none recorded'} [${report.handoff.status || 'no status'}], ${report.handoff.stepCount} step(s).`);
  lines.push(`Stopped at (${report.handoff.currentStepSource}): ${report.handoff.currentStep || 'none recorded'}`);
  lines.push(`DEVLOG: ${report.devlog.sessions} session(s), ${report.devlog.order}; latest ${report.devlog.latest || 'none'}.`);
  lines.push(`Conflicts: ${report.conflicts.total} recorded, ${report.conflicts.open.length} open (${report.conflicts.inDeliberation.length} in AI deliberation, ${report.conflicts.awaitingOwner.length} awaiting the owner, ${report.conflicts.repositoryWideStops.length} repository-wide).`);
  lines.push(`Claimed scopes: ${report.heldScopes.length ? report.heldScopes.map((item) => `${item.taskId} (${item.owner})`).join(', ') : 'none'}.`);
  lines.push(`Frozen scopes: ${report.frozenScopes.length ? report.frozenScopes.map((item) => item.id).join(', ') : 'none'}.`);
  lines.push(`Inspection complete: ${report.inspectionComplete}. Governance verified: ${report.governanceVerified}.`);
  lines.push(report.mayMutate ? 'May mutate: yes, for scopes this agent has claimed.' : `May mutate: no.\n${(report.blockers.length ? report.blockers : [report.governanceVerified ? 'inspection incomplete' : 'governance not verified']).map((item) => `  - ${item}`).join('\n')}`);
  lines.push('Read, test, review and propose: always allowed, including on claimed and frozen scopes.');
  return lines.join('\n');
}

module.exports = {
  DEFAULT_GOVERNANCE_CHECKS,
  gitState, resolveCurrentStep, awaitsOwner, freezeKind,
  inspectHandoff, inspectConflicts, inspectDevlog, inspectGovernance,
  inspectForContinuation, assertReadyToContinue, assertMutationAllowed, formatContinuationReport,
};
