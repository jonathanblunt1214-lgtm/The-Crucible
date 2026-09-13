'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { continuousHealthView, conciseHealthText } = require('../src/organismHealth');

test('continuous health reports every organ and its exact missing dependency', () => {
  const runtime = { health: () => ({ projectId: 'p', state: 'degraded', oversight: { state: 'CLEAR' }, queue: { active: 2, capacity: 10 }, organs: { brain: { state: 'healthy', missingDependency: null }, immune: { state: 'degraded', missingDependency: 'independent verifier' } } }) };
  const view = continuousHealthView({ runtime, dependencies: { brain: { available: false, reason: 'planner offline' } }, observedAt: '2026-09-01T06:00:00.000Z' });
  assert.equal(view.state, 'degraded');
  assert.deepEqual(view.exactMissingDependencies, [{ organ: 'brain', dependency: 'planner offline' }, { organ: 'immune', dependency: 'independent verifier' }]);
  assert.match(conciseHealthText(view), /brain: unavailable \(planner offline\)/);
});

test('oversight STOP dominates the health view', () => {
  const runtime = { health: () => ({ projectId: 'p', state: 'inhibited', oversight: { state: 'STOP', reason: 'scope violation' }, queue: { active: 0, capacity: 10 }, organs: { brain: { state: 'healthy', missingDependency: null } } }) };
  assert.equal(continuousHealthView({ runtime }).state, 'inhibited');
});
