// Cross-AI deliberation, inside the conflict ledger rather than beside it.
//
// There is deliberately no AI-DELIBERATION.json. A disagreement and the discussion that resolves
// it are the same object: splitting them produces two records that drift, and the one a gate
// reads is never the one an agent wrote. So AI-CONFLICTS.json carries both - the contested
// action, and the proposals, positions, evidence, responses and corroboration that settle it.
//
// Two rules do the real work here:
//
//   - Agreement between models is evidence, never proof. Several models producing the same answer
//     is correlated, not independent: they share training data, they share failure modes, and
//     they are all guessing at the same thing. `consensus` is therefore a discussion outcome and
//     can never, on its own, mark anything owner-approved.
//   - Winning an argument does not transfer ownership. A provider whose proposal is accepted has
//     not acquired the right to write the file. Mutation ownership lives in AI-HANDOFF.json and
//     changes only by explicit release or handoff; the current owner may implement someone
//     else's accepted proposal.
const { crucibleError } = require('./failureCodes');

// The full outcome vocabulary. "Unresolved" is a first-class result rather than a failure to
// reach one, because the alternative - forcing a verdict so the field can be filled in - is
// exactly the silent side-picking the ledger exists to prevent.
const CORROBORATION_OUTCOMES = Object.freeze([
  'consensus',
  'partial-agreement',
  'unresolved-conflict',
  'insufficient-evidence',
  'test-verified',
]);

// Outcomes that may never, by themselves, authorise a change. `test-verified` is absent because
// a passing test is evidence about the code rather than about which AI was right; it still does
// not confer owner approval, which is enforced separately below.
const NON_AUTHORISING_OUTCOMES = Object.freeze(['consensus', 'partial-agreement', 'unresolved-conflict', 'insufficient-evidence']);

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateParticipant(entry, label, findings) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { findings.push(`${label} must be an object.`); return false; }
  if (!nonEmpty(entry.provider)) findings.push(`${label}.provider is required so a position can be attributed.`);
  return true;
}

function validateProposal(proposal, label, findings) {
  if (!validateParticipant(proposal, label, findings)) return;
  if (!nonEmpty(proposal.summary)) findings.push(`${label}.summary is required.`);
  if (!Array.isArray(proposal.evidence) || !proposal.evidence.length || proposal.evidence.some((item) => !nonEmpty(item))) findings.push(`${label}.evidence must contain at least one disclosed evidence item.`);
}

function validatePosition(position, label, findings) {
  if (!validateParticipant(position, label, findings)) return;
  if (!nonEmpty(position.position)) findings.push(`${label}.position is required.`);
  if (!Array.isArray(position.evidence) || position.evidence.some((item) => !nonEmpty(item))) findings.push(`${label}.evidence must be an array of disclosed evidence items.`);
}

function validateResponse(response, label, findings) {
  if (!validateParticipant(response, label, findings)) return;
  if (!nonEmpty(response.respondsTo)) findings.push(`${label}.respondsTo must name the provider or proposal being answered.`);
  if (!nonEmpty(response.response)) findings.push(`${label}.response is required.`);
  if (response.stance !== undefined && !['corroborates', 'disputes', 'partial', 'abstains'].includes(response.stance)) findings.push(`${label}.stance must be corroborates, disputes, partial or abstains.`);
}

// The deliberation block is optional on a conflict record: the two conflicts already in the
// ledger predate multi-AI coordination and must keep validating unchanged. When it is present it
// is validated in full, so the schema cannot be adopted half-way.
function validateDeliberation(deliberation, label = 'deliberation') {
  const findings = [];
  if (deliberation === undefined || deliberation === null) return findings;
  if (typeof deliberation !== 'object' || Array.isArray(deliberation)) return [`${label} must be an object.`];

  const proposals = deliberation.proposals;
  if (proposals !== undefined) {
    if (!Array.isArray(proposals)) findings.push(`${label}.proposals must be an array.`);
    else proposals.forEach((proposal, index) => validateProposal(proposal, `${label}.proposals[${index}]`, findings));
  }

  const positions = deliberation.positions;
  if (positions !== undefined) {
    if (!Array.isArray(positions)) findings.push(`${label}.positions must be an array.`);
    else positions.forEach((position, index) => validatePosition(position, `${label}.positions[${index}]`, findings));
  }

  const responses = deliberation.responses;
  if (responses !== undefined) {
    if (!Array.isArray(responses)) findings.push(`${label}.responses must be an array.`);
    else responses.forEach((response, index) => validateResponse(response, `${label}.responses[${index}]`, findings));
  }

  const corroboration = deliberation.corroboration;
  if (corroboration !== undefined) {
    if (!corroboration || typeof corroboration !== 'object' || Array.isArray(corroboration)) findings.push(`${label}.corroboration must be an object.`);
    else {
      if (!CORROBORATION_OUTCOMES.includes(corroboration.outcome)) findings.push(`${label}.corroboration.outcome must be one of ${CORROBORATION_OUTCOMES.join(', ')}.`);
      if (!nonEmpty(corroboration.rationaleSummary)) findings.push(`${label}.corroboration.rationaleSummary is required.`);
      if (corroboration.assessedAt !== undefined && !ISO_PATTERN.test(corroboration.assessedAt)) findings.push(`${label}.corroboration.assessedAt must be an ISO-8601 UTC timestamp.`);
      // The load-bearing rule. A model, or a chorus of models, cannot approve its own change.
      if (corroboration.ownerApproved === true) findings.push(`${label}.corroboration.ownerApproved must not be set by an AI. Owner approval lives in resolution.decidedBy = "repository-owner"; model agreement is evidence, not authority.`);
      if (corroboration.outcome === 'unresolved-conflict' && corroboration.escalatedToOwner !== true) findings.push(`${label}.corroboration.escalatedToOwner must be true when the outcome is unresolved-conflict: an unresolved disagreement is escalated, never quietly dropped.`);
    }
  }

  // A deliberation with only one voice is not a deliberation. This catches the failure where a
  // single provider records its own proposal and calls the absence of objection consensus.
  const voices = new Set();
  for (const entry of [...(Array.isArray(proposals) ? proposals : []), ...(Array.isArray(positions) ? positions : []), ...(Array.isArray(responses) ? responses : [])]) {
    if (entry && nonEmpty(entry.provider)) voices.add(entry.provider.trim());
  }
  if (corroboration && corroboration.outcome === 'consensus' && voices.size < 2) findings.push(`${label}.corroboration.outcome is consensus but only ${voices.size} provider(s) are recorded. Consensus requires at least two independent positions.`);

  return findings;
}

// Guard for the promotion path: no route from "the models agreed" to "this is approved".
function assertConsensusDoesNotAuthorize(corroboration) {
  if (!corroboration || typeof corroboration !== 'object') return { authorized: false, reason: 'no corroboration recorded' };
  if (NON_AUTHORISING_OUTCOMES.includes(corroboration.outcome) || corroboration.outcome === 'test-verified') {
    if (corroboration.ownerApproved === true) {
      throw crucibleError('CRU-0032', `Corroboration outcome "${corroboration.outcome}" cannot mark a change owner-approved. Cross-model agreement is evidence, not proof; approval requires the repository owner in AI-CONFLICTS.json resolution.decidedBy.`);
    }
  }
  return { authorized: false, reason: 'owner approval is required and is never inferred from model agreement' };
}

// Who reviewed a change, other than whoever wrote it. An AI may not be the only reviewer of its
// own material change, so this is a count of *other* providers, not of reviews.
function independentReviewers(deliberation, authorProvider) {
  const author = String(authorProvider || '').trim();
  const reviewers = new Set();
  const entries = [
    ...(Array.isArray(deliberation?.positions) ? deliberation.positions : []),
    ...(Array.isArray(deliberation?.responses) ? deliberation.responses : []),
  ];
  for (const entry of entries) {
    const provider = typeof entry?.provider === 'string' ? entry.provider.trim() : '';
    if (provider && provider !== author) reviewers.add(provider);
  }
  return [...reviewers];
}

function assertIndependentlyReviewed(deliberation, authorProvider) {
  const reviewers = independentReviewers(deliberation, authorProvider);
  if (!reviewers.length) {
    throw crucibleError('CRU-0032', `${authorProvider || 'the author'} is the only recorded reviewer of its own material change. At least one other provider must review, test or respond before the change is put forward.`);
  }
  return { reviewers };
}

module.exports = {
  CORROBORATION_OUTCOMES, NON_AUTHORISING_OUTCOMES,
  validateDeliberation, assertConsensusDoesNotAuthorize,
  independentReviewers, assertIndependentlyReviewed,
};
