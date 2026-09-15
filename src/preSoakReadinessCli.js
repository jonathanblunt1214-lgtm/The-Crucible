// Read-only operator entry point: "what is still needed before the soak?", answered from
// the real store rather than from a checklist. It opens nothing for writing, mutates
// nothing, and authorizes nothing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { preSoakReadiness } = require('./preSoakReadiness');

function readJson(file, label) {
  if (!file) return {};
  if (!fs.existsSync(file)) throw new Error(`${label} was not found: ${file}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} could not be read: ${error.message}`); }
}

function run(argv = process.argv.slice(2), environment = process.env) {
  const projectId = environment.CRUCIBLE_LEARNING_PROJECT_ID;
  const learningRoot = environment.CRUCIBLE_LEARNING_ROOT;
  if (!projectId || !learningRoot) throw new Error('CRUCIBLE_LEARNING_PROJECT_ID and CRUCIBLE_LEARNING_ROOT are required.');
  if (argv[0] && argv[0] !== 'report') throw new Error('Usage: preSoakReadinessCli.js [report]');

  const storeFile = path.join(path.resolve(learningRoot), `${crypto.createHash('sha256').update(projectId).digest('hex')}.learning.json`);
  const envelope = readJson(storeFile, 'Durable learning store');
  const payload = envelope.payload || {};
  if (payload.projectId && payload.projectId !== projectId) throw new Error('Cross-project readiness reporting is forbidden.');

  const queue = readJson(environment.CRUCIBLE_SOURCE_QUEUE, 'Source queue');
  const research = readJson(environment.CRUCIBLE_RESEARCH_AUDIT, 'Research audit');
  // A combined R8 cycle is not recorded durably anywhere, so it is supplied explicitly or
  // reported as unjudgeable - never inferred from the unit coverage that exists already.
  const combinedSafetyEvidence = environment.CRUCIBLE_R8_EVIDENCE ? environment.CRUCIBLE_R8_EVIDENCE.split(',').map((item) => item.trim()).filter(Boolean) : null;

  return preSoakReadiness({ payload, queue, research, combinedSafetyEvidence, ...(environment.CRUCIBLE_SOAK_HOURS ? { hours: Number(environment.CRUCIBLE_SOAK_HOURS) } : {}) });
}

if (require.main === module) {
  try {
    const report = run();
    for (const item of report.gates) console.log(`[${item.state.toUpperCase()}] ${item.id} ${item.title} - ${item.detail}`);
    console.log(`\nGates green: ${report.gatesGreen}. Soak: ${report.soak.state} (${report.soak.observedDataPoints} of ${report.soak.dataPoints} data points observed, ${report.soak.heldDataPoints} held).`);
    for (const blocker of report.soak.blockers) console.log(`  - ${blocker}`);
  } catch (error) {
    console.error(`[The Crucible] Pre-soak readiness failed closed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { run };
