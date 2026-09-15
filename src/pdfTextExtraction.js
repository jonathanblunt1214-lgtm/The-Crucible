'use strict';

// In-process, page-accurate PDF text extraction using only the Node standard library.
//
// Why this exists: claim extraction reached PDF text through `pdftotext` first and a
// configured `CRUCIBLE_PYTHON` + pypdf script second, and threw when it had neither.
// That made extraction throughput a property of the operator's workstation - on any
// host without those binaries every PDF source failed, which is exactly what a hosted
// run hits. This adds a final in-process tier so extraction degrades in capability
// rather than stopping, without changing what the existing two tiers do.
//
// Scope is deliberately narrow, and narrow-but-honest is the point. It decodes
// FlateDecode / ASCII85Decode / ASCIIHexDecode streams as an ordered filter chain and
// the text-showing operators (Tj, TJ, ', "), mapping character codes through each
// font's /ToUnicode CMap when one is present and Latin-1 when it is not. That covers
// the PDFs ordinary tools emit for text documents.
//
// Everything outside that envelope FAILS CLOSED with a precise reason rather than
// returning partial or invented text: encrypted files, image-only scans, unsupported
// filters, and composite fonts with no /ToUnicode map cannot be read here. A caller
// that registered whatever this returned regardless would be manufacturing evidence,
// so the failure is a value the caller must handle, never an empty string.

const zlib = require('node:zlib');
const { crucibleError } = require('./failureCodes');

const FAILURE_REASONS = Object.freeze([
  'not_a_pdf',
  'encrypted',
  'no_pages',
  'unsupported_filter',
  'undecodable_stream',
  'no_extractable_text',
  'unmapped_composite_font',
]);

const SUPPORTED_FILTERS = Object.freeze(['ASCII85Decode', 'A85', 'ASCIIHexDecode', 'AHx', 'FlateDecode', 'Fl']);

function scanObjects(bytes) {
  const latin = bytes.toString('latin1');
  const objects = new Map();
  const header = /(\d+)\s+\d+\s+obj\b/g;
  let match;
  while ((match = header.exec(latin)) !== null) {
    const id = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const endIndex = latin.indexOf('endobj', bodyStart);
    const body = latin.slice(bodyStart, endIndex === -1 ? undefined : endIndex);
    const streamMarker = /stream\r?\n/.exec(body);
    if (!streamMarker) { objects.set(id, { id, dict: body }); continue; }
    const dict = body.slice(0, streamMarker.index);
    const dataStart = bodyStart + streamMarker.index + streamMarker[0].length;
    const declared = /\/Length\s+(\d+)/.exec(dict);
    let dataEnd;
    if (declared) dataEnd = dataStart + Number(declared[1]);
    else {
      const tail = latin.indexOf('endstream', dataStart);
      dataEnd = tail === -1 ? bytes.length : tail;
    }
    objects.set(id, { id, dict, stream: bytes.subarray(dataStart, Math.min(dataEnd, bytes.length)) });
  }
  return objects;
}

/** ASCII85 (base-85) decoder, per the PDF variant terminated by `~>`. */
function ascii85Decode(input) {
  const text = input.toString('latin1').replace(/\s+/g, '');
  const body = text.startsWith('<~') ? text.slice(2) : text;
  const end = body.indexOf('~>');
  const payload = end === -1 ? body : body.slice(0, end);
  const out = [];
  let group = [];
  for (const character of payload) {
    if (character === 'z' && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    const value = character.charCodeAt(0) - 33;
    if (value < 0 || value > 84) return null;
    group.push(value);
    if (group.length === 5) {
      let sum = 0;
      for (const digit of group) sum = sum * 85 + digit;
      out.push((sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff);
      group = [];
    }
  }
  if (group.length === 1) return null;
  if (group.length) {
    const short = group.length;
    while (group.length < 5) group.push(84);
    let sum = 0;
    for (const digit of group) sum = sum * 85 + digit;
    const full = [(sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff];
    for (const byte of full.slice(0, short - 1)) out.push(byte);
  }
  return Buffer.from(out);
}

function asciiHexDecode(input) {
  const hex = input.toString('latin1').split('>')[0].replace(/[^0-9a-fA-F]/g, '');
  return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
}

function flateDecode(input) {
  let trimmed = input;
  while (trimmed.length && (trimmed[trimmed.length - 1] === 0x0a || trimmed[trimmed.length - 1] === 0x0d)) {
    trimmed = trimmed.subarray(0, trimmed.length - 1);
  }
  for (const attempt of [zlib.inflateSync, zlib.unzipSync, zlib.inflateRawSync]) {
    try { return attempt(trimmed); } catch { /* try the next stream shape */ }
  }
  return null;
}

// Filters apply as an ordered chain, so `[/ASCII85Decode /FlateDecode]` means un-ASCII85
// first and inflate second. A /Length that came from an indirect reference, or a
// generator that miscounted, leaves the slice short or long, so the bytes are also
// retried as sliced to the real `endstream`.
function decodeStream(object, bytes) {
  if (!object.stream) return { ok: false };
  const declared = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(object.dict);
  const chain = declared ? [...declared[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((entry) => entry[1]) : [];
  if (!chain.length) return { ok: true, data: object.stream };

  const unsupported = chain.find((name) => !SUPPORTED_FILTERS.includes(name));
  if (unsupported) return { ok: false, unsupportedFilter: unsupported };

  const candidates = [object.stream];
  const latin = bytes.toString('latin1');
  const start = bytes.indexOf(object.stream.subarray(0, Math.min(16, object.stream.length)));
  if (start >= 0) {
    const tail = latin.indexOf('endstream', start);
    if (tail > start) candidates.push(bytes.subarray(start, tail));
  }
  for (const candidate of candidates) {
    let current = candidate;
    for (const name of chain) {
      if (current === null) break;
      if (name === 'ASCII85Decode' || name === 'A85') current = ascii85Decode(current);
      else if (name === 'ASCIIHexDecode' || name === 'AHx') current = asciiHexDecode(current);
      else current = flateDecode(current);
    }
    if (current !== null) return { ok: true, data: current };
  }
  return { ok: false };
}

const referenceId = (value) => {
  const found = /(\d+)\s+\d+\s+R/.exec(String(value || ''));
  return found ? Number(found[1]) : null;
};

function collectPages(objects) {
  const catalog = [...objects.values()].find((object) => /\/Type\s*\/Catalog/.test(object.dict));
  const order = [];
  const seen = new Set();
  const walk = (id) => {
    if (id === null || seen.has(id)) return;
    seen.add(id);
    const node = objects.get(id);
    if (!node) return;
    if (/\/Type\s*\/Page[^s]/.test(`${node.dict} `)) { order.push(id); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node.dict);
    if (kids) for (const kid of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(kid[1]));
  };
  if (catalog) {
    const pages = /\/Pages\s*(\d+\s+\d+\s+R)/.exec(catalog.dict);
    walk(referenceId(pages ? pages[1] : ''));
  }
  if (!order.length) {
    for (const object of objects.values()) if (/\/Type\s*\/Page[^s]/.test(`${object.dict} `)) order.push(object.id);
  }
  return order;
}

/** Parses a /ToUnicode CMap into code -> string, covering bfchar and bfrange. */
function parseToUnicode(cmap) {
  const map = new Map();
  const utf16 = (hex) => {
    const units = [];
    for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
    return String.fromCharCode(...units.filter((value) => Number.isFinite(value)));
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(pair[1], 16), utf16(pair[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const row of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const low = parseInt(row[1], 16);
      const high = parseInt(row[2], 16);
      const base = parseInt(row[3], 16);
      if (high - low > 0xffff) continue;
      for (let code = low; code <= high; code++) map.set(code, String.fromCharCode(base + (code - low)));
    }
  }
  return map;
}

function fontsForPage(page, objects, bytes) {
  const fonts = new Map();
  let resources = /\/Resources\s*<<([\s\S]*?)>>\s*(?:\/|>>)/.exec(page.dict);
  let resourceDict = resources ? resources[1] : undefined;
  if (!resourceDict) {
    const indirect = referenceId((/\/Resources\s*(\d+\s+\d+\s+R)/.exec(page.dict) || [])[1]);
    if (indirect !== null) resourceDict = objects.get(indirect) && objects.get(indirect).dict;
  }
  if (!resourceDict) return fonts;
  let fontSection = (/\/Font\s*<<([\s\S]*?)>>/.exec(resourceDict) || [])[1];
  if (!fontSection) {
    const indirect = referenceId((/\/Font\s*(\d+\s+\d+\s+R)/.exec(resourceDict) || [])[1]);
    if (indirect !== null) {
      const holder = objects.get(indirect);
      fontSection = holder ? (/<<([\s\S]*)>>/.exec(holder.dict) || [])[1] : undefined;
    }
  }
  if (!fontSection) return fonts;
  for (const entry of fontSection.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
    const fontObject = objects.get(Number(entry[2]));
    if (!fontObject) continue;
    const twoByte = /\/Subtype\s*\/Type0/.test(fontObject.dict);
    const toUnicodeId = referenceId((/\/ToUnicode\s*(\d+\s+\d+\s+R)/.exec(fontObject.dict) || [])[1]);
    let toUnicode;
    if (toUnicodeId !== null) {
      const cmapObject = objects.get(toUnicodeId);
      const decoded = cmapObject ? decodeStream(cmapObject, bytes) : { ok: false };
      if (decoded.ok) toUnicode = parseToUnicode(decoded.data.toString('latin1'));
    }
    fonts.set(entry[1], { toUnicode, twoByte });
  }
  return fonts;
}

/** Splits a PDF string operand into character codes for the active font. */
function codesOf(raw, isHex, font) {
  const codes = [];
  if (isHex) {
    const hex = raw.replace(/[^0-9a-fA-F]/g, '');
    const width = font && font.twoByte ? 4 : 2;
    for (let i = 0; i < hex.length; i += width) codes.push(parseInt(hex.slice(i, i + width).padEnd(width, '0'), 16));
    return codes;
  }
  const octets = [];
  for (let i = 0; i < raw.length; i++) {
    const character = raw[i];
    if (character !== '\\') { octets.push(raw.charCodeAt(i)); continue; }
    const next = raw[++i];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let octal = next;
      while (octal.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') octal += raw[++i];
      octets.push(parseInt(octal, 8));
      continue;
    }
    if (next === '\n') continue;
    const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
    octets.push(Object.prototype.hasOwnProperty.call(escapes, next) ? escapes[next] : raw.charCodeAt(i));
  }
  if (font && font.twoByte) {
    for (let i = 0; i < octets.length; i += 2) codes.push(((octets[i] || 0) << 8) | (octets[i + 1] || 0));
    return codes;
  }
  return octets;
}

function textOfContent(content, fonts) {
  let active;
  let unmappedComposite = false;
  const out = [];
  const pending = [];
  const flush = () => {
    for (const item of pending) {
      if (active && active.twoByte && !active.toUnicode) { unmappedComposite = true; continue; }
      const codes = codesOf(item.raw, item.hex, active);
      out.push(codes.map((code) => {
        const viaCmap = active && active.toUnicode ? active.toUnicode.get(code) : undefined;
        if (viaCmap !== undefined) return viaCmap;
        if (active && active.twoByte) return '';
        return String.fromCharCode(code);
      }).join(''));
    }
    pending.length = 0;
  };
  const token = /\/([A-Za-z0-9_.+-]+)\s+[\d.]+\s+Tf|\(((?:[^()\\]|\\[\s\S]|\((?:[^()\\]|\\[\s\S])*\))*)\)|<([0-9a-fA-F\s]*)>|(T\*|Td|TD|TJ|Tj|'|"|ET|BT)/g;
  let match;
  while ((match = token.exec(content)) !== null) {
    if (match[1] !== undefined) { flush(); active = fonts.get(match[1]) || active; continue; }
    if (match[2] !== undefined) { pending.push({ raw: match[2], hex: false }); continue; }
    if (match[3] !== undefined) { pending.push({ raw: match[3], hex: true }); continue; }
    const operator = match[4];
    if (operator === 'TJ' || operator === 'Tj' || operator === "'" || operator === '"') { flush(); out.push(' '); continue; }
    if (operator === 'T*' || operator === 'Td' || operator === 'TD' || operator === 'ET') { flush(); out.push('\n'); continue; }
  }
  flush();
  const text = out.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, unmappedComposite };
}

/**
 * Extracts text per page.
 * Returns `{ ok:true, pages:[{page,text}], characters }` or
 * `{ ok:false, reason, detail }` with `reason` drawn from FAILURE_REASONS.
 */
function extractPdfText(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, reason: 'not_a_pdf', detail: 'File does not begin with the %PDF- header.' };
  }
  const objects = scanObjects(buffer);
  if ([...objects.values()].some((object) => /\/Encrypt/.test(object.dict))) {
    return { ok: false, reason: 'encrypted', detail: 'Encrypted PDFs are not read here; supply a decrypted copy.' };
  }
  const pageIds = collectPages(objects);
  if (!pageIds.length) return { ok: false, reason: 'no_pages', detail: 'No page objects were found.' };

  const pages = [];
  const unsupportedFilters = new Set();
  let unmappedComposite = false;
  let undecodable = 0;
  pageIds.forEach((pageId, index) => {
    const page = objects.get(pageId);
    if (!page) return;
    const fonts = fontsForPage(page, objects, buffer);
    const contents = (/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(page.dict) || [])[1] || '';
    const parts = [];
    for (const reference of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
      const target = objects.get(Number(reference[1]));
      if (!target) continue;
      const decoded = decodeStream(target, buffer);
      if (!decoded.ok) {
        if (decoded.unsupportedFilter) unsupportedFilters.add(decoded.unsupportedFilter);
        else undecodable += 1;
        continue;
      }
      const outcome = textOfContent(decoded.data.toString('latin1'), fonts);
      if (outcome.unmappedComposite) unmappedComposite = true;
      if (outcome.text) parts.push(outcome.text);
    }
    pages.push({ page: index + 1, text: parts.join('\n').trim() });
  });

  const characters = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (!characters) {
    if (unmappedComposite) {
      return {
        ok: false,
        reason: 'unmapped_composite_font',
        detail: 'Text uses composite fonts with no /ToUnicode map, so character codes cannot be resolved.',
      };
    }
    if (unsupportedFilters.size) {
      return {
        ok: false,
        reason: 'unsupported_filter',
        detail: `Content streams use unsupported filter(s): ${[...unsupportedFilters].sort().join(', ')}.`,
      };
    }
    if (undecodable) {
      return {
        ok: false,
        reason: 'undecodable_stream',
        detail: `${undecodable} content stream(s) used a corrupt or unreadable encoding.`,
      };
    }
    return {
      ok: false,
      reason: 'no_extractable_text',
      detail: 'No text operators produced characters; the document is likely an image-only scan needing OCR.',
    };
  }
  return { ok: true, pages, characters };
}

/**
 * Extracts an inclusive 1-based page range as plain text, matching what the external
 * `pdftotext -f -l` tier returns. Throws on failure so the caller's existing
 * error path is unchanged.
 */
function extractPdfTextRange(bytes, pageStart, pageEnd) {
  const first = Number(pageStart);
  const last = Number(pageEnd);
  if (!Number.isSafeInteger(first) || first < 1) throw crucibleError('CRU-0041', 'pageStart must be a positive integer.');
  if (!Number.isSafeInteger(last) || last < first) throw crucibleError('CRU-0041', 'pageEnd must be greater than or equal to pageStart.');
  const result = extractPdfText(bytes);
  if (!result.ok) throw crucibleError('CRU-0041', `In-process PDF extraction failed (${result.reason}): ${result.detail}`);
  const selected = result.pages.filter((page) => page.page >= first && page.page <= last);
  if (!selected.length) {
    throw crucibleError('CRU-0041', `In-process PDF extraction found no pages in range ${first}-${last} of ${result.pages.length}.`);
  }
  return `${selected.map((page) => page.text).join('\n\n')}\n`;
}

module.exports = { extractPdfText, extractPdfTextRange, FAILURE_REASONS };
