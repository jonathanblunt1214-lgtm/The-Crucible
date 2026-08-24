const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectText, normalizeText } = require('../src/commit');

test('normalizeText removes trailing whitespace and adds a final newline', () => {
  assert.equal(normalizeText('const x = 1;   \nnext\t'), 'const x = 1;\nnext\n');
});

test('inspectText marks deterministic formatting issues as fixable', () => {
  const findings = inspectText('src/example.js', 'const x = 1;  ');
  assert.deepEqual(findings.map((item) => item.type), ['trailing-whitespace', 'missing-final-newline']);
  assert.ok(findings.every((item) => item.fixable));
});

test('inspectText requires review for merge conflict markers', () => {
  const findings = inspectText('src/example.js', '<<<<<<< HEAD\nvalue\n=======\nother\n>>>>>>> branch\n');
  assert.equal(findings.filter((item) => item.type === 'merge-conflict-marker').length, 3);
  assert.ok(findings.filter((item) => item.type === 'merge-conflict-marker').every((item) => !item.fixable));
});
