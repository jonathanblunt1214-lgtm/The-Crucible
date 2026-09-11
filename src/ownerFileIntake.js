const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AtomicClaimExtractionQueue } = require('./claimExtractionWorker');
const { extractPdfText } = require('./pdfTextExtraction');
const { crucibleError } = require('./failureCodes');

const MEDIA_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
});
const MAX_OWNER_FILE_BYTES = 128 * 1024 * 1024;

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function destinationHasExpectedContent(destination, expectedSha256) {
  const stat = fs.lstatSync(destination);
  if (!stat.isFile() || stat.isSymbolicLink()) throw crucibleError('CRU-0043', `Content-addressed destination must be a regular non-symbolic file: ${destination}.`);
  if (sha256File(destination) !== expectedSha256) throw crucibleError('CRU-0043', `Content-addressed destination has unexpected bytes: ${destination}.`);
  return true;
}

function preflightOwnerFile(input) {
  const file = path.resolve(input);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { throw crucibleError('CRU-0043', `Owner source is unavailable: ${file}. ${error.message}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw crucibleError('CRU-0043', `Owner source must be a regular non-symbolic file: ${file}.`);
  if (stat.size < 1 || stat.size > MAX_OWNER_FILE_BYTES) throw crucibleError('CRU-0043', `Owner source size must be between 1 and ${MAX_OWNER_FILE_BYTES} bytes: ${file}.`);
  const extension = path.extname(file).toLowerCase();
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) throw crucibleError('CRU-0043', `Unsupported owner source type ${extension || '(none)'}; only PDF, TXT, YML, and YAML are admitted.`);
  const contentSha256 = sha256File(file);
  let pages = null;
  if (mediaType === 'application/pdf') {
    const extraction = extractPdfText(fs.readFileSync(file));
    if (!extraction.ok) throw crucibleError('CRU-0043', `Owner PDF cannot enter extraction because its text failed closed (${extraction.reason}): ${extraction.detail}`);
    pages = extraction.pages.length;
  }
  return { file, stat, extension, mediaType, contentSha256, pages };
}

function publishContentAddressed(source, destination) {
  if (fs.existsSync(destination)) {
    destinationHasExpectedContent(destination, source.contentSha256);
    return false;
  }
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.pending`;
  let descriptor;
  try {
    fs.copyFileSync(source.file, temporary, fs.constants.COPYFILE_EXCL);
    // Windows rejects fsync on a read-only handle, so open the completed copy for
    // update even though no further bytes are written.
    descriptor = fs.openSync(temporary, 'r+');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    if (sha256File(temporary) !== source.contentSha256) throw crucibleError('CRU-0043', `Owner source changed while it was being copied: ${source.file}.`);
    try { fs.linkSync(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      destinationHasExpectedContent(destination, source.contentSha256);
    }
    return true;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function ownerRecord(source, destination, retrievedAt) {
  const originalName = path.basename(source.file);
  return {
    id: `owner-file:${source.contentSha256}`,
    originalName,
    originalPath: source.file,
    durablePath: destination,
    mediaType: source.mediaType,
    contentSha256: source.contentSha256,
    size: source.stat.size,
    title: path.basename(originalName, source.extension),
    author: 'owner supplied',
    pages: source.pages,
    license: 'owner-supplied private candidate evidence; verify source-specific rights before redistribution',
    retrievedAt,
    classification: 'Insufficient Evidence',
    state: 'claim-extraction-forced-pending',
    claimExtraction: {
      attempts: 0,
      candidateIds: [],
      classification: 'Insufficient Evidence',
      sourceContentSha256: source.contentSha256,
      windows: [],
      nextPage: source.mediaType === 'application/pdf' ? 1 : null,
      nextAction: 'extract-bounded-candidate-claims',
    },
  };
}

function ingestOwnerFiles({ queueFile, projectId, files, now = () => new Date().toISOString() }) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw crucibleError('CRU-0043', 'Owner-file intake requires the repository-bound projectId.');
  if (!Array.isArray(files) || files.length < 1) throw crucibleError('CRU-0043', 'Owner-file intake requires at least one exact file path.');
  const prepared = files.map(preflightOwnerFile);
  const requestHashes = new Set();
  for (const source of prepared) {
    if (requestHashes.has(source.contentSha256)) throw crucibleError('CRU-0043', `The intake request repeats content SHA-256 ${source.contentSha256}.`);
    requestHashes.add(source.contentSha256);
  }

  const queue = new AtomicClaimExtractionQueue(queueFile, projectId);
  const held = queue.lock();
  try {
    const current = queue.read();
    const all = [...current.documents, ...current.links];
    const existingByHash = new Map(all.filter((item) => item.contentSha256).map((item) => [String(item.contentSha256).toLowerCase(), item]));
    const admitted = [];
    const alreadyPresent = [];
    const root = path.dirname(path.resolve(queueFile));
    const retrievedAt = now();
    for (const source of prepared) {
      const existing = existingByHash.get(source.contentSha256);
      if (existing) {
        alreadyPresent.push({ input: source.file, contentSha256: source.contentSha256, sourceId: existing.id, state: existing.state });
        continue;
      }
      const destination = path.join(root, `${source.contentSha256}${source.extension}`);
      publishContentAddressed(source, destination);
      const record = ownerRecord(source, destination, retrievedAt);
      current.documents.push(record);
      existingByHash.set(source.contentSha256, record);
      admitted.push({ input: source.file, contentSha256: source.contentSha256, sourceId: record.id, state: record.state, pages: record.pages });
    }
    if (admitted.length) {
      current.updatedAt = retrievedAt;
      queue.write(current);
    }
    return {
      projectId,
      requested: prepared.length,
      admitted,
      alreadyPresent,
      candidateOnly: true,
      promotionAuthorized: false,
      lockReclaimedFrom: held.reclaimedFrom,
    };
  } finally { held.release(); }
}

module.exports = { ingestOwnerFiles, preflightOwnerFile, destinationHasExpectedContent, MEDIA_TYPES, MAX_OWNER_FILE_BYTES };
