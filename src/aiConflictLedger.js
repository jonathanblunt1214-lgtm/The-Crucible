const fs = require('node:fs');
const path = require('node:path');
const { validateDeliberation } = require('./multiAiDeliberation');
const { coordinationGate } = require('./coordinationGate');
const { scopesOverlap } = require('./mutationClaims');
const LEDGER_PATH = 'AI-CONFLICTS.json';
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function finding(type, detail) { return { type, path:LEDGER_PATH, detail }; }
function auditAIConflictLedger(root) {
  const target = path.join(root, LEDGER_PATH);
  if (!fs.existsSync(target)) return { files:0, conflicts:0, findings:[finding('AI conflict ledger missing', `${LEDGER_PATH} is mandatory for governance.`)] };
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) { return { files:1, conflicts:0, findings:[finding('AI conflict ledger invalid JSON', error.message)] }; }
  const findings = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) findings.push(finding('AI conflict ledger invalid', 'The ledger root must be an object.'));
  if (ledger?.schemaVersion !== 1) findings.push(finding('AI conflict ledger invalid', 'schemaVersion must be 1.'));
  if (!Array.isArray(ledger?.conflicts)) findings.push(finding('AI conflict ledger invalid', 'conflicts must be an array.'));
  if (findings.length) return { files:1, conflicts:0, findings };
  const ids = new Set();
  for (const [index, conflict] of ledger.conflicts.entries()) {
    const label = `conflicts[${index}]`;
    if (!conflict || typeof conflict !== 'object' || Array.isArray(conflict)) { findings.push(finding('AI conflict record invalid', `${label} must be an object.`)); continue; }
    if (!ID_PATTERN.test(conflict.id || '')) findings.push(finding('AI conflict record invalid', `${label}.id must be a stable lowercase identifier.`));
    else if (ids.has(conflict.id)) findings.push(finding('AI conflict record invalid', `${label}.id duplicates ${conflict.id}.`));
    else ids.add(conflict.id);
    if (!['open', 'resolved'].includes(conflict.status)) findings.push(finding('AI conflict record invalid', `${label}.status must be open or resolved.`));
    if (typeof conflict.contestedAction !== 'string' || !conflict.contestedAction.trim()) findings.push(finding('AI conflict record invalid', `${label}.contestedAction is required.`));
    if (typeof conflict.rationaleSummary !== 'string' || !conflict.rationaleSummary.trim()) findings.push(finding('AI conflict disclosure incomplete', `${label}.rationaleSummary is required.`));
    if (!Array.isArray(conflict.evidence) || !conflict.evidence.length || conflict.evidence.some((item) => typeof item !== 'string' || !item.trim())) findings.push(finding('AI conflict disclosure incomplete', `${label}.evidence must contain at least one disclosed evidence item.`));
    if (!Array.isArray(conflict.alternatives) || conflict.alternatives.length < 2 || conflict.alternatives.some((item) => typeof item !== 'string' || !item.trim())) findings.push(finding('AI conflict disclosure incomplete', `${label}.alternatives must preserve at least two considered options.`));
    if (!Array.isArray(conflict.sides) || conflict.sides.length < 2) findings.push(finding('AI conflict record invalid', `${label}.sides must preserve at least two conflicting directions.`));
    else for (const [sideIndex, side] of conflict.sides.entries()) if (!side || typeof side.source !== 'string' || !side.source.trim() || typeof side.instruction !== 'string' || !side.instruction.trim()) findings.push(finding('AI conflict record invalid', `${label}.sides[${sideIndex}] requires source and instruction.`));
    // Multi-AI deliberation lives on the conflict record itself - there is deliberately no
    // AI-DELIBERATION.json, because a disagreement and the discussion settling it are one object
    // and two files would drift apart. The block is optional so records predating multi-AI
    // coordination keep validating, but it is validated in full whenever present.
    for (const message of validateDeliberation(conflict.deliberation, `${label}.deliberation`)) findings.push(finding('AI deliberation record invalid', message));
    // A conflict may name the exact scope it freezes. Freezing only the contested mutation is
    // what lets every other scope, and all read-only work, keep moving during a disagreement.
    if (conflict.contestedScope !== undefined) {
      const scope = conflict.contestedScope;
      if (!scope || typeof scope !== 'object' || Array.isArray(scope) || !scopesOverlap(scope, scope)) findings.push(finding('AI conflict record invalid', `${label}.contestedScope must name at least one path or code region that the conflict freezes.`));
    }
    if (conflict.status === 'open') findings.push(finding('Unresolved AI conflict', `${conflict.id || label}: ${conflict.contestedAction || 'contested mutation'}`));
    if (conflict.status === 'resolved') {
      const resolution = conflict.resolution;
      if (!resolution || typeof resolution.decision !== 'string' || !resolution.decision.trim() || typeof resolution.rationaleSummary !== 'string' || !resolution.rationaleSummary.trim() || resolution.decidedBy !== 'repository-owner' || !DATE_PATTERN.test(resolution.decidedAt || '')) findings.push(finding('AI conflict resolution invalid', `${conflict.id || label} requires decision, rationaleSummary, decidedBy "repository-owner", and decidedAt YYYY-MM-DD.`));
    }
  }
  return { files:1, conflicts:ledger.conflicts.length, findings };
}
// `coordinationGate` is implemented in its own module and re-exported here, rather than imported
// straight into cli.js. Multi-AI coordination IS AI governance - mutation ownership, deliberation
// and accountability are three views of the same property this ledger exists to protect - and
// this module is already the brain's AI-governance surface for the command line. Routing through
// it carries more over the existing cable instead of running a second one between the same two
// organs, which is exactly what the fly-by-wire ratchet in circulationLinkage.js forbids.
module.exports = { LEDGER_PATH, auditAIConflictLedger, coordinationGate };
