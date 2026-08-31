// Governance watching the learning system's gates and adjusting the pipeline around a
// blockage, without ever touching what a gate means.
//
// The distinction this file exists to hold is between flow and proof. Governance may
// decide what the pipeline works on next, what it pauses, what it throttles, and what it
// routes to review. It may never decide that something is proven. So it can say "stop
// gathering more candidates and evaluate the ones you have", and it cannot say "that
// claim is verified", "R5 is satisfied", or "start the soak the gate is holding".
//
// That is what indirect control means here: governance moves work around an obstruction,
// and the obstruction is still cleared by real evidence produced by the pipeline itself.
// Anything governance cannot clear that way is escalated to the owner rather than worked
// around, because a blockage governance could clear by relaxing a gate is not a blockage,
// it is the gate doing its job.
//
// The semantic analyzers are learning-system components, not independent tooling, per the
// owner's instruction on 2026-08-31. A degraded analyzer is therefore a learning blockage
// and inhibits the analysis that depends on it, rather than being someone else's problem.

// The complete set of things governance may do. Adding to this list is a deliberate act;
// nothing here changes evidence, proof state, gate state, or release authority.
const ADJUSTMENTS = Object.freeze([
  'prioritize-claim-evaluation',
  'prioritize-extraction',
  'prioritize-discovery',
  'hold-discovery',
  'hold-extraction',
  'hold-analyzer-dependent-analysis',
  'hold-all-mutation',
  'throttle-batch-size',
  'route-contradictions-to-review',
  'deprioritize-recirculated-sources',
]);

// Permanently outside governance's reach. Named explicitly so that a later change adding
// one of these has to delete this line, rather than quietly widening what governance does.
const FORBIDDEN_ACTIONS = Object.freeze([
  'promote-claim',
  'verify-claim',
  'mark-gate-passed',
  'authorize-release',
  'start-held-soak',
  'repair-durable-store',
  'shorten-soak',
  'discard-evidence',
]);

const SEVERITY_ORDER = Object.freeze(['critical', 'high', 'medium', 'low']);
const rank = (severity) => {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
};

function blockage(id, severity, evidence, adjustments, escalate = false) {
  for (const adjustment of adjustments) {
    if (!ADJUSTMENTS.includes(adjustment)) throw new Error(`Governance proposed an adjustment outside its allow-list: ${adjustment}.`);
  }
  return { id, severity, evidence, adjustments, escalate };
}

function gateState(readiness, id) {
  return (readiness.gates || []).find((item) => item.id === id) || null;
}

function detectBlockages({ readiness = {}, analyzer = {}, store = {}, contradictions = 0, recirculated = 0, queuedSources = 0 } = {}) {
  const found = [];

  // A store that is not sound is not a flow problem, and governance never repairs one.
  if (store.state && store.state !== 'healthy') {
    found.push(blockage('durable-store-degraded', 'critical', store.detail || 'the durable learning store reported a non-healthy state', ['hold-all-mutation'], true));
  }

  // The analyzers are learning-system components, so their health is a learning blockage.
  if (analyzer.state && analyzer.state !== 'healthy') {
    found.push(blockage('semantic-analyzer-degraded', 'high', analyzer.detail || 'a semantic analyzer reported a non-healthy state', ['hold-analyzer-dependent-analysis'], true));
  }

  const r2 = gateState(readiness, 'R2');
  const r3 = gateState(readiness, 'R3');
  const r4 = gateState(readiness, 'R4');
  const r5 = gateState(readiness, 'R5');

  // Candidates piling up behind an empty verified store is the pipeline's real blockage:
  // more gathering cannot clear it, only evaluating what is already held can.
  if (r5 && r5.state !== 'satisfied' && r4 && r4.state === 'satisfied') {
    found.push(blockage('evaluation-starved', 'high', 'candidate evidence exists but no claim has completed independent verification, so everything downstream of R5 is waiting', ['prioritize-claim-evaluation', 'hold-discovery']));
  }

  if (r2 && r2.state === 'pending') {
    const heavy = queuedSources > 100;
    found.push(blockage('extraction-backlog', heavy ? 'high' : 'medium', r2.detail || 'sources remain in the extraction backlog', heavy ? ['prioritize-extraction', 'hold-discovery'] : ['prioritize-extraction']));
  }

  // Only worth gathering more when there is nothing already waiting to be worked.
  if (r3 && r3.state === 'pending' && (!r2 || r2.state !== 'pending')) {
    found.push(blockage('discovery-stalled', 'medium', r3.detail || 'no bounded discovery run is recorded', ['prioritize-discovery']));
  }

  if (contradictions > 0) {
    found.push(blockage('contradiction-backlog', 'medium', `${contradictions} contradiction(s) are quarantined and awaiting review`, ['route-contradictions-to-review']));
  }

  if (recirculated > 0) {
    found.push(blockage('recirculated-backlog', 'low', `${recirculated} source(s) were returned to the collection pool and must not compete with new data`, ['deprioritize-recirculated-sources']));
  }

  return found.sort((a, b) => rank(a.severity) - rank(b.severity));
}

// The governance decision for one observation: what is blocked, what the pipeline should
// do about it, what governance cannot fix, and - stated every time, not implied - what
// governance is still not allowed to do.
function governLearningPipeline(input = {}) {
  const blockages = detectBlockages(input);
  const adjustments = [];
  for (const item of blockages) for (const adjustment of item.adjustments) if (!adjustments.includes(adjustment)) adjustments.push(adjustment);

  // A hold outranks a prioritization of the same stage: never drive a stage governance
  // has just decided to stop.
  const holds = new Set(adjustments.filter((item) => item.startsWith('hold-')));
  const effective = adjustments.filter((item) => {
    if (item === 'prioritize-discovery' && holds.has('hold-discovery')) return false;
    if (item === 'prioritize-extraction' && holds.has('hold-extraction')) return false;
    if (holds.has('hold-all-mutation') && item.startsWith('prioritize-')) return false;
    return true;
  });

  return {
    schemaVersion: 1,
    state: blockages.length ? 'adjusting' : 'clear',
    blockages,
    adjustments: effective,
    escalations: blockages.filter((item) => item.escalate).map((item) => ({ id: item.id, severity: item.severity, evidence: item.evidence })),
    authority: {
      mayAdjustPipelineFlow: true,
      mayPromoteClaim: false,
      mayVerifyClaim: false,
      mayMarkGatePassed: false,
      mayAuthorizeRelease: false,
      mayStartHeldSoak: false,
      mayRepairDurableStore: false,
      forbiddenActions: FORBIDDEN_ACTIONS,
    },
    governanceIsTruthSource: false,
  };
}

module.exports = { ADJUSTMENTS, FORBIDDEN_ACTIONS, detectBlockages, governLearningPipeline };
