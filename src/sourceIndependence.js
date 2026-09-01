// Whether two sources are independent enough for one to corroborate the other.
//
// Independence was "the source ids differ". The real corpus showed what that admits. Three of
// the nineteen claims it corroborated came from the same two source ids - two editions of one
// Xamarin book by one author, whose introductions are the same prose. Two more came from two
// pages of one publisher's site. One document agreeing with its own second printing is not
// two sources agreeing, and treating it as corroboration is how a single mistaken document
// becomes two votes.
//
// Three things break independence, in order of how conclusive they are:
//   - identical content: the same bytes reached by two ids is one document, not two;
//   - the same site: two pages of one publisher share an editorial process and are not
//     independent observers of anything;
//   - the same declared author: one person writing twice is one source.
//
// Everything here is deterministic and derived from what the queue already recorded. It is
// deliberately conservative: it would rather refuse a real independent pair than accept a
// document agreeing with itself, because the second error is the one that promotes.
const MULTIPART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'co.in', 'com.br', 'com.cn', 'co.za', 'com.mx']);
const UNDECLARED = new Set(['', 'not declared', 'unknown', 'n/a', 'none', 'anonymous']);

// The registrable domain, so two pages of one publisher collapse to one site while two
// genuinely different organisations stay apart.
function site(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return null; }
  host = host.replace(/^www\./, '');
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return MULTIPART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

function declaredAuthor(value) {
  const author = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return UNDECLARED.has(author) ? null : author;
}

// sourceId -> the facts independence is judged on, taken from the restored queue.
function sourceIndex(bundle) {
  const index = new Map();
  for (const source of (bundle && bundle.sources) || []) {
    index.set(String(source.id), {
      contentSha256: String(source.contentSha256 || '').toLowerCase() || null,
      site: site(source.finalUrl || source.url),
      author: declaredAuthor(source.author),
    });
  }
  return index;
}

// Facts for one source, preferring the queue and falling back to what the candidate's own
// provenance recorded, so a candidate whose source is no longer in the queue is still judged.
function factsFor(sourceId, index, provenance) {
  const known = index && index.get(String(sourceId));
  if (known) return known;
  return {
    contentSha256: String((provenance && provenance.contentSha256) || '').toLowerCase() || null,
    site: site(provenance && (provenance.finalUrl || provenance.url || provenance.sourceId)),
    author: declaredAuthor(provenance && provenance.author),
  };
}

function independent(a, b) {
  if (!a || !b) return { independent: true, reason: 'nothing recorded links these sources' };
  if (a.contentSha256 && b.contentSha256 && a.contentSha256 === b.contentSha256) {
    return { independent: false, reason: 'both source ids resolve to identical content, so this is one document reached twice' };
  }
  if (a.site && b.site && a.site === b.site) {
    return { independent: false, reason: `both sources are pages of ${a.site}, which is one publisher rather than two independent observers` };
  }
  if (a.author && b.author && a.author === b.author) {
    return { independent: false, reason: `both sources declare the same author (${a.author}), so this is one writer rather than two` };
  }
  return { independent: true, reason: 'the sources differ in content, site, and declared author' };
}

// The largest set of sources from `entries` that are all mutually independent, chosen in a
// stable order so the same input always yields the same set. Greedy by design: a source that
// is not independent of one already chosen is left out rather than displacing it.
function independentSubset(entries, index) {
  const ordered = [...entries].sort((left, right) => (String(left.sourceId) < String(right.sourceId) ? -1 : 1));
  const chosen = [];
  const rejected = [];
  for (const entry of ordered) {
    const facts = factsFor(entry.sourceId, index, entry.provenance);
    const clash = chosen.find((item) => !independent(item.facts, facts).independent);
    if (clash) {
      rejected.push({ sourceId: String(entry.sourceId), against: String(clash.entry.sourceId), reason: independent(clash.facts, facts).reason });
      continue;
    }
    chosen.push({ entry, facts });
  }
  return { members: chosen.map((item) => item.entry), rejected };
}

module.exports = { site, declaredAuthor, sourceIndex, factsFor, independent, independentSubset };
