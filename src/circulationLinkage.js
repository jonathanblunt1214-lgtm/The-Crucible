// Making circulation the only path, rather than a path.
//
// Fly-by-wire has one defining property: there is no mechanical reversion. The stick is not
// connected to the control surface by cable, so every input goes through the computer whether
// the pilot likes it or not. A bus that organs *may* use is a control surface with a cable still
// attached to it - under load, everything reverts to the cable.
//
// The organism already has the architecture: productionOrganism registers a handler per organ
// and organs emit signals rather than calling one another. What was missing is the part that
// makes it mandatory. Two mechanisms here, because static and runtime failures look different:
//
//   - A ratchet on direct linkage. Fifty-seven cross-system imports exist today; they are
//     recorded as a baseline and may never increase. Every new connection between organs has to
//     go through circulation, so the mechanical linkage can only shrink.
//   - A registration assertion. Circulation with a missing organ handler is not a bus, it is a
//     severed wire - and the failure is silent, because a signal to a missing organ simply never
//     arrives. Every governed organ must have a handler before the organism can run at all.
//
// This does not pretend the existing linkage is gone. It says exactly how much there is, forbids
// more, and refuses to start an organism whose wiring has a hole in it.
const fs = require('node:fs');
const path = require('node:path');

// Which system each module belongs to. A module absent from this map is unassigned, and an
// unassigned module is reported rather than quietly excused - a system nobody has placed is a
// system nobody is enforcing.
const SYSTEMS = Object.freeze({
  brain: ['governingDecision', 'learningGovernance', 'learningOrchestrator', 'globalPolicy', 'globalRepositoryGovernance', 'injectedGovernance', 'injectedGovernanceReconcile', 'handoffPolicy', 'aiConflictLedger', 'aiConflictResolution', 'mutationClaims', 'multiAiDeliberation', 'coordinationGate', 'aiProviderRegistry', 'aiProviderAdapters', 'multiAiOrchestrator', 'devlogAccountability', 'aiHandoffContinuation', 'mutationClaimStore', 'coordinationCli', 'reasoningProblemSolving', 'creativeDecisionAdaptation', 'criticalClaimReview', 'repositoryOperation', 'requiredCheckBoundary', 'ecosystem', 'config', 'configureSuite', 'suiteSelection', 'folderTopology'],
  nerves: ['testCadence', 'testCadenceCore', 'testCadenceCoreLegacy', 'testCadencePolicy', 'testFeatureClassifier', 'testRunGovernance', 'testingOrgan', 'ciDiagnosticOrgan', 'precheck', 'code-check', 'report', 'failureIssue', 'snapshot', 'runner', 'cli', 'maintenance', 'organismHealth'],
  immune: ['security', 'malwareScan', 'quarantine', 'privacy', 'clutter', 'collisions', 'commit', 'dependencies', 'exceptions', 'syntax', 'integrity', 'reproducibility', 'apiGuard', 'githubRepoSecurity', 'workflowLint', 'docSync', 'designBriefGate', 'coreRefIntegrity', 'referenceBranchIntegrity', 'injectionMonitor', 'repair', 'codeSecurityOrganism', 'semanticAnalysis', 'installGitHooks', 'authenticity'],
  digestive: ['safeInformationRetrieval', 'automatedGoogleResearch', 'automatedGoogleResearchCli', 'monthlyKnowledgeRefresh', 'claimExtractionWorker', 'claimExtractionWorkerCli', 'documentFurniture', 'hostedSourceBundle', 'hostedMultiRepositoryIntegration', 'languageCatalog', 'intakePathways'],
  learning: ['scientificLearning', 'scientificLearningCli', 'learningCycle', 'learningExperience', 'claimComparison', 'claimEvaluationWorker', 'semanticCorroboration', 'pairedCorroboration', 'sourceIndependence', 'realCorpusLearning', 'realCorpusSafety', 'realSupersession', 'knowledgeLifecycle', 'hostedLearningProof', 'preSoakReadiness', 'preSoakReadinessCli', 'soakGate', 'soakRun', 'repairEvidence', 'hypothesisTestPlan', 'languageHypothesisVariables', 'concreteLanguageHarness', 'languageExperimentRegistry', 'contradictionAudit', 'contradictionReopening', 'pipelineTracer'],
  boundary: ['hostIsolation', 'externalAiFirewall', 'offlineGpuGate', 'durableLock'],
  // `failureCodes` belongs here rather than to any organ. It is the shared vocabulary every
  // organ speaks - what a failure is, and what the fix for it is - which is chemistry the blood
  // carries, not an organ of its own. Placing it in circulation is also the only placement that
  // works: an edge to circulation is the wire rather than the cable, so every organ may look a
  // code up without that becoming a new direct organ-to-organ connection.
  circulation: ['organismCirculation', 'organismRuntime', 'productionOrganism', 'oversightReflex', 'circulationLinkage', 'gradedOversightResponse', 'findingLedger', 'failureCodes'],
});

// Every organ that must have a handler on the bus before the organism may run. Circulation is
// not an organ that talks to itself, and boundary limits are enforced in place rather than
// signalled, so neither appears here.
//
// `testing` is here so the immune system can ask for tests to be run. It is a governed organ
// rather than a direct import because a direct one would be a new organ-to-organ edge the
// ratchet refuses - and because the bus is what makes the request typed, bounded, and unable
// to satisfy proof. Listing it here means an organism that forgets to wire it will not start,
// rather than silently dropping every test request into a severed wire.
// `diagnostics` is here because the owner placed it: the diagnostic organ is the link between
// the brain and the immune system. A diagnosis that only ever reached a CI artifact was a sense
// organ wired to nothing - the brain could not ask for one and the immune system never received
// one, so every diagnosis was read by a person and retyped as an instruction.
//
// On the bus it closes the loop the rest of this file exists to make possible: the brain asks
// for a diagnosis, the diagnostic organ answers with a failure code, and the code carries the
// remedy the immune system acts on - including the existing tests that would prove the repair,
// which it sends to the testing organ. Direct because it is one continuous path, and over
// circulation because a direct import would be a new cable and, more importantly, because the
// bus is what keeps a diagnosis from quietly becoming permission to repair.
const GOVERNED_ORGANS = Object.freeze(['brain', 'immune', 'digestive', 'learning', 'reporting', 'testing', 'diagnostics']);

const BASELINE_FILE = 'governingDocuments/circulation-linkage-baseline.json';

function systemOf(module) {
  for (const [system, modules] of Object.entries(SYSTEMS)) if (modules.includes(module)) return system;
  return null;
}

// Direct module-to-module linkage that crosses a system boundary: the mechanical cable that
// fly-by-wire exists to remove.
function linkageReport(root = 'src') {
  const files = fs.readdirSync(root).filter((file) => file.endsWith('.js')).map((file) => file.slice(0, -3));
  const unassigned = files.filter((file) => !systemOf(file)).sort();
  const edges = [];
  for (const file of files.sort()) {
    const from = systemOf(file);
    if (!from) continue;
    const source = fs.readFileSync(path.join(root, `${file}.js`), 'utf8');
    const required = [...new Set([...source.matchAll(/require\(['"]\.\/([A-Za-z0-9_-]+)['"]\)/g)].map((match) => match[1]))].sort();
    for (const dependency of required) {
      const to = systemOf(dependency);
      if (!to || to === from) continue;
      edges.push({ from, to, module: file, dependency });
    }
  }
  // An edge INTO circulation is the wire, not the cable: it is the direction fly-by-wire wants
  // and must never count against the ratchet. What is counted is linkage that bypasses the bus.
  const bypassing = edges.filter((edge) => edge.to !== 'circulation' && edge.from !== 'circulation');
  const byPair = {};
  for (const edge of bypassing) {
    const key = `${edge.from}->${edge.to}`;
    byPair[key] = (byPair[key] || 0) + 1;
  }
  return { total: bypassing.length, edges, bypassing, byPair, unassigned, throughCirculation: edges.filter((edge) => edge.to === 'circulation').length };
}

function readBaseline(file = BASELINE_FILE) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The ratchet. Direct linkage may shrink and may never grow; a new connection between organs has
// to be made through circulation. A drop is recorded rather than merely allowed, so the baseline
// tightens as the cable is removed and cannot silently slacken again.
function auditCirculationLinkage({ root = 'src', baselineFile = BASELINE_FILE } = {}) {
  const report = linkageReport(root);
  const baseline = readBaseline(baselineFile);
  if (!baseline) {
    return { ok: false, reason: `No circulation linkage baseline at ${baselineFile}; fly-by-wire cannot be enforced without one.`, report };
  }
  if (report.unassigned.length) {
    return { ok: false, reason: `Unassigned module(s), which no system owns and no linkage rule reaches: ${report.unassigned.join(', ')}.`, report, baseline };
  }
  if (report.total > baseline.directCrossSystemImports) {
    const added = Object.entries(report.byPair).filter(([pair, count]) => count > (baseline.byPair[pair] || 0)).map(([pair, count]) => `${pair} ${baseline.byPair[pair] || 0} -> ${count}`);
    return { ok: false, reason: `Direct cross-system linkage that bypasses circulation increased from ${baseline.directCrossSystemImports} to ${report.total}. A new connection between organs must go through the bus: ${added.join('; ')}.`, report, baseline };
  }
  return {
    ok: true,
    reason: report.total < baseline.directCrossSystemImports
      ? `Direct linkage bypassing circulation fell from ${baseline.directCrossSystemImports} to ${report.total}; record the lower baseline so the ratchet cannot slacken again.`
      : `${report.total} direct edge(s) still bypass circulation and none were added; ${report.throughCirculation} edge(s) route through it.`,
    tightened: report.total < baseline.directCrossSystemImports,
    report,
    baseline,
  };
}

// The runtime half. A signal addressed to an organ with no handler is not an error anyone sees -
// it simply never arrives - so the organism refuses to start with a hole in its wiring.
function assertFlyByWire(organs, { governed = GOVERNED_ORGANS } = {}) {
  const registered = Object.keys(organs || {}).filter((name) => typeof organs[name] === 'function');
  const missing = governed.filter((name) => !registered.includes(name));
  if (missing.length) {
    throw new Error(`Circulation is missing a handler for ${missing.join(', ')}; a signal to an unhandled organ never arrives, so the organism will not start with a severed wire.`);
  }
  return { flyByWire: true, registered: registered.sort(), governed: [...governed] };
}

module.exports = { SYSTEMS, GOVERNED_ORGANS, BASELINE_FILE, systemOf, linkageReport, readBaseline, auditCirculationLinkage, assertFlyByWire };
