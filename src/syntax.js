function stripComments(value, file = '') {
  const text = String(value);
  if (/\.(?:py|ps1)$/i.test(file)) return text.replace(/(^|\s)#(?!\[)[^\r\n]*/g, '$1');
  if (/\.(?:js|jsx|ts|tsx|mjs|cjs|java|c|cc|cpp|cs|go|rs)$/i.test(file)) return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
  if (/\.(?:sh|bash|zsh)$/i.test(file)) return text.replace(/(^|\s)#[^\r\n]*/g, '$1');
  return text;
}

function languageFindings(value, file = '') {
  const code = stripComments(value, file);
  const findings = [];
  const rules = [
    ['dynamic code execution', /(?<![.\w])(?:eval|exec)\s*\(|\bnew\s+Function\s*\(/i],
    ['shell-enabled child process', /\b(?:exec|spawn|execFile)\s*\([^\r\n]{0,300}\bshell\s*:\s*true/i],
    ['unsafe deserialization', /\b(?:pickle\.loads|yaml\.load\s*\(|ObjectInputStream\s*\()/i],
  ];
  for (const [type, rule] of rules) { const match = rule.exec(code); if (match) findings.push({ type, line:code.slice(0, match.index).split(/\r?\n/).length }); }
  return findings;
}

module.exports = { stripComments, languageFindings };
