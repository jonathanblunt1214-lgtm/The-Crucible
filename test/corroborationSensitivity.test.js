const test = require('node:test');
const assert = require('node:assert/strict');
const { corroborationEntries, corroborationFunnel, corroborationSensitivity, corroboratedClaims } = require('../src/realCorpusLearning');
const { sourceIndex } = require('../src/sourceIndependence');

// Two independently worded sentences asserting the same thing. Verified to group together by
// test/semanticCorroboration.test.js, so anything this file observes is about the funnel rather
// than about whether the wording rule works.
const CLAIM_A = 'The Bash shell expands an unquoted shell variable into separate words on whitespace before the command runs inside the current interactive login environment.';
const CLAIM_B = 'A shell splits the unquoted shell variable into separate words on whitespace before a command runs inside the current interactive login environment.';

function record(id, claim, sourceId, provenance = {}) {
  return { state: 'candidate', candidate: { id, claim, provenance: { sourceId, ...provenance } } };
}

function bundle(sources) {
  return { sources };
}

// The failure this whole file exists to prevent. The first version of this instrument reported
// only the number of corroborated claims at each threshold. It came back 0, 0, 0, 0 on the real
// corpus, which reads as "the threshold is not the problem" and is not an answer: corroboration
// runs four filters in series, and each one alone yields that same zero. An instrument that
// cannot distinguish its own stages confirms whatever the reader already believed.
test('the funnel separates the stage that loses a claim from the stages that did not', () => {
  const index = sourceIndex(bundle([
    { id: 's-1', url: 'https://one.example/a', author: 'Ada' },
    { id: 's-2', url: 'https://two.example/b', author: 'Grace' },
  ]));

  // Agreement, two source ids, two independent sources: it survives every stage.
  const both = corroborationFunnel(corroborationEntries([record('c-1', CLAIM_A, 's-1'), record('c-2', CLAIM_B, 's-2')]).entries, { sourceIndex: index });
  assert.equal(both.groupsAgreeing, 1);
  assert.equal(both.groupsWithTwoSourceIds, 1);
  assert.equal(both.groupsWithTwoIndependentSources, 1);

  // The same agreement from one source id. It must be lost at the source stage, not the
  // grouping stage - the claims did agree.
  const one = corroborationFunnel(corroborationEntries([record('c-1', CLAIM_A, 's-1'), record('c-2', CLAIM_B, 's-1')]).entries, { sourceIndex: index });
  assert.equal(one.groupsAgreeing, 1, 'the claims still agree');
  assert.equal(one.groupsWithTwoSourceIds, 0);
  assert.equal(one.groupsWithTwoIndependentSources, 0);
  assert.equal(one.lostToOneSource.length, 1, 'the loss is named where it happened');

  // Two source ids that are two pages of one publisher. This is the case the endpoint-only
  // instrument could not see at all, and it is what a corpus of one publisher's library looks
  // like: every threshold reads zero while the wording rule was never involved.
  const sameSite = sourceIndex(bundle([
    { id: 's-1', url: 'https://publisher.example/book-one', author: 'Ada' },
    { id: 's-2', url: 'https://publisher.example/book-two', author: 'Grace' },
  ]));
  const dependent = corroborationFunnel(corroborationEntries([record('c-1', CLAIM_A, 's-1'), record('c-2', CLAIM_B, 's-2')]).entries, { sourceIndex: sameSite });
  assert.equal(dependent.groupsAgreeing, 1);
  assert.equal(dependent.groupsWithTwoSourceIds, 1, 'the ids did differ');
  assert.equal(dependent.groupsWithTwoIndependentSources, 0);
  assert.match(dependent.lostToDependence[0].reason, /one publisher/);
});

// An instrument that reports a different number than the thing it claims to be measuring is
// worse than no instrument, because it is believed. This pins the two together.
test('the configured row is the number the real path reports, at every threshold', () => {
  const index = sourceIndex(bundle([
    { id: 's-1', url: 'https://one.example/a', author: 'Ada' },
    { id: 's-2', url: 'https://two.example/b', author: 'Grace' },
  ]));
  const records = [record('c-1', CLAIM_A, 's-1'), record('c-2', CLAIM_B, 's-2')];
  const sensitivity = corroborationSensitivity(records, { sourceIndex: index });
  const configured = sensitivity.measured.find((row) => row.configured);
  assert.ok(configured, 'one row is always the configured threshold');
  assert.equal(configured.corroboratedClaims, corroboratedClaims(records, { sourceIndex: index }).length);

  for (const row of sensitivity.measured) {
    assert.equal(row.corroboratedClaims, corroboratedClaims(records, { sourceIndex: index, minimumOverlap: row.minimumOverlap }).length,
      `the row for ${row.minimumOverlap} must equal what that threshold really yields`);
  }
});

// The threshold has to actually reach the comparison. If it did not, every row would read the
// same and the instrument would report a flat line whatever the corpus contained - which is
// indistinguishable from the answer it gave on the real corpus.
test('the threshold argument reaches the sameness judgement', () => {
  const index = sourceIndex(bundle([
    { id: 's-1', url: 'https://one.example/a', author: 'Ada' },
    { id: 's-2', url: 'https://two.example/b', author: 'Grace' },
  ]));
  // Worded far enough apart to fall under 0.8 and above 0.5, so the rows must differ.
  const loose = 'A shell divides the unquoted shell variable into separate words on whitespace before a command runs.';
  const records = [record('c-1', CLAIM_A, 's-1'), record('c-2', loose, 's-2')];
  const rows = corroborationSensitivity(records, { sourceIndex: index }).measured;
  const at = (threshold) => rows.find((row) => row.minimumOverlap === threshold).corroboratedClaims;
  assert.equal(at(0.8), 0, 'too differently worded to pass the configured threshold');
  assert.equal(at(0.5), 1, 'and the same pair passes a looser one, so the argument is threaded');
});

test('the instrument decides nothing and authorizes nothing', () => {
  const sensitivity = corroborationSensitivity([record('c-1', CLAIM_A, 's-1')], {});
  assert.equal(sensitivity.decidesNothing, true);
  assert.equal(sensitivity.promotionAuthorized, false);
  assert.equal(sensitivity.candidatesJudged, 1);
});

// The diagnostic that decides what the owner does next, and the one I got wrong first.
//
// "Nothing corroborates" has two causes that demand opposite responses. If the corpus is fully
// digested, it truly holds no independent agreement and the answer is to ingest different
// sources. If most of it was never extracted, the answer is to run digestion - and changing
// what gets ingested would be effort spent on the wrong problem entirely.
//
// The stop message used to state only the first cause. On the real corpus it reported 127
// sources extracted and 278 still awaiting extraction, and I read that as proof the corpus
// lacked independent publishers. Four fifths of it had simply never been digested. The count
// was already in the diagnostics one line above; it just was not in the sentence saying what
// to do next.
const { learnFromRealCorpus } = require('../src/realCorpusLearning');
const { intakePathways } = require('../src/intakePathways');

test('an undigested backlog is named as the likely cause rather than blamed on the corpus', () => {
  const backlog = intakePathways({
    sources: [
      { id: 's-1', state: 'claim-extraction-complete', content: 'x' },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `s-p${index}`, state: 'claim-extraction-forced-pending', content: 'y' })),
    ],
    candidateRecords: [],
  });
  const undigested = backlog.diagnostics.signals.find((item) => item.signal === 'undigested-backlog');
  assert.ok(undigested, 'a corpus with sources awaiting extraction raises the backlog signal');
  assert.match(undigested.detail, /8 source\(s\) awaiting extraction/);

  // And a fully digested corpus raises no such signal, so the stop message falls through to
  // saying the corpus itself is the limit - which is only honest once digestion is done.
  const digested = intakePathways({
    sources: [{ id: 's-1', state: 'claim-extraction-complete', content: 'x' }, { id: 's-2', state: 'claim-extraction-complete', content: 'y' }],
    candidateRecords: [],
  });
  assert.equal(digested.diagnostics.signals.find((item) => item.signal === 'undigested-backlog'), undefined);
});

test('learnFromRealCorpus exposes the intake diagnostics it reasons from', () => {
  assert.equal(typeof learnFromRealCorpus, 'function');
  // The stop path reads intake.diagnostics.signals. If that shape ever changes, the reason
  // string silently loses its cause rather than failing, so the shape is pinned here.
  const shape = intakePathways({ sources: [{ id: 's', state: 'claim-extraction-forced-pending', content: 'x' }], candidateRecords: [] });
  assert.ok(Array.isArray(shape.diagnostics.signals), 'signals must stay an array the stop reason can search');
});
