// Deciding when two independently written sources assert the same claim.
//
// Corroboration was exact string equality on normalized claim text. Extraction emits verbatim
// sentences, so two independently written documents essentially never matched, and a corpus of
// 403 sources corroborated nothing. Exact matching can only ever fire on duplicated text -
// mirrors, reposts, boilerplate - which is the opposite of independent agreement.
//
// What makes a looser test acceptable here is where it sits. Corroboration only routes a claim
// into controlled evaluation; it never satisfies proof, and the experiment and the distinct
// verifier still have to pass on their own. So this may be a judgement about wording, but it is
// never a judgement about truth, and every result says so.
//
// It is deterministic, dependency-free, and deliberately conservative: it would rather miss a
// real agreement than invent one. Three things it will not do, each of which would be worse
// than missing:
//   - Corroborate across a negation. "does not modify" and "modifies" share almost every word
//     and mean opposite things; treating them as agreement would let a contradiction promote.
//   - Corroborate across different numbers. "returns three items" and "returns five items" are
//     not the same claim however similar the prose.
//   - Judge a sentence too short to carry meaning, where a handful of shared common words
//     would otherwise look like agreement.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'each', 'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is', 'it', 'its', 'may', 'might', 'must',
  'of', 'on', 'onto', 'or', 'over', 'own', 'per', 'shall', 'should', 'so', 'some', 'such', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'under', 'up',
  'upon', 'use', 'used', 'uses', 'using', 'was', 'were', 'when', 'where', 'which', 'while', 'will', 'with',
  'would', 'you', 'your', 'we', 'our', 'also', 'any', 'all', 'both', 'because', 'about', 'after', 'before',
]);

// Negations are counted rather than merely detected, so a double negative does not read as a
// negative. They are removed from the content terms: whether a claim is negated is polarity,
// not subject matter, and mixing the two is what would let opposites look similar.
const NEGATIONS = new Set(['not', 'never', 'no', 'none', 'cannot', 'without', 'neither', 'nor', 'nothing']);

// Plural and simple verb inflections only. Nothing here guesses at meaning; it collapses
// surface forms that are unambiguously the same word.
function stem(term) {
  if (term.length > 4 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith('sses')) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss') && !term.endsWith('us')) return term.slice(0, -1);
  return term;
}

// The names a claim commits to: proper nouns and code identifiers. Treated exactly like
// numbers, and for the same reason.
//
// The real corpus proved this necessary. "Essential Javascript is a free book about JavaScript
// programming language" and "Essential C# is a free book about C# programming language" scored
// above the overlap threshold and were reported as one claim, because the only differing term
// sat inside enough shared boilerplate to carry the score. They are not one claim. Neither are
// a Bash book's disclaimer and a TypeScript book's, nor "Xamarin.Forms for macOS Succinctly"
// and "Xamarin.Forms Succinctly". A substituted name changes the subject, and a test that
// cannot see that will corroborate a template with itself.
//
// A sentence's first word is skipped: its capital is grammar, not a name.
function claimEntities(claim) {
  const entities = new Set();
  for (const sentence of String(claim || '').split(/(?<=[.!?])\s+/)) {
    const tokens = sentence.trim().split(/\s+/).filter(Boolean);
    for (const [index, raw] of tokens.entries()) {
      const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9#+.]+$/g, '');
      if (token.length < 2) continue;
      const internalCapital = /[a-z][A-Z]/.test(token);
      const codeMark = /[#+]/.test(token) || /[A-Za-z]\.[A-Za-z]/.test(token);
      const initialCapital = /^[A-Z]/.test(token) && index > 0;
      if (!internalCapital && !codeMark && !initialCapital) continue;
      if (STOPWORDS.has(token.toLowerCase())) continue;
      entities.add(token.toLowerCase());
    }
  }
  return [...entities].sort();
}

function tokenize(claim) {
  return String(claim || '')
    .toLowerCase()
    .replace(/n't\b/g, ' not')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// A claim reduced to the three things that decide whether two claims are the same one:
// its polarity, the exact numbers it commits to, and its content terms.
function claimFingerprint(claim) {
  const tokens = tokenize(claim);
  const negationCount = tokens.filter((token) => NEGATIONS.has(token)).length;
  const numbers = tokens.filter((token) => /^\d+(?:\.\d+)?$/.test(token.replace(/\.$/, ''))).map((token) => token.replace(/\.$/, '')).sort();
  const terms = tokens
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !NEGATIONS.has(token) && !/^\d/.test(token))
    .map(stem);
  return { negated: negationCount % 2 === 1, negationCount, numbers, entities: claimEntities(claim), terms: [...new Set(terms)].sort() };
}

const DEFAULT_MINIMUM_OVERLAP = 0.8;
const DEFAULT_MINIMUM_TERMS = 4;

// Whether two fingerprints may be treated as the same claim. Separated from the text entry
// point so that grouping a whole corpus fingerprints each claim once instead of re-tokenizing
// it against every group it is compared with.
function compareFingerprints(a, b, { minimumOverlap = DEFAULT_MINIMUM_OVERLAP, minimumTerms = DEFAULT_MINIMUM_TERMS } = {}) {
  const base = { proofStageSatisfied: false, promotionAuthorized: false, independentVerificationSatisfied: false };

  if (a.negated !== b.negated) {
    return { ...base, corroborates: false, reason: 'the claims have opposite polarity, so they are contradictory rather than corroborating however similar their wording' };
  }
  if (a.numbers.join(',') !== b.numbers.join(',')) {
    return { ...base, corroborates: false, reason: `the claims commit to different numbers (${a.numbers.join(', ') || 'none'} against ${b.numbers.join(', ') || 'none'})` };
  }
  if (a.entities.join(',') !== b.entities.join(',')) {
    const onlyA = a.entities.filter((entity) => !b.entities.includes(entity));
    const onlyB = b.entities.filter((entity) => !a.entities.includes(entity));
    return { ...base, corroborates: false, reason: `the claims name different subjects (${onlyA.join(', ') || 'none'} against ${onlyB.join(', ') || 'none'}), so they are claims about different things however similar their wording` };
  }
  if (a.terms.length < minimumTerms || b.terms.length < minimumTerms) {
    return { ...base, corroborates: false, reason: `at least ${minimumTerms} content terms are required to judge sameness; found ${Math.min(a.terms.length, b.terms.length)}` };
  }

  const setA = new Set(a.terms);
  const setB = new Set(b.terms);
  const shared = [...setA].filter((term) => setB.has(term)).sort();
  const union = new Set([...setA, ...setB]);
  const overlap = shared.length / union.size;
  if (overlap < minimumOverlap) {
    return { ...base, corroborates: false, overlap, sharedTerms: shared, reason: `content-term overlap ${overlap.toFixed(2)} is below the ${minimumOverlap} threshold` };
  }
  return { ...base, corroborates: true, overlap, sharedTerms: shared, negated: a.negated, numbers: a.numbers, reason: `content-term overlap ${overlap.toFixed(2)} with matching polarity and numbers` };
}

// Whether two claims may be treated as the same claim for routing into evaluation. Symmetric,
// deterministic, and never a statement about either claim being true.
function semanticallyCorroborates(claimA, claimB, options = {}) {
  return compareFingerprints(claimFingerprint(claimA), claimFingerprint(claimB), options);
}

// The two conditions no overlap score can ever overcome: opposite polarity and different
// numbers. Bucketing on them lets a corpus-sized grouping skip comparisons that are already
// decided, without changing a single outcome.
function incompatibilityKey(fingerprint) {
  return `${fingerprint.negated ? 'neg' : 'aff'}|${fingerprint.numbers.join(',')}|${fingerprint.entities.join(',')}`;
}

// Groups candidate claims into sets that assert the same thing. Deterministic: candidates are
// walked in a stable order and each joins the first group it corroborates, so the same input
// always yields the same grouping regardless of how the corpus was loaded.
function groupCorroborating(entries, options = {}) {
  const ordered = [...entries]
    .map((entry) => ({ entry, fingerprint: claimFingerprint(entry.claim) }))
    .sort((left, right) => (String(left.entry.id) < String(right.entry.id) ? -1 : 1));
  const groups = [];
  const buckets = new Map();
  for (const { entry, fingerprint } of ordered) {
    const key = incompatibilityKey(fingerprint);
    if (!buckets.has(key)) buckets.set(key, []);
    const bucket = buckets.get(key);
    let placed = false;
    for (const group of bucket) {
      const decision = compareFingerprints(group.fingerprint, fingerprint, options);
      if (decision.corroborates) {
        group.members.push({ ...entry, match: decision });
        placed = true;
        break;
      }
    }
    if (!placed) {
      const group = { claim: entry.claim, fingerprint, members: [{ ...entry, match: null }] };
      groups.push(group);
      bucket.push(group);
    }
  }
  return groups.map(({ claim, members }) => ({ claim, members }));
}

module.exports = { STOPWORDS, NEGATIONS, DEFAULT_MINIMUM_OVERLAP, DEFAULT_MINIMUM_TERMS, claimFingerprint, claimEntities, compareFingerprints, semanticallyCorroborates, groupCorroborating };
