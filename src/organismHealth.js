'use strict';

const VALID_STATES = new Set(['healthy', 'degraded', 'inhibited', 'quarantined', 'unavailable']);

function continuousHealthView({ runtime, dependencies = {}, observedAt = new Date().toISOString() }) {
  if (!runtime?.health) throw new Error('A live organism runtime is required.');
  const live = runtime.health();
  const organs = Object.fromEntries(Object.entries(live.organs).map(([id, value]) => {
    const dependency = dependencies[id];
    let state = value.state;
    let missingDependency = value.missingDependency;
    if (dependency && dependency.available === false) {
      state = dependency.inhibited ? 'inhibited' : 'unavailable';
      missingDependency = dependency.reason || `${id} dependency unavailable`;
    }
    if (!VALID_STATES.has(state)) state = 'degraded';
    return [id, { state, missingDependency: missingDependency || null }];
  }));
  const overall = live.oversight.state === 'STOP'
    ? 'inhibited'
    : Object.values(organs).some((item) => item.state !== 'healthy')
      ? 'degraded'
      : live.state;
  return Object.freeze({
    schemaVersion: 1,
    projectId: live.projectId,
    observedAt,
    state: overall,
    oversight: live.oversight,
    queue: live.queue,
    organs,
    exactMissingDependencies: Object.entries(organs)
      .filter(([, value]) => value.missingDependency)
      .map(([organ, value]) => ({ organ, dependency: value.missingDependency })),
  });
}

function conciseHealthText(view) {
  return [
    `Organism: ${view.state}`,
    `Oversight: ${view.oversight.state}`,
    `Queue: ${view.queue.active}/${view.queue.capacity}`,
    ...Object.entries(view.organs).map(([id, value]) => `${id}: ${value.state}${value.missingDependency ? ` (${value.missingDependency})` : ''}`),
  ].join('\n');
}

module.exports = { continuousHealthView, conciseHealthText, VALID_STATES };
