'use strict';
// The testing suite as an organ on the circulation bus.
//
// The immune system could run checks but could not run tests. Before this, no immune module
// imported any testCadence module, `codeSecurityOrganism` imported only `ecosystem`, and the
// bus had no testing handler at all - GOVERNED_ORGANS was brain, immune, digestive, learning
// and reporting. The traffic ran one way: `cli` (nerves) invoked the immune checks, twenty
// direct edges of it. Nothing let the immune system ask for a test.
//
// The link is made on the bus rather than by import, for two reasons that agree with each
// other. The fly-by-wire ratchet refuses a new direct organ-to-organ edge, so an immune module
// importing testCadence would be edge 58 and rejected. And the bus is what carries a typed,
// bounded, project-scoped request that circulation itself refuses to let satisfy proof. The
// rule and the architecture want the same thing here.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not write tests. A request may only name tests
// that already exist on disk, and `selectRequestedTests` refuses anything else by name. An
// organ that could author the test that then judges its own repair is self-certification, and
// the whole proof boundary of this project exists to prevent exactly that. Authoring is a
// separate decision the owner has not taken; until then this refuses rather than guesses.
const { discoverTests, selectTestsForCategory, selectTestsForChanges, runTestSelection } = require('./testCadenceCore');

// A request names either changed paths or explicit test files. Anything that is not already a
// discovered test is refused by name rather than silently dropped, so a request to run a test
// that does not exist can never be reported as a run that passed.
function selectRequestedTests(request = {}, available = discoverTests()) {
  const known = new Set(available);
  if (Array.isArray(request.tests) && request.tests.length) {
    const unknown = request.tests.filter((file) => !known.has(file));
    if (unknown.length) {
      throw new Error(`Testing organ was asked to run test(s) that do not exist: ${unknown.join(', ')}. It runs existing tests and never writes them.`);
    }
    return { tests: [...request.tests], mainCategories: [], categories: [], reason: `explicitly requested ${request.tests.length} existing test(s)`, coverageComplete: true };
  }
  if (request.mainCategory) return selectTestsForCategory(request.mainCategory, available);
  if (Array.isArray(request.changedPaths) && request.changedPaths.length) return selectTestsForChanges(request.changedPaths, available);
  throw new Error('A testing work-request must name changed paths, a main category, or explicit existing tests.');
}

// The organ handler. Returns what the run observed and nothing more: a passing test is an
// observation, never a proof stage and never permission to promote. Circulation enforces the
// same thing independently - `pump` throws if a handler claims either - so the guarantee does
// not rest on this function remembering to be honest.
function createTestingOrgan({ run, available } = {}) {
  return async ({ payload, envelope }) => {
    const selection = selectRequestedTests(payload && payload.request, available || discoverTests());
    const outcome = runTestSelection(selection, run);
    return {
      result: {
        kind: 'existing-test-observation',
        requestedBy: envelope.sourceOrgan,
        boundary: envelope.boundary,
        tests: selection.tests,
        passed: outcome.ok,
        outcomes: outcome.outcomes,
        // Said out loud in the record itself, because this is the property a reader most needs
        // and the one a future change is most likely to erode.
        authoredAnyTest: false,
        classification: 'Insufficient Evidence',
      },
      proofStageSatisfied: false,
      promotionAuthorized: false,
    };
  };
}

module.exports = { selectRequestedTests, createTestingOrgan };
