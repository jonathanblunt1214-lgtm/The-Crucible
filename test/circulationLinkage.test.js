const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SYSTEMS, GOVERNED_ORGANS, systemOf, linkageReport, auditCirculationLinkage, assertFlyByWire } = require('../src/circulationLinkage');

function tree(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${name}.js`), body);
  return dir;
}
const baselineFile = (t, value) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'baseline.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};

test('every module in src belongs to exactly one system', () => {
  const seen = new Map();
  for (const [system, modules] of Object.entries(SYSTEMS)) {
    for (const item of modules) {
      assert.ok(!seen.has(item), `${item} is claimed by both ${seen.get(item)} and ${system}`);
      seen.set(item, system);
    }
  }
  assert.deepEqual(linkageReport('src').unassigned, [], 'a module no system owns is a module no linkage rule reaches');
});

// The rule that matters: an edge toward the bus is the wire, not the cable.
test('an edge into circulation never counts against the ratchet', (t) => {
  const dir = tree(t, {
    testCadence: "require('./organismCirculation');",
    organismCirculation: "'use strict';",
  });
  const report = linkageReport(dir);
  assert.equal(report.throughCirculation, 1);
  assert.equal(report.total, 0, 'routing through the bus is the desired direction and is never penalised');
});

test('a new organ-to-organ connection that bypasses the bus fails the gate', (t) => {
  const dir = tree(t, {
    testCadence: "require('./security');",
    security: "'use strict';",
    organismCirculation: "'use strict';",
  });
  const before = auditCirculationLinkage({ root: dir, baselineFile: baselineFile(t, { directCrossSystemImports: 1, byPair: { 'nerves->immune': 1 } }) });
  assert.equal(before.ok, true, 'linkage that already existed is held, not retroactively failed');

  const grown = tree(t, {
    testCadence: "require('./security');",
    report: "require('./privacy');",
    security: "'use strict';",
    privacy: "'use strict';",
  });
  const after = auditCirculationLinkage({ root: grown, baselineFile: baselineFile(t, { directCrossSystemImports: 1, byPair: { 'nerves->immune': 1 } }) });
  assert.equal(after.ok, false);
  assert.match(after.reason, /must go through the bus/);
  assert.match(after.reason, /nerves->immune 1 -> 2/);
});

test('the ratchet reports when linkage falls, so it can be tightened', (t) => {
  const dir = tree(t, { testCadence: "require('./security');", security: "'use strict';" });
  const result = auditCirculationLinkage({ root: dir, baselineFile: baselineFile(t, { directCrossSystemImports: 9, byPair: {} }) });
  assert.equal(result.ok, true);
  assert.equal(result.tightened, true);
  assert.match(result.reason, /record the lower baseline/);
});

test('a module no system owns fails the gate rather than being excused', (t) => {
  const dir = tree(t, { testCadence: "'use strict';", somethingNobodyPlaced: "'use strict';" });
  const result = auditCirculationLinkage({ root: dir, baselineFile: baselineFile(t, { directCrossSystemImports: 99, byPair: {} }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no system owns/);
  assert.match(result.reason, /somethingNobodyPlaced/);
});

test('fly-by-wire cannot be enforced without a recorded baseline', (t) => {
  const dir = tree(t, { testCadence: "'use strict';" });
  const result = auditCirculationLinkage({ root: dir, baselineFile: path.join(dir, 'absent.json') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cannot be enforced without one/);
});

// The runtime half. A signal to an organ with no handler never arrives and nothing reports it.
test('the organism refuses to start with a severed wire', () => {
  const complete = Object.fromEntries(GOVERNED_ORGANS.map((name) => [name, async () => ({})]));
  assert.equal(assertFlyByWire(complete).flyByWire, true);

  const severed = { ...complete };
  delete severed.learning;
  assert.throws(() => assertFlyByWire(severed), /missing a handler for learning/);
  assert.throws(() => assertFlyByWire(severed), /never arrives/);
  assert.throws(() => assertFlyByWire({}), /brain, immune, digestive, learning, reporting/);
});

test('the live repository holds its recorded baseline', () => {
  const result = auditCirculationLinkage();
  assert.equal(result.ok, true, result.reason);
  assert.equal(systemOf('organismCirculation'), 'circulation');
  assert.equal(systemOf('scientificLearning'), 'learning');
});
