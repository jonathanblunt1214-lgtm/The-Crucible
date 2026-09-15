// Where a raw-text element ends is a tokenizer question, and no regex family answers it.
//
// script, style, textarea and title switch the HTML tokenizer into a state where markup stops
// being markup: the only thing that ends the element is its own end tag, and "its own end tag"
// means `</name` followed by whitespace, `/` or `>` - nothing else, and not end of input. That one
// rule defeated the pattern this repository reached for twice. `</scriptZ>` names a different
// element. A NUL inside the name becomes U+FFFD, so a NUL spliced into `</script>` names a
// different element too. An unterminated attribute value inside the end tag is end-of-file-in-tag,
// so the parser discards the tag and everything after it. And a script with no end tag at all runs
// to the end of the document. In each of those a pattern that "finds the closing tag" finds the
// wrong thing or nothing at all, and the strip-every-tag pass that followed then deleted the
// delimiters and promoted the element body to prose - script bytes entering the corpus as though
// the document had asserted them. Chromium's own parser settled the expected result for every case
// in the tests rather than a reading of the specification; this walks the input once and agrees.
//
// The opposite error matters as much. `<scr<form>` is a single start tag named `scr<form`, because
// `<` is an ordinary tag-name character, so the `ipt>` after it is text a reader sees. The regex
// chain deleted the fragments and re-matched them into a `<script>` the document never contained.
// Text a parser renders is text, and the extractor has to return it.
//
// This is deliberately not a general-purpose HTML sanitizer and must not be relied on as one. It
// answers one bounded question - which byte ranges of this document are text a reader sees, and
// which belong to an element whose body must never be read as prose - which is what bounded text
// extraction from retrieved evidence needs. Anything that renders untrusted HTML into a live
// document needs a real parser and a rendering policy, not this.

// Elements whose content the tokenizer stops treating as markup. Parsing them correctly is
// separate from whether their text is kept: title and textarea hold text a reader sees.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

// Element bodies that are never the document's prose. script and style because their content is
// code, form because its content is interface furniture and its `formaction` is an injection
// vector - the boundary this repository already drew, kept as it was.
const NEVER_PROSE = Object.freeze(['script', 'style', 'form']);

// What must not survive into content handed to a parser downstream. Wider than NEVER_PROSE because
// template and noscript hide markup from a text pass while remaining live to a renderer.
const DANGEROUS_ELEMENTS = Object.freeze(['script', 'style', 'template', 'noscript', 'form']);

const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xFFFD);

// Attributes that make an element act rather than describe. Scrubbing them is still pattern work,
// but it now runs only over the source of a single tag the tokenizer has already delimited, which
// fixes two faults at once. `<svg/onload=alert(1)>` survived a document-wide pass and executed,
// because that pass required whitespace before the name and `/` separates attributes just as well;
// and prose containing `and/one=1` was silently edited by a rule that had no business reading text
// nodes at all. Inside a tag there is no prose to damage and no unbounded input to scan.
const ACTIVE_ATTRIBUTE = /[\s/]on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SMUGGLING_ATTRIBUTE = /[\s/](?:srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

function scrubTagSource(tagSource) {
  return tagSource.replace(ACTIVE_ATTRIBUTE, ' ').replace(SMUGGLING_ATTRIBUTE, ' ');
}

function isSpace(character) {
  return character === '\t' || character === '\n' || character === '\f' || character === '\r' || character === ' ';
}

function isAsciiAlpha(character) {
  return character !== undefined && ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z'));
}

// The tokenizer lowercases a tag name and replaces U+0000 within it by U+FFFD. Both are why
// `</SCRIPT>` closes a script and a NUL spliced into the name does not.
function readName(source, index) {
  let end = index;
  while (end < source.length && !isSpace(source[end]) && source[end] !== '/' && source[end] !== '>') end += 1;
  return { name: source.slice(index, end).toLowerCase().split(NUL).join(REPLACEMENT), end };
}

// From just after a tag name to just past the `>` that ends the tag. Quoted attribute values hold
// `>` as an ordinary character, which is the whole of the `</script x="><b>` bypass; an unclosed
// quote is end-of-file-in-tag, and returning the end of input for it is what stops the remainder
// of the document being promoted to prose.
function scanToTagEnd(source, index) {
  let i = index;
  let state = 'before-attribute';
  while (i < source.length) {
    const character = source[i];
    if (character === '>') return i + 1;
    if (state === 'before-attribute') {
      state = isSpace(character) || character === '/' ? 'before-attribute' : 'attribute-name';
      i += 1;
      continue;
    }
    if (state === 'attribute-name') {
      if (character === '=') state = 'before-value';
      else if (isSpace(character) || character === '/') state = 'before-attribute';
      i += 1;
      continue;
    }
    if (state === 'before-value') {
      if (isSpace(character)) { i += 1; continue; }
      if (character === '"' || character === "'") {
        const close = source.indexOf(character, i + 1);
        if (close < 0) return source.length;
        i = close + 1;
        state = 'before-attribute';
        continue;
      }
      state = 'value-unquoted';
      i += 1;
      continue;
    }
    if (isSpace(character)) state = 'before-attribute';
    i += 1;
  }
  return source.length;
}

function untilTerminator(source, terminator, from) {
  const at = source.indexOf(terminator, from);
  return { kind: 'ignore', name: '', end: at < 0 ? source.length : at + terminator.length };
}

// What the `<` at this index actually opens, or null when it opens nothing and is literal text.
function readTag(source, index) {
  const next = source[index + 1];
  if (next === undefined) return null;
  if (next === '!') {
    if (source.startsWith('!--', index + 1)) return untilTerminator(source, '-->', index + 4);
    if (source.slice(index + 2, index + 9).toUpperCase() === '[CDATA[') return untilTerminator(source, ']]>', index + 9);
    return untilTerminator(source, '>', index + 2);
  }
  if (next === '?') return untilTerminator(source, '>', index + 2);
  if (next === '/') {
    const after = source[index + 2];
    if (after === undefined) return null;
    if (after === '>') return { kind: 'ignore', name: '', end: index + 3 };
    if (!isAsciiAlpha(after)) return untilTerminator(source, '>', index + 2);
    const read = readName(source, index + 2);
    return { kind: 'end', name: read.name, end: scanToTagEnd(source, read.end) };
  }
  if (!isAsciiAlpha(next)) return null;
  const read = readName(source, index + 1);
  return { kind: 'start', name: read.name, end: scanToTagEnd(source, read.end) };
}

function namedAt(source, index, name) {
  return source.slice(index, index + name.length).toLowerCase() === name;
}

// The end of a raw-text element's content. `script` additionally has the escaped and
// double-escaped states: inside `<!-- ... -->` a nested `<script` makes the following `</script>`
// return to escaped rather than close the element, so treating the first one as the end would
// again promote script bytes to prose.
function findRawTextEnd(source, from, name) {
  const scriptLike = name === 'script';
  let escaped = false;
  let doubleEscaped = false;
  let i = from;
  while (i < source.length) {
    if (scriptLike && source.startsWith('<!--', i)) { escaped = true; i += 4; continue; }
    if (scriptLike && escaped && source.startsWith('-->', i)) { escaped = false; doubleEscaped = false; i += 3; continue; }
    if (source[i] === '<') {
      const isEnd = source[i + 1] === '/';
      const nameAt = i + (isEnd ? 2 : 1);
      if (namedAt(source, nameAt, name)) {
        const boundary = source[nameAt + name.length];
        const closes = boundary !== undefined && (isSpace(boundary) || boundary === '/' || boundary === '>');
        if (closes && isEnd && !doubleEscaped) return { contentEnd: i, tagEnd: scanToTagEnd(source, nameAt + name.length) };
        if (closes && isEnd) { doubleEscaped = false; i = nameAt + name.length; continue; }
        if (closes && scriptLike && escaped) { doubleEscaped = true; i = nameAt + name.length; continue; }
      }
    }
    i += 1;
  }
  return { contentEnd: source.length, tagEnd: source.length };
}

// The end of an ordinary element that is being removed whole. Raw-text elements inside it are
// skipped as raw text, so a `</form>` written inside a script string cannot end the form early.
function findElementEnd(source, from, name) {
  let i = from;
  while (i < source.length) {
    if (source[i] !== '<') { i += 1; continue; }
    const tag = readTag(source, i);
    if (!tag) { i += 1; continue; }
    if (tag.kind === 'end' && tag.name === name) return { contentEnd: i, tagEnd: tag.end };
    if (tag.kind === 'start' && RAW_TEXT.has(tag.name)) { i = findRawTextEnd(source, tag.end, tag.name).tagEnd; continue; }
    i = tag.end;
  }
  return { contentEnd: source.length, tagEnd: source.length };
}

// One left-to-right pass producing both answers: the text a reader sees, and the same source with
// the removed elements cut out of it. Two callers with two different needs, one walk, so they can
// never disagree about where an element ended.
function scanHtml(html, { drop = NEVER_PROSE, scrub = null } = {}) {
  const source = String(html == null ? '' : html);
  const removed = new Set(drop.map((item) => String(item).toLowerCase()));
  const text = [];
  const kept = [];
  let keepFrom = 0;
  let textFrom = 0;
  let i = 0;
  while (i < source.length) {
    if (source[i] !== '<') { i += 1; continue; }
    const tag = readTag(source, i);
    if (!tag) { i += 1; continue; }
    if (i > textFrom) text.push(source.slice(textFrom, i));
    const dropping = tag.kind === 'start' && removed.has(tag.name);
    // A stray end tag for a removed element has no body to cut, but leaving it in the output
    // meant a second regex pass to sweep it up - and that pass, scanning `[^>]*` from every `<`
    // in a document that contains no `>` at all, was the whole of the quadratic blowup. The
    // tokenizer already knows exactly where the tag ends, so it removes it here in the same walk.
    const droppingStray = tag.kind === 'end' && removed.has(tag.name);
    let after = tag.end;
    if (tag.kind === 'start' && RAW_TEXT.has(tag.name)) {
      const raw = findRawTextEnd(source, tag.end, tag.name);
      after = raw.tagEnd;
      if (!dropping && raw.contentEnd > tag.end) text.push(source.slice(tag.end, raw.contentEnd));
    } else if (dropping) {
      after = findElementEnd(source, tag.end, tag.name).tagEnd;
    }
    if (dropping || droppingStray) {
      kept.push(source.slice(keepFrom, i));
      keepFrom = after;
    } else if (scrub && tag.kind !== 'ignore') {
      kept.push(source.slice(keepFrom, i), scrub(source.slice(i, tag.end)));
      keepFrom = tag.end;
    }
    textFrom = after;
    i = after;
  }
  if (source.length > textFrom) text.push(source.slice(textFrom));
  kept.push(source.slice(keepFrom));
  // Joined on a space because a tag is a word boundary: `<p>A</p><p>B</p>` is two sentences, not
  // one run-on. This is the separator the previous strip-every-tag pass produced, kept as it was.
  return { text: text.join(' '), kept: kept.join('') };
}

// The text of a document, with the bodies of elements that are never prose left out of it.
function extractDocumentText(html, options) { return scanHtml(html, options).text; }

// The same document with whole dangerous elements cut out and the attributes that make an element
// act scrubbed from every tag that remains. One pass reaches a fixed point by construction: the
// tokenizer never manufactures an element out of the fragments it removed, which is what the old
// chain did and what its do/while loop then existed to clean up after.
function stripElements(html, drop = DANGEROUS_ELEMENTS) { return scanHtml(html, { drop, scrub: scrubTagSource }).kept; }

module.exports = { RAW_TEXT, NEVER_PROSE, DANGEROUS_ELEMENTS, scrubTagSource, readTag, findRawTextEnd, findElementEnd, scanHtml, extractDocumentText, stripElements };
