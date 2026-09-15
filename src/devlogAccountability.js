// What each AI actually did, in the permanent record.
//
// The governance split this enforces:
//
//   AI-HANDOFF.json  - future intent: the plan, the claims, who owns what next.
//   DEVLOG.md        - past fact: what was actually done, by whom, with what result.
//   AI-CONFLICTS.json - disagreement: competing proposals and how they were settled.
//
// DEVLOG is therefore never a plan. A bullet saying an AI "will refactor the extractor" is a
// category error: it belongs in the handoff, and putting it in the log makes the historical
// record unfalsifiable, since nothing that has not happened can be wrong.
//
// The mechanical rule is narrow on purpose: every mutation claim that has actually mutated
// something - anything past `active` - must be findable in DEVLOG.md by its taskId. That is
// checkable without parsing prose, and it closes the gap that matters: an AI took exclusive
// ownership of a scope, changed it, released it, and left nothing behind saying so.
const { crucibleError } = require('./failureCodes');

// The identifying fields a material action should carry. Not every one applies to every action -
// a review changes no files - so the required set is small and the rest are recorded when known.
const REQUIRED_ACTION_FIELDS = Object.freeze(['provider', 'taskId', 'timestamp', 'role', 'action', 'repositoryStateChanged']);
const OPTIONAL_ACTION_FIELDS = Object.freeze([
  'model', 'agent', 'filesExamined', 'filesChanged', 'testsRun', 'results',
  'commits', 'evidence', 'disagreements', 'handoffState',
]);
const ROLES = Object.freeze(['mutator', 'reviewer', 'investigator', 'tester', 'proposer']);
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateAccountabilityRecord(record, label = 'accountability record') {
  const findings = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [`${label} must be an object.`];
  for (const field of REQUIRED_ACTION_FIELDS) {
    if (field === 'repositoryStateChanged') {
      if (typeof record.repositoryStateChanged !== 'boolean') findings.push(`${label}.repositoryStateChanged must be true or false - "did this change the repository" is never left blank.`);
      continue;
    }
    if (!nonEmpty(record[field])) findings.push(`${label}.${field} is required.`);
  }
  if (record.timestamp !== undefined && nonEmpty(record.timestamp) && !ISO_PATTERN.test(record.timestamp)) findings.push(`${label}.timestamp must be an ISO-8601 UTC timestamp.`);
  if (record.role !== undefined && nonEmpty(record.role) && !ROLES.includes(record.role)) findings.push(`${label}.role must be one of ${ROLES.join(', ')}.`);
  for (const field of ['filesExamined', 'filesChanged', 'testsRun', 'commits', 'evidence', 'disagreements']) {
    if (record[field] !== undefined && (!Array.isArray(record[field]) || record[field].some((item) => !nonEmpty(item)))) findings.push(`${label}.${field} must be an array of non-empty strings.`);
  }
  // A mutation that claims to have changed nothing, or a no-op that claims to have changed
  // files, is a record that will mislead whoever reads it next.
  if (record.repositoryStateChanged === true && (!Array.isArray(record.filesChanged) || !record.filesChanged.length)) findings.push(`${label} says the repository changed but lists no filesChanged.`);
  if (record.repositoryStateChanged === false && Array.isArray(record.filesChanged) && record.filesChanged.length) findings.push(`${label} lists changed files but says the repository did not change.`);
  return findings;
}

function assertAccountabilityRecord(record, label) {
  const findings = validateAccountabilityRecord(record, label);
  if (findings.length) throw crucibleError('CRU-0035', findings.join(' '));
  return { ok: true };
}

// Claims that have actually mutated something. An `active` claim may legitimately have produced
// no work yet, so it is not required to appear in the log; anything released or handed off has
// had its turn and must have left a record.
function materialClaims(claims) {
  return (Array.isArray(claims) ? claims : []).filter((claim) => claim && (claim.status === 'released' || claim.status === 'handed-off'));
}

function auditDevlogAccountability({ devlog = '', claims = [] } = {}) {
  const content = String(devlog || '');
  const findings = [];
  for (const claim of materialClaims(claims)) {
    if (!nonEmpty(claim.taskId)) continue;
    if (!content.includes(claim.taskId)) {
      findings.push({
        type: 'DEVLOG accountability missing',
        detail: `Mutation claim ${claim.taskId} (${claim.owner && claim.owner.provider ? claim.owner.provider : 'unknown provider'}) is ${claim.status} but does not appear in DEVLOG.md. An AI that took exclusive ownership of a scope and gave it back must record what it did there.`,
      });
    }
  }
  return { claims: materialClaims(claims).length, findings };
}

// DEVLOG is the record of what happened. Future-tense planning language in a session entry is
// the one prose check worth making mechanically, because it is the failure that quietly turns
// the historical record into a second, competing plan.
const FUTURE_TENSE = Object.freeze([
  /\bwill (?:now )?(?:add|implement|refactor|fix|update|create|remove|migrate)\b/i,
  /\bplan(?:s|ned)? to\b/i,
  /\bnext session (?:will|should)\b/i,
  /\bTODO:/,
]);

function findFuturePlanning(devlog) {
  const findings = [];
  const lines = String(devlog || '').split(/\r?\n/);
  let inArchive = false;
  for (const [index, line] of lines.entries()) {
    if (/^## Command log archive/.test(line)) { inArchive = true; continue; }
    if (/^## /.test(line) && !/^## Command log archive/.test(line)) inArchive = false;
    if (!inArchive || !line.trim().startsWith('- ')) continue;
    for (const pattern of FUTURE_TENSE) {
      if (pattern.test(line)) {
        findings.push({ type: 'DEVLOG records future intent', detail: `DEVLOG.md:${index + 1} reads as a plan rather than a record. Future intent belongs in AI-HANDOFF.json; DEVLOG.md records what was actually done.` });
        break;
      }
    }
  }
  return findings;
}

module.exports = {
  REQUIRED_ACTION_FIELDS, OPTIONAL_ACTION_FIELDS, ROLES,
  validateAccountabilityRecord, assertAccountabilityRecord,
  materialClaims, auditDevlogAccountability, findFuturePlanning,
};
