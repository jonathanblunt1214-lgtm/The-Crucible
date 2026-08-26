const { execFileSync } = require('node:child_process');

function stagedText(root, file) { try { return execFileSync('git', ['show', `:${file}`], { cwd:root, encoding:'utf8', windowsHide:true, stdio:['ignore', 'pipe', 'ignore'] }); } catch { return null; } }
function auditDependencyPolicy(root, config) {
  const policy = config.security.dependencyPolicy;
  if (!policy.enabled) return { findings:[], packages:0, skipped:true };
  const findings = [];
  let packages = 0;
  const packageJson = stagedText(root, 'package.json');
  if (packageJson) {
    const parsed = JSON.parse(packageJson);
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const [name, spec] of Object.entries(parsed[section] || {})) {
      packages += 1;
      if (policy.denyGit && /^(?:git(?:\+[^:]+)?|github:|gitlab:|bitbucket:)/i.test(spec)) findings.push({ type:'Git dependency is forbidden', path:`package.json:${section}.${name}` });
      if (policy.denyHttp && /^https?:/i.test(spec)) findings.push({ type:'URL dependency is forbidden', path:`package.json:${section}.${name}` });
      if (/^(?:file:|link:)/i.test(spec) && policy.denyLocal) findings.push({ type:'local dependency is forbidden', path:`package.json:${section}.${name}` });
    }
  }
  const lock = stagedText(root, 'package-lock.json');
  if (lock) {
    const parsed = JSON.parse(lock);
    for (const [name, item] of Object.entries(parsed.packages || {})) {
      if (item.resolved && policy.allowedRegistryHosts.length) {
        let host; try { host = new URL(item.resolved).hostname; } catch { continue; }
        if (!policy.allowedRegistryHosts.includes(host)) findings.push({ type:'unapproved dependency registry', path:name || 'package-lock.json' });
      }
      if (item.license && policy.denyLicenses.includes(item.license)) findings.push({ type:`prohibited license ${item.license}`, path:name || 'package-lock.json' });
    }
  }
  return { findings, packages, skipped:false };
}

module.exports = { auditDependencyPolicy };
