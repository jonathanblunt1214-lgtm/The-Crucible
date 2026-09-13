const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ClaimExtractionWorker } = require('../src/claimExtractionWorker');
const { DurableScientificLearningStore } = require('../src/scientificLearning');
const { site, declaredAuthor, sourceIndex, independent, independentSubset } = require('../src/sourceIndependence');
const { readBundle, corroboratedClaims } = require('../src/realCorpusLearning');
const { groupCorroborating } = require('../src/semanticCorroboration');
const { verifyPairedDeclaration } = require('../src/pairedCorroboration');

const PROJECT = 'github:owner/repo';
const AT = '2026-09-01T00:00:00.000Z';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// The sentence that actually corroborated across two editions of one book in the real corpus.
const XAMARIN = 'The gap between platform operating systems, programming languages, and devices is an immense obstacle.';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-independence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function buildBundle(dir, documents) {
  const bundleRoot = path.join(dir, 'bundle');
  const learningRoot = path.join(dir, 'learning');
  fs.mkdirSync(path.join(bundleRoot, 'sources'), { recursive: true });
  fs.mkdirSync(learningRoot, { recursive: true });
  const links = documents.map((doc) => {
    const digest = sha256(doc.content);
    const file = path.join(bundleRoot, 'sources', `${digest}.txt`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, doc.content);
    return { id: doc.url, state: 'claim-extraction-forced-pending', url: doc.url, finalUrl: doc.url, contentType: 'text/plain', contentSha256: digest, durablePath: `sources/${digest}.txt`, retrievedAt: AT, author: doc.author };
  });
  const queue = { schemaVersion: 1, projectId: PROJECT, updatedAt: AT, documents: [], links };
  const queueFile = path.join(bundleRoot, 'source-queue.json');
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, projectId: PROJECT, repository: 'owner/repo', ref: 'refs/heads/development', queueSha256: sha256(fs.readFileSync(queueFile, 'utf8')), sourceFiles: links.map((l) => ({ name: `${l.contentSha256}.txt`, sha256: l.contentSha256, bytes: 1 })) }, null, 2)}\n`);

  const absolute = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  absolute.links = absolute.links.map((link) => ({ ...link, durablePath: path.join(bundleRoot, link.durablePath) }));
  const extractionQueue = path.join(dir, 'extraction-queue.json');
  fs.writeFileSync(extractionQueue, `${JSON.stringify(absolute, null, 2)}\n`);
  new ClaimExtractionWorker({ queueFile: extractionQueue, projectId: PROJECT, learningRoot, now: () => AT }).run();
  return { bundleRoot, learningRoot, bundle: readBundle(bundleRoot) };
}

test('a site is the registrable domain, so pages of one publisher collapse to one source', () => {
  assert.equal(site('https://www.syncfusion.com/succinctly-free-ebooks/xamarin-forms'), 'syncfusion.com');
  assert.equal(site('https://flaviocopes.com/page/books/'), 'flaviocopes.com');
  assert.equal(site('https://docs.example.co.uk/a'), 'example.co.uk', 'a multi-part suffix is not mistaken for the registrable domain');
  assert.equal(site('not a url'), null);
  assert.equal(declaredAuthor('not declared'), null, 'an undeclared author never makes two sources the same author');
});

test('identical content, one site, and one author each break independence', () => {
  const base = { contentSha256: 'aaa', site: 'a.example', author: 'ada lovelace' };
  assert.equal(independent(base, { contentSha256: 'aaa', site: 'b.example', author: null }).independent, false);
  assert.match(independent(base, { contentSha256: 'aaa', site: 'b.example', author: null }).reason, /one document reached twice/);
  assert.equal(independent(base, { contentSha256: 'bbb', site: 'a.example', author: null }).independent, false);
  assert.match(independent(base, { contentSha256: 'bbb', site: 'a.example', author: null }).reason, /one publisher/);
  assert.equal(independent(base, { contentSha256: 'bbb', site: 'b.example', author: 'ada lovelace' }).independent, false);
  assert.match(independent(base, { contentSha256: 'bbb', site: 'b.example', author: 'ada lovelace' }).reason, /same author/);
  assert.equal(independent(base, { contentSha256: 'bbb', site: 'b.example', author: 'grace hopper' }).independent, true);
});

test('the independent subset is stable and never displaces a source already chosen', () => {
  const index = new Map([
    ['s-a', { contentSha256: 'x', site: 'syncfusion.com', author: 'alessandro del sole' }],
    ['s-b', { contentSha256: 'y', site: 'syncfusion.com', author: 'alessandro del sole' }],
    ['s-c', { contentSha256: 'z', site: 'goalkicker.com', author: null }],
  ]);
  const entries = [{ sourceId: 's-c' }, { sourceId: 's-b' }, { sourceId: 's-a' }];
  const first = independentSubset(entries, index);
  assert.deepEqual(first.members.map((item) => item.sourceId), ['s-a', 's-c']);
  assert.equal(first.rejected.length, 1);
  assert.equal(first.rejected[0].sourceId, 's-b');
  assert.deepEqual(independentSubset([...entries].reverse(), index).members.map((item) => item.sourceId), ['s-a', 's-c'], 'input order does not change the subset');
});

// The case the real corpus produced: three of its nineteen corroborated claims came from two
// editions of one book by one author, whose introductions share prose word for word.
test('two editions of one book do not corroborate each other', (t) => {
  const dir = workspace(t);
  const { learningRoot, bundle } = buildBundle(dir, [
    { url: 'https://www.syncfusion.com/ebooks/xamarin-forms', author: 'Alessandro Del Sole', content: `Xamarin.Forms Succinctly.\n${XAMARIN} Developers want to reuse what they know.` },
    { url: 'https://www.syncfusion.com/ebooks/xamarin-forms-macos', author: 'Alessandro Del Sole', content: `Xamarin.Forms for macOS Succinctly.\n${XAMARIN} Developers want to reuse what they know.` },
  ]);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  assert.ok(store.read().candidateRecords.length >= 2, 'both editions were extracted');

  // The two editions do assert one claim - sameness is not what rejects them.
  const records = store.read().candidateRecords.filter((record) => record.candidate.claim === XAMARIN);
  assert.equal(new Set(records.map((record) => record.candidate.provenance.sourceId)).size, 2, 'two distinct source ids assert it');
  const grouped = groupCorroborating(records.map((record) => ({ id: record.candidate.id, claim: record.candidate.claim })));
  assert.equal(grouped.length, 1, 'the wording test groups them as one claim');

  // Independence is what rejects them, with or without the queue: the fallback reads the site
  // off the candidate's own provenance when the index is not supplied.
  assert.equal(corroboratedClaims(store, { sourceIndex: sourceIndex(bundle) }).length, 0, 'one book agreeing with its own second edition is not corroboration');
  assert.equal(corroboratedClaims(store).length, 0, 'and it is still rejected without the queue index');
});

test('a genuinely independent pair still corroborates', (t) => {
  const dir = workspace(t);
  const { learningRoot, bundle } = buildBundle(dir, [
    { url: 'https://example.edu/mobile', author: 'A Researcher', content: `A university note.\n${XAMARIN} Developers want to reuse what they know.` },
    { url: 'https://other.org/mobile', author: 'Another Writer', content: `An unrelated publisher.\n${XAMARIN} Developers want to reuse what they know.` },
  ]);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: PROJECT });
  const judged = corroboratedClaims(store, { sourceIndex: sourceIndex(bundle) });
  const found = judged.find((item) => item.claim === XAMARIN);
  assert.ok(found, 'two different publishers with different authors are independent');
  assert.equal(found.sourceCount, 2);
  assert.deepEqual(found.notIndependent, []);
});

test('an owner may not nominate two pages of one publisher as a pair', (t) => {
  const dir = workspace(t);
  const { bundleRoot, bundle } = buildBundle(dir, [
    { url: 'https://flaviocopes.com/page/books/', author: 'Flavio Copes', content: `Books page.\n${XAMARIN} Developers want to reuse what they know.` },
    { url: 'https://flaviocopes.com/page/courses/', author: 'Flavio Copes', content: `Courses page.\n${XAMARIN} Developers want to reuse what they know.` },
  ]);
  const decision = verifyPairedDeclaration({ bundle, bundleRoot, declaration: {
    claim: XAMARIN, claimScope: 'scope', generalizationBoundary: 'boundary', language: 'javascript',
    pairedSources: ['https://flaviocopes.com/page/books/', 'https://flaviocopes.com/page/courses/'],
    pairedAssertions: [XAMARIN, XAMARIN],
  } });
  assert.equal(decision.satisfied, false);
  assert.match(decision.reason, /one publisher/);
  assert.equal(decision.promotionAuthorized, false);
});
