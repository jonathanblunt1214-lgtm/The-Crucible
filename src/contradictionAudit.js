// What to do when new documents contradict what was already learned.
//
// Today a contradiction quarantines the newcomer: the active version wins by default and the
// contradicting evidence is set aside as a Crucible Issue. That is safe and it is not learning.
// It also has a failure mode worth naming - the first thing learned about a claim becomes the
// hardest to dislodge, which is exactly backwards for an engine whose whole point is that
// evidence outranks incumbency.
//
// This audits instead. It assembles everything in custody that bears on the claim, weighs each
// side by how many genuinely independent sources stand behind it, enumerates the ways the
// contradiction could resolve, and proposes the perspective that would reconcile both bodies of
// evidence if one is available from the data.
//
// What it deliberately does NOT do is decide. Deciding which side is true requires a controlled
// experiment and a distinct independent verifier, and nothing here is a substitute for either.
// Source counts prioritise investigation; they never authorise a conclusion - more agreeing
// documents cannot make a claim true, and the learning policy says so explicitly. Every
// resolution this reports carries the evidence that would settle it, and the proposed
// perspective is a hypothesis to be tested, never a finding.
const { independentSubset, sourceIndex } = require('./sourceIndependence');
const { semanticallyCorroborates } = require('./semanticCorroboration');

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

// The ways a contradiction between verified knowledge and new evidence can actually resolve.
// Enumerated rather than chosen, each with what would settle it.
const RESOLUTIONS = Object.freeze([
  {
    id: 'incumbent-wrong',
    reads: 'the verified version is wrong and the new evidence is right',
    settledBy: 'a controlled experiment within the same boundary whose result matches the challenge, confirmed by a distinct verifier; the prior version is then superseded, not deleted',
  },
  {
    id: 'challenge-wrong',
    reads: 'the new sources agree with each other and are wrong',
    settledBy: 'a controlled experiment within the same boundary whose result matches the incumbent; the challenge is then recorded as tested and refuted rather than discarded',
  },
  {
    id: 'shared-upstream-error',
    reads: 'the new sources are not independent of each other and repeat one upstream error',
    settledBy: 'establishing whether the challenging sources are genuinely independent in content, publisher and author',
  },
  {
    id: 'different-scopes',
    reads: 'both are right, within narrower scopes that the current boundary conflates',
    settledBy: 'identifying the condition that differs between the two bodies of evidence, then testing each claim within its own narrowed scope',
  },
  {
    id: 'under-specified-claim',
    reads: 'the claim conflates two assertions and needs splitting before either can be tested',
    settledBy: 'restating the claim as separate bounded assertions and evaluating each on its own',
  },
  {
    id: 'undecidable-on-available-evidence',
    reads: 'neither side has enough behind it to be worth testing yet',
    settledBy: 'further independent sources, or a controlled experiment someone is willing to design',
  },
]);

// Everything in custody that bears on this claim within this boundary - not only the two sides.
// A contradiction audited on two documents when eleven are held is not an audit.
function gatherIntel({ records, activeVersion, challengeClaim, options = {} }) {
  const boundary = activeVersion.boundary;
  const supporting = [];
  const challenging = [];
  const related = [];
  for (const record of records || []) {
    const candidate = record && record.candidate;
    if (!candidate) continue;
    const sameBoundary = candidate.claimBoundary === boundary || (record.claimScope || null) === boundary;
    if (normalize(candidate.claim) === normalize(activeVersion.claim) || semanticallyCorroborates(candidate.claim, activeVersion.claim, options).corroborates) {
      supporting.push(record);
    } else if (normalize(candidate.claim) === normalize(challengeClaim) || semanticallyCorroborates(candidate.claim, challengeClaim, options).corroborates) {
      challenging.push(record);
    } else if (sameBoundary) {
      // Held, not counted for either side: evidence about the same boundary that speaks to
      // neither claim is still context an owner should see before deciding anything.
      related.push(record);
    }
  }
  return { supporting, challenging, related };
}

// How many genuinely independent sources stand behind a body of evidence. Two editions of one
// book are one source; this is the same test corroboration uses.
function weigh(records, index) {
  const entries = records.map((record) => ({ sourceId: record.candidate.provenance.sourceId, provenance: record.candidate.provenance, id: record.candidate.id }));
  const { members, rejected } = independentSubset(entries, index);
  return {
    records: records.length,
    independentSources: members.length,
    sourceIds: members.map((item) => String(item.sourceId)),
    notIndependent: rejected,
    // Counting sources prioritises what to investigate. It never authorises a conclusion.
    authorises: false,
  };
}

// An observable difference between the two bodies of evidence, taken only from what provenance
// actually records. Nothing is invented: when the data shows no systematic difference, this
// says so rather than proposing a scope that would have to be guessed.
function discriminator(supporting, challenging) {
  const at = (records) => records.map((record) => Date.parse(record.candidate.provenance.retrievedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const a = at(supporting);
  const b = at(challenging);
  if (!a.length || !b.length) return null;
  const newestSupporting = a[a.length - 1];
  const oldestChallenging = b[0];
  if (oldestChallenging > newestSupporting) {
    return {
      observed: 'every challenging source was retrieved after every supporting source',
      hypothesis: 'the claim may be version- or time-dependent, and the boundary may be conflating two eras of the same subject',
      wouldNarrowTo: 'the version or period each body of evidence describes',
    };
  }
  return null;
}

// The audit. Reports what is held, what it weighs, how it could resolve, and - when the data
// supports one - the perspective that would reconcile both. Never a verdict.
function auditContradiction({ records, activeVersion, challengeClaim, bundle = null, options = {} }) {
  if (!activeVersion || typeof activeVersion.claim !== 'string' || typeof activeVersion.boundary !== 'string') throw new Error('A contradiction audit requires the active verified version it concerns.');
  if (typeof challengeClaim !== 'string' || !challengeClaim.trim()) throw new Error('A contradiction audit requires the contradicting claim.');

  const index = sourceIndex(bundle);
  const intel = gatherIntel({ records, activeVersion, challengeClaim, options });
  const incumbent = weigh(intel.supporting, index);
  const challenge = weigh(intel.challenging, index);
  const difference = discriminator(intel.supporting, intel.challenging);

  const leading = [];
  if (challenge.independentSources < 2) leading.push('shared-upstream-error');
  if (difference) leading.push('different-scopes');
  if (!leading.length && incumbent.independentSources >= 2 && challenge.independentSources >= 2) leading.push('different-scopes');
  if (challenge.independentSources >= 2 && incumbent.independentSources >= 2) leading.push('incumbent-wrong', 'challenge-wrong');
  if (!challenge.independentSources || !incumbent.independentSources) leading.push('undecidable-on-available-evidence');

  const ordered = [...new Set(leading)];
  const resolutions = RESOLUTIONS.map((item) => ({ ...item, leading: ordered.includes(item.id) }));

  // The perspective: what would have to be true for both bodies of evidence to stand. Offered
  // only when the data itself shows a difference between them, and always as a hypothesis.
  const perspective = difference && challenge.independentSources >= 2 && incumbent.independentSources >= 2
    ? {
        hypothesis: `Both bodies of evidence hold, within narrower scopes than "${activeVersion.boundary}": ${difference.hypothesis}`,
        groundedIn: difference.observed,
        wouldNarrowTo: difference.wouldNarrowTo,
        // A perspective is a claim awaiting proof like any other. It enters as a candidate for
        // testing, and the owner declares the narrowed scopes; nothing here infers them.
        classification: 'Insufficient Evidence',
        requiresOwnerDeclaredScopes: true,
        proofStageSatisfied: false,
      }
    : null;

  const route = challenge.independentSources < 2
    ? 'hold-challenge-pending-independent-corroboration'
    : perspective
      ? 'propose-narrowed-scopes-for-owner-declaration'
      : incumbent.independentSources >= 2
        ? 'controlled-retest-within-the-same-boundary'
        : 'request-more-independent-evidence';

  return {
    schemaVersion: 1,
    contradiction: { activeVersion: activeVersion.version, boundary: activeVersion.boundary, incumbentClaim: activeVersion.claim, challengeClaim },
    intel: {
      supporting: incumbent,
      challenging: challenge,
      relatedHeld: intel.related.length,
      // Nothing is discarded by an audit, on either side.
      discarded: 0,
    },
    difference,
    resolutions,
    leadingResolutions: ordered,
    perspective,
    route,
    // An audit reports; it never concludes.
    classification: 'Crucible Issue',
    proofStageSatisfied: false,
    independentVerificationSatisfied: false,
    promotionAuthorized: false,
  };
}

module.exports = { RESOLUTIONS, gatherIntel, weigh, discriminator, auditContradiction };
