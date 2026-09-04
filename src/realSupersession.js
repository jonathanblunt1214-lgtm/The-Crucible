// R7 proven on real evidence: a promoted claim superseded by a further real source, then
// rolled back with its history intact.
//
// The hosted proof previously satisfied R7 by building a candidate out of the same hardcoded
// claim string it had just promoted, labelling its provenance "repository test fixture", and
// superseding a version it had made for itself moments earlier. That demonstrates the version
// machinery moves. It demonstrates nothing about knowledge, because no document was involved
// on either side.
//
// Supersession here needs a third real source. Two already corroborated the claim and produced
// the active version; a third, independent of both, asserting the same claim within the same
// boundary, is what a real second look at a claim consists of. The verified knowledge store
// matches a prior version on exact claim text and boundary, so that third source has to assert
// it verbatim - a paraphrase starts a separate lineage rather than superseding anything, which
// is correct and is reported as the reason rather than worked around.
//
// When the corpus cannot supply that third source, this reports unsatisfied and says so. R7
// also cannot precede R4-R6: there is nothing to supersede until something is promoted.
const { AutonomousScientificLearner } = require('./scientificLearning');
const { sourceIndex, factsFor, independent } = require('./sourceIndependence');

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const unsatisfied = (reason) => ({ satisfied: false, reason, supersededVersion: null, newVersion: null, rolledBackTo: null, proofStageSatisfied: false, promotionAuthorized: false });

// A source asserting the promoted claim verbatim that is independent of both sources already
// behind it. "Independent of both" matters: a third page of one publisher is the same second
// look, not a third one.
function findFurtherSource({ store, available, bundle, activeVersion, usedSourceIds }) {
  const index = sourceIndex(bundle);
  const usedFacts = usedSourceIds.map((id) => factsFor(id, index, null));
  const wanted = normalize(activeVersion.claim);
  const candidates = available
    .filter((record) => record.state === 'candidate')
    .filter((record) => normalize(record.candidate.claim) === wanted)
    .filter((record) => !usedSourceIds.includes(String(record.candidate.provenance.sourceId)))
    .sort((a, b) => (a.candidate.id < b.candidate.id ? -1 : 1));

  for (const record of candidates) {
    const facts = factsFor(record.candidate.provenance.sourceId, index, record.candidate.provenance);
    const clash = usedFacts.find((item) => !independent(item, facts).independent);
    if (!clash) return { record, facts };
  }
  return null;
}

// `excludeSourceIds` names the sources already behind the active version - the pair that
// corroborated it. The caller knows them exactly; where it does not, they are inferred from the
// records that were actually used, because a candidate still sitting in candidate state was
// never part of promoting anything and is a legitimate further look.
async function realSupersession({ store, available, bundle, experiment, verifier, hypothesis, claimScope = null, excludeSourceIds = [], now = () => new Date().toISOString() }) {
  const payload = store.read();
  const active = payload.knowledgeVersions.filter((item) => item.status === 'active');
  if (!active.length) {
    return unsatisfied('no verified knowledge exists yet, so there is nothing to supersede or roll back; R7 follows R4-R6 rather than being provable before them');
  }

  const already = payload.knowledgeVersions.find((item) => item.previousVersion || item.rollback);
  if (already) {
    return { satisfied: true, reason: null, supersededVersion: already.previousVersion, newVersion: already.version, rolledBackTo: payload.activeVersion, source: 'already recorded in durable state', proofStageSatisfied: false, promotionAuthorized: false };
  }

  const target = active[active.length - 1];
  const behind = payload.candidateRecords
    .filter((record) => record.candidate.id === target.candidateId || (normalize(record.candidate.claim) === normalize(target.claim) && record.state !== 'candidate'))
    .map((record) => String(record.candidate.provenance.sourceId));
  const usedSourceIds = [...new Set([...behind, ...excludeSourceIds.map((id) => String(id))])];

  const further = findFurtherSource({ store, available, bundle, activeVersion: target, usedSourceIds });
  if (!further) {
    return unsatisfied(`no further source in the corpus asserts "${String(target.claim).slice(0, 80)}" verbatim while being independent of the ${usedSourceIds.length} source(s) already behind version ${target.version}; a paraphrase would start a separate lineage rather than supersede it`);
  }

  const at = now();
  if (!store.get(further.record.candidate.id)) store.ingest(further.record.candidate);
  // The further source must be tested within the same boundary as the version it supersedes,
  // which is the declared scope when the promoted version was evaluated under one.
  const learner = new AutonomousScientificLearner({ store, experimentExecutor: experiment, independentVerifier: verifier, claimScope: claimScope || target.boundary, now: () => at });
  const record = await learner.process(further.record.candidate.id, hypothesis || `Re-test the promoted claim within its declared boundary using a further independent source.`);
  if (record.state !== 'verified') {
    return unsatisfied(`the further source did not pass the controlled pipeline, so it cannot supersede: its record ended in state ${record.state}`);
  }

  const after = store.read();
  const superseding = after.knowledgeVersions.find((item) => item.candidateId === further.record.candidate.id);
  if (!superseding || superseding.previousVersion !== target.version) {
    // The store matches a prior version on claim text AND boundary. When the experiment
    // boundary is taken from the candidate's provenance rather than from the owner-declared
    // scope, two documents can never share one, so a further source starts a separate lineage
    // no matter how plainly it re-tests the same claim. Say that precisely: it is a defect in
    // how the harness sets its boundary, not an absence of evidence.
    const detail = superseding && superseding.boundary !== target.boundary
      ? `the further source was tested within "${String(superseding.boundary).slice(0, 80)}" while version ${target.version} holds "${String(target.boundary).slice(0, 80)}"; a supersession requires one boundary, so the experiment boundary must be the owner-declared scope rather than the source document's provenance`
      : `no supersession was recorded`;
    return unsatisfied(`the further source produced version ${superseding ? superseding.version : 'none'}, which does not carry version ${target.version} as its predecessor: ${detail}`);
  }

  // Rolling back is the other half: prior history has to survive being superseded.
  store.rollback(target.version, at, `Restored version ${target.version} after supersession by a further independent corpus source, to prove prior history survives.`);
  const final = store.read();
  const restored = final.knowledgeVersions.find((item) => item.version === target.version);
  if (!restored || restored.status !== 'active' || final.activeVersion !== target.version) {
    return unsatisfied('the rollback did not restore the prior version as active, so history was not preserved');
  }

  return {
    satisfied: true,
    reason: null,
    supersededVersion: target.version,
    newVersion: superseding.version,
    rolledBackTo: target.version,
    furtherSourceId: String(further.record.candidate.provenance.sourceId),
    furtherCandidateId: further.record.candidate.id,
    independentOf: usedSourceIds,
    supersededStillRecorded: final.knowledgeVersions.some((item) => item.version === superseding.version),
    proofStageSatisfied: false,
    promotionAuthorized: false,
  };
}

module.exports = { findFurtherSource, realSupersession };
