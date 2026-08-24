const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { languageFindings } = require('./syntax');

const TEXT_RULES = [
  ['encoded PowerShell execution', /powershell(?:\.exe)?[^\r\n]{0,160}(?:-[Ee](?:ncodedCommand)?\s+|frombase64string\s*\()/i],
  ['download-and-execute payload', /(?:invoke-expression|\biex\b)\s*\([^\r\n]{0,200}(?:downloadstring|webclient)|(?:curl|wget)\b[^\r\n|]{0,240}\|\s*(?:sh|bash|zsh|powershell)\b/i],
  ['reverse-shell payload', /(?:bash\s+-i[^\r\n]{0,160}\/dev\/tcp\/|\bnc\b[^\r\n]{0,120}\s-e\s+(?:\/bin\/(?:ba)?sh|cmd\.exe)|socket\.[^\r\n]{0,100}connect\([^\r\n]{0,160}dup2\()/i],
  ['obfuscated dynamic execution', /(?:eval|Function)\s*\(\s*(?:atob\s*\(|Buffer\.from\s*\([^\r\n]{0,120}['"]base64['"]|(?:unescape|decodeURIComponent)\s*\()/i],
  ['credential-store theft behavior', /(?:Login Data|Cookies|logins\.json|key4\.db)[^\r\n]{0,240}(?:sqlite|decrypt|dpapi|password|token)|(?:sqlite|decrypt|dpapi)[^\r\n]{0,240}(?:Login Data|logins\.json|key4\.db)/i],
  ['keylogging or covert capture behavior', /(?:SetWindowsHookEx|GetAsyncKeyState|pynput\.keyboard|iohook)[^\r\n]{0,240}(?:fetch\s*\(|requests\.post|https?\.request|socket\.send|webhook)|(?:pyautogui\.screenshot|ImageGrab\.grab|CopyFromScreen)[^\r\n]{0,240}(?:fetch\s*\(|requests\.post|https?\.request|socket\.send|webhook)/i],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Slack credential', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['npm credential', /\bnpm_[A-Za-z0-9]{30,}\b/],
  ['Stripe live secret', /\bsk_live_[A-Za-z0-9]{16,}\b/],
  ['client-visible credential storage', /(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*['"][^'"]*(?:access[_-]?token|refresh[_-]?token|provider[_-]?credential|private[_-]?key|client[_-]?secret)[^'"]*['"]/i],
  ['client-visible secret environment variable', /\b(?:VITE|NEXT_PUBLIC|REACT_APP)_[A-Z0-9_]*(?:SECRET|PRIVATE_KEY|REFRESH_TOKEN|ACCESS_TOKEN)\b/],
  ['service-account private key material', /["']private_key["']\s*:\s*["']-----BEGIN PRIVATE KEY-----/i],
  ['fabricated integration success', /catch\s*(?:\([^)]*\))?\s*\{[^}]{0,300}(?:return\s+\{[^}]{0,120}(?:success|ok)\s*:\s*true|status\s*\(\s*2\d\d\s*\))/i],
];

const ARTIFACT_RULE_TYPES = new Set(['AWS access key', 'Slack credential', 'npm credential', 'Stripe live secret', 'client-visible credential storage', 'client-visible secret environment variable', 'service-account private key material']);

const SUSPICIOUS_BINARY_EXTENSION = /\.(?:exe|dll|scr|com|msi|msp|cpl|sys|dylib|so(?:\.\d+)*|node|class|jar|wasm)$/i;

function gitBuffer(root, spec) {
  return execFileSync('git', ['show', spec], { cwd:root, windowsHide:true, encoding:'buffer', maxBuffer:25 * 1024 * 1024 });
}

function glob(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd:root, encoding:'utf8', windowsHide:true }).split('\0').filter(Boolean);
}

function executableMagic(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer.subarray(1, 4).toString('ascii') === 'ELF') return 'ELF executable';
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'MZ') return 'Windows PE executable';
  if (buffer.length >= 4) {
    const magic = buffer.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return 'Mach-O executable';
  }
  return null;
}

function findingsForText(value, allowedTypes = null) {
  const content = String(value);
  const findings = [];
  for (const [type, rule] of TEXT_RULES) {
    if (allowedTypes && !allowedTypes.has(type)) continue;
    rule.lastIndex = 0;
    const match = rule.exec(content);
    if (match) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      const sourceLine = content.split(/\r?\n/)[line - 1] || '';
      if (/\bpattern\s*:\s*\/.+\/[dgimsuvy]*\s*[,}]/.test(sourceLine)) continue;
      findings.push({ type, line });
    }
  }
  return findings;
}

function artifactFiles(root, artifacts) {
  const files = [];
  const repository = path.resolve(root);
  function visit(target) {
    const resolved = path.resolve(target);
    if (resolved !== repository && !resolved.startsWith(`${repository}${path.sep}`)) throw new Error('Artifact path escapes the repository.');
    if (!fs.existsSync(resolved)) return;
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) for (const entry of fs.readdirSync(resolved)) visit(path.join(resolved, entry));
    else if (stat.isFile()) files.push(resolved);
  }
  for (const artifact of artifacts) visit(path.resolve(root, artifact));
  return files;
}

function auditArtifactSecurity(root, config) {
  if (!config.security.enabled) return { files:0, findings:[], skipped:true };
  const findings = [];
  const files = artifactFiles(root, config.artifacts);
  for (const target of files) {
    const stat = fs.statSync(target);
    if (stat.size > config.security.maxTextBytes) continue;
    const buffer = fs.readFileSync(target);
    if (buffer.includes(0)) continue;
    const relative = path.relative(root, target).replace(/\\/g, '/');
    for (const finding of findingsForText(buffer.toString('utf8'), ARTIFACT_RULE_TYPES)) findings.push({ path:relative, ...finding });
  }
  return { files:files.length, findings, skipped:false };
}

function auditSecurity(root, config, snapshot = null) {
  if (!config.security.enabled) return { files:0, findings:[], skipped:true };
  const allow = config.security.allow.map((entry) => glob(typeof entry === 'string' ? entry : entry.path));
  const allowedBinaries = config.security.allowBinaries.map((entry) => glob(typeof entry === 'string' ? entry : entry.path));
  const findings = [];
  const files = snapshot?.files || trackedFiles(root);
  for (const file of files) {
    if (allow.some((rule) => rule.test(file))) continue;
    let buffer;
    try { buffer = snapshot?.entries.get(file)?.buffer || gitBuffer(root, `:${file}`); } catch { continue; }
    const magic = executableMagic(buffer);
    if ((magic || SUSPICIOUS_BINARY_EXTENSION.test(file)) && !allowedBinaries.some((rule) => rule.test(file))) {
      findings.push({ type:magic || 'suspicious executable binary extension', path:file });
      continue;
    }
    if (buffer.length > config.security.maxTextBytes || buffer.includes(0)) continue;
    for (const finding of findingsForText(buffer.toString('utf8'))) findings.push({ path:file, ...finding });
    for (const finding of languageFindings(buffer.toString('utf8'), file)) findings.push({ path:file, ...finding });
  }
  return { files:files.length, findings, skipped:false };
}

module.exports = { TEXT_RULES, SUSPICIOUS_BINARY_EXTENSION, executableMagic, findingsForText, artifactFiles, auditArtifactSecurity, auditSecurity, glob };
