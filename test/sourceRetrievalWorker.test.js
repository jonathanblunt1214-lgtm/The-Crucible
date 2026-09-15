'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AtomicClaimExtractionQueue } = require('../src/claimExtractionWorker');
const { registerOwnerDelegatedUrl, SourceRetrievalWorker } = require('../src/sourceRetrievalWorker');

const PROJECT = 'github:owner/repo';
const AT = '2026-09-12T08:00:00.000Z';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-source-retrieval-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const queueFile = path.join(root, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify({ schemaVersion:1, projectId:PROJECT, updatedAt:AT, documents:[], links:[] }, null, 2)}\n`);
  return { root, queueFile };
}

function result(url, bytes, overrides = {}) {
  const content = Buffer.from(bytes);
  return {
    record:{
      state:'retrieved-candidate-evidence',
      classification:'Insufficient Evidence',
      requestedUrl:url,
      finalUrl:url,
      retrievedAt:AT,
      author:'Example Author',
      license:'Example terms',
      contentType:'text/html',
      contentLength:content.length,
      contentSha256:sha(content),
      retrievedContentLength:content.length,
      retrievedContentSha256:sha(content),
      quarantineReasons:[],
      ...overrides,
    },
    content:overrides.state === 'quarantined' ? null : content,
  };
}

test('admits only a positively trusted delegated HTTPS URL and deduplicates it', (t) => {
  const { queueFile } = fixture(t);
  const url = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map';
  const first = registerOwnerDelegatedUrl({ queueFile, projectId:PROJECT, url, now:() => AT });
  assert.equal(first.created, true);
  assert.equal(first.state, 'research-approved-pending-retrieval');
  assert.equal(registerOwnerDelegatedUrl({ queueFile, projectId:PROJECT, url, now:() => AT }).created, false);
  assert.throws(() => registerOwnerDelegatedUrl({ queueFile, projectId:PROJECT, url:'https://untrusted.example/page' }), /CRU-0044.*positive trust allow-list/);
});

test('retrieves queued content under the shared lock, stores the hashed bytes, and hands it to extraction', async (t) => {
  const { root, queueFile } = fixture(t);
  const url = 'https://developer.mozilla.org/example';
  registerOwnerDelegatedUrl({ queueFile, projectId:PROJECT, url, now:() => AT });
  const bytes = Buffer.from('<p>The map method creates a new array.</p>');
  const worker = new SourceRetrievalWorker({
    queueFile,
    projectId:PROJECT,
    auditRoot:path.join(root, 'audit'),
    minimumIntervalMs:0,
    now:() => AT,
    retrieverFactory:() => ({ retrieve:async(input) => result(input, bytes) }),
  });
  const outcomes = await worker.run();
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].state, 'claim-extraction-forced-pending');
  const source = JSON.parse(fs.readFileSync(queueFile, 'utf8')).links[0];
  assert.equal(source.contentSha256, sha(bytes));
  assert.equal(fs.readFileSync(source.durablePath).equals(bytes), true);
  assert.equal(source.claimExtraction.nextAction, 'extract-bounded-candidate-claims');
  assert.equal(source.classification, 'Insufficient Evidence');
});

test('reuses one content-addressed file and candidate list when two URLs return identical bytes', async (t) => {
  const { root, queueFile } = fixture(t);
  const bytes = Buffer.from('The exact stored bytes are shared safely.');
  const destination = path.join(root, `${sha(bytes)}.html`);
  fs.writeFileSync(destination, bytes);
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  queue.links.push({ id:'existing', url:'https://first.example.org/a', finalUrl:'https://first.example.org/a', state:'claim-extraction-complete', contentSha256:sha(bytes), durablePath:destination, claimExtraction:{ candidateIds:['candidate-1'] } });
  queue.links.push({ id:'pending', url:'https://second.example.org/b', state:'research-approved-pending-retrieval', classification:'Insufficient Evidence' });
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  const worker = new SourceRetrievalWorker({ queueFile, projectId:PROJECT, auditRoot:path.join(root, 'audit'), minimumIntervalMs:0, retrieverFactory:() => ({ retrieve:async(input) => result(input, bytes) }), now:() => AT });
  const [outcome] = await worker.run();
  assert.equal(outcome.state, 'claim-extraction-complete');
  assert.equal(outcome.duplicateOfSourceId, 'existing');
  const source = JSON.parse(fs.readFileSync(queueFile, 'utf8')).links.find((item) => item.id === 'pending');
  assert.equal(source.durablePath, destination);
  assert.deepEqual(source.claimExtraction.candidateIds, ['candidate-1']);
});

test('quarantine and retrieval failures remain non-promotable structured queue outcomes', async (t) => {
  const blocked = fixture(t);
  registerOwnerDelegatedUrl({ queueFile:blocked.queueFile, projectId:PROJECT, url:'https://blocked.example.org/a', now:() => AT });
  const failedWorker = new SourceRetrievalWorker({ queueFile:blocked.queueFile, projectId:PROJECT, auditRoot:path.join(blocked.root, 'audit'), minimumIntervalMs:0, retrieverFactory:() => ({ retrieve:async() => { throw new Error('network refused'); } }), now:() => AT });
  assert.deepEqual((await failedWorker.run()).map((item) => item.state), ['retrieval-blocked']);
  assert.match(JSON.parse(fs.readFileSync(blocked.queueFile, 'utf8')).links[0].blocker, /network refused/);

  const quarantined = fixture(t);
  const url = 'https://quarantine.example.org/a';
  registerOwnerDelegatedUrl({ queueFile:quarantined.queueFile, projectId:PROJECT, url, now:() => AT });
  const quarantineWorker = new SourceRetrievalWorker({ queueFile:quarantined.queueFile, projectId:PROJECT, auditRoot:path.join(quarantined.root, 'audit'), minimumIntervalMs:0, retrieverFactory:() => ({ retrieve:async(input) => result(input, 'unsafe', { state:'quarantined', classification:'Crucible Issue', quarantineReasons:['prompt-injection-pattern'] }) }), now:() => AT });
  assert.deepEqual((await quarantineWorker.run()).map((item) => item.state), ['quarantined']);
  const source = JSON.parse(fs.readFileSync(quarantined.queueFile, 'utf8')).links[0];
  assert.equal(source.classification, 'Crucible Issue');
  assert.equal(source.durablePath, null);

  const reviewedRetry = new SourceRetrievalWorker({ queueFile:quarantined.queueFile, projectId:PROJECT, auditRoot:path.join(quarantined.root, 'audit'), sourceId:source.id, retryQuarantined:true, minimumIntervalMs:0, retrieverFactory:() => ({ retrieve:async(input) => result(input, 'reviewed safe content') }), now:() => AT });
  assert.deepEqual((await reviewedRetry.run()).map((item) => item.state), ['claim-extraction-forced-pending']);
  assert.ok(JSON.parse(fs.readFileSync(quarantined.queueFile, 'utf8')).links[0].durablePath);
});

test('a concurrent extraction owner keeps the queue; retrieval never bypasses the generic lock', async (t) => {
  const { root, queueFile } = fixture(t);
  registerOwnerDelegatedUrl({ queueFile, projectId:PROJECT, url:'https://locked.example.org/a', now:() => AT });
  const queue = new AtomicClaimExtractionQueue(queueFile, PROJECT);
  const held = queue.lock();
  try {
    const worker = new SourceRetrievalWorker({ queueFile, projectId:PROJECT, auditRoot:path.join(root, 'audit'), minimumIntervalMs:0, retrieverFactory:() => ({ retrieve:async() => { throw new Error('must not run'); } }) });
    await assert.rejects(() => worker.run(), /Source queue lock is held/);
  } finally { held.release(); }
});
