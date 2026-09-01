// Turns "what is left before the soak" from a checklist somebody tracks by hand into a
// read-only check that answers from the real store.
//
// It reports gate state and nothing else. It never promotes, never writes, never marks a
// gate passed on its own authority, and never infers R11. Where a gate cannot be decided
// from durable state alone it says so, rather than guessing a pass - an unverifiable gate
// reads as `manual-evidence-required`, which is not the same as satisfied.
const { soakReadiness } = require('./soakGate');

const PENDING_EXTRACTION_STATES = new Set(['claim-extraction-forced-pending', 'claim-extraction-in-progress']);

function gate(id, title, state, detail) {
  return { id, title, state, detail };
}

// R2: the worker has drained its forced-pending queue. The restart half is proven
// separately and permanently by test/durableLock.test.js, so only the live drain is open.
function evaluateR2(queue) {
  const sources = [...(queue.documents || []), ...(queue.links || [])];
  const pending = sources.filter((item) => PENDING_EXTRACTION_STATES.has(item.state));
  if (!sources.length) return gate('R2', 'Extraction worker', 'unknown', 'the source queue is empty or was not supplied, so the live drain cannot be judged from here');
  return pending.length
    ? gate('R2', 'Extraction worker', 'pending', `${pending.length} of ${sources.length} sources are still awaiting bounded claim extraction`)
    : gate('R2', 'Extraction worker', 'satisfied', `all ${sources.length} queued sources have left the extraction backlog; the forced-interruption restart proof is covered permanently by test/durableLock.test.js`);
}

// R3: one real bounded discovery run is recorded in the research audit.
function evaluateR3(research) {
  const topics = research.topics || [];
  const completed = topics.filter((item) => Number(item.runs || 0) > 0);
  if (!topics.length) return gate('R3', 'Live Google discovery', 'pending', 'no research audit state was supplied, so no bounded discovery run is recorded');
  return completed.length
    ? gate('R3', 'Live Google discovery', 'satisfied', `${completed.length} of ${topics.length} topics have completed at least one real bounded run, with ${(research.discoveredUrls || []).length} URLs registered`)
    : gate('R3', 'Live Google discovery', 'pending', `${topics.length} topics are registered but none has completed a run yet`);
}

// R4: at least one candidate carries a complete provenance chain, which is what proves a
// source travelled retrieval, hashing, extraction, deduplication, and custody intact.
function evaluateR4(payload) {
  const records = payload.candidateRecords || [];
  const complete = records.filter((item) => {
    const provenance = item.candidate?.provenance;
    return provenance && provenance.sourceId && provenance.retrievedAt && /^[a-f0-9]{64}$/i.test(String(provenance.contentSha256 || ''));
  });
  if (!records.length) return gate('R4', 'End-to-end candidate', 'pending', 'the store holds no candidate records');
  return complete.length
    ? gate('R4', 'End-to-end candidate', 'satisfied', `${complete.length} of ${records.length} candidate records carry a complete source, retrieval-time, and content-hash provenance chain`)
    : gate('R4', 'End-to-end candidate', 'pending', `${records.length} candidate records exist but none carries a complete provenance chain`);
}

// R5: a verified knowledge version exists. This is the linchpin - R6, R7, and three of the
// four soak preconditions are all downstream of it.
function evaluateR5(payload) {
  const versions = payload.knowledgeVersions || [];
  return versions.length
    ? gate('R5', 'Independent verification', 'satisfied', `${versions.length} verified knowledge version(s) exist`)
    : gate('R5', 'Independent verification', 'pending', 'zero verified knowledge versions: nothing has completed controls, causal isolation, negative and regression testing, scope proof, and a distinct verifier');
}

// R6: an active version is set and retrievable within its own tested boundary.
function evaluateR6(payload) {
  if (!payload.activeVersion) return gate('R6', 'Verified-only retrieval', 'pending', 'no active version is set, so verified-only retrieval cannot be demonstrated');
  const active = (payload.knowledgeVersions || []).find((item) => item.version === payload.activeVersion);
  if (!active) return gate('R6', 'Verified-only retrieval', 'pending', `the active version ${payload.activeVersion} does not resolve to a stored knowledge version`);
  return gate('R6', 'Verified-only retrieval', 'satisfied', `active version ${active.version} resolves and carries boundary "${active.boundary || 'not declared'}"`);
}

// R7: a real promoted claim has been rolled back or superseded, with its history intact.
function evaluateR7(payload) {
  const versions = payload.knowledgeVersions || [];
  const superseded = versions.filter((item) => item.status === 'rolled-back' || item.status === 'superseded' || item.rollback);
  if (!versions.length) return gate('R7', 'Rollback or supersession', 'pending', 'there is no promoted claim to roll back or supersede yet');
  return superseded.length
    ? gate('R7', 'Rollback or supersession', 'satisfied', `${superseded.length} version(s) carry a rollback or supersession record, with prior history retained`)
    : gate('R7', 'Rollback or supersession', 'pending', `${versions.length} version(s) exist but none has been rolled back or superseded`);
}

// R8 is a combined live cycle across eight distinct safety behaviours. Nothing durable
// records "these eight ran together", so this reports honestly rather than inferring it
// from the unit coverage, which proves the behaviours but not the combined run.
function evaluateR8(evidence) {
  const required = ['kill-switch', 'duplicate-url', 'duplicate-content-hash', 'duplicate-claim', 'prompt-injection', 'executable-content', 'blocked-source', 'contradiction-quarantine'];
  const provided = Array.isArray(evidence) ? evidence : [];
  const missing = required.filter((item) => !provided.includes(item));
  if (!provided.length) return gate('R8', 'Safety and deduplication', 'manual-evidence-required', `unit proof exists for all eight behaviours, but a combined live cycle is not recorded in durable state; supply its evidence to judge this gate (${required.join(', ')})`);
  return missing.length
    ? gate('R8', 'Safety and deduplication', 'pending', `the combined live cycle is missing: ${missing.join(', ')}`)
    : gate('R8', 'Safety and deduplication', 'satisfied', 'the combined live cycle covered all eight safety and deduplication behaviours');
}

// The whole pre-soak picture, plus what the soak gate itself would say right now.
function preSoakReadiness({ payload = {}, queue = {}, research = {}, combinedSafetyEvidence = null, hours } = {}) {
  const gates = [evaluateR2(queue), evaluateR3(research), evaluateR4(payload), evaluateR5(payload), evaluateR6(payload), evaluateR7(payload), evaluateR8(combinedSafetyEvidence)];
  const satisfied = gates.filter((item) => item.state === 'satisfied');
  const outstanding = gates.filter((item) => item.state !== 'satisfied');
  const gatesGreen = outstanding.length === 0;
  const soak = soakReadiness({ payload, queue, gatesGreen, ...(hours === undefined ? {} : { hours }) });
  return {
    schemaVersion: 1,
    gates,
    satisfied: satisfied.map((item) => item.id),
    outstanding: outstanding.map((item) => item.id),
    gatesGreen,
    // observed is the frozen population startSoak works from, so it travels with the decision.
    // Without it the report could read ready and then fail to start the soak it had just approved.
    soak: { state: soak.state, dataPoints: soak.dataPoints, observedDataPoints: soak.observedDataPoints, heldDataPoints: soak.heldDataPoints, observed: soak.observed, blockers: soak.blockers },
    // Reporting only. This function decides nothing and authorizes nothing.
    authorizesPromotion: false,
  };
}

module.exports = { preSoakReadiness, evaluateR2, evaluateR3, evaluateR4, evaluateR5, evaluateR6, evaluateR7, evaluateR8 };
