'use strict';
// A traceable packet pushed through the real pipeline to find where it actually breaks.
//
// The corpus tells us WHERE it dies - 127 sources extracted, 278 awaiting extraction, every
// cross-source agreement refused at publisher independence - but not WHY any given stage behaves
// as it does, because the only material available is 403 real documents whose correct outcome
// nobody knows independently. A diagnosis built on material whose right answer is unknown is a
// guess with numbers attached.
//
// So this builds material whose right answer IS known. Every source and claim in the packet is
// designed to exercise one stage, and carries the outcome that stage must produce. Running it
// through the real path and comparing designed against observed turns "corroboration returns 0"
// into "stage N disagreed with its own contract, here is the pair and here is the reason it
// gave". A stage that passes its own designed case is exonerated; a stage that fails one is the
// defect, located exactly.
//
// Two properties this must never lose:
//   - It cannot promote. Every record it produces is Insufficient Evidence and it declares no
//     scope, so nothing it touches can reach a knowledge version. It is a diagnostic.
//   - It cannot contaminate. It builds its own bundle and learning root under a caller-supplied
//     directory and never reads or writes the real corpus or the durable store.
//
// It lives in the learning system and imports only learning modules, so it adds no direct
// organ-to-organ edge; the fly-by-wire ratchet stays where it is.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readBundle, corroborationEntries, corroborationFunnel, corroboratedClaims } = require('./realCorpusLearning');
const { semanticallyCorroborates } = require('./semanticCorroboration');
const { sourceIndex, independent, factsFor } = require('./sourceIndependence');

const MARKER = 'crucible-pipeline-tracer';
const AT = '2026-01-01T00:00:00.000Z';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// The packet. Each entry states the stage it exercises and the outcome that stage owes it, so a
// disagreement is attributable to one stage rather than to the pipeline in general.
//
// Claims are worded as independently as two real documents would word them: different sentence
// shape, different incidental vocabulary, the same assertion. Anything less would be testing
// near-duplicate matching, which is the failure mode corroboration exists to avoid.
function tracerPacket() {
  return [
    // Must corroborate. Worded differently but sharing the vocabulary a close paraphrase shares,
    // so this pair proves the whole path works end to end. If this fails, the pipeline is broken.
    { id: `${MARKER}-independent-a`, site: 'https://alpha.example/tcp', author: 'Ada Alpha',
      claim: 'A TCP connection is established by a three-way handshake before application data is sent.',
      exercises: 'corroboration + independence', expect: 'must corroborate with independent-b' },
    { id: `${MARKER}-independent-b`, site: 'https://beta.example/tcp', author: 'Grace Beta',
      claim: 'A TCP connection gets established through a three-way handshake before application data is sent.',
      exercises: 'corroboration + independence', expect: 'must corroborate with independent-a' },

    // Must agree on wording and be refused by INDEPENDENCE alone. Two pages of one publisher, so
    // if this pair is refused for any other reason the refusal is coming from the wrong stage.
    { id: `${MARKER}-same-publisher-a`, site: 'https://onepublisher.example/page-one', author: 'Ada Alpha',
      claim: 'An undrained queue keeps growing until the process holding it exhausts its available memory.',
      exercises: 'independence refusal', expect: 'wording agrees; refused only as same publisher' },
    { id: `${MARKER}-same-publisher-b`, site: 'https://onepublisher.example/page-two', author: 'Grace Beta',
      claim: 'An undrained queue keeps growing until the process holding it exhausts its available heap memory.',
      exercises: 'independence refusal', expect: 'wording agrees; refused only as same publisher' },

    // Must be refused on polarity, however close the wording.
    { id: `${MARKER}-contradiction`, site: 'https://gamma.example/tcp', author: 'Hopper Gamma',
      claim: 'A TCP connection is not established by a three-way handshake before application data is sent.',
      exercises: 'polarity refusal', expect: 'refused: opposite polarity to independent-a' },

    // Must never reach corroboration at all.
    { id: `${MARKER}-furniture`, site: 'https://delta.example/nav', author: 'Delta Docs',
      claim: 'Table of Contents Previous Next Copyright 2026 All rights reserved.',
      exercises: 'furniture exclusion', expect: 'excluded before corroboration' },

    // Must be refused on committed numbers.
    { id: `${MARKER}-numbers`, site: 'https://epsilon.example/retry', author: 'Eve Epsilon',
      claim: 'The retry policy attempts the failing request 3 times before it gives up and reports the operation as failed.',
      exercises: 'number refusal', expect: 'refused: different numbers to numbers-conflict' },
    { id: `${MARKER}-numbers-conflict`, site: 'https://zeta.example/retry', author: 'Zoe Zeta',
      claim: 'The retry policy attempts the failing request 5 times before it gives up and reports the operation as failed.',
      exercises: 'number refusal', expect: 'refused: different numbers to numbers' },

    // CALIBRATION, not a pass/fail case. Two sentences a person would unhesitatingly call the same
    // claim, worded the way genuinely independent documents word things - different sentence shape,
    // different incidental vocabulary. Its overlap is measured and reported rather than asserted,
    // because whether the threshold should admit it is the owner's judgement about what counts as
    // the same claim, not a defect the pipeline can be said to have. Reporting it keeps that
    // decision anchored to a case whose right answer a human already knows.
    { id: `${MARKER}-calibration-a`, site: 'https://eta.example/tcp', author: 'Ida Eta', calibration: true,
      claim: 'A TCP connection is established by a three-way handshake between the two endpoints before any application data is sent.',
      exercises: 'threshold calibration', expect: 'measured, not asserted' },
    { id: `${MARKER}-calibration-b`, site: 'https://theta.example/tcp', author: 'Otto Theta', calibration: true,
      claim: 'Before an endpoint sends application data over TCP, the connection gets established through a handshake of three messages.',
      exercises: 'threshold calibration', expect: 'measured, not asserted' },
  ];
}

// A bundle in the shape readBundle expects, holding the packet as extracted candidates so the
// trace begins where the real corpus's own material begins.
function stageTracerBundle(root, projectId, packet = tracerPacket()) {
  const bundleRoot = path.join(root, 'bundle');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  const links = packet.map((item) => {
    const body = Buffer.from(`${item.claim}\n`);
    const digest = sha256(body);
    fs.writeFileSync(path.join(bundleRoot, 'sources', `${digest}.bin`), body);
    return {
      id: item.id, state: 'claim-extraction-complete', url: item.site, finalUrl: item.site,
      contentType: 'text/plain', contentSha256: digest, durablePath: `sources/${digest}.bin`,
      retrievedAt: AT, author: item.author,
    };
  });
  const queue = { schemaVersion: 1, projectId, updatedAt: AT, documents: [], links };
  const queueFile = path.join(bundleRoot, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1, projectId, repository: 'tracer/packet', ref: 'refs/heads/development',
    queueSha256: sha256(Buffer.from(fs.readFileSync(queueFile, 'utf8'))),
    sourceFiles: links.map((link) => ({ name: `${link.contentSha256}.bin`, sha256: link.contentSha256, bytes: 1 })),
  }, null, 2)}\n`);
  return { bundleRoot, packet, links };
}

// Candidate records in the shape corroboration reads, one per packet entry.
function tracerRecords(projectId, packet, links) {
  const bySite = new Map(links.map((link) => [link.id, link]));
  return packet.map((item) => ({
    state: 'candidate',
    candidate: {
      id: item.id, projectId, claim: item.claim, claimBoundary: 'tracer', kind: 'extracted-source-assertion',
      provenance: {
        sourceType: 'retrieved-web-document', sourceId: item.id, retrievedAt: AT,
        author: item.author, license: 'tracer', contentSha256: bySite.get(item.id).contentSha256,
        url: item.site, finalUrl: item.site,
      },
      createdAt: AT,
    },
  }));
}

// The trace. Each stage reports what the packet designed, what the pipeline did, and whether they
// agree - so a disagreement names one stage.
function tracePipeline({ root, projectId = 'tracer-project' }) {
  const { bundleRoot, packet, links } = stageTracerBundle(root, projectId);
  const bundle = readBundle(bundleRoot);
  const records = tracerRecords(projectId, packet, links);
  const claimOf = new Map(packet.map((item) => [item.id, item.claim]));
  const index = sourceIndex(bundle);
  const stages = [];
  const check = (stage, expected, observed, detail) => {
    stages.push({ stage, expected, observed, agrees: expected === observed, detail });
  };

  // Stage 1 - furniture exclusion. The packet's chrome entry must not survive into the set
  // corroboration judges, and every designed assertion must.
  const { entries, furnitureExcluded } = corroborationEntries(records);
  const survived = new Set(entries.map((entry) => entry.id));
  check('furniture-exclusion', true, !survived.has(`${MARKER}-furniture`), `excluded ${furnitureExcluded.length}: ${furnitureExcluded.map((item) => item.candidateId).join(', ') || 'none'}`);
  check('assertions-survive-furniture', packet.length - 1, entries.length, `${entries.length} of ${packet.length} packet entries reached corroboration; only the furniture entry may be dropped`);

  // Stage 2 - the sameness judgement, pair by pair, using the real comparison.
  const pair = (left, right) => semanticallyCorroborates(claimOf.get(`${MARKER}-${left}`), claimOf.get(`${MARKER}-${right}`));
  const agreeing = pair('independent-a', 'independent-b');
  check('sameness-accepts-paraphrase', true, agreeing.corroborates, agreeing.reason);
  const opposite = pair('independent-a', 'contradiction');
  check('sameness-refuses-polarity', true, !opposite.corroborates && /polarity/.test(opposite.reason), opposite.reason);
  const numbers = pair('numbers', 'numbers-conflict');
  check('sameness-refuses-numbers', true, !numbers.corroborates && /different numbers/.test(numbers.reason), numbers.reason);
  const samePublisher = pair('same-publisher-a', 'same-publisher-b');
  check('sameness-accepts-same-publisher-pair', true, samePublisher.corroborates, `${samePublisher.reason} (independence must be what refuses this pair, not wording)`);

  // Stage 3 - independence, judged on the same facts the real path uses.
  const factsFor_ = (id) => factsFor(id, index, records.find((record) => record.candidate.id === id).candidate.provenance);
  const cross = independent(factsFor_(`${MARKER}-independent-a`), factsFor_(`${MARKER}-independent-b`));
  check('independence-accepts-two-publishers', true, cross.independent, cross.reason);
  const same = independent(factsFor_(`${MARKER}-same-publisher-a`), factsFor_(`${MARKER}-same-publisher-b`));
  check('independence-refuses-one-publisher', true, !same.independent, same.reason);

  // Stage 4 - the whole funnel, and the end-to-end result the pipeline actually returns.
  const funnel = corroborationFunnel(entries, { sourceIndex: index });
  check('funnel-finds-one-agreeing-group', true, funnel.groupsAgreeing >= 2, `${funnel.groupsAgreeing} agreeing group(s), ${funnel.groupsWithTwoSourceIds} with two source ids, ${funnel.groupsWithTwoIndependentSources} independent`);
  const corroborated = corroboratedClaims(records, { sourceIndex: index });
  check('end-to-end-corroborates-the-designed-pair', 1, corroborated.length, corroborated.length
    ? `corroborated: ${corroborated.map((item) => item.candidateIds.join(' + ')).join('; ')}`
    : 'the packet was designed to corroborate exactly one claim and the pipeline found none');

  // Calibration, reported and never asserted. This is the pair whose right answer a person knows
  // and the configured threshold may still refuse; keeping it beside the pass/fail stages is what
  // stops "the threshold refused a real paraphrase" being read as "the pipeline is broken".
  const calibrationPair = semanticallyCorroborates(claimOf.get(`${MARKER}-calibration-a`), claimOf.get(`${MARKER}-calibration-b`));
  const calibration = {
    pair: [`${MARKER}-calibration-a`, `${MARKER}-calibration-b`],
    humanVerdict: 'the same claim, worded as two independent documents would word it',
    corroborates: calibrationPair.corroborates,
    overlap: calibrationPair.overlap ?? null,
    reason: calibrationPair.reason,
    decidesNothing: true,
  };

  const failed = stages.filter((item) => !item.agrees);
  return {
    schemaVersion: 1, marker: MARKER, projectId, bundleRoot,
    packet: packet.map(({ id, exercises, expect }) => ({ id, exercises, expect })),
    stages, calibration, healthy: failed.length === 0, failedStages: failed.map((item) => item.stage),
    // Said in the artifact itself, because a diagnostic that reads like a proof is how a
    // diagnostic becomes one by accident.
    isEvidence: false, proofStageSatisfied: false, promotionAuthorized: false,
  };
}

module.exports = { MARKER, tracerPacket, stageTracerBundle, tracerRecords, tracePipeline };

if (require.main === module) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'crucible-tracer-'));
  try {
    const report = tracePipeline({ root });
    for (const stage of report.stages) {
      console.log(`[The Crucible] tracer ${stage.agrees ? 'OK  ' : 'FAIL'} ${stage.stage}: expected ${JSON.stringify(stage.expected)}, observed ${JSON.stringify(stage.observed)} - ${stage.detail}`);
    }
    console.log(`[The Crucible] tracer calibration (decides nothing): a human-obvious paraphrase scores ${report.calibration.overlap === null ? 'n/a' : report.calibration.overlap.toFixed(2)} and ${report.calibration.corroborates ? 'is corroborated' : 'is NOT corroborated'} - ${report.calibration.reason}`);
    console.log(`[The Crucible] tracer: ${report.healthy ? 'every designed stage behaved as designed' : `${report.failedStages.length} stage(s) disagreed with the packet: ${report.failedStages.join(', ')}`}. This decides nothing and authorizes nothing.`);
    if (!report.healthy) process.exitCode = 1;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
