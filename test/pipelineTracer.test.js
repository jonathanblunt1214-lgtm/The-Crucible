'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MARKER, tracerPacket, tracePipeline } = require('../src/pipelineTracer');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-tracer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// The packet is material whose correct outcome is known before it is run, which is the only way
// to tell "the pipeline is broken" apart from "the corpus contains nothing". Every stage must
// behave as the packet designed; a stage that does not is the defect, named.
test('every designed stage of the pipeline behaves as the packet designed', (t) => {
  const report = tracePipeline({ root: workspace(t) });
  assert.equal(report.healthy, true, `stages disagreed with the packet: ${JSON.stringify(report.stages.filter((s) => !s.agrees), null, 2)}`);
  for (const stage of report.stages) assert.equal(stage.agrees, true, `${stage.stage}: ${stage.detail}`);
});

// The property that keeps a diagnostic from becoming a proof by accident.
test('the tracer decides nothing and authorizes nothing', (t) => {
  const report = tracePipeline({ root: workspace(t) });
  assert.equal(report.isEvidence, false);
  assert.equal(report.proofStageSatisfied, false);
  assert.equal(report.promotionAuthorized, false);
});

// Calibration is measured and reported, never asserted. Whether the threshold should admit a
// human-obvious paraphrase is a judgement about what counts as the same claim; pinning it as a
// pass/fail case here would quietly convert that judgement into a test the pipeline must satisfy.
test('the calibration pair is reported rather than asserted', (t) => {
  const report = tracePipeline({ root: workspace(t) });
  assert.equal(report.calibration.decidesNothing, true);
  assert.ok(typeof report.calibration.overlap === 'number', 'the overlap is measured');
  assert.ok(!report.failedStages.includes('threshold calibration'), 'calibration never fails the trace');
  assert.match(report.calibration.humanVerdict, /same claim/);
});

// Each entry states which stage it exercises, so a failure points at one stage rather than at
// "the pipeline". A packet whose entries stop saying that stops being diagnostic.
test('every packet entry names the stage it exercises and the outcome it expects', () => {
  const packet = tracerPacket();
  assert.ok(packet.length >= 8);
  for (const entry of packet) {
    assert.ok(entry.id.startsWith(MARKER), 'every entry is traceable to the tracer');
    assert.ok(entry.exercises && entry.expect, `${entry.id} must say what it exercises and expects`);
  }
  const exercised = new Set(packet.map((entry) => entry.exercises));
  for (const stage of ['corroboration + independence', 'independence refusal', 'polarity refusal', 'furniture exclusion', 'number refusal', 'threshold calibration']) {
    assert.ok(exercised.has(stage), `the packet must exercise ${stage}`);
  }
});
