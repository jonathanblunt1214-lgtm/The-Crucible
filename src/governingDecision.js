const GOVERNING_PRINCIPLES = Object.freeze({
  adapt: 'Reconcile changed or unfamiliar conditions against current authoritative evidence.',
  persevere: 'Try each safe supported evidence and recovery path before escalating.',
  overcome: 'Accept only verified recovery; reserve semantic, ambiguous, or high-risk choices for human review.',
});

const AUTHORITATIVE_EVIDENCE_ORDER = Object.freeze(['repository', 'tool', 'configuration', 'upstream']);

function evidenceResult(source, outcome, detail, value) {
  return Object.freeze({ source, outcome, detail, ...(value === undefined ? {} : { value }) });
}

async function reconcileDecision({
  condition,
  knownUnsafe = false,
  semantic = false,
  highRisk = false,
  evidence = [],
  recover,
  verify,
} = {}) {
  if (!condition) throw new Error('Governing decision requires a condition.');
  const attempts = [];
  if (knownUnsafe) {
    return Object.freeze({ condition, status: 'blocked', action: 'block-known-unsafe', principle: 'overcome', attempts: Object.freeze(attempts) });
  }

  for (const candidate of evidence) {
    if (!candidate || !AUTHORITATIVE_EVIDENCE_ORDER.includes(candidate.source) || typeof candidate.inspect !== 'function') continue;
    try {
      const result = await candidate.inspect();
      const normalized = result && typeof result === 'object' ? result : { resolved: false, detail: String(result || 'no usable evidence') };
      attempts.push(evidenceResult(candidate.source, normalized.resolved ? 'resolved' : 'inspected', normalized.detail || 'evidence inspected', normalized.value));
      if (normalized.resolved) {
        return Object.freeze({ condition, status: 'reconciled', action: 'use-authoritative-evidence', principle: 'adapt', evidence: normalized.value, attempts: Object.freeze(attempts) });
      }
    } catch (error) {
      attempts.push(evidenceResult(candidate.source, 'unavailable', error.message));
    }
  }

  if (semantic || highRisk) {
    return Object.freeze({ condition, status: 'needs-review', action: 'human-review', principle: 'overcome', reason: semantic ? 'semantic decision requires human intent' : 'high-risk change requires human approval', attempts: Object.freeze(attempts) });
  }

  if (typeof recover === 'function' && typeof verify === 'function') {
    try {
      const repair = await recover();
      attempts.push(evidenceResult('tool', 'recovery-attempted', repair?.detail || 'safe supported recovery attempted'));
      const verification = await verify(repair);
      attempts.push(evidenceResult('tool', verification?.ok ? 'verified' : 'verification-failed', verification?.detail || 'recovery re-check completed'));
      if (verification?.ok) {
        return Object.freeze({ condition, status: 'recovered', action: 'verified-repair', principle: 'overcome', repair, verification, attempts: Object.freeze(attempts) });
      }
    } catch (error) {
      attempts.push(evidenceResult('tool', 'recovery-unavailable', error.message));
    }
  }

  return Object.freeze({
    condition,
    status: 'needs-review',
    action: 'human-review',
    principle: 'persevere',
    reason: 'available authoritative evidence and safe supported recovery did not resolve the ambiguity',
    attempts: Object.freeze(attempts),
  });
}

function formatDecision(decision) {
  const evidence = (decision.attempts || []).map((item) => `${item.source}:${item.outcome}`).join(', ') || decision.evidenceSource || 'none';
  return `${decision.status} via ${decision.principle}; evidence ${evidence}`;
}

module.exports = { GOVERNING_PRINCIPLES, AUTHORITATIVE_EVIDENCE_ORDER, reconcileDecision, formatDecision };
