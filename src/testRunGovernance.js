const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const TEST_PROGRESS_INTERVAL_MS = 60_000;
const TEST_PROGRESS_MAX_INTERVAL_MS = 90_000;
const KNOWN_BUG_SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const CATEGORY_CRITICALITY = {
  security: 'critical',
  code: 'high',
  utility: 'medium',
  maintenance: 'low',
};
const DEFAULT_KNOWN_BUGS_PATH = path.join(__dirname, '..', 'governingDocuments', 'known-bugs', 'KNOWN-BUGS.json');

function emptyKnownBugLedger() {
  return { schemaVersion: 1, severityOrder: [...KNOWN_BUG_SEVERITY_ORDER], bugs: [] };
}

function severityRank(severity) {
  const index = KNOWN_BUG_SEVERITY_ORDER.indexOf(severity);
  if (index === -1) throw new Error(`Unknown known-bug severity "${severity}".`);
  return index;
}

function severityForMainCategories(mainCategories) {
  const severities = [...new Set(mainCategories)].map((category) => {
    const severity = CATEGORY_CRITICALITY[category];
    if (!severity) throw new Error(`Unknown main category "${category}" while assigning known-bug criticality.`);
    return severity;
  });
  return severities.sort((a, b) => severityRank(a) - severityRank(b))[0] || 'low';
}

function validateKnownBugLedger(ledger) {
  if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.bugs)) throw new Error('Known-bug ledger is invalid.');
  for (const bug of ledger.bugs) {
    if (!KNOWN_BUG_SEVERITY_ORDER.includes(bug.severity)) throw new Error(`Known bug ${bug.id || '(missing id)'} has invalid severity.`);
    if (bug.checked === true || bug.status === 'resolved') {
      const latest = Array.isArray(bug.retests) ? bug.retests[bug.retests.length - 1] : null;
      if (!latest || latest.ok !== true) throw new Error(`Known bug ${bug.id} cannot be checked off without a passing re-test.`);
    }
  }
  return true;
}

function readKnownBugLedger(ledgerPath = DEFAULT_KNOWN_BUGS_PATH) {
  if (!fs.existsSync(ledgerPath)) return emptyKnownBugLedger();
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  validateKnownBugLedger(ledger);
  return ledger;
}

function sortKnownBugs(bugs) {
  return [...bugs].sort((a, b) => {
    const severityDelta = severityRank(a.severity) - severityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;
    return String(a.foundAt || '').localeCompare(String(b.foundAt || ''));
  });
}

function writeKnownBugLedger(ledger, ledgerPath = DEFAULT_KNOWN_BUGS_PATH) {
  validateKnownBugLedger(ledger);
  ledger.bugs = sortKnownBugs(ledger.bugs);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  return ledger;
}

function bugIdFor(tests, headSha = process.env.CRUCIBLE_HEAD_SHA || 'local') {
  const digest = crypto.createHash('sha256').update(`${headSha}\n${[...tests].sort().join('\n')}`).digest('hex').slice(0, 10);
  return `KB-${String(headSha).slice(0, 8) || 'local'}-${digest}`;
}

function recordKnownBug({ tests, mainCategoryForTest, status = 1, ledgerPath = DEFAULT_KNOWN_BUGS_PATH, headSha = process.env.CRUCIBLE_HEAD_SHA || 'local', now = new Date().toISOString(), selectedTests = null, attribution = 'failing-tests' }) {
  const normalizedTests = [...new Set(tests || [])].sort();
  const normalizedSelection = [...new Set(selectedTests || tests || [])].sort();
  const mainCategories = [...new Set(normalizedTests.map(mainCategoryForTest))];
  const severity = severityForMainCategories(mainCategories);
  const ledger = readKnownBugLedger(ledgerPath);
  const id = bugIdFor(normalizedTests, headSha);
  const categoryResults = mainCategories
    .map((category) => ({
      category,
      severity: CATEGORY_CRITICALITY[category],
      status: 'failed',
      tests: normalizedTests.filter((file) => mainCategoryForTest(file) === category),
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const existing = ledger.bugs.find((bug) => bug.id === id);
  const record = existing || { id, foundAt: now, retests: [] };
  Object.assign(record, {
    severity,
    status: 'open',
    checked: false,
    sourceCommit: headSha,
    categoryResults,
    mainCategories,
    tests: normalizedTests,
    // Which tests the run selected, and whether the failures above are the proven
    // failing files or the whole selection because attribution was unavailable. A
    // reader must be able to tell those two apart without re-running anything.
    selectedTests: normalizedSelection,
    attribution,
    lastFailure: { at: now, exitStatus: status },
  });
  if (!existing) ledger.bugs.push(record);
  writeKnownBugLedger(ledger, ledgerPath);
  console.error(`[The Crucible] Orchestrator: saved known bug ${id} as ${severity} in governingDocuments/known-bugs/KNOWN-BUGS.json.`);
  return record;
}

function startProgressHeartbeat(label = 'tests', spawnImpl = spawn) {
  const script = [
    `const label = process.argv[1];`,
    `let elapsed = 0;`,
    `const interval = setInterval(() => {`,
    `  elapsed += ${TEST_PROGRESS_INTERVAL_MS};`,
    `  console.log('[The Crucible] Orchestrator update: ' + label + ' still running; ' + Math.round(elapsed / 1000) + 's elapsed.');`,
    `}, ${TEST_PROGRESS_INTERVAL_MS});`,
    `process.on('SIGTERM', () => { clearInterval(interval); process.exit(0); });`,
    `process.on('SIGINT', () => { clearInterval(interval); process.exit(0); });`,
  ].join('\n');
  return spawnImpl(process.execPath, ['-e', script, label], { stdio: 'inherit', windowsHide: true });
}

function stopProgressHeartbeat(child) {
  if (!child) return;
  try { child.kill(); } catch (_) { /* best-effort companion cleanup */ }
}

// A run's exit status says that something failed, never what. Recording the whole
// selection therefore marked every selected category as failed - security, utility and
// maintenance included - when a single test in one category was the only thing broken,
// which puts failures that did not happen into a governed ledger. Node's TAP output
// carries a 'location:' for every failure, so the failing file is recoverable exactly.
const TAP_FAILURE = /^not ok \d+ - (.*)$/;
const TAP_LOCATION = /^\s+location: '(.+?)(?::\d+)*'\s*$/;
const TAP_BLOCK_END = /^\s+\.\.\.\s*$/;

function failingTestFilesFromTap(tapOutput, selectedTests, root = process.cwd()) {
  const selected = new Set(selectedTests || []);
  const relative = (candidate) => path.relative(root, candidate).split(path.sep).join('/');
  const failing = [];
  const claim = (candidate) => {
    if (candidate && selected.has(candidate) && !failing.includes(candidate)) failing.push(candidate);
  };
  const lines = String(tapOutput || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const failure = TAP_FAILURE.exec(lines[index]);
    if (!failure) continue;
    // A file that fails to load is reported by path; a failing assertion is reported by
    // test name, and only the block's location names the file it came from.
    claim(failure[1].trim());
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (TAP_FAILURE.test(lines[cursor]) || TAP_BLOCK_END.test(lines[cursor])) break;
      const location = TAP_LOCATION.exec(lines[cursor]);
      if (location) { claim(path.isAbsolute(location[1]) ? relative(location[1]) : location[1]); break; }
    }
  }
  return failing;
}

function createGovernedRunner({ mainCategoryForTest, ledgerPath = DEFAULT_KNOWN_BUGS_PATH } = {}) {
  if (typeof mainCategoryForTest !== 'function') throw new Error('Governed runner requires mainCategoryForTest.');
  return function governedRun(executable, args, options = {}) {
    const isTestInvocation = Array.isArray(args) && args[0] === '--test';
    if (isTestInvocation) validateKnownBugLedger(readKnownBugLedger(ledgerPath));
    const tests = isTestInvocation ? args.slice(1).filter((arg) => typeof arg === 'string' && arg.endsWith('.test.js')) : [];
    const categories = isTestInvocation ? [...new Set(tests.map(mainCategoryForTest))] : [];
    const heartbeat = isTestInvocation ? startProgressHeartbeat(`${categories.join(', ') || 'selected'} tests`) : null;
    // A second TAP reporter into a file, so failures are attributable without changing
    // what the operator sees: stdout keeps the reporter Node would have chosen anyway.
    const alreadyReported = args.some((arg) => typeof arg === 'string' && arg.startsWith('--test-reporter'));
    const tapDirectory = isTestInvocation && !alreadyReported
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-test-attribution-'))
      : null;
    const tapPath = tapDirectory ? path.join(tapDirectory, 'run.tap') : null;
    const spawnArgs = tapPath
      ? [
        args[0],
        `--test-reporter=${process.stdout.isTTY ? 'spec' : 'tap'}`,
        '--test-reporter-destination=stdout',
        '--test-reporter=tap',
        `--test-reporter-destination=${tapPath}`,
        ...args.slice(1),
      ]
      : args;
    let result;
    try {
      result = spawnSync(executable, spawnArgs, options);
    } finally {
      stopProgressHeartbeat(heartbeat);
    }
    if (isTestInvocation && result && result.status !== 0) {
      let failing = [];
      try {
        if (tapPath && fs.existsSync(tapPath)) failing = failingTestFilesFromTap(fs.readFileSync(tapPath, 'utf8'), tests);
      } catch (_) { failing = []; }
      // Fail closed on attribution: if the failing files cannot be established - a crash
      // before any test ran, an unreadable report - record the whole selection exactly as
      // before and mark it, rather than narrowing a record on a guess.
      recordKnownBug({
        tests: failing.length ? failing : tests,
        selectedTests: tests,
        attribution: failing.length ? 'failing-tests' : 'selection-unattributed',
        mainCategoryForTest,
        status: result.status,
        ledgerPath,
      });
    }
    if (tapDirectory) fs.rmSync(tapDirectory, { recursive: true, force: true });
    return result;
  };
}

function verifyKnownBugFix(id, { ledgerPath = DEFAULT_KNOWN_BUGS_PATH, run = spawnSync, now = new Date().toISOString() } = {}) {
  const ledger = readKnownBugLedger(ledgerPath);
  const bug = ledger.bugs.find((candidate) => candidate.id === id);
  if (!bug) throw new Error(`Unknown known bug "${id}".`);
  const heartbeat = run === spawnSync ? startProgressHeartbeat(`known-bug re-test ${id}`) : null;
  let result;
  try {
    result = run(process.execPath, ['--test', ...bug.tests], { stdio: 'inherit', shell: false });
  } finally {
    stopProgressHeartbeat(heartbeat);
  }
  const ok = result && result.status === 0;
  bug.retests = Array.isArray(bug.retests) ? bug.retests : [];
  bug.retests.push({ at: now, ok, exitStatus: result ? result.status : null, tests: [...bug.tests] });
  bug.status = ok ? 'resolved' : 'open';
  bug.checked = ok;
  if (ok) bug.checkedAt = now;
  else delete bug.checkedAt;
  writeKnownBugLedger(ledger, ledgerPath);
  console.log(`[The Crucible] Orchestrator: known bug ${id} re-test ${ok ? 'passed and is now checked off' : 'FAILED and remains open'}.`);
  return { bug, ok };
}

module.exports = {
  failingTestFilesFromTap,
  TEST_PROGRESS_INTERVAL_MS,
  TEST_PROGRESS_MAX_INTERVAL_MS,
  KNOWN_BUG_SEVERITY_ORDER,
  CATEGORY_CRITICALITY,
  DEFAULT_KNOWN_BUGS_PATH,
  emptyKnownBugLedger,
  severityRank,
  severityForMainCategories,
  validateKnownBugLedger,
  readKnownBugLedger,
  writeKnownBugLedger,
  recordKnownBug,
  startProgressHeartbeat,
  stopProgressHeartbeat,
  createGovernedRunner,
  verifyKnownBugFix,
};
