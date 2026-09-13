// Governed multi-provider coordination.
//
// This extends the orchestrator rather than replacing it: the existing test-cadence orchestrator
// still decides what work runs and when. What is added here is the ability to put one bounded
// task to several providers, keep their answers apart, and reason about the spread - without any
// of that becoming an authority to change the repository.
//
// Three properties are enforced rather than documented:
//
//   - Responses are never merged. Each is kept with its own provenance, because a merged answer
//     has no author and cannot be checked against the model that gave it.
//   - A provider that fails is recorded as having failed. Silently dropping an unreachable
//     provider turns "three of four agreed" into "the only one that answered agreed", which
//     reads identically in a summary and means something completely different.
//   - Nothing this module returns authorises a mutation. It reports; the owner decides, and
//     mutation ownership is checked separately against AI-HANDOFF.json.
const crypto = require('node:crypto');
const { crucibleError } = require('./failureCodes');
const { PROVIDER_IDS, describeProvider, modelFor, redact, assertNoCredentialsPersisted } = require('./aiProviderRegistry');
const { CORROBORATION_OUTCOMES, assertConsensusDoesNotAuthorize } = require('./multiAiDeliberation');
const { assertMutationAllowed } = require('./mutationClaims');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

// Normalised for comparison only. The stored response keeps its original text; agreement is
// judged on a form that ignores whitespace and case, which are not disagreements.
function comparable(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim();
}

class MultiAiOrchestrator {
  // `authorize` is injected rather than imported so the external-AI firewall stays a boundary
  // concern and this stays replaceable. A deployment that has no firewall passes nothing and
  // gets no egress authorisation step; one that has it passes it in and every call is permitted
  // individually.
  constructor({ env = process.env, now = () => new Date().toISOString(), authorize = null } = {}) {
    this.env = env;
    this.now = now;
    this.authorize = authorize;
    this.adapters = new Map();
  }

  register(providerId, adapter) {
    const provider = describeProvider(providerId);
    if (!adapter || typeof adapter.run !== 'function') throw crucibleError('CRU-0033', `Adapter for ${provider.label} must expose a run({ prompt, model, signal }) function.`);
    this.adapters.set(provider.id, adapter);
    return this;
  }

  registered() {
    return [...this.adapters.keys()];
  }

  // One bounded task, several providers, answers kept separate. The prompt is checked for
  // credentials before it leaves: the most common way a key escapes is being pasted into the
  // context an agent then sends to four different vendors.
  async distribute({ taskId, prompt, providers = this.registered(), purpose = 'multi-provider consultation' }) {
    if (typeof taskId !== 'string' || !taskId.trim()) throw crucibleError('CRU-0034', 'A distributed task requires a taskId so every response can be traced back to the question.');
    if (typeof prompt !== 'string' || !prompt.trim()) throw crucibleError('CRU-0034', 'A distributed task requires a prompt.');
    assertNoCredentialsPersisted(prompt, { env: this.env, label: `task ${taskId} prompt` });

    const requested = providers.length ? providers : this.registered();
    if (!requested.length) throw crucibleError('CRU-0034', 'No providers are registered, so this task cannot be distributed. Register at least one adapter first.');

    const promptSha256 = sha256(prompt);
    const responses = [];
    const failures = [];

    for (const providerId of requested) {
      const provider = describeProvider(providerId);
      const adapter = this.adapters.get(provider.id);
      const model = modelFor(provider.id, this.env);
      if (!adapter) {
        failures.push({ provider: provider.id, model, at: this.now(), reason: `No adapter registered for ${provider.label}.` });
        continue;
      }
      try {
        if (this.authorize) this.authorize({ provider: provider.id, payloadSha256: promptSha256, fields: ['prompt'], purpose });
        const result = await adapter.run({ prompt, model, taskId });
        const text = typeof result === 'string' ? result : result?.text;
        if (typeof text !== 'string' || !text.trim()) {
          failures.push({ provider: provider.id, model, at: this.now(), reason: `${provider.label} returned no usable text.` });
          continue;
        }
        responses.push({
          provider: provider.id,
          model: (result && result.model) || model || null,
          taskId,
          at: this.now(),
          promptSha256,
          responseSha256: sha256(text),
          text: redact(text, this.env),
          evidence: Array.isArray(result?.evidence) ? result.evidence.map((item) => redact(item, this.env)) : [],
        });
      } catch (error) {
        // Recorded, never swallowed. A caller that wants to proceed on partial coverage has to
        // see the gap in order to decide that.
        failures.push({ provider: provider.id, model, at: this.now(), reason: redact(error && error.message ? error.message : String(error), this.env) });
      }
    }

    return {
      taskId,
      promptSha256,
      requested: requested.map((id) => describeProvider(id).id),
      responses,
      failures,
      // Stated on every result so no consumer has to infer it.
      promotionAuthorized: false,
      ownerApproved: false,
    };
  }

  // Turn a distribution into one of the five governed outcomes. Deliberately conservative: any
  // provider that could not be reached drags the result down to insufficient-evidence, because
  // agreement among the reachable subset says nothing about the ones that were not asked.
  corroborate(distribution, { testVerified = false } = {}) {
    if (!distribution || !Array.isArray(distribution.responses)) throw crucibleError('CRU-0034', 'Corroboration requires a distribution result with a responses array.');
    const { responses, failures = [] } = distribution;
    const answered = responses.length;

    let outcome;
    let rationaleSummary;

    if (answered === 0) {
      outcome = 'insufficient-evidence';
      rationaleSummary = `No provider produced a usable response${failures.length ? ` (${failures.length} failed)` : ''}. Nothing is corroborated.`;
    } else if (failures.length) {
      outcome = 'insufficient-evidence';
      rationaleSummary = `${answered} provider(s) answered but ${failures.length} failed (${failures.map((item) => item.provider).join(', ')}). Agreement among the providers that happened to answer is not coverage; the unreached providers are unknown, not agreeing.`;
    } else if (answered === 1) {
      outcome = 'insufficient-evidence';
      rationaleSummary = 'Only one provider answered. A single model agreeing with itself is not corroboration.';
    } else {
      const distinct = new Set(responses.map((item) => comparable(item.text)));
      if (distinct.size === 1) {
        outcome = 'consensus';
        rationaleSummary = `${answered} providers returned the same substantive answer. Cross-model agreement is evidence, not proof: it does not authorise the change.`;
      } else if (distinct.size < answered) {
        outcome = 'partial-agreement';
        rationaleSummary = `${answered} providers returned ${distinct.size} distinct answers. Some agree and some do not; the disagreement is preserved rather than averaged away.`;
      } else {
        outcome = 'unresolved-conflict';
        rationaleSummary = `${answered} providers returned ${distinct.size} distinct answers with no overlap. This is escalated to the repository owner with every position preserved.`;
      }
    }

    // A passing test is a fact about the code, and outranks any amount of model agreement - but
    // it still is not owner approval.
    if (testVerified && outcome !== 'unresolved-conflict') {
      outcome = 'test-verified';
      rationaleSummary = `${rationaleSummary} A test independently verified the behaviour, which outranks model agreement as evidence but is still not owner approval.`;
    }

    const corroboration = {
      outcome,
      rationaleSummary,
      assessedAt: this.now(),
      providers: responses.map((item) => ({ provider: item.provider, model: item.model, responseSha256: item.responseSha256 })),
      failures: failures.map((item) => ({ provider: item.provider, reason: item.reason })),
      escalatedToOwner: outcome === 'unresolved-conflict',
      ownerApproved: false,
      promotionAuthorized: false,
    };
    assertConsensusDoesNotAuthorize(corroboration);
    return corroboration;
  }

  // The single place a multi-provider result meets the exclusive-ownership rule. Distribution and
  // corroboration are read-only and are allowed against any scope, including a claimed one; only
  // a mutation has to prove it owns what it is about to change.
  assertMayMutate({ claims, conflicts, actor, paths }) {
    return assertMutationAllowed({ claims, conflicts, actor, paths });
  }
}

// Build the deliberation block that goes into AI-CONFLICTS.json from a distribution, so the
// permanent record carries the same provenance the run had rather than a retyped summary.
function deliberationFromDistribution(distribution, corroboration) {
  return {
    proposals: distribution.responses.map((item) => ({
      provider: item.provider,
      model: item.model,
      summary: item.text,
      evidence: item.evidence && item.evidence.length ? item.evidence : [`response ${item.responseSha256} to prompt ${item.promptSha256}`],
      at: item.at,
    })),
    positions: [],
    responses: [],
    corroboration,
  };
}

module.exports = {
  MultiAiOrchestrator, deliberationFromDistribution,
  sha256, comparable, CORROBORATION_OUTCOMES, PROVIDER_IDS,
};
