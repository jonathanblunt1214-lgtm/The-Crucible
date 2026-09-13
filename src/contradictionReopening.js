// Reopening what contradiction quarantined before there was an audit.
//
// Until the contradiction audit existed, a candidate that disagreed with active knowledge was
// quarantined and that was the end of it: the incumbent version won by default and the
// disagreeing evidence sat in custody unexamined. Those records were never adjudicated. They
// were set aside by a rule, and the rule was wrong.
//
// So they go back to the front of the pipeline, and the priority is not a courtesy. A retry
// queues behind new work because it already had its turn and failed. These never had a turn.
// That is also why this does not conflict with the owner's standing rule that recirculated soak
// sources rank below new data: a recirculated source failed on its merits and is being given
// another go, while a contradiction quarantine was a verdict nobody actually reached.
//
// Reopening means audited, not accepted. Nothing here clears a quarantine, promotes a claim, or
// decides that the incumbent was wrong - that would be the original mistake running in reverse.
// Each reopened record is handed to the audit, which enumerates how it could resolve and
// decides nothing either.
const { auditContradiction } = require('./contradictionAudit');

const CONTRADICTION_REASON = /contradiction with knowledge version (\d+)/i;

// A quarantine that came from contradiction, as opposed to injection, executable content, or
// any other reason a record can be held. Only the first kind was decided by a default.
function contradictionQuarantines(records) {
  const found = [];
  for (const record of records || []) {
    if (!record || record.state !== 'quarantined' || !record.candidate) continue;
    const entry = [...(record.history || [])].reverse().find((item) => CONTRADICTION_REASON.test(String(item && item.reason)));
    if (!entry) continue;
    const [, version] = CONTRADICTION_REASON.exec(String(entry.reason));
    found.push({
      candidateId: record.candidate.id,
      claim: record.candidate.claim,
      boundary: record.candidate.claimBoundary,
      sourceId: String(record.candidate.provenance.sourceId),
      quarantinedAt: entry.at || null,
      againstVersion: Number(version),
      record,
    });
  }
  return found;
}

// Front of the queue, oldest quarantine first: the evidence that has waited longest without
// ever being examined is the evidence that has been wrong for longest. Deterministic, so a
// reopening round can be replayed rather than trusted - ties break on candidate id.
function reopeningOrder(quarantines, newWork = []) {
  const reopened = [...quarantines].sort((left, right) => {
    const a = Date.parse(left.quarantinedAt || '') || 0;
    const b = Date.parse(right.quarantinedAt || '') || 0;
    if (a !== b) return a - b;
    return left.candidateId < right.candidateId ? -1 : 1;
  }).map((item, index) => ({ ...item, priority: 'reopened-contradiction', position: index + 1 }));

  return [
    ...reopened,
    ...newWork.map((item, index) => ({ ...item, priority: 'new', position: reopened.length + index + 1 })),
  ];
}

// Reopen every contradiction quarantine and audit each one. Returns what was reopened and what
// each audit routed to. It writes nothing: a quarantine is cleared only by the pipeline that can
// actually settle the question, never by the act of looking again.
function reopenContradictions({ records, activeKnowledge, bundle = null, options = {}, newWork = [] }) {
  const quarantines = contradictionQuarantines(records);
  const ordered = reopeningOrder(quarantines, newWork);
  const audits = [];

  for (const item of ordered.filter((entry) => entry.priority === 'reopened-contradiction')) {
    // The version it was quarantined against, if that is still active. Otherwise any active
    // version on the same boundary that still makes a different claim - the incumbent may have
    // been superseded since, and the contradiction is with whatever stands now, not with a
    // version that no longer exists.
    const named = (activeKnowledge || []).find((version) => version.version === item.againstVersion && version.status !== 'superseded');
    const current = named || (activeKnowledge || []).find((version) => version.boundary === item.boundary && version.claim !== item.claim);
    const active = current;
    if (!active) {
      audits.push({
        candidateId: item.candidateId,
        reopened: true,
        audited: false,
        reason: `the knowledge version ${item.againstVersion} this was quarantined against is no longer active, so there is no longer a contradiction to audit; it returns as ordinary candidate evidence`,
        route: 'return-to-candidate-evaluation',
        promotionAuthorized: false,
      });
      continue;
    }
    const audit = auditContradiction({ records, activeVersion: active, challengeClaim: item.claim, bundle, options });
    audits.push({
      candidateId: item.candidateId,
      reopened: true,
      audited: true,
      quarantinedAt: item.quarantinedAt,
      againstVersion: active.version,
      route: audit.route,
      // Worth surfacing: the incumbent may not be the one this was set aside against.
      incumbentChangedSinceQuarantine: !named,
      leadingResolutions: audit.leadingResolutions,
      perspective: audit.perspective,
      audit,
      // Reopening examines; it never clears, promotes, or reverses anything.
      quarantineCleared: false,
      promotionAuthorized: false,
    });
  }

  return {
    schemaVersion: 1,
    reopened: audits.length,
    stillQuarantined: audits.length,
    order: ordered.map(({ record, audit, ...rest }) => rest),
    audits,
    // Every reopened record precedes every piece of new work, because it never had its turn.
    newWorkBeginsAt: audits.length + 1,
    promotionAuthorized: false,
  };
}

module.exports = { CONTRADICTION_REASON, contradictionQuarantines, reopeningOrder, reopenContradictions };
