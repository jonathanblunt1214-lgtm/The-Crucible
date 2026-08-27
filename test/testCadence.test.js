const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CADENCE_TIERS, TEST_CADENCE, AUDIT_CADENCE, ERROR_TRIGGERS,
  tierRank, testsForTier, auditsForTier, auditsForError, runTier, runError,
} = require('../src/testCadence');

test('cadence tiers escalate in the documented order', () => {
  assert.deepEqual(CADENCE_TIERS, ['every-push', 'daily', 'weekly', 'monthly']);
  assert.equal(tierRank('every-push'), 0);
  assert.equal(tierRank('monthly'), 3);
  assert.throws(() => tierRank('yearly'), /Unknown cadence tier "yearly"/);
});

test('every test file listed in the registry actually exists', () => {
  for (const file of Object.keys(TEST_CADENCE)) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} referenced in TEST_CADENCE does not exist`);
});

test('every test file listed in the registry has a valid tier', () => {
  for (const [file, tier] of Object.entries(TEST_CADENCE)) assert.ok(CADENCE_TIERS.includes(tier), `${file} has invalid tier "${tier}"`);
});

test('every audit script listed in AUDIT_CADENCE is a real package.json script', () => {
  const scripts = require('../package.json').scripts;
  for (const tier of CADENCE_TIERS) {
    for (const script of AUDIT_CADENCE[tier] || []) assert.ok(scripts[script], `AUDIT_CADENCE.${tier} references unknown script "${script}"`);
  }
});

test('every on-error trigger only lists read-only audits, never a mutating fixer', () => {
  const forbidden = ['repair', 'fix-commit', 'scrub:privacy', 'docs:sync'];
  for (const [trigger, scripts] of Object.entries(ERROR_TRIGGERS)) {
    for (const script of scripts) assert.ok(!forbidden.includes(script), `on-error trigger "${trigger}" must not run mutating script "${script}" unattended`);
  }
});

test('testsForTier("every-push") includes every test file the registry does not explicitly move elsewhere', () => {
  const allFiles = fs.readdirSync(path.join(__dirname, '..', 'test')).filter((name) => name.endsWith('.test.js')).map((name) => `test/${name}`);
  const everyPush = testsForTier('every-push');
  const explicitlyMoved = Object.keys(TEST_CADENCE).filter((file) => TEST_CADENCE[file] !== 'every-push');
  for (const file of allFiles) {
    if (explicitlyMoved.includes(file)) assert.ok(!everyPush.includes(file), `${file} is tagged for a slower cadence but still appears in every-push`);
    else assert.ok(everyPush.includes(file), `${file} is untagged (defaults to every-push) but is missing from testsForTier('every-push')`);
  }
});

test('testsForTier is cumulative: a slower tier always includes everything a faster tier includes', () => {
  const everyPush = testsForTier('every-push');
  const daily = testsForTier('daily');
  const weekly = testsForTier('weekly');
  const monthly = testsForTier('monthly');
  for (const file of everyPush) assert.ok(daily.includes(file));
  for (const file of daily) assert.ok(weekly.includes(file));
  for (const file of weekly) assert.ok(monthly.includes(file));
  assert.ok(daily.includes('test/hostedMultiRepositoryIntegration.test.js'));
  assert.ok(!everyPush.includes('test/hostedMultiRepositoryIntegration.test.js'));
  assert.ok(weekly.includes('test/globalRepositoryGovernance.test.js'));
  assert.ok(!daily.includes('test/globalRepositoryGovernance.test.js'));
});

test('auditsForTier is cumulative across escalating tiers', () => {
  const everyPush = auditsForTier('every-push');
  const daily = auditsForTier('daily');
  const monthly = auditsForTier('monthly');
  for (const script of everyPush) assert.ok(daily.includes(script));
  assert.ok(daily.includes('audit:core-ref'));
  assert.ok(!everyPush.includes('audit:core-ref'));
  assert.ok(monthly.includes('audit:reproducibility'), 'monthly must still include weekly-tier audits');
});

test('auditsForError returns the mapped read-only diagnostics and rejects an unknown trigger', () => {
  assert.deepEqual(auditsForError('self-test-failure'), ['audit:core-ref', 'audit:github-security', 'audit:collisions']);
  assert.throws(() => auditsForError('made-up-trigger'), /Unknown on-error trigger "made-up-trigger"/);
});

test('runTier runs unit tests plus every audit for the tier and reports pass/fail per check', () => {
  const calls = [];
  const run = (executable, args) => { calls.push({ executable, args }); return { status: args.includes('audit:security') ? 1 : 0 }; };
  const result = runTier('every-push', run);
  assert.equal(result.tier, 'every-push');
  assert.ok(calls.some((call) => call.args[0] === '--test'));
  assert.equal(result.ok, false);
  assert.ok(result.outcomes.find((item) => item.label === 'npm run audit:security' && item.ok === false));
  assert.ok(result.outcomes.find((item) => item.label === 'npm run validate' && item.ok === true));
});

test('runTier with no unit tests assigned to a tier still runs that tier\'s audits', () => {
  const calls = [];
  const run = (executable, args) => { calls.push({ executable, args }); return { status: 0 }; };
  const result = runTier('every-push', run);
  assert.equal(result.ok, true);
  assert.ok(calls.every((call) => call.executable !== process.execPath || call.args[0] === '--test'));
});

test('runError runs only the mapped diagnostics and never touches an audit outside the trigger\'s list', () => {
  const calls = [];
  const run = (executable, args) => { calls.push(args.join(' ')); return { status: 0 }; };
  const result = runError('handoff-policy-failure', run);
  assert.equal(result.trigger, 'handoff-policy-failure');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /audit:ai-conflict-governance/);
});
