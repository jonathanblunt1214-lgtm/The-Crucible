// R8 proven against the real corpus and a real retriever, not against a stub.
//
// The hosted proof previously satisfied all eight safety behaviours with fetchImpl replaced by
// a function returning a string written inline, and with three of the eight asserted as
// tautologies - sha('same content') equals sha('same content'), and a claim hash equals itself
// with different whitespace. Those prove the helpers compile. They prove nothing about the
// corpus, and a gate that passes on a tautology is indistinguishable from one that succeeded.
//
// Every behaviour here is derived from something real: the documents actually retrieved into
// the corpus, the queue that recorded their retrieval, the candidates extraction produced from
// them, and a SafeInformationRetriever running with its real fetch. Two of the eight are
// deliberately provable without any network call at all, because the retriever is supposed to
// refuse before reaching the network - that refusal IS the behaviour.
//
// A behaviour the corpus cannot demonstrate reports unsatisfied and says why. It is never
// filled in with a constructed example, because the point of the gate is to establish that the
// safety rules held on real material.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { INJECTION_PATTERNS, RetrievalAuditStore, SafeInformationRetriever } = require('./safeInformationRetrieval');
const { normalizedClaimSha256 } = require('./claimExtractionWorker');

const REQUIRED = ['kill-switch', 'duplicate-url', 'duplicate-content-hash', 'duplicate-claim', 'prompt-injection', 'executable-content', 'blocked-source', 'contradiction-quarantine'];
const EXECUTABLE_MAGIC = [
  { name: 'PE/DOS executable', bytes: Buffer.from('MZ') },
  { name: 'ELF executable', bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { name: 'Mach-O executable', bytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) },
  { name: 'Java class file', bytes: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
];

const satisfied = (behaviour, evidence) => ({ behaviour, satisfied: true, evidence, proofStageSatisfied: false, promotionAuthorized: false });
const unsatisfied = (behaviour, reason) => ({ behaviour, satisfied: false, reason, proofStageSatisfied: false, promotionAuthorized: false });

// The restored queue comes from a repository Crucible does not control, so a declared path is a
// claim about where content lives, not permission to read there. verifyRestored authenticates the
// manifest and the file hashes; it does not confine these paths, and the hosted workflow calls
// verify rather than hydrate - so containment is enforced here, before any read. A path that
// resolves outside the corpus's own sources directory is refused rather than followed, whether it
// climbs out with .. or simply names somewhere else absolutely: a safety proof that reads a runner
// file outside the authenticated corpus proves nothing about the corpus.
function sourceContentPath(bundleRoot, source) {
  const declared = String(source.durablePath || '').replaceAll('\\', '/');
  if (!declared) return null;
  const sourcesRoot = path.resolve(bundleRoot, 'sources');
  const file = path.resolve(path.isAbsolute(declared) ? declared : path.join(bundleRoot, declared));
  if (file !== sourcesRoot && !file.startsWith(`${sourcesRoot}${path.sep}`)) return null;
  return fs.existsSync(file) ? file : null;
}

// The retriever refuses a killed run and an unapproved URL before it opens a socket, so both
// are provable against a real retriever with its real fetch left in place: if either check
// leaked, the run would attempt a real request and the assertion would not hold.
async function proveRefusals(root, approvedUrl) {
  const results = [];
  const build = (killed) => {
    const workspace = path.join(root, `safety-${crypto.randomUUID()}`);
    const retriever = new SafeInformationRetriever({ approvedUrls: [approvedUrl], auditStore: new RetrievalAuditStore(workspace), killSwitchFile: path.join(workspace, 'KILL'), minimumIntervalMs: 0 });
    if (killed) { fs.mkdirSync(path.dirname(retriever.killSwitchFile), { recursive: true }); fs.writeFileSync(retriever.killSwitchFile, 'stop', { mode: 0o600 }); }
    return retriever;
  };

  const killed = build(true);
  try {
    await killed.retrieve(approvedUrl);
    results.push(unsatisfied('kill-switch', 'the retriever proceeded past an active kill switch'));
  } catch (error) {
    const record = killed.auditStore.read().records.at(-1);
    results.push(/kill switch/i.test(String(error.message)) && record && record.state === 'blocked'
      ? satisfied('kill-switch', { requestedUrl: approvedUrl, auditState: record.state, reason: record.reason })
      : unsatisfied('kill-switch', `the retriever refused for the wrong reason: ${error.message}`));
  }

  const open = build(false);
  const unapproved = 'https://unapproved.invalid/evidence';
  try {
    await open.retrieve(unapproved);
    results.push(unsatisfied('blocked-source', 'the retriever accepted a URL the owner never approved'));
  } catch (error) {
    const record = open.auditStore.read().records.at(-1);
    results.push(/not owner supplied/i.test(String(error.message)) && record && record.state === 'blocked'
      ? satisfied('blocked-source', { requestedUrl: unapproved, auditState: record.state, reason: record.reason })
      : unsatisfied('blocked-source', `the retriever refused for the wrong reason: ${error.message}`));
  }
  return results;
}

// Two source ids that resolved to the same bytes. This is the mirrored-document case, and the
// corpus is full of it: it is why exact-match corroboration used to fire only on chrome.
function proveDuplicateContent(sources) {
  const byHash = new Map();
  for (const source of sources) {
    const hash = String(source.contentSha256 || '').toLowerCase();
    if (!hash) continue;
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(String(source.id));
  }
  const shared = [...byHash.entries()].filter(([, ids]) => new Set(ids).size > 1).sort((a, b) => b[1].length - a[1].length);
  return shared.length
    ? satisfied('duplicate-content-hash', { distinctContentsReachedTwice: shared.length, example: { contentSha256: shared[0][0], sourceIds: shared[0][1].slice(0, 4) } })
    : unsatisfied('duplicate-content-hash', 'no two sources in the corpus resolved to identical content, so the corpus cannot demonstrate this');
}

// Two queue entries that resolved to the same final URL after redirects.
function proveDuplicateUrl(sources) {
  const byUrl = new Map();
  for (const source of sources) {
    const final = String(source.finalUrl || source.url || '').trim().toLowerCase().replace(/\/+$/, '');
    if (!final) continue;
    if (!byUrl.has(final)) byUrl.set(final, new Set());
    byUrl.get(final).add(String(source.id));
  }
  const shared = [...byUrl.entries()].filter(([, ids]) => ids.size > 1);
  return shared.length
    ? satisfied('duplicate-url', { distinctUrlsReachedTwice: shared.length, example: { finalUrl: shared[0][0], sourceIds: [...shared[0][1]].slice(0, 4) } })
    : unsatisfied('duplicate-url', 'no two queue entries in the corpus resolved to the same final URL, so the corpus cannot demonstrate this');
}

// One claim extracted from two different sources with byte-identical normalized text. This is
// deduplication on real extracted evidence rather than a hash compared with itself.
function proveDuplicateClaim(candidateRecords) {
  const byClaim = new Map();
  for (const record of candidateRecords) {
    const key = normalizedClaimSha256(record.candidate.claim);
    if (!byClaim.has(key)) byClaim.set(key, { claim: record.candidate.claim, sourceIds: new Set() });
    byClaim.get(key).sourceIds.add(String(record.candidate.provenance.sourceId));
  }
  const shared = [...byClaim.values()].filter((item) => item.sourceIds.size > 1).sort((a, b) => b.sourceIds.size - a.sourceIds.size);
  return shared.length
    ? satisfied('duplicate-claim', { claimsAssertedByMoreThanOneSource: shared.length, example: { claim: shared[0].claim.slice(0, 200), sourceCount: shared[0].sourceIds.size } })
    : unsatisfied('duplicate-claim', 'no claim in the corpus was extracted from more than one source, so the corpus cannot demonstrate this');
}

// Whether the corpus records that this source was actually quarantined, as opposed to merely
// containing bytes that would have caused a quarantine had the safeguard run.
//
// SafeInformationRetriever writes the real outcome when it retrieves: state 'quarantined' with
// quarantineReasons, or state 'retrieved-candidate-evidence'. That record is the evidence. A
// pattern match performed here, later, over bytes the corpus already holds is a re-run of the
// classifier and proves only that the classifier still matches - not that the processing path
// ever enforced anything.
//
// The distinction matters in the alarming direction. A document that carries injection patterns
// and is sitting in the corpus as readable stored content is a document that was ADMITTED. To
// report that as "state: quarantined" is to report a safeguard as demonstrated by the very case
// where it did not fire.
//
// proveContradiction, in this same file, already reads the recorded state rather than asserting
// one. These two now do the same.
function recordedQuarantine(source) {
  if (String(source.state || '') !== 'quarantined') return null;
  const reasons = Array.isArray(source.quarantineReasons) ? source.quarantineReasons.map(String) : [];
  return { state: 'quarantined', quarantineReasons: reasons };
}

// A source the corpus records as quarantined for prompt injection, whose stored content still
// carries the patterns that caused it. Both halves are required: the recorded outcome is the
// evidence, and the pattern match confirms the record is about this content.
function proveInjection(bundleRoot, sources, readFile = fs.readFileSync) {
  const admitted = [];
  for (const source of sources) {
    const file = sourceContentPath(bundleRoot, source);
    if (!file) continue;
    let content;
    try { content = String(readFile(file, 'utf8')); } catch { continue; }
    const matched = INJECTION_PATTERNS.filter((pattern) => pattern.test(content));
    if (!matched.length) continue;
    const quarantine = recordedQuarantine(source);
    if (quarantine) {
      return satisfied('prompt-injection', { sourceId: String(source.id), patternsMatched: matched.length, classification: 'Crucible Issue', ...quarantine });
    }
    admitted.push(String(source.id));
  }
  // Reported rather than swallowed. Documents carrying injection patterns that the corpus does
  // not record as quarantined are the case this behaviour is supposed to catch, and saying
  // "nothing to see" about them would hide a safety signal behind an absence of evidence.
  return unsatisfied('prompt-injection', admitted.length
    ? `${admitted.length} document(s) carry prompt-injection patterns but are not recorded as quarantined (${admitted.slice(0, 3).join(', ')}); that is the safeguard not having fired, so it cannot be evidence that it did`
    : 'no document in the restored corpus carries a prompt-injection pattern, so the corpus cannot demonstrate this quarantine on real content');
}

// Real retrieved bytes that are an executable rather than a document.
function proveExecutable(bundleRoot, sources, readFile = fs.readFileSync) {
  const admitted = [];
  for (const source of sources) {
    const file = sourceContentPath(bundleRoot, source);
    if (!file) continue;
    let head;
    try { const handle = fs.openSync(file, 'r'); const buffer = Buffer.alloc(8); fs.readSync(handle, buffer, 0, 8, 0); fs.closeSync(handle); head = buffer; } catch { continue; }
    const magic = EXECUTABLE_MAGIC.find((item) => head.subarray(0, item.bytes.length).equals(item.bytes));
    if (!magic) continue;
    const quarantine = recordedQuarantine(source);
    if (quarantine) return satisfied('executable-content', { sourceId: String(source.id), magic: magic.name, ...quarantine });
    admitted.push(String(source.id));
  }
  return unsatisfied('executable-content', admitted.length
    ? `${admitted.length} document(s) begin with executable magic bytes but are not recorded as quarantined (${admitted.slice(0, 3).join(', ')}); that is the safeguard not having fired, so it cannot be evidence that it did`
    : 'no document in the restored corpus begins with executable magic bytes, so the corpus cannot demonstrate this quarantine on real content');
}

// A real corpus claim that contradicts a real promoted one, quarantined by the real learner.
// This needs promoted knowledge to contradict, so until R4-R6 land on real evidence it reports
// exactly that rather than manufacturing a claim to contradict a claim.
function proveContradiction(payload, candidateRecords) {
  const active = (payload.knowledgeVersions || []).filter((item) => item.status === 'active');
  if (!active.length) return unsatisfied('contradiction-quarantine', 'no verified knowledge exists yet, so there is nothing for a corpus claim to contradict; this follows R4-R6 rather than being provable before them');
  const quarantined = (payload.candidateRecords || []).filter((record) => record.state === 'quarantined' && /contradiction/i.test(JSON.stringify(record.history || [])));
  if (quarantined.length) {
    return satisfied('contradiction-quarantine', { quarantinedCandidateIds: quarantined.map((item) => item.candidate.id).slice(0, 4), againstActiveVersions: active.map((item) => item.version) });
  }
  const conflicting = candidateRecords.find((record) => active.some((item) => item.boundary === record.candidate.claimBoundary && item.claim !== record.candidate.claim));
  return unsatisfied('contradiction-quarantine', conflicting
    ? `corpus candidate ${conflicting.candidate.id} conflicts with active knowledge but has not been run through the learner yet`
    : 'no corpus candidate contradicts the active verified knowledge within its boundary, so the corpus cannot demonstrate this');
}

// All eight, from real material. Returns the behaviours proven, those that were not, and the
// plain evidence list the readiness gate consumes - which now only ever contains behaviours
// something real actually demonstrated.
async function realCorpusSafety({ root, bundleRoot, bundle, payload, candidateRecords = [] }) {
  const sources = (bundle && bundle.sources) || [];
  const approved = sources.map((source) => String(source.finalUrl || source.url || '')).find((url) => /^https:\/\//.test(url));
  const behaviours = [];
  behaviours.push(...(approved
    ? await proveRefusals(root, approved)
    : [unsatisfied('kill-switch', 'the corpus holds no https URL to attempt a refused retrieval against'), unsatisfied('blocked-source', 'the corpus holds no https URL to attempt a refused retrieval against')]));
  behaviours.push(proveDuplicateUrl(sources));
  behaviours.push(proveDuplicateContent(sources));
  behaviours.push(proveDuplicateClaim(candidateRecords));
  behaviours.push(proveInjection(bundleRoot, sources));
  behaviours.push(proveExecutable(bundleRoot, sources));
  behaviours.push(proveContradiction(payload || {}, candidateRecords));

  const ordered = REQUIRED.map((name) => behaviours.find((item) => item.behaviour === name) || unsatisfied(name, 'not evaluated'));
  return {
    schemaVersion: 1,
    behaviours: ordered,
    evidence: ordered.filter((item) => item.satisfied).map((item) => item.behaviour),
    unsatisfied: ordered.filter((item) => !item.satisfied).map((item) => ({ behaviour: item.behaviour, reason: item.reason })),
    allSatisfied: ordered.every((item) => item.satisfied),
    proofStageSatisfied: false,
    promotionAuthorized: false,
  };
}

module.exports = { REQUIRED, realCorpusSafety, proveRefusals, proveDuplicateUrl, proveDuplicateContent, proveDuplicateClaim, proveInjection, proveExecutable, proveContradiction };
