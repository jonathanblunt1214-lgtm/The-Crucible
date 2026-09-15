const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scopesOverlap, pathsOverlap, validateClaim, auditMutationClaims,
  assertMutationAllowed, acquireClaim, releaseClaim, handOffClaim, claimCovering,
} = require('../src/mutationClaims');

const OPENAI = { provider: 'openai', model: 'example', agent: 'session-a' };
const ANTHROPIC = { provider: 'anthropic', model: 'example', agent: 'session-b' };

function claim(taskId, owner, scope, overrides = {}) {
  return { taskId, owner, scope, purpose: `work on ${taskId}`, status: 'active', acquiredAt: '2026-09-03T17:00:00Z', handedOffTo: null, releasedAt: null, ...overrides };
}

test('a directory claim and a file claim beneath it are the same lock at two widths', () => {
  assert.equal(pathsOverlap('src/', 'src/a.js'), true);
  assert.equal(pathsOverlap('src/a.js', 'src'), true);
  assert.equal(pathsOverlap('src/a.js', 'src/b.js'), false);
  // "src" must not be treated as a prefix of "srcfoo".
  assert.equal(pathsOverlap('src', 'srcfoo/a.js'), false);
});

test('two AIs cannot hold overlapping active mutation claims', () => {
  const claims = [claim('task-a', OPENAI, { paths: ['src/extractor.js'] }), claim('task-b', ANTHROPIC, { paths: ['src/'] })];
  const audit = auditMutationClaims(claims);
  const overlap = audit.findings.filter((item) => item.type === 'Overlapping mutation claim');
  assert.equal(overlap.length, 1);
  assert.match(overlap[0].detail, /task-a/);
  assert.match(overlap[0].detail, /task-b/);
});

test('non-overlapping mutation claims are allowed', () => {
  const claims = [claim('task-a', OPENAI, { paths: ['src/extractor.js'] }), claim('task-b', ANTHROPIC, { paths: ['src/retriever.js'] })];
  const audit = auditMutationClaims(claims);
  assert.deepEqual(audit.findings, []);
  assert.equal(audit.active, 2);
});

test('overlapping line regions in one file collide, and disjoint ones do not', () => {
  const a = { regions: [{ path: 'src/x.js', startLine: 10, endLine: 40 }] };
  const b = { regions: [{ path: 'src/x.js', startLine: 35, endLine: 60 }] };
  const c = { regions: [{ path: 'src/x.js', startLine: 41, endLine: 60 }] };
  assert.ok(scopesOverlap(a, b));
  assert.equal(scopesOverlap(a, c), null);
  // A whole-file claim swallows any region inside it.
  assert.ok(scopesOverlap({ paths: ['src/x.js'] }, c));
});

test('acquiring a claim over a held scope is refused with its failure code', () => {
  const held = [claim('task-a', OPENAI, { paths: ['src/extractor.js'] })];
  assert.throws(
    () => acquireClaim(held, claim('task-b', ANTHROPIC, { paths: ['src/'] })),
    (error) => error.crucibleCode === 'CRU-0029' && /already held by openai/.test(error.message),
  );
});

test('read, review and test activity is allowed on another AI\'s claimed scope', () => {
  const claims = [claim('task-a', OPENAI, { paths: ['src/extractor.js'] })];
  // Nothing here calls assertMutationAllowed: reading is not gated at all, which is the point.
  assert.ok(claimCovering(claims, 'src/extractor.js'));
  // And a mutation by the holder itself is permitted.
  assert.deepEqual(assertMutationAllowed({ claims, actor: OPENAI, paths: ['src/extractor.js'] }), { allowed: true, paths: ['src/extractor.js'] });
});

test('a second AI may not mutate a scope claimed by the first', () => {
  const claims = [claim('task-a', OPENAI, { paths: ['src/extractor.js'] })];
  assert.throws(
    () => assertMutationAllowed({ claims, actor: ANTHROPIC, paths: ['src/extractor.js'] }),
    (error) => error.crucibleCode === 'CRU-0030' && /may read, test, review, critique and propose/.test(error.message),
  );
});

test('ownership can be explicitly handed off, and the successor may then mutate', () => {
  let claims = [claim('task-a', OPENAI, { paths: ['src/extractor.js'] })];
  claims = handOffClaim(claims, 'task-a', { to: ANTHROPIC, at: '2026-09-03T18:00:00Z', taskId: 'task-b', purpose: 'continue the repair' });
  const previous = claims.find((item) => item.taskId === 'task-a');
  assert.equal(previous.status, 'handed-off');
  assert.equal(previous.handedOffTo.provider, 'anthropic');
  assert.equal(previous.releasedAt, '2026-09-03T18:00:00Z');
  // Exactly one active claim survives the transfer, so the scope is never doubly held.
  assert.deepEqual(auditMutationClaims(claims).findings, []);
  assert.equal(auditMutationClaims(claims).active, 1);
  assert.ok(assertMutationAllowed({ claims, actor: ANTHROPIC, paths: ['src/extractor.js'] }).allowed);
  assert.throws(() => assertMutationAllowed({ claims, actor: OPENAI, paths: ['src/extractor.js'] }), (error) => error.crucibleCode === 'CRU-0030');
});

test('releasing a claim frees the scope for another AI', () => {
  let claims = [claim('task-a', OPENAI, { paths: ['src/extractor.js'] })];
  claims = releaseClaim(claims, 'task-a', '2026-09-03T18:00:00Z');
  assert.equal(claims[0].status, 'released');
  assert.ok(assertMutationAllowed({ claims, actor: ANTHROPIC, paths: ['src/extractor.js'] }).allowed);
});

test('a contested mutation is blocked while unrelated work continues', () => {
  const conflicts = [{ id: 'extractor-approach', status: 'open', contestedScope: { paths: ['src/extractor.js'] } }];
  assert.throws(
    () => assertMutationAllowed({ claims: [], conflicts, actor: OPENAI, paths: ['src/extractor.js'] }),
    (error) => error.crucibleCode === 'CRU-0031' && /frozen by unresolved AI conflict/.test(error.message),
  );
  // The freeze is scoped to what is contested; everything else keeps moving.
  assert.ok(assertMutationAllowed({ claims: [], conflicts, actor: OPENAI, paths: ['src/retriever.js'] }).allowed);
  // A resolved conflict freezes nothing.
  const resolved = [{ id: 'extractor-approach', status: 'resolved', contestedScope: { paths: ['src/extractor.js'] } }];
  assert.ok(assertMutationAllowed({ claims: [], conflicts: resolved, actor: OPENAI, paths: ['src/extractor.js'] }).allowed);
});

test('a claim missing its identifying fields is rejected', () => {
  assert.ok(validateClaim({}).length >= 4);
  assert.deepEqual(validateClaim(claim('task-a', OPENAI, { paths: ['src/a.js'] })), []);
  assert.ok(validateClaim(claim('task-a', OPENAI, { paths: [] })).some((item) => /at least one path or code region/.test(item)));
  assert.ok(validateClaim(claim('task-a', OPENAI, { paths: ['src/a.js'] }, { status: 'released', releasedAt: null })).some((item) => /releasedAt is required/.test(item)));
});
