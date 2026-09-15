const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXPERIMENT_ROOT,
  CONFIGURATIONS,
  fixtureSha256,
  harnessesForDeclaration,
  lazyHarnessPair,
} = require('../src/hostedExperimentHarnesses');

const PROJECT = 'github:jonathanblunt1214-lgtm/The-Crucible';
const AT = '2026-09-15T15:00:00.000Z';
const candidate = (claim) => ({ id: 'cand-1', projectId: PROJECT, claim, claimBoundary: 'as asserted by the document', generalizationBoundary: 'Does not cover other runtimes.' });

// Real toolchains against the real fixtures. Nothing here is stubbed on purpose: a stubbed
// adapter would reintroduce exactly what this module removed, which was a harness that reported
// a result without running anything the claim was about.
function temporaryExperimentRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-experiments-'));
  fs.cpSync(EXPERIMENT_ROOT, dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function runPair({ language, root, claim }) {
  const { experiment, verifier } = harnessesForDeclaration({ language, claim }, { projectId: PROJECT, at: AT, root });
  const subject = candidate(claim);
  const proof = await experiment.run({ candidate: subject, hypothesis: `Within scope, controlled execution will show that ${claim}`, testPlan: { experimentBoundary: 'declared scope' }, testPlanSha256: 'a'.repeat(64), claimScope: 'declared scope' });
  const verification = await verifier.run({ candidate: subject, experimentalProof: proof, testPlanSha256: 'a'.repeat(64) });
  return { proof, verification };
}

test('each language runs a real toolchain and is verified by a different measurement method', async (t) => {
  const root = temporaryExperimentRoot(t);

  const java = await runPair({ language: 'java', root, claim: 'Any class can have more than one constructor.' });
  assert.equal(java.verification.result, 'passed');
  assert.equal(java.verification.verifierId, 'jdk-compiler-tree', 'the verifier reads the parse tree');
  // The experiment executed; the verifier did not. Two ids that merely differ would satisfy
  // claimEvaluationWorker while sharing one closure, which is what this replaced.
  assert.match(java.proof.causalIsolation.result, /DECLARED\|3/, 'the JVM reported its own constructor count');
  assert.match(java.proof.causalIsolation.result, /DECLARED\|1/, 'and the control reported one');
  assert.equal(java.proof.causalIsolation.correlationOnly, false);

  const javascript = await runPair({ language: 'javascript', root, claim: 'map returns a new array and leaves the input unchanged' });
  assert.equal(javascript.verification.result, 'passed');
  assert.equal(javascript.verification.verifierId, 'typescript-compiler-api');
  assert.match(javascript.proof.causalIsolation.result, /IDENTITY\|distinct-reference/);
  assert.match(javascript.proof.causalIsolation.result, /IDENTITY\|same-reference/, 'the control mutated in place');
});

test('every proof field is derived from the run rather than from a module constant', async (t) => {
  const root = temporaryExperimentRoot(t);
  const claim = 'Any class can have more than one constructor.';
  const { proof } = await runPair({ language: 'java', root, claim });

  assert.equal(proof.testedProperty, claim, 'the proof is about the claim, not about a fixed example');
  assert.equal(proof.scopeProof, 'declared scope', 'the scope proved is the declared one');
  assert.equal(proof.generalizationResult, 'Does not cover other runtimes.', 'taken from the candidate');
  assert.equal(proof.experimentBoundary, 'declared scope');
  // The old harness asserted an array boundary for every claim through module constants.
  const serialised = JSON.stringify(proof);
  assert.doesNotMatch(serialised, /dense arrays of numbers|sparse arrays, proxies/, 'no array-map constant may survive into a Java proof');
  assert.match(proof.controls.join(' '), /^unchanged fixture [a-f0-9]{64}/, 'controls name the exact fixture hash');
  assert.match(proof.regressionTests[0], /no-arg, int:2, string-int:x:3/, 'each constructor identified itself');
  assert.match(proof.negativeTests[0], /the negative control failed/);
});

test('a fixture that contradicts its own expected property is refused', async (t) => {
  const root = temporaryExperimentRoot(t);
  // One declared constructor, so the claim it is supposed to demonstrate is false of it.
  const target = path.join(root, 'java', 'ManyConstructors.java');
  fs.writeFileSync(target, `public class ManyConstructors {
  private final String origin;
  ManyConstructors() { this.origin = "no-arg"; }
  String origin() { return this.origin; }
  public static void main(String[] args) {
    System.out.println("CONSTRUCTED|" + new ManyConstructors().origin());
    System.out.println("DECLARED|" + ManyConstructors.class.getDeclaredConstructors().length);
  }
}
`);
  await assert.rejects(() => runPair({ language: 'java', root, claim: 'Any class can have more than one constructor.' }), /assertion failed/);

  // And the same for JavaScript: the positive fixture replaced by the mutating control.
  const jsRoot = temporaryExperimentRoot(t);
  fs.copyFileSync(path.join(jsRoot, 'javascript', 'mutatingLoop.js'), path.join(jsRoot, 'javascript', 'mapReturnsNewArray.js'));
  await assert.rejects(() => runPair({ language: 'javascript', root: jsRoot, claim: 'map returns a new array' }), /assertion failed/);
});

test('a control that cannot fail invalidates the experiment', async (t) => {
  const root = temporaryExperimentRoot(t);
  // The negative control is given several constructors, so it now satisfies the property it
  // exists to fail. An experiment whose control passes has isolated nothing, so it must refuse
  // even though the positive fixture is untouched and still correct.
  fs.writeFileSync(path.join(root, 'java', 'OneConstructor.java'), `public class OneConstructor {
  private final String origin;
  OneConstructor() { this.origin = "no-arg"; }
  OneConstructor(int count) { this.origin = "int:" + count; }
  String origin() { return this.origin; }
  public static void main(String[] args) {
    System.out.println("CONSTRUCTED|" + new OneConstructor().origin());
    System.out.println("CONSTRUCTED|" + new OneConstructor(1).origin());
    System.out.println("DECLARED|" + OneConstructor.class.getDeclaredConstructors().length);
  }
}
`);
  await assert.rejects(() => runPair({ language: 'java', root, claim: 'Any class can have more than one constructor.' }), /assertion failed/);
});

test('an unregistered language fails closed instead of borrowing another harness', () => {
  assert.deepEqual(Object.keys(CONFIGURATIONS).sort(), ['java', 'javascript']);
  assert.throws(() => harnessesForDeclaration({ language: 'cobol', claim: 'x' }, { projectId: PROJECT }), /CRU-0050.*No controlled experiment harness is registered for cobol/s);
  // The default must not quietly become JavaScript for a claim in some other language, which is
  // how a Java claim came to be "proved" by an array-map script.
  assert.throws(() => harnessesForDeclaration({ language: 'python', claim: 'x' }, { projectId: PROJECT }), /CRU-0050/);
});

test('the supersession pair resolves only when used and refuses without a language', async () => {
  let resolutions = 0;
  const unused = lazyHarnessPair({ projectId: PROJECT, at: AT, resolveLanguage: () => { resolutions += 1; return 'java'; } });
  assert.equal(typeof unused.experiment.run, 'function');
  assert.equal(resolutions, 0, 'constructing the pair must not build a harness; R7 often never needs one');

  const missing = lazyHarnessPair({ projectId: PROJECT, at: AT, resolveLanguage: () => null });
  await assert.rejects(() => missing.experiment.run({}), /CRU-0050.*without a language/s);
});

test('the fixture hash covers fixture content, so a changed fixture is a changed contract', (t) => {
  const root = temporaryExperimentRoot(t);
  const files = ['java/ManyConstructors.java', 'java/OneConstructor.java'];
  const before = fixtureSha256(root, files);
  assert.match(before, /^[a-f0-9]{64}$/);
  assert.equal(fixtureSha256(root, [...files].reverse()), before, 'ordering is canonical, not incidental');
  fs.appendFileSync(path.join(root, 'java', 'OneConstructor.java'), '// touched\n');
  assert.notEqual(fixtureSha256(root, files), before, 'a fixture edit must change the contract it is pinned by');
});
