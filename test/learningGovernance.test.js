const test = require('node:test');
const assert = require('node:assert/strict');
const { ADJUSTMENTS, FORBIDDEN_ACTIONS, detectBlockages, governLearningPipeline } = require('../src/learningGovernance');

const gates = (overrides = {}) => ({
  gates: ['R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'].map((id) => ({ id, state: overrides[id] || 'pending', detail: `${id} detail` })),
});
const healthy = { state: 'healthy' };

test('governance never claims authority over proof, promotion, or release', () => {
  const decision = governLearningPipeline({ readiness: gates(), analyzer: healthy, store: healthy });
  assert.equal(decision.authority.mayAdjustPipelineFlow, true);
  assert.equal(decision.authority.mayPromoteClaim, false);
  assert.equal(decision.authority.mayVerifyClaim, false);
  assert.equal(decision.authority.mayMarkGatePassed, false);
  assert.equal(decision.authority.mayAuthorizeRelease, false);
  assert.equal(decision.authority.mayStartHeldSoak, false);
  assert.equal(decision.authority.mayRepairDurableStore, false);
  assert.equal(decision.governanceIsTruthSource, false);
  for (const forbidden of ['promote-claim', 'verify-claim', 'mark-gate-passed', 'authorize-release', 'start-held-soak', 'repair-durable-store', 'shorten-soak', 'discard-evidence']) {
    assert.ok(FORBIDDEN_ACTIONS.includes(forbidden), `${forbidden} must stay permanently outside governance`);
    assert.ok(!ADJUSTMENTS.includes(forbidden), `${forbidden} must never appear in the adjustment allow-list`);
  }
});

test('every adjustment governance can emit comes from the closed allow-list', () => {
  // Exhaust the input space that produces blockages, not one convenient case.
  for (const analyzer of [healthy, { state: 'degraded' }]) {
    for (const store of [healthy, { state: 'degraded' }]) {
      for (const overrides of [{}, { R2: 'satisfied' }, { R2: 'satisfied', R3: 'satisfied', R4: 'satisfied' }, { R2: 'satisfied', R3: 'satisfied', R4: 'satisfied', R5: 'satisfied' }]) {
        for (const queuedSources of [0, 4, 288]) {
          const decision = governLearningPipeline({ readiness: gates(overrides), analyzer, store, queuedSources, contradictions: 2, recirculated: 3 });
          for (const adjustment of decision.adjustments) assert.ok(ADJUSTMENTS.includes(adjustment), `${adjustment} is outside the allow-list`);
          for (const item of decision.blockages) for (const adjustment of item.adjustments) assert.ok(ADJUSTMENTS.includes(adjustment), `${adjustment} is outside the allow-list`);
        }
      }
    }
  }
  // And the allow-list itself is a closed set of flow controls, with nothing that touches evidence.
  for (const adjustment of ADJUSTMENTS) assert.match(adjustment, /^(prioritize|hold|throttle|route|deprioritize)-/);
  assert.equal(detectBlockages({}).length, 0, 'no observation means no invented blockage');
});

test('a degraded durable store halts mutation and escalates instead of being repaired', () => {
  const decision = governLearningPipeline({ readiness: gates(), store: { state: 'degraded', detail: 'integrity check failed' }, analyzer: healthy });
  assert.equal(decision.blockages[0].id, 'durable-store-degraded');
  assert.equal(decision.blockages[0].severity, 'critical');
  assert.ok(decision.adjustments.includes('hold-all-mutation'));
  assert.ok(decision.escalations.some((item) => item.id === 'durable-store-degraded'));
  assert.equal(decision.authority.mayRepairDurableStore, false);
  for (const adjustment of decision.adjustments) assert.ok(!adjustment.startsWith('prioritize-'), 'nothing is driven while all mutation is held');
});

// The analyzers are learning-system components, so their health is a learning blockage.
test('a degraded semantic analyzer is treated as a learning blockage, not someone else\'s problem', () => {
  const decision = governLearningPipeline({ readiness: gates(), analyzer: { state: 'degraded', detail: 'roslyn adapter failed closed' }, store: healthy });
  const found = decision.blockages.find((item) => item.id === 'semantic-analyzer-degraded');
  assert.ok(found, 'analyzer health is inside the learning system');
  assert.equal(found.severity, 'high');
  assert.ok(decision.adjustments.includes('hold-analyzer-dependent-analysis'));
  assert.ok(decision.escalations.some((item) => item.id === 'semantic-analyzer-degraded'));
});

test('candidates piling up behind an empty verified store redirect work to evaluation', () => {
  const decision = governLearningPipeline({ readiness: gates({ R2: 'satisfied', R3: 'satisfied', R4: 'satisfied' }), analyzer: healthy, store: healthy });
  const found = decision.blockages.find((item) => item.id === 'evaluation-starved');
  assert.ok(found);
  assert.ok(decision.adjustments.includes('prioritize-claim-evaluation'));
  assert.ok(decision.adjustments.includes('hold-discovery'), 'gathering more cannot clear an evaluation blockage');
  assert.ok(!decision.adjustments.includes('prioritize-discovery'), 'a hold outranks a prioritization of the same stage');
});

test('a heavy extraction backlog pauses discovery; a light one merely prioritizes extraction', () => {
  const heavy = governLearningPipeline({ readiness: gates(), analyzer: healthy, store: healthy, queuedSources: 288 });
  assert.ok(heavy.adjustments.includes('prioritize-extraction'));
  assert.ok(heavy.adjustments.includes('hold-discovery'));

  const light = governLearningPipeline({ readiness: gates(), analyzer: healthy, store: healthy, queuedSources: 4 });
  assert.ok(light.adjustments.includes('prioritize-extraction'));
  assert.ok(!light.adjustments.includes('hold-discovery'));
});

test('discovery is only driven when nothing is already waiting to be worked', () => {
  const backlog = governLearningPipeline({ readiness: gates(), analyzer: healthy, store: healthy, queuedSources: 10 });
  assert.ok(!backlog.adjustments.includes('prioritize-discovery'));

  const idle = governLearningPipeline({ readiness: gates({ R2: 'satisfied' }), analyzer: healthy, store: healthy });
  assert.ok(idle.adjustments.includes('prioritize-discovery'));
});

test('contradictions route to review and recirculated sources stay behind new data', () => {
  const decision = governLearningPipeline({ readiness: gates({ R2: 'satisfied', R3: 'satisfied' }), analyzer: healthy, store: healthy, contradictions: 3, recirculated: 7 });
  assert.ok(decision.adjustments.includes('route-contradictions-to-review'));
  assert.ok(decision.adjustments.includes('deprioritize-recirculated-sources'));
});

test('blockages are ordered by severity so the worst obstruction is addressed first', () => {
  const decision = governLearningPipeline({ readiness: gates({ R2: 'satisfied', R3: 'satisfied', R4: 'satisfied' }), analyzer: { state: 'degraded' }, store: { state: 'degraded' }, contradictions: 1, recirculated: 1 });
  const severities = decision.blockages.map((item) => item.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a) - ['critical', 'high', 'medium', 'low'].indexOf(b)));
  assert.equal(decision.blockages[0].severity, 'critical');
});

test('a clear pipeline produces no adjustments and still asserts its limits', () => {
  const decision = governLearningPipeline({ readiness: gates({ R2: 'satisfied', R3: 'satisfied', R4: 'satisfied', R5: 'satisfied' }), analyzer: healthy, store: healthy });
  assert.equal(decision.state, 'clear');
  assert.deepEqual(decision.blockages, []);
  assert.deepEqual(decision.adjustments, []);
  assert.equal(decision.authority.mayMarkGatePassed, false);
});
