// Owner-paired corroboration: nominating two real sources that assert one claim.
//
// Semantic corroboration finds agreement the corpus already contains. It cannot help when the
// two documents that agree state the claim in wording too different for any deterministic
// same-meaning test to accept, and loosening that test until they match is exactly the failure
// mode that would let contradictions promote. This is the other direction: the owner names two
// sources, and the corpus is asked to prove the pairing rather than being asked to find it.
//
// The pairing is never taken on trust. For a declaration to be usable, all of this must hold
// against the restored bundle:
//   - both nominated source ids exist in the corpus, and they are two distinct sources;
//   - each source's stored content is present and hashes to what the queue recorded, so a
//     pairing cannot be pointed at content that has since changed;
//   - each source genuinely asserts the claim - established by finding, among that document's
//     own bounded assertions, a sentence that the deterministic same-meaning test accepts.
//
// That last point is what keeps R4's invariant intact. The claim carried forward for each
// source is the document's own sentence, verbatim, never the owner's wording. A declaration
// therefore selects which two sources to evaluate; it cannot introduce a claim, and it cannot
// make a source say something it does not say. And like every other form of corroboration
// here, it authorizes evaluation only - the experiment and the distinct verifier still decide.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { boundedAssertions } = require('./claimExtractionWorker');
const { semanticallyCorroborates } = require('./semanticCorroboration');
const { sourceIndex, independent } = require('./sourceIndependence');

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Bundled sources record durablePath relative to the bundle root; a source staged in place may
// still hold an absolute one. Either way the content must hash to what the queue recorded.
function readSourceContent(bundleRoot, source) {
  const declared = String(source.durablePath || '').replaceAll('\\', '/');
  if (!declared) throw new Error(`Source ${source.id} has no stored content path.`);
  const file = path.isAbsolute(declared) ? declared : path.join(bundleRoot, declared);
  const resolved = path.resolve(file);
  // The queue is restored from a repository Crucible does not control, so a declared path is a
  // claim about where content lives rather than permission to read there. Absolute is allowed
  // because a source staged in place records one, but it must still land inside the corpus's own
  // sources directory: a pairing must never be able to make a runner file into corroboration.
  const sourcesRoot = path.resolve(bundleRoot, 'sources');
  if (resolved !== sourcesRoot && !resolved.startsWith(`${sourcesRoot}${path.sep}`)) throw new Error(`Source ${source.id} declares content outside the corpus: ${declared}.`);
  if (!fs.existsSync(resolved)) throw new Error(`Source ${source.id} has no restored content at ${declared}.`);
  const content = fs.readFileSync(resolved, 'utf8');
  const recorded = String(source.contentSha256 || '').toLowerCase();
  // The hash is required, not merely checked when present. A pairing is the one place owner
  // judgement reaches the corpus, and it reaches it by source id; without a recorded hash the
  // bytes behind that id are whatever is on disk now, so unhashed content could become
  // corroboration on nothing but a filename.
  if (!/^[0-9a-f]{64}$/.test(recorded)) throw new Error(`Source ${source.id} has no recorded content hash, so its content cannot be corroboration.`);
  if (sha256(content) !== recorded) throw new Error(`Source ${source.id} content does not match the hash the queue recorded.`);
  return content;
}

// The sentence a document actually uses to assert a claim, chosen from that document's own
// bounded assertions. A verbatim statement wins outright; otherwise the highest-overlap
// accepted paraphrase, with ties broken on the sentence text so the choice is deterministic.
function assertingSentence(content, claim, options = {}) {
  const assertions = boundedAssertions(content);
  const wanted = normalize(claim);
  const verbatim = assertions.find((sentence) => normalize(sentence) === wanted);
  if (verbatim) return { sentence: verbatim, agreement: 'verbatim', decision: null };
  let best = null;
  for (const sentence of assertions) {
    const decision = semanticallyCorroborates(claim, sentence, options);
    if (!decision.corroborates) continue;
    if (!best || decision.overlap > best.decision.overlap || (decision.overlap === best.decision.overlap && sentence < best.sentence)) {
      best = { sentence, agreement: 'semantic', decision };
    }
  }
  return best;
}

// Whether the corpus supports a declaration's nominated pairing. Reports the reason it does
// not rather than throwing, because "these two sources do not both say this" is an ordinary
// answer the owner needs to read, not a fault.
function verifyPairedDeclaration({ bundle, bundleRoot, declaration, options = {} }) {
  const unsatisfied = (reason) => ({ satisfied: false, reason, sources: [], proofStageSatisfied: false, promotionAuthorized: false, independentVerificationSatisfied: false });
  const nominated = declaration && declaration.pairedSources;
  if (!Array.isArray(nominated) || nominated.length !== 2) return unsatisfied('a paired declaration must nominate exactly two source ids');
  const ids = nominated.map((value) => String(value || '').trim());
  if (ids.some((value) => !value)) return unsatisfied('every nominated source id must be a non-empty string');
  if (ids[0] === ids[1]) return unsatisfied('the two nominated sources must be distinct: one document agreeing with itself is not corroboration');

  const found = [];
  for (const id of ids) {
    const source = (bundle.sources || []).find((item) => String(item.id) === id);
    if (!source) return unsatisfied(`source ${id} is not in the restored corpus, so nothing can be paired to it`);
    found.push(source);
  }

  // The owner may name the exact sentence each source uses. That is the judgement only a person
  // can supply - that two differently worded sentences state the same claim - and the corpus
  // still has to confirm the sentence is genuinely one of that document's bounded assertions.
  const declared = declaration.pairedAssertions;
  if (declared !== undefined && (!Array.isArray(declared) || declared.length !== 2 || declared.some((value) => typeof value !== 'string' || !value.trim()))) {
    return unsatisfied('pairedAssertions, when present, must give one non-empty sentence for each nominated source, in the same order');
  }

  const resolved = [];
  for (const [index, source] of found.entries()) {
    let content;
    try {
      content = readSourceContent(bundleRoot, source);
    } catch (error) {
      return unsatisfied(error.message);
    }
    if (declared) {
      const assertions = boundedAssertions(content);
      const wanted = normalize(declared[index]);
      const verbatim = assertions.find((sentence) => normalize(sentence) === wanted);
      if (!verbatim) {
        return unsatisfied(`source ${source.id} does not contain the sentence declared for it; a pairing may say what a document means, never that it says something it does not`);
      }
      resolved.push({ sourceId: String(source.id), sentence: verbatim, agreement: 'owner-declared', overlap: null, contentSha256: String(source.contentSha256 || '').toLowerCase() });
      continue;
    }
    const asserting = assertingSentence(content, declaration.claim, options);
    if (!asserting) {
      return unsatisfied(`source ${source.id} does not assert the declared claim: none of its bounded assertions carries that meaning, and a pairing never makes a document say what it does not say`);
    }
    resolved.push({ sourceId: String(source.id), sentence: asserting.sentence, agreement: asserting.agreement, overlap: asserting.decision ? asserting.decision.overlap : 1, contentSha256: String(source.contentSha256 || '').toLowerCase() });
  }

  // A nomination cannot make two pages of one publisher, or two printings of one document,
  // into independent sources. The owner chooses which pair to evaluate; what counts as two
  // sources is not theirs to declare.
  const index = sourceIndex(bundle);
  const relation = independent(index.get(ids[0]), index.get(ids[1]));
  if (!relation.independent) return unsatisfied(relation.reason);

  return {
    satisfied: true,
    reason: null,
    // True only when the owner supplied the sentences and the wording test does not already
    // relate them on its own; this is what the comparison layer records as owner-declared.
    ownerDeclaredAgreement: Boolean(declared) && !semanticallyCorroborates(resolved[0].sentence, resolved[1].sentence, options).corroborates && normalize(resolved[0].sentence) !== normalize(resolved[1].sentence),
    sources: resolved,
    // A verified pairing routes two real candidates into controlled evaluation. It is not proof,
    // it is not independent verification, and it authorizes no promotion on its own.
    proofStageSatisfied: false,
    independentVerificationSatisfied: false,
    promotionAuthorized: false,
  };
}

module.exports = { readSourceContent, assertingSentence, verifyPairedDeclaration };
