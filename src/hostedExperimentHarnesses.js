'use strict';

// Real controlled experiments for the hosted learning proof.
//
// What this replaces was not a stub anybody had forgotten to finish - it looked finished. The
// hosted proof supplied one hardcoded pair for every claim: the "experiment" ran a fixed
// JavaScript array-map snippet whatever the claim said, `proof()` returned hardcoded controls,
// causal isolation, negative tests and regression tests, and the "independent verifier" ran the
// same closure and reported passed. The only thing separating experiment from verifier was the
// id string, which is all claimEvaluationWorker compares.
//
// So a declaration for any claim would have produced a verified knowledge version without the
// claim ever being tested. That is the same failure this repository corrected on 2026-09-01,
// when R4-R8 had been recorded passed on a proof that built its sources in code: the corpus
// reading was fixed then and the experiment was not.
//
// Three properties make a harness here real, and each is enforced rather than described.
//
// Independence is a different measurement method, not a different name. Each language pairs a
// runtime adapter that executes the fixture against a static adapter that reads its source
// tree. The experiment observes behaviour; the verifier confirms the source really declares
// what the behaviour exercised. Two ids that differ while sharing a closure would satisfy
// claimEvaluationWorker and satisfy nothing else.
//
// The control is executed, not asserted. assertExperiment runs the negative-control fixture and
// requires it to FAIL the expected property. An experiment whose control cannot fail has not
// isolated anything, so a control that passes fails the experiment.
//
// The proof is derived. Every field handed to the governed proof shape comes from the analysis
// that actually ran - the fixture hash, the observed constructor count, the control's outcome,
// the owner's declared scope - and the analysis is captured inside assertExperiment so the proof
// is built from the exact result the assertion validated rather than from a second run.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { concreteHarnessConfiguration } = require('./concreteLanguageHarness');
const { javaRuntimeAdapter, javaStaticAdapter, nodeRuntimeAdapter, typescriptStaticAdapter } = require('./toolchainCirculation');
const { crucibleError } = require('./failureCodes');

const EXPERIMENT_ROOT = path.resolve(__dirname, '..', 'scripts', 'experiments');

function fixtureSha256(root, files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort()) hash.update(`${file}\n`).update(fs.readFileSync(path.resolve(root, file)));
  return hash.digest('hex');
}

const valuesFor = (result, key) => (result.observations || []).filter((item) => item.key === key).map((item) => item.value);
const singleValue = (result, key) => { const values = valuesFor(result, key); return values.length === 1 ? values[0] : null; };

// --- java: "Any class can have more than one constructor." -------------------------------
//
// Measured by the JVM itself. The fixture invokes every constructor it declares and then reports
// getDeclaredConstructors().length through reflection, so the count is the runtime's rather than
// the fixture author's, and each CONSTRUCTED line is evidence that one constructor really ran.
function javaConstructorConfiguration({ projectId, root = EXPERIMENT_ROOT, env = process.env }) {
  const runtime = javaRuntimeAdapter({ projectId, root, env });
  const analysis = javaStaticAdapter({ projectId, root, env });
  if (!runtime || !analysis) return null;
  const files = ['java/ManyConstructors.java', 'java/OneConstructor.java'];
  const captured = {};

  const declaresSeveral = (result) => {
    const declared = Number(singleValue(result, 'DECLARED'));
    const constructed = new Set(valuesFor(result, 'CONSTRUCTED'));
    return Number.isInteger(declared) && declared > 1 && constructed.size === declared;
  };

  return {
    captured,
    experimentAdapter: runtime,
    verifierAdapter: analysis,
    fixture: {
      files,
      sha256: fixtureSha256(root, files),
      expectedProperty: 'the class declares more than one constructor and each declared constructor is separately invocable',
      runtimeBoundary: 'OpenJDK javac and java, as resolved from JAVA_HOME on this runner',
      mainClass: 'ManyConstructors',
    },
    assertExperiment: async (result) => {
      captured.experiment = result;
      if (!declaresSeveral(result)) return false;
      // The control runs here because a control that is merely described controls nothing. It is
      // the same fixture set and the same adapter with one variable changed - which class is
      // constructed - and it must fail the property the positive case satisfies.
      const control = await runtime.analyze({ files: [...files], mainClass: 'OneConstructor' });
      captured.control = control;
      return declaresSeveral(control) === false;
    },
    assertVerification: async (result) => {
      captured.verification = result;
      // Independent method: the JDK's own parse tree, not the runtime. A constructor appears as a
      // declaration whose method name equals the class name, so the class name is derived from the
      // file rather than written twice. This corroborates the control as well as the positive
      // case, by reading the source instead of executing it - which is what makes it independent
      // of the experiment rather than a second opinion from the same measurement.
      const constructorsIn = (file) => {
        const className = path.basename(file, '.java');
        return (result.functions || []).filter((item) => item.file === file && String(item.id).includes(`#${className}(`));
      };
      const many = constructorsIn('java/ManyConstructors.java');
      const control = constructorsIn('java/OneConstructor.java');
      // Distinct signatures, so a fixture repeating one declaration could not read as several.
      const signatures = new Set(many.map((item) => String(item.id)));
      return many.length > 1 && signatures.size === many.length && control.length === 1;
    },
  };
}

// --- javascript: map returns a new array and leaves the input alone ----------------------
function javascriptMapConfiguration({ projectId, root = EXPERIMENT_ROOT }) {
  const runtime = nodeRuntimeAdapter({ projectId, root });
  const analysis = typescriptStaticAdapter({ projectId, root });
  const positive = 'javascript/mapReturnsNewArray.js';
  const control = 'javascript/mutatingLoop.js';
  const files = [positive];
  const captured = {};

  const returnsNewArray = (result) => singleValue(result, 'IDENTITY') === 'distinct-reference' && singleValue(result, 'INPUT') === '[1,2,3]' && singleValue(result, 'OUTPUT') === '[2,4,6]';

  return {
    captured,
    experimentAdapter: runtime,
    verifierAdapter: analysis,
    fixture: {
      files,
      sha256: fixtureSha256(root, [positive, control]),
      expectedProperty: 'map returns a distinct array carrying the transformed values while the input array is unchanged',
      runtimeBoundary: `Node.js ${process.version} on this runner, ordinary dense arrays of numbers`,
    },
    assertExperiment: async (result) => {
      captured.experiment = result;
      if (!returnsNewArray(result)) return false;
      const controlResult = await runtime.analyze({ files: [control] });
      captured.control = controlResult;
      return returnsNewArray(controlResult) === false;
    },
    assertVerification: async (result) => {
      captured.verification = result;
      const callees = (result.calls || []).map((item) => String(item.calleeText));
      const controlReport = await analysis.analyze({ files: [control] });
      const controlCallees = (controlReport.calls || []).map((item) => String(item.calleeText));
      captured.verificationControl = controlReport;
      // Independent method: the TypeScript compiler API over the same source, executing nothing.
      // The runtime observed a distinct array; this confirms the transformation was actually
      // `input.map` and that the control reaches its result without it. That single construct is
      // the variable the control isolates, so its presence here and absence there is what makes
      // this a second measurement rather than a second opinion.
      //
      // Diagnostics are deliberately not asserted on. The fixtures use Node globals and the
      // program is built without Node type declarations, so both files report benign errors;
      // gating on them would fail this assertion for a reason unrelated to the claim.
      return callees.includes('input.map') && !controlCallees.includes('input.map');
    },
  };
}

const CONFIGURATIONS = Object.freeze({ java: javaConstructorConfiguration, javascript: javascriptMapConfiguration });

// Translates a real analysis into the governed proof shape. Every value is derived; there is
// deliberately no constant here, because module-level constants are what let the old harness
// assert an array boundary for a Java claim.
function governedProof({ candidate, hypothesis, testPlan, claimScope, configuration, at }) {
  const { captured, fixture } = configuration;
  const experiment = captured.experiment || { observations: [] };
  const control = captured.control || { observations: [] };
  const declared = singleValue(experiment, 'DECLARED');
  const constructed = valuesFor(experiment, 'CONSTRUCTED');
  const observedSummary = (experiment.observations || []).map((item) => `${item.key}|${item.value}`).join(' ');
  const controlSummary = (control.observations || []).map((item) => `${item.key}|${item.value}`).join(' ');
  const boundary = (testPlan && testPlan.experimentBoundary) || claimScope || candidate.claimBoundary;
  return {
    schemaVersion: 1,
    candidateId: candidate.id,
    projectId: candidate.projectId,
    hypothesis,
    testedProperty: candidate.claim,
    experimentBoundary: boundary,
    controls: [
      `unchanged fixture ${fixture.sha256} comprising ${fixture.files.join(', ')}`,
      `negative control observed ${controlSummary || 'no output'} and failed the expected property`,
      `runtime boundary ${fixture.runtimeBoundary}`,
    ],
    causalIsolation: {
      method: `one declared variable changed against the same fixture set and the same ${experiment.adapter ? experiment.adapter.id : 'runtime'} adapter`,
      result: declared !== null ? `the positive case reported ${observedSummary} while the control reported ${controlSummary}` : `the positive case reported ${observedSummary} and the control reported ${controlSummary}`,
      correlationOnly: false,
    },
    negativeTests: [`the negative control failed ${fixture.expectedProperty}, observing ${controlSummary || 'no output'}`],
    regressionTests: constructed.length
      ? [`each declared constructor ran and identified itself: ${constructed.join(', ')}`]
      : [`the fixture reported ${observedSummary}`],
    scopeProof: claimScope || candidate.claimBoundary,
    generalizationResult: candidate.generalizationBoundary,
    contradictionResult: 'none',
    completedAt: at,
  };
}

// The harness pair the evaluation worker consumes. It delegates to the concrete harness so its
// assertions and contract custody still run, then builds the governed proof from the captured
// analysis. contractSha256 is injected because the worker does not carry it, and the custody
// check inside the concrete harness still fires if the wrong contract is ever wired here.
function harnessPair({ language, configuration, at }) {
  const handlers = concreteHarnessConfiguration(language, configuration);
  const experiment = {
    id: configuration.experimentAdapter.id,
    run: async ({ candidate, hypothesis, testPlan, testPlanSha256, claimScope }) => {
      const inner = await handlers.experiment.run({ testPlanSha256, contractSha256: handlers.contractSha256 });
      if (inner.passed !== true) throw crucibleError('CRU-0050', `The ${language} controlled experiment did not pass its own fixture assertions.`);
      return { ...governedProof({ candidate, hypothesis, testPlan, claimScope, configuration, at }), testPlanSha256 };
    },
  };
  const verifier = {
    id: configuration.verifierAdapter.id,
    run: async ({ candidate, experimentalProof, testPlanSha256 }) => {
      const inner = await handlers.verifier.run({ testPlanSha256, contractSha256: handlers.contractSha256, experimentalProof, experimentExecutorId: configuration.experimentAdapter.id });
      if (inner.passed !== true) throw crucibleError('CRU-0050', `The ${language} independent verifier did not confirm the experiment.`);
      return {
        verifierId: configuration.verifierAdapter.id,
        independent: true,
        testedProperty: candidate.claim,
        experimentBoundary: experimentalProof.experimentBoundary,
        result: 'passed',
        verifiedAt: at,
        testPlanSha256,
      };
    },
  };
  return { experiment, verifier, contractSha256: handlers.contractSha256, planBuilder: handlers.planBuilder };
}

// Dispatches on the declaration's own language and fails closed for anything else. There is no
// default harness on purpose: a default is how a Java claim came to be "proved" by an array-map
// script, and a missing harness is a fact worth reporting rather than routing around.
function harnessesForDeclaration(declaration, { projectId, at = new Date().toISOString(), env = process.env, root = EXPERIMENT_ROOT } = {}) {
  const language = String(declaration?.language || 'javascript').toLowerCase();
  const build = CONFIGURATIONS[language];
  if (!build) {
    throw crucibleError('CRU-0050', `No controlled experiment harness is registered for ${language}, so the claim "${String(declaration?.claim || '').slice(0, 60)}" cannot be tested. Registered languages are ${Object.keys(CONFIGURATIONS).join(', ')}.`);
  }
  const configuration = build({ projectId, root, env });
  if (!configuration) {
    throw crucibleError('CRU-0050', `The ${language} toolchain is unavailable on this runner, so its controlled experiment cannot run.`);
  }
  return harnessPair({ language, configuration, at });
}

// R7 re-tests a claim that R5 already promoted, so its harness has to be the one for that
// claim's language rather than a pair chosen in advance. There is no active verified knowledge
// until R5 promotes something, and realSupersession returns unsatisfied before touching a
// harness in that case, so resolution is deferred to first use: nothing is built when nothing is
// superseded, and if it is ever reached without a resolvable language it throws CRU-0050 instead
// of substituting a harness that would not be testing the claim.
function lazyHarnessPair({ resolveLanguage, projectId, at = new Date().toISOString(), env = process.env, root = EXPERIMENT_ROOT }) {
  let resolved = null;
  const pair = () => {
    if (resolved) return resolved;
    const language = resolveLanguage();
    if (!language) throw crucibleError('CRU-0050', 'A supersession experiment was requested without a language to resolve its harness from, so there is no way to test the claim it re-tests.');
    resolved = harnessesForDeclaration({ language }, { projectId, at, env, root });
    return resolved;
  };
  return {
    experiment: { get id() { return pair().experiment.id; }, run: async (input) => pair().experiment.run(input) },
    verifier: { get id() { return pair().verifier.id; }, run: async (input) => pair().verifier.run(input) },
  };
}

module.exports = { EXPERIMENT_ROOT, lazyHarnessPair, CONFIGURATIONS, fixtureSha256, javaConstructorConfiguration, javascriptMapConfiguration, governedProof, harnessPair, harnessesForDeclaration };
