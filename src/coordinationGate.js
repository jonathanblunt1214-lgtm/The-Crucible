// The gate where multi-AI coordination is enforced rather than described.
//
// Three failures share one gate because they are one property seen from three sides:
//
//   - Exactly one AI may mutate a given scope        (AI-HANDOFF.json mutationClaims)
//   - What an AI actually did survives the session   (DEVLOG.md)
//   - No credential ever reaches the permanent record (all three artifacts)
//
// It lives in its own module rather than inside cli.js because cli.js runs its own main() on
// require: anything that wants to call this from a test, a workflow, or another organ would
// otherwise have to start the whole command-line tool to do it.
const fs = require('node:fs');
const path = require('node:path');
const { crucibleError } = require('./failureCodes');
const { auditMutationClaims } = require('./mutationClaims');
const { auditDevlogAccountability, findFuturePlanning } = require('./devlogAccountability');
const { findCredentialLeaks } = require('./aiProviderRegistry');

const GOVERNANCE_ARTIFACTS = Object.freeze(['AI-HANDOFF.json', 'AI-CONFLICTS.json', 'DEVLOG.md']);

function coordinationGate(root) {
  const handoffPath = path.join(root, 'AI-HANDOFF.json');
  let plan = null;
  if (fs.existsSync(handoffPath)) {
    try { plan = JSON.parse(fs.readFileSync(handoffPath, 'utf8')); }
    catch (error) { throw crucibleError('CRU-0029', `AI-HANDOFF.json is not valid JSON, so mutation ownership cannot be checked: ${error.message}`); }
  }

  const claims = plan && Array.isArray(plan.mutationClaims) ? plan.mutationClaims : [];
  const claimAudit = auditMutationClaims(claims);
  if (claimAudit.findings.length) {
    throw crucibleError('CRU-0029', `Exclusive mutation ownership failed:\n${claimAudit.findings.map((item) => `- ${item.type}: ${item.detail}`).join('\n')}`);
  }

  const devlogPath = path.join(root, 'DEVLOG.md');
  const devlog = fs.existsSync(devlogPath) ? fs.readFileSync(devlogPath, 'utf8') : '';
  const accountability = auditDevlogAccountability({ devlog, claims });
  const record = [...accountability.findings, ...findFuturePlanning(devlog)];
  if (record.length) throw crucibleError('CRU-0035', `DEVLOG accountability failed:\n${record.map((item) => `- ${item.type}: ${item.detail}`).join('\n')}`);

  // Checked here, and not only in the security gate, because these three files are the ones an
  // AI rewrites on literally every change - which makes them the likeliest place for a working
  // prompt, and the key inside it, to be pasted.
  const leaks = [];
  for (const relative of GOVERNANCE_ARTIFACTS) {
    const target = path.join(root, relative);
    if (!fs.existsSync(target)) continue;
    leaks.push(...findCredentialLeaks(fs.readFileSync(target, 'utf8'), { label: relative }));
  }
  if (leaks.length) throw crucibleError('CRU-0033', `Provider credential persisted in a governance artifact:\n${leaks.map((item) => `- ${item.detail}`).join('\n')}`);

  return { claims: claimAudit.claims, active: claimAudit.active, accountable: accountability.claims };
}

module.exports = { GOVERNANCE_ARTIFACTS, coordinationGate };
