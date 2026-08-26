const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runCommand } = require('./runner');

function digestFile(target) { return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'); }
async function verifyClaims(root, config) {
  const records = [];
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd:root, encoding:'utf8', windowsHide:true }).trim();
  for (const claim of config.authenticity.claims) {
    await runCommand(root, claim, config.workload.timeoutMinutes * 60_000, ' [claim evidence]');
    const evidence = (claim.evidence || []).map((relative) => {
      const target = path.resolve(root, relative);
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`${claim.name} did not produce evidence file ${relative}.`);
      return { path:relative, sha256:digestFile(target) };
    });
    if (config.authenticity.requireArtifacts && !evidence.length) throw new Error(`${claim.name} must declare at least one evidence artifact.`);
    const record = { claim:claim.name, commandSha256:crypto.createHash('sha256').update(JSON.stringify({ run:claim.run, args:claim.args, cwd:claim.cwd })).digest('hex'), commit, verifiedAt:new Date().toISOString(), evidence };
    records.push(record);
    console.log(`[The Crucible] Evidence: ${JSON.stringify(record)}`);
  }
  return { claims:records.length, records };
}

module.exports = { verifyClaims, digestFile };
