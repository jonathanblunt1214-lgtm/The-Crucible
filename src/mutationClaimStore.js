// Persisting exclusive mutation ownership into AI-HANDOFF.json.
//
// The in-memory rules live in mutationClaims.js. This is the part that makes them durable, and
// therefore the part that makes them real: a lock that exists only inside one agent's process is
// not a lock, because the second agent is a different process and never sees it.
//
// Every write goes through the same audit the gate uses. That is deliberate - the file is the
// only shared state between agents, so a write that leaves it inconsistent has broken the
// mechanism for everyone, not just the writer.
const fs = require('node:fs');
const path = require('node:path');
const { crucibleError } = require('./failureCodes');
const { acquireClaim, releaseClaim, handOffClaim, auditMutationClaims, activeClaims, ownerLabel } = require('./mutationClaims');

const HANDOFF_PATH = 'AI-HANDOFF.json';

function handoffFile(root) {
  return path.join(root, HANDOFF_PATH);
}

function readPlan(root) {
  const file = handoffFile(root);
  if (!fs.existsSync(file)) throw crucibleError('CRU-0029', `${HANDOFF_PATH} does not exist, so mutation ownership cannot be recorded. It is the shared state every agent reads.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw crucibleError('CRU-0029', `${HANDOFF_PATH} is not valid JSON: ${error.message}`); }
}

// Written with a trailing newline and two-space indent to match the file as it is already
// committed, so a claim never shows up in a diff as a whole-file reformat.
function writePlan(root, plan) {
  const audit = auditMutationClaims(plan.mutationClaims || []);
  if (audit.findings.length) throw crucibleError('CRU-0029', `Refusing to write an inconsistent claim list: ${audit.findings.map((item) => item.detail).join(' ')}`);
  fs.writeFileSync(handoffFile(root), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function listClaims(root) {
  const plan = readPlan(root);
  const claims = Array.isArray(plan.mutationClaims) ? plan.mutationClaims : [];
  return { claims, active: activeClaims(claims) };
}

function acquire(root, claim) {
  const plan = readPlan(root);
  plan.mutationClaims = acquireClaim(plan.mutationClaims || [], claim);
  writePlan(root, plan);
  return { acquired: claim.taskId, owner: ownerLabel(claim.owner), scope: claim.scope };
}

function release(root, taskId, releasedAt = new Date().toISOString()) {
  const plan = readPlan(root);
  plan.mutationClaims = releaseClaim(plan.mutationClaims || [], taskId, releasedAt);
  writePlan(root, plan);
  return { released: taskId, releasedAt };
}

function handOff(root, taskId, options) {
  const plan = readPlan(root);
  plan.mutationClaims = handOffClaim(plan.mutationClaims || [], taskId, { at: new Date().toISOString(), ...options });
  writePlan(root, plan);
  return { handedOff: taskId, to: ownerLabel(options.to), successor: options.taskId || `${taskId}-handoff` };
}

module.exports = { HANDOFF_PATH, readPlan, writePlan, listClaims, acquire, release, handOff };
