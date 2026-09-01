// Digestion has two outputs, and they are not the same pathway.
//
// In the owner's organism diagram intake feeds the senses and intake feeds the learner, and
// those were drawn as one line. They should not be. What reaches the learner is candidate
// evidence: bounded assertions extracted from documents, which the scientific pipeline then
// has to corroborate, scope, test and independently verify. What reaches the senses is
// something else entirely - the health of digestion itself: sources that could not be
// retrieved, content that was quarantined on arrival, extraction that stalled, a backlog that
// is not moving. That is a diagnostic signal, it needs no corroboration, and it must never be
// mistaken for something the corpus asserts.
//
// Conflating them has a specific failure mode, and this repository has already seen its shape:
// a pipeline that reports "nothing corroborated" when the real answer is "digestion stopped
// three steps earlier" sends everyone looking in the wrong place. Reporting the two separately
// means a blockage announces itself as a blockage.
//
// This is a read-only reporter. It moves nothing, writes nothing, and decides nothing - it
// says what each pathway currently carries.
const { documentFurniture } = require('./documentFurniture');

// Queue states that mean digestion is stuck rather than working, and what each one indicates.
const IMPEDIMENTS = Object.freeze({
  'retrieval-blocked': 'the source could not be retrieved and will not become evidence without intervention',
  'claim-extraction-in-progress': 'extraction holds a lock on this source; a count that never falls is a stalled worker',
  'research-approved-pending-retrieval': 'approved for retrieval that has not happened yet',
  'claim-extraction-forced-pending': 'awaiting extraction; a backlog that does not fall is digestion not running',
});

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');

function countStates(sources) {
  const states = new Map();
  for (const source of sources) {
    const state = normalize(source.state) || 'unknown';
    states.set(state, (states.get(state) || 0) + 1);
  }
  return Object.fromEntries([...states.entries()].sort((a, b) => b[1] - a[1]));
}

// What digestion currently delivers to the learner: candidate evidence, and how much of it is
// usable rather than merely present.
function toLearning(candidateRecords) {
  const records = candidateRecords || [];
  let furniture = 0;
  const bySource = new Set();
  let usable = 0;
  for (const record of records) {
    const claim = record && record.candidate && record.candidate.claim;
    if (!claim) continue;
    if (documentFurniture(claim).furniture) { furniture += 1; continue; }
    usable += 1;
    bySource.add(String(record.candidate.provenance.sourceId));
  }
  return {
    pathway: 'intake-to-learning',
    carries: 'candidate evidence: bounded assertions a document actually contains',
    candidates: records.length,
    usableCandidates: usable,
    excludedAsFurniture: furniture,
    distinctSources: bySource.size,
    // Everything on this pathway is evidence awaiting proof. None of it is knowledge.
    classification: 'Insufficient Evidence',
    promotionAuthorized: false,
  };
}

// What digestion currently reports to the senses: its own health. Nothing here is a claim about
// the world, so nothing here needs corroborating - and nothing here may ever be treated as
// something the corpus asserts.
function toDiagnostics(sources, { stalledInProgressThreshold = 1 } = {}) {
  const all = sources || [];
  const states = countStates(all);
  const impediments = Object.entries(IMPEDIMENTS)
    .filter(([state]) => states[state])
    .map(([state, meaning]) => ({ state, count: states[state], meaning }))
    .sort((a, b) => b.count - a.count);

  const withoutContent = all.filter((source) => !source.durablePath && !source.contentSha256).length;
  const signals = [];
  if (states['claim-extraction-in-progress'] >= stalledInProgressThreshold) {
    signals.push({ signal: 'possible-stalled-extraction', detail: `${states['claim-extraction-in-progress']} source(s) held in extraction; if this does not fall between runs a worker died holding a lock` });
  }
  if (states['retrieval-blocked']) {
    signals.push({ signal: 'retrieval-blocked', detail: `${states['retrieval-blocked']} source(s) cannot be retrieved and will never become evidence unless the block is resolved` });
  }
  if (states['claim-extraction-forced-pending']) {
    signals.push({ signal: 'undigested-backlog', detail: `${states['claim-extraction-forced-pending']} source(s) awaiting extraction` });
  }
  if (withoutContent) {
    signals.push({ signal: 'sources-without-content', detail: `${withoutContent} source(s) have no stored content, so nothing can be extracted from them` });
  }

  return {
    pathway: 'intake-to-diagnostics',
    carries: 'the health of digestion itself, which is never a claim about the world',
    sources: all.length,
    states,
    impediments,
    signals,
    healthy: signals.length === 0,
    // A diagnostic signal is not evidence and can never be corroborated into knowledge.
    isEvidence: false,
    promotionAuthorized: false,
  };
}

// Both pathways, reported side by side so a blockage in one is never read as a result from the
// other. `blocked` names the pathway that is actually stopping progress, when one is.
function intakePathways({ sources, candidateRecords, options = {} } = {}) {
  const learning = toLearning(candidateRecords);
  const diagnostics = toDiagnostics(sources, options);
  let blocked = null;
  if (!diagnostics.healthy && learning.usableCandidates === 0) {
    blocked = 'intake-to-diagnostics: digestion is impeded and has produced no usable evidence, so an empty learning pathway says nothing about the corpus';
  } else if (learning.usableCandidates === 0) {
    blocked = 'intake-to-learning: digestion reports healthy but produced no usable candidate evidence';
  }
  return { schemaVersion: 1, learning, diagnostics, blocked, promotionAuthorized: false };
}

module.exports = { IMPEDIMENTS, toLearning, toDiagnostics, intakePathways };
