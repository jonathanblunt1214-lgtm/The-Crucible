const fs = require('node:fs');
const path = require('node:path');
const { recoverLegacyZeroByteLock } = require('./durableLock');
const { crucibleError } = require('./failureCodes');

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw crucibleError('CRU-0039', `${name} is required.`);
  return value.trim();
}

function run(argv = process.argv.slice(2), env = process.env, output = console.log) {
  if (argv.length !== 1 || argv[0] !== 'recover-extraction') throw crucibleError('CRU-0039', 'Usage: durableLockRecoveryCli.js recover-extraction');
  const projectId = required(env, 'CRUCIBLE_LEARNING_PROJECT_ID');
  const queueFile = path.resolve(required(env, 'CRUCIBLE_SOURCE_QUEUE'));
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  if (queue?.schemaVersion !== 1 || queue.projectId !== projectId || !Array.isArray(queue.documents) || !Array.isArray(queue.links)) throw crucibleError('CRU-0039', 'Source queue is invalid or belongs to another project.');
  const ownerAuthorized = required(env, 'CRUCIBLE_LEGACY_LOCK_RECOVERY_AUTHORIZED') === '1';
  const confirmedNoActiveWorker = required(env, 'CRUCIBLE_LEGACY_LOCK_NO_ACTIVE_WORKER') === '1';
  const expectedSha256 = required(env, 'CRUCIBLE_LEGACY_LOCK_EXPECTED_SHA256');
  const expectedMtimeMs = Number(required(env, 'CRUCIBLE_LEGACY_LOCK_EXPECTED_MTIME_MS'));
  const result = recoverLegacyZeroByteLock(`${queueFile}.claim-extraction.lock`, { projectId, ownerAuthorized, confirmedNoActiveWorker, expectedSha256, expectedMtimeMs });
  output(JSON.stringify({ state:'recovered', ...result }));
  return result;
}

if (require.main === module) {
  try { run(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { run };
