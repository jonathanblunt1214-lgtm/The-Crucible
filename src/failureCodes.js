'use strict';
// Every failure carries a code, and a code is a lookup rather than a guess.
//
// The owner's instruction, after one too many reports that said nothing: "every error and
// failure must have a diagnosable error code". This module is what makes that true, and what
// keeps it true.
//
// What was wrong. `ciDiagnosticOrgan` classified failures by running five hand-written regular
// expressions over whatever log text it was handed. That has two failure modes and CI hit both
// on 2026-09-02: a failure whose wording no rule anticipated came back `unclassifiedFailure:
// true` with an empty `diagnoses` array, and - worse - the organ was handed the *install* log
// while the failure was four steps later, so it was asked to explain a failure it had never
// been shown. Either way the report told a reader nothing they did not already know, and the
// diagnosis had to be done by hand from raw CI logs.
//
// Pattern-matching prose is the wrong instrument. It infers identity from wording, so rewording
// a message silently reclassifies it, and any error nobody wrote a rule for is invisible
// forever. A code is the opposite: the throw site declares what went wrong, the registry says
// what it means and what to do, and the classification survives rewording, translation, and the
// trip through a child process's stdout.
//
// WHAT A CODE IS NOT. It is not a severity, not a promise the failure is understood, and never
// an authority to repair. `describeCode` returns meaning and next action; deciding anything is
// somebody else's job.
//
// This module lives in `circulation` deliberately. It is shared vocabulary that every organ
// speaks - the chemistry the blood carries rather than an organ of its own - and the linkage
// ratchet exempts edges to circulation for exactly that reason. Putting it anywhere else would
// make every import of it a new cross-organ cable.
const fs = require('node:fs');
const path = require('node:path');

// The code that means "this failure path has not been given a code yet". It exists because the
// owner's rule admits no exceptions: an uncoded failure still has to arrive as something a
// reader can act on. `CRU-0000` is a finding about the codebase - a named gap with a named
// remedy - rather than the shrug that `unclassifiedFailure: true` was.
const UNCODED = 'CRU-0000';

// A code is `CRU-` followed by four digits. Fixed width so it can be found in a log by shape
// rather than by knowing the list, and stable across any rewording of the message it carries.
const CODE_PATTERN = /CRU-\d{4}/g;

// The registry. Each entry says what happened and what to do about it, in the words a person
// reading a red CI job needs. `category` groups codes for reporting; it is not a severity.
const FAILURE_CODES = Object.freeze({
  [UNCODED]: {
    code: UNCODED,
    category: 'diagnosis-coverage',
    meaning: 'A failure occurred on a path that has not been assigned a failure code, so the diagnostic organ can name that the gap exists but not what went wrong.',
    next: 'Read the failure message quoted in the report, give that throw site a code from this registry (or add one), and record the lower uncoded baseline. Never widen a pattern rule to cover it.',
    remedy: {
      kind: 'owner-decision',
      command: null,
      verifyWith: { mainCategory: 'utility' },
      forbidden: 'Never widen a diagnostic pattern rule to absorb it; that hides the gap instead of closing it.',
    },
  },
  'CRU-0001': {
    code: 'CRU-0001',
    category: 'governance',
    meaning: 'The Crucible design-brief link is severed: THE-CRUCIBLE-DESIGN-BRIEF.md was installed and then deleted.',
    next: 'Restore the design brief from the canonical source and commit it. Nothing else runs until the link is intact.',
    remedy: {
      kind: 'owner-decision',
      command: null,
      verifyWith: { tests: ['test/designBriefGate.test.js'] },
      forbidden: 'Never re-create the brief from memory or stub it to clear the gate; it must come from the canonical source.',
    },
  },
  'CRU-0002': {
    code: 'CRU-0002',
    category: 'repository-integrity',
    meaning: 'The pinned Crucible commit failed integrity verification.',
    next: 'Compare the pinned ref against the canonical branch and resolve the mismatch; do not repoint the pin to make the check pass.',
    remedy: {
      kind: 'owner-decision',
      command: null,
      verifyWith: { tests: ['test/coreRefIntegrity.test.js'] },
      forbidden: 'Never repoint the pin at whatever the working tree happens to be; that makes the check agree with the drift.',
    },
  },
  'CRU-0003': {
    code: 'CRU-0003',
    category: 'quality',
    meaning: 'The pre-check gate found required actions that have not been taken.',
    next: 'Work the actions listed in the pre-check report, then rerun it.',
    remedy: {
      kind: 'guided',
      command: 'npm run precheck',
      verifyWith: { mainCategory: 'code' },
      forbidden: 'Never mark a pre-check action done without doing it.',
    },
  },
  'CRU-0004': {
    code: 'CRU-0004',
    category: 'commit-hygiene',
    meaning: 'The Commit Gate found issues in the staged commit.',
    next: 'Fix the listed issues, or run npm run fix:commit for the mechanical ones, then restage.',
    remedy: {
      kind: 'automatic',
      command: 'npm run fix:commit',
      verifyWith: { tests: ['test/commit.test.js'] },
      forbidden: "Never amend the gate's rules to admit the commit as written.",
    },
  },
  'CRU-0005': {
    code: 'CRU-0005',
    category: 'dependency-policy',
    meaning: 'The dependency policy audit rejected the declared dependency set.',
    next: 'Bring the dependency declarations back inside policy; never relax the policy to admit them.',
    remedy: {
      kind: 'guided',
      command: 'npm run audit:security',
      verifyWith: { tests: ['test/security.test.js'] },
      forbidden: 'Never relax the dependency policy to admit a dependency it rejected.',
    },
  },
  'CRU-0006': {
    code: 'CRU-0006',
    category: 'repository-security',
    meaning: 'GitHub repository security settings do not satisfy the required configuration.',
    next: 'Apply the fixes named in the report; see "GitHub repository security settings gate" in README.md.',
    remedy: {
      kind: 'owner-decision',
      command: 'npm run audit:github-security',
      verifyWith: { tests: ['test/globalRepositoryGovernance.test.js'] },
      forbidden: 'Never disable a required repository setting, and never mark the gate skipped, to get past it.',
    },
  },
  'CRU-0007': {
    code: 'CRU-0007',
    category: 'governance',
    meaning: 'The global repository governance gate failed against the recorded manifest.',
    next: 'Resolve each named repository finding, or update the manifest through the governed path if the estate genuinely changed.',
    remedy: {
      kind: 'owner-decision',
      command: 'npm run audit:github-security',
      verifyWith: { tests: ['test/globalRepositoryGovernance.test.js'] },
      forbidden: 'Never edit the manifest to match a drifted estate unless the estate genuinely changed by decision.',
    },
  },
  'CRU-0008': {
    code: 'CRU-0008',
    category: 'workflow-validity',
    meaning: 'A workflow declares an unrecognized GitHub Actions permissions key, which makes GitHub reject the entire workflow file so every job in it stops running.',
    next: 'Replace the key with a valid one from the documented set. This is a hard syntax failure, not a policy preference.',
    remedy: {
      kind: 'automatic',
      command: 'npm run lint:workflows',
      verifyWith: { tests: ['test/workflowLint.test.js'] },
      forbidden: 'Never delete the whole permissions block to silence it; that grants the default, which is broader.',
    },
  },
  'CRU-0009': {
    code: 'CRU-0009',
    category: 'governance',
    meaning: 'Configuration governance forbids the requested configuration change (the Security Gate may not be disabled).',
    next: 'Leave the Security Gate enabled. If it is failing, fix what it found.',
    remedy: {
      kind: 'owner-decision',
      command: null,
      verifyWith: { tests: ['test/config.test.js'] },
      forbidden: 'Never disable the Security Gate. If it is failing, the finding is the work.',
    },
  },
  'CRU-0010': {
    code: 'CRU-0010',
    category: 'ai-conflict',
    meaning: 'AI conflict governance found unresolved or malformed conflict custody.',
    next: 'Record the conflict and its resolution in AI-CONFLICTS.json through the governed path.',
    remedy: {
      kind: 'guided',
      command: 'npm run audit:ai-conflict',
      verifyWith: { tests: ['test/aiConflictLedger.test.js'] },
      forbidden: 'Never delete a conflict entry to clear the ledger; an unrecorded conflict is an unresolved one.',
    },
  },
  'CRU-0011': {
    code: 'CRU-0011',
    category: 'governance',
    meaning: 'Exception governance found an exception that is not declared, has expired, or does not match its declared scope.',
    next: 'Declare, re-scope, or remove the exception. An undeclared exception is a rule nobody agreed to.',
    remedy: {
      kind: 'owner-decision',
      command: null,
      verifyWith: { mainCategory: 'security' },
      forbidden: "Never broaden an exception's scope to cover what it was found not to cover.",
    },
  },
  'CRU-0012': {
    code: 'CRU-0012',
    category: 'documentation',
    meaning: 'README.md is out of date with respect to the generated documentation surface.',
    next: 'Run npm run docs:sync, review the diff, and commit it.',
    remedy: {
      kind: 'automatic',
      command: 'npm run docs:sync',
      verifyWith: { tests: ['test/docSync.test.js'] },
      forbidden: 'Never hand-edit README.md to match; regenerate it so the generator stays the source of truth.',
    },
  },
  'CRU-0013': {
    code: 'CRU-0013',
    category: 'privacy',
    meaning: 'Personal identifiers were detected in tracked or staged content.',
    next: 'Review the sanitized working files, stage the cleaned content, and commit again. The original staged content stays blocked.',
    remedy: {
      kind: 'automatic',
      command: 'npm run scrub:privacy',
      verifyWith: { tests: ['test/privacy.test.js'] },
      forbidden: 'Never add the identifier to an allow-list to clear the audit.',
    },
  },
  'CRU-0014': {
    code: 'CRU-0014',
    category: 'hygiene',
    meaning: 'The clutter audit found files that do not belong in the tracked tree.',
    next: 'Remove or relocate each listed path. Do not add it to an ignore list to silence the audit.',
    remedy: {
      kind: 'guided',
      command: 'npm run audit:clutter',
      verifyWith: { mainCategory: 'maintenance' },
      forbidden: 'Never add the path to an ignore list to silence the audit.',
    },
  },
  'CRU-0015': {
    code: 'CRU-0015',
    category: 'repository-collision',
    meaning: 'Another open pull request changes the same lines of the same files as this one, so one of them will not merge cleanly.',
    next: 'Coordinate with the overlapping pull request, rebase or separate the shared changes, then rerun collision checking.',
    remedy: {
      kind: 'owner-decision',
      command: 'npm run audit:collisions',
      verifyWith: { tests: ['test/collisions.test.js'] },
      forbidden: 'Never close or exclude the other pull request to clear the overlap; the overlap is real until the changes are separated.',
    },
  },
  'CRU-0016': {
    code: 'CRU-0016',
    category: 'ci-harness',
    meaning: 'The command-line interface was asked to perform an action it does not implement.',
    next: 'Check the action name against the documented set in README.md.',
    remedy: {
      kind: 'guided',
      command: null,
      verifyWith: { mainCategory: 'utility' },
      forbidden: 'Never add an alias for a mistyped action; fix the caller.',
    },
  },
  'CRU-0017': {
    code: 'CRU-0017',
    category: 'artifact-security',
    meaning: 'The generated-artifact security scan found unsafe content in produced artifacts, which were quarantined.',
    next: 'Inspect the quarantined artifacts, fix what generated them, and rerun. Never release the quarantine to get green.',
    remedy: {
      kind: 'owner-decision',
      command: null,
      verifyWith: { tests: ['test/security.test.js'] },
      forbidden: 'Never release the quarantine or exclude the artifact path to get green.',
    },
  },
  'CRU-0018': {
    code: 'CRU-0018',
    category: 'workload',
    meaning: 'A verification command in the bounded workload exited non-zero or was killed by a signal.',
    next: 'Read the captured child output quoted with this code: it names the command, the worker and cycle, and the exit status. Diagnose that command, not the harness that ran it.',
    remedy: {
      kind: 'guided',
      command: null,
      verifyWith: { mainCategory: 'code' },
      forbidden: 'Never skip, disable, or quarantine the failing verification command.',
    },
  },
  'CRU-0019': {
    code: 'CRU-0019',
    category: 'workload',
    meaning: 'A verification command exceeded its configured timeout and was terminated.',
    next: 'Establish whether the command hung or is genuinely slower than the budget; raise the budget only with evidence, never to hide a hang.',
    remedy: {
      kind: 'guided',
      command: null,
      verifyWith: { mainCategory: 'code' },
      forbidden: 'Never raise the timeout budget without evidence that the command is genuinely slower rather than hung.',
    },
  },
  'CRU-0020': {
    code: 'CRU-0020',
    category: 'workload',
    meaning: 'A verification command could not be started at all.',
    next: 'Resolve the missing executable or unreadable working directory named in the message.',
    remedy: {
      kind: 'guided',
      command: null,
      verifyWith: { mainCategory: 'utility' },
      forbidden: 'Never drop the command from the workload because it will not start.',
    },
  },
  'CRU-0021': {
    code: 'CRU-0021',
    category: 'workload',
    meaning: 'The bounded workload finished but a required artifact was not produced.',
    next: 'Find out why the producing command did not write it; a missing artifact is a silent failure of the step that owed it.',
    remedy: {
      kind: 'guided',
      command: null,
      verifyWith: { mainCategory: 'utility' },
      forbidden: 'Never remove the artifact from the required list to make the check pass.',
    },
  },
  'CRU-0022': {
    code: 'CRU-0022',
    category: 'diagnosis-coverage',
    meaning: 'The failure-code coverage ratchet found more uncoded throw sites than the recorded baseline allows.',
    next: 'Give the new throw sites codes. The baseline may only fall; raising it would let the diagnosable surface shrink again.',
    remedy: {
      kind: 'guided',
      command: 'npm run audit:failure-codes',
      verifyWith: { tests: ['test/failureCodes.test.js'] },
      forbidden: 'Never raise the uncoded baseline. It may only fall.',
    },
  },
});

// Build an error that carries its code. The code is also written into the message text, because
// an error frequently has to survive a trip it cannot carry properties across: `runner.js`
// captures a child process's stdout and stderr as a string, and CI keeps only the log. A code
// in the text is still recoverable at the far end; a property is not.
function crucibleError(code, message, extra = {}) {
  if (!FAILURE_CODES[code]) throw new Error(`Unknown failure code ${code}. Add it to the registry in src/failureCodes.js before throwing it, so a reader can look it up.`);
  const error = new Error(`[${code}] ${message}`);
  error.crucibleCode = code;
  Object.assign(error, extra);
  return error;
}

// Recover the code from an error, wherever it survived: the property first, then the message
// text for an error that crossed a process boundary.
function failureCode(error) {
  if (!error) return null;
  if (error.crucibleCode && FAILURE_CODES[error.crucibleCode]) return error.crucibleCode;
  const found = String(error.message || error).match(/CRU-\d{4}/);
  return found && FAILURE_CODES[found[0]] ? found[0] : null;
}

function describeCode(code) {
  return FAILURE_CODES[code] || null;
}

// The half the immune system uses.
//
// A code that only names a failure still leaves the repair to be worked out from prose, which is
// the same guessing one layer up. So every code carries a remedy the immune system can act on
// without reading English:
//
//   kind       'automatic'      a mechanical fix exists and the immune system may apply it
//              'guided'         the command reproduces the finding; the change itself is judgement
//              'owner-decision' not the immune system's to make, and it must escalate instead
//   command    the exact repository command, or null when no command applies
//   verifyWith a testing work-request in the shape `selectRequestedTests` accepts, so the proof
//              of a repair is existing tests run through the bus rather than a claim
//   forbidden  the fix that would make the symptom disappear without fixing anything, named so
//              that taking it has to be a deliberate act
//
// `kind` is the load-bearing field. The repair selection policy in AI-HANDOFF.json requires the
// correct fix rather than the one that silences the symptom, and 'owner-decision' is how a code
// says out loud that no correct fix is available to an automaton. A remedy is still not
// authority: it says what to do, never that it may be promoted, and R11 is untouched by any of
// it.
function remedyFor(code) {
  const known = FAILURE_CODES[code];
  return known ? known.remedy : null;
}

// The work-request the immune system should send to the testing organ to prove a repair for this
// code. Returned as its own function because this is the join between the two halves: a code
// names the failure, and this names the existing tests that would show it fixed.
function testRequestFor(code) {
  const remedy = remedyFor(code);
  return remedy ? { ...remedy.verifyWith } : null;
}

// Codes the immune system may act on unaided, and codes it must escalate. Kept as a query rather
// than left to each caller's reading of `kind`, so "may I repair this?" has one answer.
function repairableByImmuneSystem(code) {
  const remedy = remedyFor(code);
  return Boolean(remedy && remedy.kind !== 'owner-decision');
}

// Every code present in a body of text, in the order first seen and without duplicates. This is
// how the diagnostic organ classifies a log: by what the failure declared itself to be, not by
// what its wording resembles.
function codesInText(text) {
  const seen = [];
  for (const match of String(text || '').matchAll(CODE_PATTERN)) {
    if (FAILURE_CODES[match[0]] && !seen.includes(match[0])) seen.push(match[0]);
  }
  return seen;
}

const BASELINE_FILE = 'governingDocuments/failure-code-baseline.json';

// A throw site is coded when it throws through `crucibleError`. Counting the uncoded ones is
// what turns "every failure has a code" from an intention into something with a number attached.
//
// The registry module itself is excluded: the guard inside `crucibleError` has to throw when
// handed an unknown code, and it cannot do that through itself.
function coverageReport(root = 'src') {
  const files = fs.readdirSync(root).filter((file) => file.endsWith('.js') && file !== 'failureCodes.js').sort();
  const byFile = {};
  let uncoded = 0;
  let coded = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const bare = (source.match(/throw new Error\(/g) || []).length;
    const carried = (source.match(/throw crucibleError\(/g) || []).length;
    coded += carried;
    if (bare) { byFile[file] = bare; uncoded += bare; }
  }
  return { uncoded, coded, byFile, files: files.length };
}

function readBaseline(file = BASELINE_FILE) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The ratchet, in the shape this repository already uses for circulation linkage: the count of
// uncoded throw sites may fall and may never rise. Six hundred throw sites are not going to
// grow codes in one commit, and pretending otherwise would be the dishonest version of this
// change. What this guarantees instead is that the diagnosable surface only ever grows.
function auditFailureCodes({ root = 'src', baselineFile = BASELINE_FILE } = {}) {
  const report = coverageReport(root);
  const baseline = readBaseline(baselineFile);
  if (!baseline) {
    return { ok: false, code: 'CRU-0022', reason: `No failure-code baseline at ${baselineFile}; coverage cannot be ratcheted without one.`, report };
  }
  if (report.uncoded > baseline.uncodedThrowSites) {
    const grew = Object.entries(report.byFile)
      .filter(([file, count]) => count > (baseline.byFile[file] || 0))
      .map(([file, count]) => `${file} ${baseline.byFile[file] || 0} -> ${count}`);
    return {
      ok: false,
      code: 'CRU-0022',
      reason: `Uncoded throw sites rose from ${baseline.uncodedThrowSites} to ${report.uncoded}. A new failure path must carry a code so it can be diagnosed rather than guessed at: ${grew.join('; ')}.`,
      report,
      baseline,
    };
  }
  return {
    ok: true,
    reason: report.uncoded < baseline.uncodedThrowSites
      ? `Uncoded throw sites fell from ${baseline.uncodedThrowSites} to ${report.uncoded}; record the lower baseline so the ratchet cannot slacken again.`
      : `${report.uncoded} throw site(s) remain uncoded and none were added; ${report.coded} carry a failure code.`,
    tightened: report.uncoded < baseline.uncodedThrowSites,
    report,
    baseline,
  };
}

module.exports = {
  UNCODED, CODE_PATTERN, FAILURE_CODES, BASELINE_FILE,
  crucibleError, failureCode, describeCode, codesInText,
  remedyFor, testRequestFor, repairableByImmuneSystem,
  coverageReport, readBaseline, auditFailureCodes,
};
