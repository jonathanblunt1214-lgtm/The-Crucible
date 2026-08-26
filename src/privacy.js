const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { glob } = require('./clutter');

const RULES = [
  ['GitHub credential', /gh[pousr]_[A-Za-z0-9_]{20,}/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['personal Windows user path', /[A-Za-z]:\\Users\\(?!USER_HOME\\|example(?:-user)?\\|developer\\)[^\\\s"']+\\/gi],
  ['personal Google Drive path', /[A-Za-z]:\\My Drive\\/gi],
  ['phone number', /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g],
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
];

function isAllowedEmail(value, githubIdentity) {
  const email = String(value).toLowerCase();
  const identity = githubIdentity.toLowerCase();
  return email === 'git@github.com'
    || /@example\.(?:com|org|net|test)$/.test(email)
    || email === 'maintainer@packages.invalid'
    || email === `${identity}@users.noreply.github.com`
    || email.endsWith(`+${identity}@users.noreply.github.com`);
}

function findingsForText(value, githubIdentity) {
  const content = String(value);
  const findings = [];
  for (const [type, rule] of RULES) {
    rule.lastIndex = 0;
    let match;
    while ((match = rule.exec(content))) {
      if (type === 'email address' && isAllowedEmail(match[0], githubIdentity)) continue;
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      const sourceLine = content.split(/\r?\n/)[line - 1] || '';
      if (type === 'private key' && /\/[^/]*(?:PRIVATE KEY)[^/]*\/[dgimsuvy]*/.test(sourceLine)) continue;
      findings.push({ type, line });
    }
  }
  return findings;
}

function isDependencyLockfile(file) {
  return /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|Pipfile\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/i.test(String(file).replace(/\\/g, '/'));
}

function scrubText(value, githubIdentity, preserveEmails = false, scanContactInformation = true) {
  let content = String(value)
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/[A-Za-z]:\\Users\\(?!USER_HOME\\|example(?:-user)?\\|developer\\)[^\\\s"']+\\/gi, (match) => `${match[0]}:\\Users\\USER_HOME\\`)
    .replace(/[A-Za-z]:\\My Drive\\/gi, 'DRIVE_HOME\\');
  if (scanContactInformation) content = content.replace(/(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g, '[REDACTED_PHONE]');
  if (scanContactInformation && !preserveEmails) content = content.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) => isAllowedEmail(email, githubIdentity) ? email : '[REDACTED_EMAIL]');
  return content;
}

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd:root, encoding:'utf8', windowsHide:true }).split('\0').filter(Boolean);
}

function auditPrivacy(root, config, snapshot = null) {
  const findings = [];
  const files = snapshot?.files || trackedFiles(root);
  const allow = (config.privacy.allow || []).map((entry) => glob(typeof entry === 'string' ? entry : entry.path));
  for (const file of files) {
    if (allow.some((rule) => rule.test(file))) continue;
    let content;
    try { content = snapshot?.entries.get(file)?.buffer.toString('utf8') ?? execFileSync('git', ['show', `:${file}`], { cwd:root, encoding:'utf8', windowsHide:true, maxBuffer:20 * 1024 * 1024 }); }
    catch { continue; }
    if (!content || content.includes('\0')) continue;
    for (const finding of findingsForText(content, config.privacy.githubIdentity)) {
      if (!config.privacy.scanContactInformation && ['email address', 'phone number'].includes(finding.type)) continue;
      if (finding.type === 'email address' && isDependencyLockfile(file)) continue;
      findings.push({ path:file, ...finding });
    }
  }
  return { files:files.length, findings };
}

function scrubPrivacy(root, config) {
  const changed = [];
  const allow = (config.privacy.allow || []).map((entry) => glob(typeof entry === 'string' ? entry : entry.path));
  for (const file of trackedFiles(root)) {
    if (allow.some((rule) => rule.test(file))) continue;
    const target = path.resolve(root, file);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
    const buffer = fs.readFileSync(target);
    if (buffer.includes(0)) continue;
    const before = buffer.toString('utf8');
    const after = scrubText(before, config.privacy.githubIdentity, isDependencyLockfile(file), config.privacy.scanContactInformation);
    if (after === before) continue;
    fs.writeFileSync(target, after, 'utf8');
    changed.push(file);
  }
  return { changed };
}

module.exports = { RULES, isAllowedEmail, isDependencyLockfile, findingsForText, scrubText, auditPrivacy, scrubPrivacy };
