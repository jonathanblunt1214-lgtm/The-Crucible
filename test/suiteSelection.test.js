const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SUITE_CATEGORIES, validateSuiteSelection, categoryEnabled, applySuiteSelection } = require('../src/suiteSelection');
const { configureSuite } = require('../src/configureSuite');

test('whole suite is the backward-compatible default', () => {
  const suite = validateSuiteSelection();
  assert.equal(suite.mode, 'all');
  assert.deepEqual(suite.categories, SUITE_CATEGORIES);
  assert.ok(SUITE_CATEGORIES.every((category) => categoryEnabled(suite, category)));
});

test('selected categories persist and disable unselected categories', () => {
  const config = applySuiteSelection({ schemaVersion:1 }, 'selected', ['security', 'repository', 'security']);
  assert.deepEqual(config.suite, { mode:'selected', categories:['security', 'repository'] });
  assert.equal(categoryEnabled(validateSuiteSelection(config.suite), 'security'), true);
  assert.equal(categoryEnabled(validateSuiteSelection(config.suite), 'privacy'), false);
});

test('selected mode fails closed for missing or unknown categories', () => {
  assert.throws(() => validateSuiteSelection({ mode:'selected', categories:[] }), /at least one/);
  assert.throws(() => validateSuiteSelection({ mode:'selected', categories:['everything'] }), /may contain only/);
});

test('initial configurator asks once and persists selected categories until changed', async () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-suite-')), '.thecrucible.json');
  fs.writeFileSync(target, JSON.stringify({ schemaVersion:1, project:{ name:'Fixture' }, commands:{ verify:[{ name:'Test', run:'node' }] }, privacy:{ githubIdentity:'octocat' } }));
  const answers = ['selected', 'security, repository'];
  const suite = await configureSuite(target, { prompt:{ question:async () => answers.shift() } });
  assert.deepEqual(suite, { mode:'selected', categories:['security', 'repository'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')).suite, suite);
});

test('initial configurator asks for explicit topology when a project has three or more folders', async () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-topology-')), '.thecrucible.json');
  fs.writeFileSync(target, JSON.stringify({ schemaVersion:1, project:{ name:'Fixture' }, commands:{ verify:[{ name:'Test', run:'node' }] }, privacy:{ githubIdentity:'octocat' } }));
  const answers = ['all', 'influences-main', '123', 'checks-only', '123', 'archive', ''];
  await configureSuite(target, { folderNames:['app', 'checks', 'history'], prompt:{ question:async () => answers.shift() } });
  const topology = JSON.parse(fs.readFileSync(target, 'utf8')).project.folderTopology;
  assert.deepEqual(topology.folders, [
    { path:'app', roles:['influences-main'], links:['123'] },
    { path:'checks', roles:['checks-only'], links:['123'] },
    { path:'history', roles:['archive'], links:[] },
  ]);
});
