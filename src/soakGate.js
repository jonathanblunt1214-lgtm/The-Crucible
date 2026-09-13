// R9's soak, made specific enough to mean something.
//
// The gate text names the failures a soak must not produce - lost, duplicated,
// cross-project, corrupt, or unauthorized transitions - but never said what set was
// under observation or how much of it. Duration was the only precise part of it, which
// is backwards: a soak run over a population that cannot exhibit those failures passes
// by being empty, and an empty pass is worse than no soak, because it looks like proof.
//
// Two owner decisions on 2026-08-31 fix that:
//   - At most 1000 data points are observed at once.
//   - If the current data makes a soak pointless - if it would return no results - the
//     soak does not start. All data is held until the population is usable as intended.
//
// Holding never discards. Data beyond the ceiling, and data held because the soak is not
// yet meaningful, both stay exactly where they are; `observed + held` always equals the
// full population, and the tests assert that rather than trusting it.
const SOAK_OBSERVATION_CEILING = 1000;
const SOAK_MIN_HOURS = 72;
const SOAK_MAX_HOURS = 96;

// What one data point is, so the ceiling counts something definite: one durable record
// under observation. The active version is deliberately not counted separately - it is a
// pointer at a knowledge version that is already in the population.
function population(payload = {}, queue = {}) {
  const knowledgeVersions = Array.isArray(payload.knowledgeVersions) ? payload.knowledgeVersions : [];
  const candidateRecords = Array.isArray(payload.candidateRecords) ? payload.candidateRecords : [];
  const sources = [...(Array.isArray(queue.documents) ? queue.documents : []), ...(Array.isArray(queue.links) ? queue.links : [])];
  return { knowledgeVersions, candidateRecords, sources, total: knowledgeVersions.length + candidateRecords.length + sources.length };
}

// Why a soak would return no result. Each entry is a category of R9 failure that the
// current data cannot exhibit, so a soak run now could not detect it either.
function unobservableFailures(payload = {}, queue = {}) {
  const { knowledgeVersions, candidateRecords, sources } = population(payload, queue);
  const reasons = [];
  if (!knowledgeVersions.length) reasons.push('unauthorized and supersession transitions are unobservable: the store holds zero verified knowledge versions, so no promotion or rollback can occur during the soak to be checked');
  if (!payload.activeVersion) reasons.push('verified-only retrieval is unobservable: no active version is set, so retrieval cannot be shown to change or hold correctly');
  if (!candidateRecords.length && !sources.length) reasons.push('loss and duplication are unobservable: there are no candidate records or queued sources that could go missing or be duplicated');
  return reasons;
}

// Deterministic, so a soak window can be reproduced and re-checked rather than trusted.
// Transition-bearing records come first because they are what R9 is mostly about; the
// remainder fills by stable id order, never by sampling that cannot be replayed.
function observationWindow(payload = {}, queue = {}, ceiling = SOAK_OBSERVATION_CEILING) {
  const { knowledgeVersions, candidateRecords, sources } = population(payload, queue);
  const byId = (items, kind, id) => [...items].map((item) => ({ kind, id: String(id(item)) })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ordered = [
    ...byId(knowledgeVersions, 'knowledge-version', (item) => item.version ?? item.id ?? ''),
    ...byId(candidateRecords, 'candidate', (item) => item.candidate?.id ?? item.id ?? ''),
    ...byId(sources, 'queued-source', (item) => item.id ?? ''),
  ];
  return { observed: ordered.slice(0, ceiling), held: ordered.slice(ceiling) };
}

function validateSoakHours(hours) {
  if (!Number.isFinite(hours) || hours < SOAK_MIN_HOURS || hours > SOAK_MAX_HOURS) {
    throw new Error(`Soak duration must be within the owner-set ${SOAK_MIN_HOURS}-${SOAK_MAX_HOURS} hour band; ${hours} is outside it.`);
  }
  return hours;
}

// The decision to start a soak or hold. It never reports a pass - passing is what the
// soak itself establishes over its duration. It reports only whether starting one now
// would mean anything, and if not, exactly what is missing.
function soakReadiness({ payload = {}, queue = {}, hours = SOAK_MIN_HOURS, ceiling = SOAK_OBSERVATION_CEILING, gatesGreen = false } = {}) {
  if (!Number.isSafeInteger(ceiling) || ceiling < 1 || ceiling > SOAK_OBSERVATION_CEILING) {
    throw new Error(`Soak observation ceiling must be a positive whole number no greater than the owner-set ${SOAK_OBSERVATION_CEILING}.`);
  }
  validateSoakHours(hours);
  const counts = population(payload, queue);
  const { observed, held } = observationWindow(payload, queue, ceiling);
  const blockers = unobservableFailures(payload, queue);
  if (!gatesGreen) blockers.unshift('R2-R8 are not simultaneously green, so the soak clock has no valid starting point');
  return {
    schemaVersion: 1,
    state: blockers.length ? 'held' : 'ready',
    hours,
    ceiling,
    dataPoints: counts.total,
    observedDataPoints: observed.length,
    heldDataPoints: held.length,
    population: { knowledgeVersions: counts.knowledgeVersions.length, candidateRecords: counts.candidateRecords.length, queuedSources: counts.sources.length },
    observed,
    blockers,
    // Holding is a wait, never a discard, and never a quiet pass.
    dataRetained: true,
    soakPassed: false,
  };
}

module.exports = { SOAK_OBSERVATION_CEILING, SOAK_MIN_HOURS, SOAK_MAX_HOURS, population, unobservableFailures, observationWindow, validateSoakHours, soakReadiness };
