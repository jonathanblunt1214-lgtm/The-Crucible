const path = require('node:path');
const { ingestOwnerFiles } = require('./ownerFileIntake');
const { crucibleError } = require('./failureCodes');

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) throw crucibleError('CRU-0043', `${name} is required.`);
  return value.trim();
}

function run(argv = process.argv.slice(2), environment = process.env, output = console.log) {
  if (argv[0] !== 'ingest' || argv.length < 2) throw crucibleError('CRU-0043', 'Usage: ownerFileIntakeCli.js ingest <exact-file> [exact-file ...]');
  const result = ingestOwnerFiles({
    projectId: required(environment, 'CRUCIBLE_LEARNING_PROJECT_ID'),
    queueFile: path.resolve(required(environment, 'CRUCIBLE_SOURCE_QUEUE')),
    files: argv.slice(1),
  });
  output(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try { run(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { run };
