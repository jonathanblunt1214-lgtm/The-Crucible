const fs = require('node:fs');

const GLOBAL_POLICY_FILE = '.thecrucible-global.json';
const LOCAL_POLICY_FILE = '.thecrucible-local.json';
const KINDS = ['preferences', 'rules', 'settings'];

function interpretGlobalInstruction(command) {
  if (typeof command !== 'string' || /[\u0000-\u001f\u007f]/.test(command)) return null;
  let normalized = command.trim().replace(/[.!?]+$/g, '').trim();
  const local = /\bin this project\b/i.test(normalized);
  normalized = normalized.replace(/\bin this project\b/ig, ' ').replace(/\s*,\s*|\s+/g, ' ').trim();
  let value = normalized.match(/^crucible\s*[, :]\s*(?:please\s+)?(.+)$/i)?.[1]
    || normalized.match(/^(?:hey\s*,?\s*)?from now on\s+(.+)$/i)?.[1];
  if (!value || value.length > 500) return null;
  value = value.trim();
  const kind = /^(?:prefer|preference\b)/i.test(value) ? 'preferences' : /^(?:set|setting\b)/i.test(value) ? 'settings' : 'rules';
  const policyFile = local ? LOCAL_POLICY_FILE : GLOBAL_POLICY_FILE;
  const scope = local ? 'local' : 'global';
  const sharing = local ? 'applied only to this repository after review and commit' : 'shared across project repositories after review and commit';
  return { kind, value, scope, policyFile, updatesGlobalPolicy:!local, updatesLocalPolicy:local, userNotice:`This adds a ${scope} ${kind.slice(0, -1)} inside The Crucible's ${policyFile}, ${sharing}.` };
}

function validateGlobalPolicy(policy) {
  if (!policy || policy.schemaVersion !== 1) throw new Error(`${GLOBAL_POLICY_FILE} must use schemaVersion 1.`);
  const result = { schemaVersion:1 };
  for (const kind of KINDS) {
    const values = policy[kind] || [];
    if (!Array.isArray(values) || values.length > 100 || values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error(`${GLOBAL_POLICY_FILE}.${kind} must contain at most 100 bounded text values.`);
    result[kind] = [...new Set(values.map((value) => value.trim()))];
  }
  return result;
}

function applyGlobalInstruction(policy, command) {
  const interpreted = interpretGlobalInstruction(command);
  if (!interpreted) return null;
  const updated = validateGlobalPolicy(policy);
  if (!updated[interpreted.kind].includes(interpreted.value)) updated[interpreted.kind].push(interpreted.value);
  return { policy:updated, interpretation:interpreted };
}

function updateGlobalPolicyFile(file, command) {
  const result = applyGlobalInstruction(JSON.parse(fs.readFileSync(file, 'utf8')), command);
  if (!result) throw new Error('Command is not a bounded global Crucible instruction.');
  fs.writeFileSync(file, `${JSON.stringify(result.policy, null, 2)}\n`, 'utf8');
  return result.interpretation;
}

module.exports = { GLOBAL_POLICY_FILE, LOCAL_POLICY_FILE, KINDS, interpretGlobalInstruction, validateGlobalPolicy, applyGlobalInstruction, updateGlobalPolicyFile };
