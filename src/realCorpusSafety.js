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
// The satisfied branch used to require a source that was recorded quarantined AND whose stored
// content still carried the patterns. Those two are mutually exclusive by construction, so it
// could never be reached for any document the safeguard actually caught.
//
// sourceRetrievalWorker says so in its own words - `blocker: 'retrieved content was quarantined
// before persistence'`. SafeInformationRetriever.retrieve returns `content: null` when it finds
// injection signals, so the worker sets state, classification and quarantineReasons and never
// writes a durablePath. A quarantined source therefore has no stored content, sourceContentPath
// returns null for it, and the loop `continue`d past it before the pattern test ran. The only
// sources that reached the pattern test were the ones with stored content - that is, the ones
// that were admitted - and for those the satisfied branch is correctly refused. So R8's
// prompt-injection behaviour was unsatisfiable, and "pending" has been reported for weeks for a
// reason that was never about the corpus.
//
// The recorded quarantine is the demonstration, and it is the strongest evidence available:
// content absent is what the safeguard DID. The guard the previous shape was reaching for is kept
// exactly - a source with stored content is an admitted source and can never be evidence, which
// is why absentContent is required rather than merely allowed.
// The independent vetting organ's own record of what it refused. Oversight publishes
// encrypted-custody-report.json beside the ciphertext in the vetted state repository, and it
// carries a per-source decision with a reason. The hosted workflow already clones that file onto
// the runner to join the ciphertext parts; nothing read it.
//
// This matters because Crucible's queue does not carry Oversight's reason. A source Oversight
// quarantines appears in the queue as oversight-vetting-pending, so proveInjection - which reads
// the queue state - found zero quarantined sources while the refusal was recorded all along, one
// directory away, by the party whose independence is the point.
//
// Treated as candidate evidence from an independent party, never as instruction. Only two fields
// are read, decision and reason, and a refusal is credited only when the corpus also does not
// hold the content: an independent record that the bytes were refused, corroborated by the bytes
// being absent. The report is not encrypted, so its trust basis is membership of the vetted
// repository rather than the bundle key - which is why the content-absence half is required
// rather than decorative.
function oversightInjectionRefusals(custodyReport) {
  const reviews = (custodyReport && Array.isArray(custodyReport.sourceReviews)) ? custodyReport.sourceReviews : [];
  return reviews
    .filter((review) => String(review.decision || '') === 'quarantined' && /prompt.?injection/i.test(String(review.reason || '')))
    .map((review) => ({ sourceId: String(review.sourceId || ''), contentSha256: String(review.contentSha256 || '').toLowerCase(), reason: String(review.reason || '') }));
}

function proveInjection(bundleRoot, sources, readFile = fs.readFileSync, custodyReport = null) {
  const admitted = [];
  // Independent refusal first, because it is the stronger evidence: a different party recorded
  // the decision, and Crucible holds none of the bytes it refused.
  const storedHashes = new Set();
  for (const source of sources) {
    if (sourceContentPath(bundleRoot, source)) storedHashes.add(String(source.contentSha256 || '').toLowerCase());
  }
  // A refusal whose bytes are in the corpus anyway is kept and reported rather than skipped. The
  // first run to read the report found exactly that: Oversight recorded one source quarantined
  // for prompt-injection content and the corpus still stores that content hash, with no other
  // review sharing it. So the decision was published and the bytes were published with it, and
  // the refusal did not keep anything out. Silently falling through made the log contradict
  // itself - "1 recorded as quarantined" followed by "no source is recorded quarantined" - and
  // this is the finding, not a detail of it.
  const refusalsNotHonoured = [];
  for (const refusal of oversightInjectionRefusals(custodyReport)) {
    if (!refusal.contentSha256) continue;
    if (storedHashes.has(refusal.contentSha256)) { refusalsNotHonoured.push(refusal); continue; }
    return satisfied('prompt-injection', {
      sourceId: refusal.sourceId,
      recordedBy: 'independent-oversight-custody-report',
      reason: refusal.reason,
      contentSha256: refusal.contentSha256,
      contentPersisted: false,
      classification: 'Crucible Issue',
      state: 'quarantined',
      quarantineReasons: [refusal.reason],
    });
  }
  for (const source of sources) {
    const file = sourceContentPath(bundleRoot, source);
    const quarantine = recordedQuarantine(source);
    if (!file) {
      // No stored content. The safeguard firing looks exactly like this, and nothing else does:
      // the corpus records the refusal and holds none of the bytes it refused.
      if (quarantine && quarantine.quarantineReasons.some((reason) => /prompt-injection/i.test(reason))) {
        return satisfied('prompt-injection', {
          sourceId: String(source.id),
          classification: String(source.classification || 'Crucible Issue'),
          contentPersisted: false,
          blocker: String(source.blocker || 'not recorded'),
          ...quarantine,
        });
      }
      continue;
    }
    let content;
    try { content = String(readFile(file, 'utf8')); } catch { continue; }
    const matched = INJECTION_PATTERNS.filter((pattern) => pattern.test(content));
    if (!matched.length) continue;
    // Stored content plus a pattern match is an ADMITTED document, whatever its state field says.
    // Reporting that as the safeguard being demonstrated would cite the one case where it failed.
    admitted.push({ sourceId: String(source.id), patterns: matched.map((pattern) => pattern.source) });
  }
  // Reported rather than swallowed, and with the matching pattern named. "60 documents carry
  // prompt-injection patterns" reads as sixty attacks sitting in the corpus; naming the pattern
  // lets a reader see when it is /(?:execute|run).{0,20}(?:command|shell|powershell|bash)/
  // matching "run the command javac", which ordinary technical documentation does constantly.
  // These patterns screen untrusted fetches at retrieval time, where over-matching is cheap and
  // a miss is not; reused as a corpus-wide assertion they answer a different question. Whether
  // to narrow them is a safety decision for the owner, so this reports and decides nothing.
  // Said first and plainly, because an independent refusal that did not hold is a worse finding
  // than no refusal at all: the safeguard ran, recorded its decision, and the bytes arrived
  // anyway. This is what makes the content-absence half of that check load-bearing rather than
  // decorative - crediting the decision alone would have reported the gate satisfied on it.
  const notHonoured = refusalsNotHonoured.length
    ? ` Independent oversight recorded ${refusalsNotHonoured.length} source(s) quarantined for prompt injection whose content the corpus stores anyway, so the refusal did not keep the bytes out and is not evidence that it did: ${refusalsNotHonoured.map((item) => `${item.sourceId} at contentSha256 ${item.contentSha256}`).join('; ')}.`
    : '';
  if (!admitted.length) {
    return unsatisfied('prompt-injection', `no document in the restored corpus carries a prompt-injection pattern, and no source is recorded as quarantined for one, so the corpus cannot demonstrate this quarantine on real content.${notHonoured}`);
  }
  // Grouped by pattern with source ids, because the counts alone were not actionable. The first
  // run to print them showed 45 of 60 matching the exfiltration pattern - the specific one, which
  // ordinary documentation samples do not match - and only 18 matching the broad ones. So "these
  // are over-matches" stopped being a safe reading, and whoever looks next needs to know WHICH
  // documents to open.
  //
  // Deliberately no match context. This pattern fires on text near "secret", "credential",
  // "token" and "key", which is exactly where a real credential would sit, and this runs in a
  // public Actions log. Naming the source ids sends the reader to the documents in vetted custody
  // instead of copying their bytes into a log that cannot be unpublished.
  const byPattern = new Map();
  for (const item of admitted) {
    for (const pattern of item.patterns) {
      if (!byPattern.has(pattern)) byPattern.set(pattern, []);
      byPattern.get(pattern).push(item.sourceId);
    }
  }
  const breakdown = [...byPattern.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pattern, ids]) => `${ids.length}x ${pattern} (e.g. ${ids.slice(0, 3).join(', ')})`)
    .join('; ');
  return unsatisfied('prompt-injection', `${admitted.length} document(s) have stored content matching a prompt-injection pattern and are not recorded as quarantined; they were admitted, so they cannot be evidence that the safeguard fired. By pattern, most frequent first, with source ids to open in vetted custody: ${breakdown}. No content is quoted here on purpose: these patterns fire next to the words secret, credential, token and key, and this is a public log. No source in this corpus is both recorded as refused and absent from it, which is what the satisfied case requires.${notHonoured}`);
}

// Real retrieved bytes that are an executable rather than a document.
//
// This looked for the wrong signature, and looked for it in a place the pipeline is built never
// to fill. SafeInformationRetriever does not record a quarantine for executable content - it
// THROWS, at `if (magic || SUSPICIOUS_BINARY_EXTENSION.test(...))`, before anything is persisted.
// sourceRetrievalWorker catches that and records `state: 'retrieval-blocked'`,
// `classification: 'Insufficient Evidence'` and the retriever's own message in `blocker`. So no
// source is ever recorded `state: 'quarantined'` for executable content, and none ever has stored
// bytes beginning with executable magic either, because the throw precedes persistence. The old
// shape required both at once, so its satisfied branch was unreachable and the gate could only
// ever report the corpus explanation.
//
// The recorded refusal is the demonstration. It is the retriever's own sentence, kept verbatim in
// the queue, on a source that holds none of the bytes it refused - and the corpus already carries
// retrieval-blocked sources, so this evidence may exist today where the previous shape could not
// have seen it. The admitted-document guard is unchanged and still decisive: bytes present means
// the screen did not stop them, whatever any state field says.
const EXECUTABLE_REFUSAL = /Executable content quarantined/i;

function proveExecutable(bundleRoot, sources, readFile = fs.readFileSync) {
  const admitted = [];
  for (const source of sources) {
    const file = sourceContentPath(bundleRoot, source);
    if (!file) {
      // No stored bytes. A refusal recorded by either shape counts: the retriever's message under
      // retrieval-blocked, which is what the code actually produces, or an explicit quarantine
      // recorded for executable content, which nothing writes today but which would still be a
      // refusal if something did.
      const blocker = String(source.blocker || '');
      const quarantine = recordedQuarantine(source);
      const byBlocker = EXECUTABLE_REFUSAL.test(blocker);
      const byReason = Boolean(quarantine && quarantine.quarantineReasons.some((reason) => /executable/i.test(reason)));
      if (byBlocker || byReason) {
        return satisfied('executable-content', {
          sourceId: String(source.id),
          state: String(source.state || 'not recorded'),
          classification: String(source.classification || 'not recorded'),
          contentPersisted: false,
          refusal: byBlocker ? blocker : 'recorded as a quarantine reason',
          ...(quarantine || {}),
        });
      }
      continue;
    }
    let head;
    try { const handle = fs.openSync(file, 'r'); const buffer = Buffer.alloc(8); fs.readSync(handle, buffer, 0, 8, 0); fs.closeSync(handle); head = buffer; } catch { continue; }
    const magic = EXECUTABLE_MAGIC.find((item) => head.subarray(0, item.bytes.length).equals(item.bytes));
    if (!magic) continue;
    // Stored executable bytes are an admitted executable. That is the screen having failed, and
    // it can never be evidence that it worked.
    admitted.push(`${String(source.id)} (${magic.name})`);
  }
  return unsatisfied('executable-content', admitted.length
    ? `${admitted.length} document(s) have stored content beginning with executable magic bytes and are not recorded as refused (${admitted.slice(0, 3).join(', ')}); they were admitted, so they cannot be evidence that the safeguard fired`
    : 'no source in the restored corpus records an executable-content refusal, and none has stored content beginning with executable magic bytes, so the corpus cannot demonstrate this quarantine on real content');
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
async function realCorpusSafety({ root, bundleRoot, bundle, payload, candidateRecords = [], custodyReport = null }) {
  const sources = (bundle && bundle.sources) || [];
  const approved = sources.map((source) => String(source.finalUrl || source.url || '')).find((url) => /^https:\/\//.test(url));
  const behaviours = [];
  behaviours.push(...(approved
    ? await proveRefusals(root, approved)
    : [unsatisfied('kill-switch', 'the corpus holds no https URL to attempt a refused retrieval against'), unsatisfied('blocked-source', 'the corpus holds no https URL to attempt a refused retrieval against')]));
  behaviours.push(proveDuplicateUrl(sources));
  behaviours.push(proveDuplicateContent(sources));
  behaviours.push(proveDuplicateClaim(candidateRecords));
  behaviours.push(proveInjection(bundleRoot, sources, fs.readFileSync, custodyReport));
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

module.exports = { REQUIRED, oversightInjectionRefusals, realCorpusSafety, proveRefusals, proveDuplicateUrl, proveDuplicateContent, proveDuplicateClaim, proveInjection, proveExecutable, proveContradiction };
