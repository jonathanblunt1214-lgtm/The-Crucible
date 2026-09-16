const test = require('node:test');
const assert = require('node:assert/strict');
const { preSoakReadiness, evaluateR2, evaluateR3, evaluateR4, evaluateR5, evaluateR6, evaluateR7, evaluateR8 } = require('../src/preSoakReadiness');

const sha = 'a'.repeat(64);
const candidate = (id, provenance = { sourceId: 'src-1', retrievedAt: '2026-09-01T00:00:00.000Z', contentSha256: sha }) => ({ candidate: { id, provenance } });
const ALL_EIGHT = ['kill-switch', 'duplicate-url', 'duplicate-content-hash', 'duplicate-claim', 'prompt-injection', 'executable-content', 'blocked-source', 'contradiction-quarantine'];

const everythingDone = () => ({
  payload: {
    candidateRecords: [candidate('c-1')],
    knowledgeVersions: [
      { version: 'v-1', boundary: 'node-22/linux/test-y', status: 'rolled-back', rollback: { at: '2026-09-02T00:00:00.000Z', reason: 'superseded by v-2' } },
      { version: 'v-2', boundary: 'node-22/linux/test-y', status: 'active' },
    ],
    activeVersion: 'v-2',
  },
  queue: { documents: [], links: [{ id: 's-1', state: 'claim-extraction-complete', contentSha256: sha }] },
  research: { topics: [{ topic: 'node', runs: 1 }], discoveredUrls: ['https://example.edu/a'], auditLog: [{ topic: 'node', state: 'completed', discovered: 1 }] },
  combinedSafetyEvidence: ALL_EIGHT,
});

test('R2 tracks the live drain and does not claim the restart proof it does not own', () => {
  assert.equal(evaluateR2({ links: [{ id: 's-1', state: 'claim-extraction-forced-pending' }] }).state, 'pending');
  const done = evaluateR2({ links: [{ id: 's-1', state: 'claim-extraction-complete', contentSha256: sha }] });
  assert.equal(done.state, 'satisfied');
  assert.match(done.detail, /durableLock\.test\.js/);
  assert.equal(evaluateR2({}).state, 'unknown', 'an absent queue is unknown, never satisfied');
});

// The real hosted corpus of 2026-09-15: hosted proof run 34947395586 restored 534 sources of
// which none sat in either extraction state, because 381 had been extracted and the rest had
// never been retrievable. Counting only the extraction states cannot tell those two apart, and
// the difference is the whole meaning of the gate.
const HOSTED_2026_09_15 = () => ({
  documents: Array.from({ length: 8 }, (item, index) => ({ id: `owner-file:doc-${index}`, state: 'claim-extraction-complete', contentSha256: sha })),
  links: [
    ...Array.from({ length: 373 }, (item, index) => ({ id: `linked-source:done-${index}`, state: 'claim-extraction-complete', contentSha256: sha })),
    ...Array.from({ length: 109 }, (item, index) => ({ id: `linked-source:blocked-${index}`, state: 'retrieval-blocked', contentSha256: null })),
    // A state this repository does not define anywhere: the Learning Worker writes it. The gate
    // must not bucket an unknown state by guessing, which is why custody decides instead.
    ...Array.from({ length: 25 }, (item, index) => ({ id: `linked-source:vetting-${index}`, state: 'oversight-vetting-pending', contentSha256: sha })),
    ...Array.from({ length: 19 }, (item, index) => ({ id: `linked-source:awaiting-${index}`, state: 'research-approved-pending-retrieval', contentSha256: null })),
  ],
});

test('R2 separates a drained backlog from one nothing could ever enter', () => {
  const hosted = HOSTED_2026_09_15();
  assert.equal(hosted.documents.length + hosted.links.length, 534, 'the fixture is the real population or it proves nothing');
  const report = evaluateR2(hosted);
  // 381 completions genuinely satisfy what R2 asks of the worker, so the verdict stands.
  assert.equal(report.state, 'satisfied');
  assert.match(report.detail, /381 of 534/, 'the detail has to say how many were actually extracted');
  assert.match(report.detail, /128/, 'and how many never became retrievable');
  assert.doesNotMatch(report.detail, /all 534/, 'never report 534 sources as having left a backlog 128 of them never entered');

  // The pure form of the same defect: an empty extraction backlog because nothing was ever
  // extractable. That must not read satisfied, and did before this test existed.
  const nothingRetrievable = evaluateR2({ links: [
    { id: 'linked-source:a', state: 'retrieval-blocked', contentSha256: null },
    { id: 'linked-source:b', state: 'research-approved-pending-retrieval', contentSha256: null },
  ] });
  assert.equal(nothingRetrievable.state, 'pending');
  assert.notEqual(nothingRetrievable.state, 'satisfied', 'an empty backlog is not a drained one');
  assert.match(nothingRetrievable.detail, /nothing ever entered it/);
});

test('R3 requires a completed bounded run that admitted a governed candidate URL', () => {
  assert.equal(evaluateR3({}).state, 'pending');
  assert.equal(evaluateR3({ topics: [{ topic: 'node', runs: 0 }] }).state, 'pending');
  assert.equal(evaluateR3({ topics: [{ topic: 'node', runs: 2 }], discoveredUrls: [], auditLog: [{ state: 'blocked', discovered: 0 }] }).state, 'pending');
  assert.equal(evaluateR3({ topics: [{ topic: 'node', runs: 2 }], discoveredUrls: [], auditLog: [{ state: 'completed', discovered: 0 }] }).state, 'pending');
  assert.equal(evaluateR3({ topics: [{ topic: 'node', runs: 2 }], discoveredUrls: ['https://example.edu/a'], auditLog: [{ state: 'completed', discovered: 1 }] }).state, 'satisfied');
});

test('R4 requires a complete provenance chain, not merely a candidate record', () => {
  assert.equal(evaluateR4({ candidateRecords: [] }).state, 'pending');
  assert.equal(evaluateR4({ candidateRecords: [candidate('c-1', { sourceId: 'src-1', retrievedAt: '2026-09-01T00:00:00.000Z', contentSha256: 'not-a-hash' })] }).state, 'pending');
  assert.equal(evaluateR4({ candidateRecords: [candidate('c-1')] }).state, 'satisfied');
});

test('R5 is the linchpin and reads pending while there is no verified version', () => {
  const pending = evaluateR5({ knowledgeVersions: [] });
  assert.equal(pending.state, 'pending');
  assert.match(pending.detail, /zero verified knowledge versions/);
  assert.equal(evaluateR5({ knowledgeVersions: [{ version: 'v-1' }] }).state, 'satisfied');
});

test('R6 requires the active pointer to resolve to a version that is still active', () => {
  assert.equal(evaluateR6({ activeVersion: null }).state, 'pending');
  assert.equal(evaluateR6({ activeVersion: 'v-9', knowledgeVersions: [{ version: 'v-1' }] }).state, 'pending');
  assert.equal(evaluateR6({ activeVersion: 'v-1', knowledgeVersions: [{ version: 'v-1', boundary: 'b', status: 'active' }] }).state, 'satisfied');

  // Found while instrumenting the hosted proof. retrieve() filters on status === 'active', so a
  // pointer left aimed at a version that supersession or rollback has since demoted returns
  // nothing from retrieval - and this gate reported satisfied anyway, quoting the boundary of a
  // version no longer in force. A gate named verified-only retrieval must not pass while
  // retrieval within the tested boundary is empty. Every version a real store writes carries a
  // status, which is why the absent-status fixture this assertion used before was not a case
  // worth preserving.
  const demoted = { activeVersion: 'v-1', knowledgeVersions: [{ version: 'v-1', boundary: 'b', status: 'superseded' }] };
  assert.equal(demoted.knowledgeVersions.filter((item) => item.status === 'active').length, 0, 'nothing is retrievable for this payload');
  const gateWhenDemoted = evaluateR6(demoted);
  assert.equal(gateWhenDemoted.state, 'pending');
  assert.match(gateWhenDemoted.detail, /whose status is superseded/);
  assert.match(evaluateR6({ activeVersion: 'v-1', knowledgeVersions: [{ version: 'v-1', boundary: 'b' }] }).detail, /status is not recorded/, 'an absent status is not an active one');
});

test('R7 requires a real rollback or supersession record', () => {
  assert.equal(evaluateR7({ knowledgeVersions: [] }).state, 'pending');
  assert.equal(evaluateR7({ knowledgeVersions: [{ version: 'v-1', status: 'active' }] }).state, 'pending');
  assert.equal(evaluateR7({ knowledgeVersions: [{ version: 'v-1', status: 'rolled-back' }] }).state, 'satisfied');
});

test('R8 says it cannot judge the combined cycle rather than inferring it from unit coverage', () => {
  const unknown = evaluateR8(null);
  assert.equal(unknown.state, 'manual-evidence-required');
  assert.notEqual(unknown.state, 'satisfied', 'unit proof of the behaviours is not proof of the combined run');
  assert.equal(evaluateR8(ALL_EIGHT.slice(0, 7)).state, 'pending');
  assert.equal(evaluateR8(ALL_EIGHT).state, 'satisfied');
});

test('reports the whole picture and holds the soak while anything is outstanding', () => {
  const report = preSoakReadiness({ payload: { candidateRecords: [], knowledgeVersions: [], activeVersion: null }, queue: { links: [{ id: 's-1', state: 'claim-extraction-forced-pending' }] }, research: {} });
  assert.equal(report.gatesGreen, false);
  assert.deepEqual(report.outstanding, ['R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  assert.equal(report.soak.state, 'held');
  assert.match(report.soak.blockers.join(' '), /R2-R8 are not simultaneously green/);
  assert.equal(report.authorizesPromotion, false);
});

test('only lets the soak read ready once every gate is genuinely satisfied', () => {
  const report = preSoakReadiness(everythingDone());
  assert.deepEqual(report.outstanding, []);
  assert.equal(report.gatesGreen, true);
  assert.equal(report.soak.state, 'ready');
  assert.equal(report.authorizesPromotion, false, 'readiness reporting never authorizes anything');
});

test('one unsatisfied gate is enough to keep the soak held', () => {
  for (const breakOne of [
    (input) => { input.research = {}; },
    (input) => { input.payload.knowledgeVersions = []; input.payload.activeVersion = null; },
    (input) => { input.combinedSafetyEvidence = null; },
    (input) => { input.queue.links = [{ id: 's-1', state: 'claim-extraction-forced-pending' }]; },
  ]) {
    const input = everythingDone();
    breakOne(input);
    const report = preSoakReadiness(input);
    assert.equal(report.gatesGreen, false);
    assert.equal(report.soak.state, 'held');
  }
});

// The report said ready and then could not start the soak it had just approved: the projection
// dropped the observed population that startSoak freezes its window from, so the success path threw
// a TypeError while the held path, which never reaches that line, looked fine.
test('a ready pre-soak decision can actually start a soak', () => {
  const { startSoak } = require('../src/soakRun');
  const report = preSoakReadiness(everythingDone());
  assert.equal(report.soak.state, 'ready');
  assert.ok(Array.isArray(report.soak.observed), 'the decision carries the population it was made about');
  const soak = startSoak({ readiness: report.soak, at: '2026-09-01T00:00:00.000Z', hours: 72 });
  // One knowledge version plus one candidate record, frozen at the start.
  assert.equal(soak.dataPoints.length, report.soak.observedDataPoints);
  assert.deepEqual(soak.dataPoints.map((item) => item.id), report.soak.observed.map((item) => item.id));
  assert.equal(soak.failed, false);
});
