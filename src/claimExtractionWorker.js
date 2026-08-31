const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DurableScientificLearningStore } = require('./scientificLearning');
const { INJECTION_PATTERNS } = require('./safeInformationRetrieval');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizedClaimSha256(value) { return sha256(cleanText(value).toLowerCase()); }
function cleanText(value) {
  return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

function boundedAssertions(text) {
  const candidates = cleanText(text).split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length >= 40 && item.length <= 360);
  const seen = new Set(); const results = [];
  for (const sentence of candidates) {
    if (INJECTION_PATTERNS.some((pattern) => pattern.test(sentence))) continue;
    if (!/\b(?:is|are|uses?|requires?|returns?|creates?|provides?|supports?|allows?|can|must|should)\b/i.test(sentence)) continue;
    const fingerprint = sha256(sentence.toLowerCase()); if (seen.has(fingerprint)) continue;
    seen.add(fingerprint); results.push(sentence);
  }
  return results;
}

function defaultExtractText(source, pageStart, pageEnd, environment = process.env) {
  if (!source.durablePath || !fs.existsSync(source.durablePath)) throw new Error('Durable source content is missing.');
  if (source.mediaType === 'application/pdf') {
    const executable = environment.CRUCIBLE_PDFTOTEXT || 'pdftotext';
    const result = spawnSync(executable, ['-f', String(pageStart), '-l', String(pageEnd), '-enc', 'UTF-8', source.durablePath, '-'], { encoding:'utf8', shell:false, windowsHide:true, maxBuffer:8 * 1024 * 1024 });
    if (!result.error && result.status === 0) return result.stdout;
    const python = environment.CRUCIBLE_PYTHON;
    if (!python) throw new Error(`PDF extraction unavailable: ${result.error?.message || `pdftotext exited ${result.status}`}; CRUCIBLE_PYTHON is not configured.`);
    const fallback = spawnSync(python, [path.join(__dirname, '..', 'scripts', 'extractPdfText.py'), source.durablePath, String(pageStart), String(pageEnd)], { encoding:'utf8', shell:false, windowsHide:true, maxBuffer:8 * 1024 * 1024 });
    if (fallback.error) throw new Error(`PDF extraction fallback unavailable: ${fallback.error.message}`);
    if (fallback.status !== 0) throw new Error(`PDF extraction fallback failed with exit ${fallback.status}: ${String(fallback.stderr || '').trim()}`);
    return fallback.stdout;
  }
  return fs.readFileSync(source.durablePath, 'utf8');
}

class AtomicClaimExtractionQueue {
  constructor(file, projectId) { this.file = path.resolve(file); this.projectId = projectId; this.lockFile = `${this.file}.claim-extraction.lock`; }
  read() { const queue = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (queue?.schemaVersion !== 1 || queue.projectId !== this.projectId || !Array.isArray(queue.documents) || !Array.isArray(queue.links)) throw new Error('Source queue is invalid or belongs to another project.'); return queue; }
  write(queue) { const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(queue, null, 2)}\n`, { flag:'wx', mode:0o600 }); fs.renameSync(temporary, this.file); }
  lock() { const handle = fs.openSync(this.lockFile, 'wx', 0o600); return () => { fs.closeSync(handle); fs.rmSync(this.lockFile, { force:true }); }; }
}

class ClaimExtractionWorker {
  constructor({ queueFile, projectId, learningRoot, extractText = defaultExtractText, now = () => new Date().toISOString(), maximumSources = 25, maximumDocuments = 9, pdfPagesPerBatch = 20 }) {
    if (!projectId || !learningRoot) throw new Error('Repository-bound projectId and learningRoot are required.');
    if (!Number.isSafeInteger(maximumSources) || maximumSources < 1 || maximumSources > 100) throw new Error('maximumSources must be between 1 and 100.');
    if (!Number.isSafeInteger(maximumDocuments) || maximumDocuments < 1 || maximumDocuments > maximumSources) throw new Error('maximumDocuments must be between 1 and maximumSources.');
    if (!Number.isSafeInteger(pdfPagesPerBatch) || pdfPagesPerBatch < 1 || pdfPagesPerBatch > 100) throw new Error('pdfPagesPerBatch must be between 1 and 100.');
    this.queue = new AtomicClaimExtractionQueue(queueFile, projectId); this.store = new DurableScientificLearningStore({ projectId, root:path.resolve(learningRoot) }); this.projectId = projectId; this.extractText = extractText; this.now = now; this.maximumSources = maximumSources; this.maximumDocuments = maximumDocuments; this.pdfPagesPerBatch = pdfPagesPerBatch;
  }

  candidate(source, assertion, boundary, createdAt) {
    const assertionSha = normalizedClaimSha256(assertion);
    return { schemaVersion:1, id:`extracted-${sha256(`${source.id}\n${assertionSha}`).slice(0, 32)}`, projectId:this.projectId, claim:assertion, claimBoundary:boundary, generalizationBoundary:'Untrusted source assertion only; no correctness, causation, current-version applicability, recommendation, or generalization is verified by extraction.', kind:'extracted-source-assertion', provenance:{ sourceType:source.mediaType || source.contentType || 'retrieved-web-document', sourceId:source.id, retrievedAt:source.retrievedAt || createdAt, author:source.author || source.publisher || 'not declared', license:source.license || 'not declared; verify source terms before redistribution', contentSha256:source.contentSha256 }, classification:'Insufficient Evidence', createdAt };
  }

  run() {
    const unlock = this.queue.lock(); const outcomes = [];
    try {
      let queue = this.queue.read();
      const isEligible = (item) => item.state === 'claim-extraction-forced-pending' || item.state === 'claim-extraction-in-progress';
      const eligibleDocuments = queue.documents.filter(isEligible).slice(0, this.maximumDocuments);
      const eligibleLinks = queue.links.filter(isEligible).slice(0, Math.max(0, this.maximumSources - eligibleDocuments.length));
      const eligible = [...eligibleDocuments, ...eligibleLinks];
      for (const selected of eligible) {
        const collection = queue.documents.some((item) => item.id === selected.id) ? queue.documents : queue.links;
        let source = collection.find((item) => item.id === selected.id); const startedAt = this.now();
        source.claimExtraction = source.claimExtraction || { attempts:0, candidateIds:[], classification:'Insufficient Evidence' };
        const currentContentSha = String(source.contentSha256 || '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(currentContentSha)) throw new Error('Source contentSha256 must be a SHA-256 digest.');
        if (source.claimExtraction.sourceContentSha256 && source.claimExtraction.sourceContentSha256 !== currentContentSha) {
          source.claimExtraction.previousRevisions = [...(source.claimExtraction.previousRevisions || []), { contentSha256:source.claimExtraction.sourceContentSha256, candidateIds:[...(source.claimExtraction.candidateIds || [])], completedAt:source.claimExtraction.completedAt || null }];
          source.claimExtraction.nextPage = 1; source.claimExtraction.candidateIds = []; source.claimExtraction.completedAt = null;
        }
        source.claimExtraction.sourceContentSha256 = currentContentSha;
        source.claimExtraction.windows = source.claimExtraction.windows || [];
        source.claimExtraction.attempts = Number(source.claimExtraction.attempts || 0) + 1; source.claimExtraction.startedAt = startedAt; source.state = 'claim-extraction-in-progress'; queue.updatedAt = startedAt; this.queue.write(queue);
        try {
          const pageStart = source.mediaType === 'application/pdf' ? Number(source.claimExtraction.nextPage || 1) : 1;
          const pageEnd = source.mediaType === 'application/pdf' ? Math.min(Number(source.pages || pageStart + this.pdfPagesPerBatch - 1), pageStart + this.pdfPagesPerBatch - 1) : 1;
          const priorWindow = source.claimExtraction.windows.find((window) => window.sourceContentSha256 === currentContentSha && window.pageStart === pageStart && window.pageEnd === pageEnd);
          let ids; let windowContentSha256; let comparison;
          if (priorWindow) {
            ids = [...priorWindow.candidateIds]; windowContentSha256 = priorWindow.windowContentSha256; comparison = 'unchanged-window-skipped';
          } else {
            const text = this.extractText(source, pageStart, pageEnd); windowContentSha256 = sha256(Buffer.from(String(text), 'utf8')); const assertions = boundedAssertions(text); ids = []; const candidates = [];
            for (const assertion of assertions) {
              const boundary = source.mediaType === 'application/pdf' ? `${source.title || source.originalName || source.id}, SHA-256 ${source.contentSha256}, pages ${pageStart}-${pageEnd} only` : `${source.finalUrl || source.url || source.id}, SHA-256 ${source.contentSha256}, retrieved content only`;
              const candidate = this.candidate(source, assertion, boundary, startedAt); candidates.push(candidate); ids.push(candidate.id);
            }
            this.store.ingestMany(candidates); comparison = 'new-window-extracted';
          }
          queue = this.queue.read(); source = [...queue.documents, ...queue.links].find((item) => item.id === selected.id); source.claimExtraction.windows = source.claimExtraction.windows || [];
          if (!source.claimExtraction.windows.some((window) => window.sourceContentSha256 === currentContentSha && window.pageStart === pageStart && window.pageEnd === pageEnd)) source.claimExtraction.windows.push({ sourceContentSha256:currentContentSha, pageStart, pageEnd, windowContentSha256, candidateIds:[...ids], completedAt:this.now() });
          source.claimExtraction.candidateIds = [...new Set([...(source.claimExtraction.candidateIds || []), ...ids])]; source.claimExtraction.completedAt = this.now(); source.claimExtraction.classification = 'Insufficient Evidence'; delete source.claimExtraction.lastError; delete source.claimExtraction.failedAt;
          const morePdf = source.mediaType === 'application/pdf' && pageEnd < Number(source.pages || pageEnd);
          if (morePdf) { source.claimExtraction.nextPage = pageEnd + 1; source.claimExtraction.nextAction = 'extract-next-page-bounded-claims'; source.state = 'claim-extraction-forced-pending'; }
          else { source.claimExtraction.nextPage = null; source.claimExtraction.nextAction = ids.length ? 'evaluate-bounded-candidate-claims' : 'no-bounded-assertion-found'; source.state = 'claim-extraction-complete'; }
          queue.updatedAt = source.claimExtraction.completedAt; this.queue.write(queue); outcomes.push({ sourceId:source.id, state:source.state, candidateIds:ids, pages:source.mediaType === 'application/pdf' ? [pageStart, pageEnd] : null, comparison });
        } catch (error) {
          queue = this.queue.read(); source = [...queue.documents, ...queue.links].find((item) => item.id === selected.id); source.state = 'claim-extraction-forced-pending'; source.claimExtraction.lastError = String(error.message || error); source.claimExtraction.nextAction = 'retry-bounded-claim-extraction'; source.claimExtraction.failedAt = this.now(); queue.updatedAt = source.claimExtraction.failedAt; this.queue.write(queue); outcomes.push({ sourceId:source.id, state:'blocked', reason:source.claimExtraction.lastError, candidateIds:[] });
        }
      }
      return outcomes;
    } finally { unlock(); }
  }
}

module.exports = { cleanText, boundedAssertions, normalizedClaimSha256, defaultExtractText, AtomicClaimExtractionQueue, ClaimExtractionWorker };
