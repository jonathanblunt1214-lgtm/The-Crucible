const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { extractPdfText, extractPdfTextRange } = require('../src/pdfTextExtraction');
const { defaultExtractText } = require('../src/claimExtractionWorker');

// Fixtures are generated rather than committed: a binary cannot be reviewed in a diff,
// and the facts asserted below then live next to the assertions that depend on them.
const PAGES = [
  ['Vantage Telemetry Handbook', 'Batch admission requires a quorum of three Kestrel witnesses.'],
  ['Chapter 2: Retention', 'Vantage retains raw telemetry frames for exactly 47 days before compaction.'],
  ['Chapter 3: Thresholds', 'The drift alarm triggers when frame skew exceeds 812 milliseconds.'],
];

function flatePdf(pages = PAGES) {
  const objects = []; const add = (body) => { objects.push(body); return objects.length; };
  const escape = (value) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const fontId = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'));
  const pagesId = objects.length + 1; objects.push(null);
  const pageIds = [];
  for (const lines of pages) {
    // Alternate Tj and TJ so both text-showing operators are exercised.
    const ops = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td'];
    lines.forEach((line, index) => { ops.push(index % 2 === 0 ? `(${escape(line)}) Tj` : `[(${escape(line)})] TJ`); ops.push('T*'); });
    ops.push('ET');
    const packed = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
    const streamId = add(Buffer.concat([Buffer.from(`<< /Length ${packed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), packed, Buffer.from('\nendstream', 'latin1')]));
    pageIds.push(add(Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`, 'latin1')));
  }
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`, 'latin1');
  const catalogId = add(Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1'));
  const chunks = [Buffer.from('%PDF-1.7\n', 'latin1')]; let offset = chunks[0].length; const offsets = [];
  objects.forEach((body, index) => { offsets.push(offset); const piece = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body || Buffer.alloc(0), Buffer.from('\nendobj\n', 'latin1')]); chunks.push(piece); offset += piece.length; });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets) xref += `${String(value).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

function tempFile(t, bytes, name = 'source.pdf') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-pdf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test('extracts every page of a Flate-compressed PDF and attributes text to the right page', () => {
  const result = extractPdfText(flatePdf());
  assert.equal(result.ok, true);
  assert.equal(result.pages.length, 3);
  assert.match(result.pages[0].text, /quorum of three Kestrel witnesses/);
  assert.match(result.pages[1].text, /47 days/);
  assert.match(result.pages[2].text, /812 milliseconds/);
  // Page attribution must be exact, not merely present somewhere in the document.
  assert.doesNotMatch(result.pages[0].text, /47 days/);
  assert.doesNotMatch(result.pages[2].text, /Kestrel/);
});

test('decodes an ASCII85 then FlateDecode filter chain in order', () => {
  const flated = zlib.deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Chained filter payload) Tj ET', 'latin1'));
  let encoded = '';
  for (let i = 0; i < flated.length; i += 4) {
    const group = [...flated.subarray(i, i + 4)]; const short = 4 - group.length;
    while (group.length < 4) group.push(0);
    let value = 0; for (const byte of group) value = value * 256 + byte;
    const digits = []; for (let d = 0; d < 5; d++) { digits.unshift(String.fromCharCode(33 + (value % 85))); value = Math.floor(value / 85); }
    encoded += digits.join('').slice(0, 5 - short);
  }
  const stream = Buffer.from(`${encoded}~>`, 'latin1');
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n', 'latin1'),
    Buffer.from(`4 0 obj\n<< /Length ${stream.length} /Filter [ /ASCII85Decode /FlateDecode ] >>\nstream\n`, 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
  const result = extractPdfText(pdf);
  assert.equal(result.ok, true);
  assert.match(result.pages[0].text, /Chained filter payload/);
});

test('fails closed rather than returning empty text for unreadable documents', () => {
  const notPdf = extractPdfText(Buffer.from('this is not a pdf', 'utf8'));
  assert.equal(notPdf.ok, false);
  assert.equal(notPdf.reason, 'not_a_pdf');

  const encrypted = extractPdfText(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Encrypt 9 0 R /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  assert.equal(encrypted.ok, false);
  assert.equal(encrypted.reason, 'encrypted');

  // An image-only page draws an XObject and shows no text: OCR territory, not a parse result.
  const imageOnly = extractPdfText(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 30 >>\nstream\nq 100 0 0 100 0 0 cm /Im0 Do Q\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  assert.equal(imageOnly.ok, false);
  assert.equal(imageOnly.reason, 'no_extractable_text');
});

test('range extraction returns only the requested pages and rejects an invalid range', () => {
  const bytes = flatePdf();
  assert.match(extractPdfTextRange(bytes, 2, 2), /47 days/);
  assert.doesNotMatch(extractPdfTextRange(bytes, 2, 2), /Kestrel/);
  assert.match(extractPdfTextRange(bytes, 1, 3), /Kestrel/);
  assert.match(extractPdfTextRange(bytes, 1, 3), /812 milliseconds/);
  assert.throws(() => extractPdfTextRange(bytes, 0, 1), /pageStart must be a positive integer/);
  assert.throws(() => extractPdfTextRange(bytes, 3, 2), /pageEnd must be greater than or equal/);
  assert.throws(() => extractPdfTextRange(bytes, 9, 9), /no pages in range/);
});

test('claim extraction falls through to the in-process tier when pdftotext and pypdf are unavailable', (t) => {
  const file = tempFile(t, flatePdf());
  const source = { id: 'doc:1', durablePath: file, mediaType: 'application/pdf' };
  // Neither external tier can run: an absent binary and no configured interpreter.
  const text = defaultExtractText(source, 2, 2, { CRUCIBLE_PDFTOTEXT: '/nonexistent/pdftotext' });
  assert.match(text, /47 days/);
  assert.doesNotMatch(text, /Kestrel/);
});

test('claim extraction reports every tier that failed instead of only the last', (t) => {
  const file = tempFile(t, Buffer.from('not a pdf at all', 'utf8'));
  const source = { id: 'doc:2', durablePath: file, mediaType: 'application/pdf' };
  assert.throws(
    () => defaultExtractText(source, 1, 1, { CRUCIBLE_PDFTOTEXT: '/nonexistent/pdftotext' }),
    (error) => {
      // Losing the pdftotext or pypdf diagnosis would make a toolchain fault look like
      // a parser limitation, so all three must be named.
      assert.match(error.message, /pdftotext:/);
      assert.match(error.message, /pypdf: CRUCIBLE_PYTHON is not configured/);
      assert.match(error.message, /in-process: .*not_a_pdf/);
      assert.match(error.message, /doc:2/);
      return true;
    },
  );
});

test('a working external tier still wins, so existing hosts are unaffected', (t) => {
  const file = tempFile(t, flatePdf());
  const source = { id: 'doc:3', durablePath: file, mediaType: 'application/pdf' };
  // Stand in for pdftotext with a command that succeeds and prints a marker.
  const text = defaultExtractText(source, 1, 1, { CRUCIBLE_PDFTOTEXT: 'echo' });
  assert.match(text, /source\.pdf/);
  assert.doesNotMatch(text, /Kestrel/);
});

test('non-PDF sources are still read directly as text', (t) => {
  const file = tempFile(t, Buffer.from('plain source text', 'utf8'), 'source.txt');
  const source = { id: 'doc:4', durablePath: file, mediaType: 'text/html' };
  assert.equal(defaultExtractText(source, 1, 1, {}), 'plain source text');
});
