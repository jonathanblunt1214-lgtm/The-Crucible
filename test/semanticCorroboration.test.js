const test = require('node:test');
const assert = require('node:assert/strict');
const { claimFingerprint, claimEntities, semanticallyCorroborates, groupCorroborating, DEFAULT_MINIMUM_OVERLAP } = require('../src/semanticCorroboration');

const MAP_A = 'The map method returns a new array and does not modify the original array.';
const MAP_B = 'The map method returns a new array and does not change the original array.';
const MAP_PARAPHRASE = 'A map method call returns new arrays and does not modify original arrays.';
const MAP_OPPOSITE = 'The map method returns a new array and does modify the original array.';

test('a claim is reduced to polarity, numbers, and content terms', () => {
  const fingerprint = claimFingerprint(MAP_A);
  assert.equal(fingerprint.negated, true, 'the claim asserts something does not happen');
  assert.deepEqual(fingerprint.numbers, []);
  assert.ok(fingerprint.terms.includes('map'));
  assert.ok(fingerprint.terms.includes('array'), 'plurals collapse to one term');
  assert.ok(!fingerprint.terms.includes('the'), 'stopwords carry no subject matter');
  assert.ok(!fingerprint.terms.includes('not'), 'polarity is not subject matter');
});

test('a double negative reads as affirmative rather than negative', () => {
  assert.equal(claimFingerprint('The call does not fail.').negated, true);
  assert.equal(claimFingerprint('The call does not never fail.').negated, false);
  assert.equal(claimFingerprint('The call succeeds.').negated, false);
});

// The failure that would matter most: two claims that share almost every word and mean
// opposite things must never be treated as agreement.
test('never corroborates across a negation, however similar the wording', () => {
  const decision = semanticallyCorroborates(MAP_A, MAP_OPPOSITE);
  assert.equal(decision.corroborates, false);
  assert.match(decision.reason, /opposite polarity/);

  const overlap = semanticallyCorroborates(MAP_A, MAP_A).overlap;
  assert.equal(overlap, 1, 'the two differ only in polarity, so wording alone would have matched');
});

test('never corroborates across different numbers', () => {
  const decision = semanticallyCorroborates(
    'The retry policy attempts the request 3 times before failing the operation.',
    'The retry policy attempts the request 5 times before failing the operation.',
  );
  assert.equal(decision.corroborates, false);
  assert.match(decision.reason, /different numbers/);
});

test('refuses to judge sentences too short to carry meaning', () => {
  const decision = semanticallyCorroborates('It returns quickly.', 'It returns quickly.');
  assert.equal(decision.corroborates, false);
  assert.match(decision.reason, /content terms are required/);
});

test('corroborates genuine paraphrase between independently written sentences', () => {
  const decision = semanticallyCorroborates(MAP_A, MAP_PARAPHRASE);
  assert.equal(decision.corroborates, true, decision.reason);
  assert.ok(decision.overlap >= DEFAULT_MINIMUM_OVERLAP);
  assert.ok(decision.sharedTerms.includes('map'));
});

test('does not corroborate unrelated claims of the same polarity that share a few common words', () => {
  // Same polarity as MAP_A, so this reaches the overlap test rather than stopping at polarity.
  const decision = semanticallyCorroborates(MAP_A, 'The socket connection does not reuse an existing timeout handler between separate requests.');
  assert.equal(decision.corroborates, false);
  assert.match(decision.reason, /overlap/);

  // And an affirmative unrelated claim is rejected earlier still, on polarity.
  const affirmative = semanticallyCorroborates(MAP_A, 'The filter method returns a new array containing every element that satisfies the predicate.');
  assert.equal(affirmative.corroborates, false);
  assert.match(affirmative.reason, /opposite polarity/);
});

test('is symmetric and deterministic', () => {
  const pairs = [[MAP_A, MAP_B], [MAP_A, MAP_OPPOSITE], [MAP_A, MAP_PARAPHRASE], [MAP_B, 'Something entirely different about network sockets and timeouts.']];
  for (const [left, right] of pairs) {
    const forward = semanticallyCorroborates(left, right);
    const backward = semanticallyCorroborates(right, left);
    assert.equal(forward.corroborates, backward.corroborates, 'order must not change the decision');
    const repeat = semanticallyCorroborates(left, right);
    assert.deepEqual(forward, repeat, 'the same input must always give the same result');
  }
});

// The property that makes a wording judgement acceptable here at all.
test('corroboration never satisfies proof, verification, or promotion', () => {
  for (const decision of [semanticallyCorroborates(MAP_A, MAP_PARAPHRASE), semanticallyCorroborates(MAP_A, MAP_OPPOSITE)]) {
    assert.equal(decision.proofStageSatisfied, false);
    assert.equal(decision.independentVerificationSatisfied, false);
    assert.equal(decision.promotionAuthorized, false);
  }
});

test('groups agreeing claims and keeps contradictions apart, in a stable order', () => {
  const entries = [
    { id: 'c-3', claim: MAP_PARAPHRASE },
    { id: 'c-1', claim: MAP_A },
    { id: 'c-2', claim: MAP_OPPOSITE },
    { id: 'c-4', claim: MAP_B },
  ];
  const groups = groupCorroborating(entries);
  const agreeing = groups.find((group) => group.members.some((member) => member.id === 'c-1'));
  assert.ok(agreeing.members.length >= 2, 'the paraphrases group together');
  assert.ok(!agreeing.members.some((member) => member.id === 'c-2'), 'the opposite claim is never in the agreeing group');

  assert.deepEqual(groupCorroborating(entries), groups, 'grouping is deterministic');
  assert.deepEqual(groupCorroborating([...entries].reverse()), groups, 'input order does not change the grouping');
});

// Found by running against the real corpus, not by imagining a case. All four of these were
// reported as one claim and are not: the substituted name sat inside enough shared boilerplate
// to carry the overlap score. A test that cannot see a changed subject corroborates a template
// with itself.
test('never corroborates claims that name different subjects', () => {
  // Each of these is still refused, and now each says which of the two things went wrong: a name
  // swapped for another in the same slot, or one skeleton filled twice. Asserting the exact reason
  // is stricter than asserting a shared one, because it would catch a refusal made for the wrong
  // cause - which is how the earlier rule refused every genuine agreement as well.
  const cases = [
    ['Essential Javascript - a free JavaScript programming book Essential Javascript is a free book about JavaScript programming language.',
     'Essential C# - a free C# programming book Essential C# is a free book about C# programming language.', /name different subjects/, /javascript.*c#|c#.*javascript/],
    ['This is an unofficial free book created for educational purposes and is not affiliated with official Bash group(s) or company(s).',
     'This is an unofficial free book created for educational purposes and is not affiliated with official TypeScript group(s) or company(s).', /name different subjects/, /bash|typescript/],
    ['My Dashboard Home Xamarin.Forms for macOS Succinctly Alessandro Del Sole This ebook is part of our premier ebook collection.',
     'My Dashboard Home Xamarin.Forms Succinctly Alessandro Del Sole This ebook is part of our premier ebook collection.', /one template filled differently/, /macos/],
  ];
  for (const [left, right, why, named] of cases) {
    const decision = semanticallyCorroborates(left, right);
    assert.equal(decision.corroborates, false, `must not corroborate: ${left}`);
    assert.match(decision.reason, why);
    assert.match(decision.reason.toLowerCase(), named, 'the reason names the subject that differs');
  }

  // The same sentence about the same subject is unaffected.
  const same = 'The Bash shell expands an unquoted variable into separate words on whitespace.';
  assert.equal(semanticallyCorroborates(same, 'A Bash shell expands the unquoted variable into separate words on whitespace.').corroborates, true);
});

test('a sentence-initial capital is grammar, not a named subject', () => {
  assert.deepEqual(claimEntities('The array is returned.'), []);
  assert.deepEqual(claimEntities('Calling map returns a JavaScript array.'), ['javascript']);
  assert.ok(claimEntities('It uses Xamarin.Forms and C# together.').includes('c#'));
  assert.ok(claimEntities('It uses Xamarin.Forms and C# together.').includes('xamarin.forms'));
});

// The rule that made independent agreement impossible by construction. Names had to match
// exactly, so one document mentioning the language or protocol it was talking about and another
// not mentioning it were "claims about different things" - and the reason it gave, "different
// subjects (tcp against none)", was not even true. Naming nothing extra is not naming a different
// subject. These pairs must now reach the wording judgement instead of being refused before it.
test('a one-sided name difference is context, not a different subject', () => {
  const pairs = [
    ['A TCP connection is established using a three-way handshake.',
     'TCP establishes a connection using a three-way handshake.'],
    ['The HTTP 404 status code indicates that the server cannot find the requested resource.',
     'HTTP 404 indicates the server cannot find the requested resource.'],
    ['Git stores each commit as a snapshot of the entire repository tree.',
     'In Git, every commit is stored as a snapshot of the whole repository tree.'],
  ];
  for (const [left, right] of pairs) {
    const decision = semanticallyCorroborates(left, right);
    assert.doesNotMatch(decision.reason, /name different subjects/, `refused for the wrong cause: ${left}`);
    assert.doesNotMatch(decision.reason, /one template filled differently/, `these differ in wording, not only in a name: ${left}`);
    // Whether they corroborate is the overlap threshold's call, and that is a separate question.
    assert.match(decision.reason, /content-term overlap/);
  }
});

// Bucketing decided which claims ever meet to be compared. While names were an absolute refusal
// they belonged in that key; now that a one-sided difference can still corroborate, leaving them
// there would silently prevent the comparison that decides the outcome.
test('grouping compares claims that mention different names', () => {
  // One document names the shell it is describing and the other does not, and they word the
  // action differently. Under the old rule these were placed in different buckets by the name
  // alone and never compared, so the wording judgement below could not run at all.
  const entries = [
    { id: 'a', claim: 'The Bash shell expands an unquoted shell variable into separate words on whitespace before the command runs inside the current interactive login environment.', sourceId: 's-1' },
    { id: 'b', claim: 'A shell splits the unquoted shell variable into separate words on whitespace before a command runs inside the current interactive login environment.', sourceId: 's-2' },
  ];
  const groups = groupCorroborating(entries);
  const together = groups.find((group) => group.members.length === 2);
  assert.ok(together, 'claims that agree must be compared rather than bucketed apart by a name');
  assert.equal(groups.length, 1);
});
