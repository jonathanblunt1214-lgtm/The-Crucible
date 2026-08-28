const fs = require('node:fs');
const path = require('node:path');

const STOP_WORDS = new Set([
  'test', 'tests', 'testing', 'node', 'assert', 'strict', 'const', 'let', 'var', 'function', 'require', 'import', 'from', 'true', 'false', 'null', 'return', 'async', 'await', 'describe', 'it', 'should', 'src', 'js',
]);

function tokensFor(text) {
  const expanded = String(text || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return new Set(expanded.split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function overlapScore(left, right) {
  let score = 0;
  for (const token of left) if (right.has(token)) score += 1;
  return score;
}

function classifyTestByClosestFeature(file, {
  knownCategoryMap,
  rootDir = path.join(__dirname, '..'),
  readFile = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8'),
} = {}) {
  if (!knownCategoryMap || typeof knownCategoryMap !== 'object') throw new Error('Closest-feature classifier requires knownCategoryMap.');

  let targetBody;
  try { targetBody = readFile(file); }
  catch (error) {
    return Object.freeze({ file, category: null, source: 'unresolved', scores: Object.freeze({}), evidence: Object.freeze([]), reason: `unable to read candidate test: ${error.message}` });
  }

  const targetTokens = tokensFor(`${file}\n${targetBody}`);
  const scores = {};
  const evidence = [];

  for (const [category, knownFiles] of Object.entries(knownCategoryMap)) {
    let categoryScore = 0;
    for (const knownFile of knownFiles || []) {
      let body = '';
      try { body = readFile(knownFile); } catch (_) { continue; }
      const score = overlapScore(targetTokens, tokensFor(`${knownFile}\n${body}`));
      if (score > 0) evidence.push({ category, knownFile, score });
      categoryScore += score;
    }
    scores[category] = categoryScore;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0] || [null, 0];
  const second = ranked[1] || [null, 0];
  if (!top[0] || top[1] <= 0 || top[1] === second[1]) {
    return Object.freeze({
      file,
      category: null,
      source: 'unresolved',
      scores: Object.freeze({ ...scores }),
      evidence: Object.freeze(evidence.sort((a, b) => b.score - a.score || a.knownFile.localeCompare(b.knownFile))),
      reason: top[1] <= 0 ? 'no matching feature evidence' : 'closest-feature match is tied or ambiguous',
    });
  }

  return Object.freeze({
    file,
    category: top[0],
    source: 'closest-feature',
    scores: Object.freeze({ ...scores }),
    evidence: Object.freeze(evidence.filter((item) => item.category === top[0]).sort((a, b) => b.score - a.score || a.knownFile.localeCompare(b.knownFile))),
    reason: `unique closest feature match: ${top[0]}`,
  });
}

module.exports = { STOP_WORDS, tokensFor, overlapScore, classifyTestByClosestFeature };
