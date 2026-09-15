const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ingestOwnerFiles } = require('../src/ownerFileIntake');
const { AtomicClaimExtractionQueue } = require('../src/claimExtractionWorker');

const PROJECT = 'github:owner/repo';
const AT = '2026-09-10T22:45:00.000Z';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-owner-intake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const queueFile = path.join(root, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify({ schemaVersion: 1, projectId: PROJECT, updatedAt: AT, protocol: 'candidate-evidence-only', documents: [], links: [] }, null, 2)}\n`);
  return { root, queueFile };
}

function write(root, name, content) {
  const file = path.join(root, name);
  fs.writeFileSync(file, content);
  return file;
}

test('content-addresses owner text and YAML as candidate-only work and deduplicates a repeated intake', (t) => {
  const { root, queueFile } = fixture(t);
  const text = write(root, 'research.txt', 'This is untrusted research source material.');
  const yaml = write(root, 'workflow.yml', 'steps:\n  - run: this text must never be executed\n');
  const first = ingestOwnerFiles({ queueFile, projectId: PROJECT, files: [text, yaml], now: () => AT });
  assert.equal(first.admitted.length, 2);
  assert.equal(first.alreadyPresent.length, 0);
  assert.equal(first.candidateOnly, true);
  assert.equal(first.promotionAuthorized, false);
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  assert.equal(queue.documents.length, 2);
  for (const document of queue.documents) {
    assert.equal(document.state, 'claim-extraction-forced-pending');
    assert.equal(document.classification, 'Insufficient Evidence');
    assert.equal(fs.readFileSync(document.durablePath).equals(fs.readFileSync(document.originalPath)), true);
    assert.equal(path.basename(document.durablePath).startsWith(document.contentSha256), true);
  }
  const second = ingestOwnerFiles({ queueFile, projectId: PROJECT, files: [text, yaml], now: () => AT });
  assert.equal(second.admitted.length, 0);
  assert.equal(second.alreadyPresent.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(queueFile, 'utf8')).documents.length, 2);
});

test('deduplicates content already represented by a retrieved link', (t) => {
  const { root, queueFile } = fixture(t);
  const file = write(root, 'same.txt', 'same immutable source bytes');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  queue.links.push({ id: 'linked-source:one', contentSha256: sha(fs.readFileSync(file)), state: 'claim-extraction-complete' });
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  const result = ingestOwnerFiles({ queueFile, projectId: PROJECT, files: [file], now: () => AT });
  assert.equal(result.admitted.length, 0);
  assert.deepEqual(result.alreadyPresent.map((item) => item.sourceId), ['linked-source:one']);
});

test('rejects unsupported source types before changing the queue', (t) => {
  const { root, queueFile } = fixture(t);
  const before = fs.readFileSync(queueFile);
  const file = write(root, 'program.exe', 'not an executable that intake may accept');
  assert.throws(() => ingestOwnerFiles({ queueFile, projectId: PROJECT, files: [file] }), /CRU-0043.*Unsupported owner source type/);
  assert.equal(fs.readFileSync(queueFile).equals(before), true);
});

test('shares the extraction queue lock and fails closed while another worker owns it', (t) => {
  const { root, queueFile } = fixture(t);
  const file = write(root, 'research.txt', 'candidate material');
  const queue = new AtomicClaimExtractionQueue(queueFile, PROJECT);
  const held = queue.lock();
  try {
    assert.throws(() => ingestOwnerFiles({ queueFile, projectId: PROJECT, files: [file] }), /Source queue lock is held/);
  } finally { held.release(); }
  assert.equal(JSON.parse(fs.readFileSync(queueFile, 'utf8')).documents.length, 0);
});

test('refuses a non-file object at the content-addressed destination', (t) => {
  const { root, queueFile } = fixture(t);
  const file = write(root, 'research.txt', 'candidate material with a blocked destination');
  const digest = sha(fs.readFileSync(file));
  fs.mkdirSync(path.join(root, `${digest}.txt`));
  assert.throws(() => ingestOwnerFiles({ queueFile, projectId: PROJECT, files: [file] }), /CRU-0043.*regular non-symbolic file/);
  assert.equal(JSON.parse(fs.readFileSync(queueFile, 'utf8')).documents.length, 0);
});
