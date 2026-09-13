const test = require('node:test');
const assert = require('node:assert/strict');
const { documentFurniture, repeatedCapitalisedLabel, capitalisedLabelRatio } = require('../src/documentFurniture');
const { boundedAssertions } = require('../src/claimExtractionWorker');

// Every one of these was extracted from the real corpus as a bounded assertion, and each is
// document furniture. They are the reason all nineteen claims the corpus corroborated were
// footers: furniture is the text that repeats across independently retrieved documents.
const FURNITURE = [
  'Bash Notes for Professionals Bash Notes for Professionals GoalKicker.com Free Programming Books Disclaimer This is an unofficial free book created for educational purposes and is not affiliated with official Bash group(s) or company(s).',
  'Footer navigation Terms Privacy Security Status Community Docs Contact Manage cookies Do not share my personal information You can not perform that action at this time.',
  'Cancel Agree & Download You are one step away from downloading ebooks from the Succinctly series premier collection!',
  'Essential Javascript - a free JavaScript programming book Essential Javascript Essential Javascript is a free book about JavaScript programming language.',
  'Open the download library Your email is stored on a secure server in the EU.',
  'Unsubscribing stops future emails; you can keep using the public download library.',
  'All trademarks and registered trademarks are the property of their respective owners 100+ pages of professional hints and tricks Contents About 1 ...................................................',
  'Download Microsoft Edge More info about Internet Explorer and Microsoft Edge Table of contents Exit editor mode Ask Learn Ask Learn Reading mode Table of contents Read in English Add Add to Plans Copy Markdown Print Note Access to this page requires authorization.',
  'Images may be copyright of their respective owners unless otherwise specified This is an unofficial free book created for educational purposes and is not affiliated with official Java group(s) or company(s) nor Stack Overflow.',
  'My Dashboard SIGN OUT Home Xamarin.Forms for macOS Succinctly Xamarin.Forms for macOS Succinctly Alessandro Del Sole This ebook is part of our premier ebook collection.',
  'Text content is released under Creative Commons BY-SA, see credits at the end of this book whom contributed to the various chapters.',
  'Upgrade to Microsoft Edge to take advantage of the latest features, security updates, and technical support.',
  'We are sorry, but your browser is no longer supported by Smashwords.',
];

// The half that matters more. A filter that rejects furniture by rejecting its subject matter
// would narrow what the machine may ever learn, which is the opposite of the point. Each of
// these shares vocabulary with the furniture above and must survive.
const CLAIMS = [
  'The map method returns a new array and does not modify the original array.',
  'A cookie is set by the Set-Cookie response header and returned in the Cookie request header.',
  'The Java Virtual Machine Specification defines the class file format for compiled classes.',
  'You can use the filter method to select elements that satisfy a predicate.',
  'Text encoded in UTF-8 uses one to four bytes per code point.',
  'The Creative Commons Attribution licence requires attribution to the original author.',
  'The gap between platform operating systems, programming languages, and devices is an immense obstacle.',
  'Ideally, these developers would be able to use their existing skills and knowledge to build native mobile apps.',
  'A HashMap in Java permits one null key and any number of null values.',
  'The browser applies the Content-Security-Policy header before any inline script is evaluated.',
  'An account is locked after five consecutive failed sign in attempts.',
];

test('every furniture sentence taken from the real corpus is rejected, with a stated reason', () => {
  for (const sentence of FURNITURE) {
    const decision = documentFurniture(sentence);
    assert.equal(decision.furniture, true, `not rejected: ${sentence.slice(0, 70)}`);
    assert.ok(decision.reasons.length > 0 && decision.reasons.every((reason) => typeof reason === 'string' && reason.trim()));
  }
});

test('claims sharing vocabulary with furniture are never rejected for their subject', () => {
  for (const sentence of CLAIMS) {
    const decision = documentFurniture(sentence);
    assert.equal(decision.furniture, false, `wrongly rejected: ${sentence.slice(0, 70)} :: ${decision.reasons[0]}`);
  }
});

test('a capitalised label run is a menu, ordinary title case is not', () => {
  assert.ok(capitalisedLabelRatio('Terms Privacy Security Status Community Docs Contact Manage').ratio > 0.55);
  assert.ok(capitalisedLabelRatio('The Java Virtual Machine Specification defines the class file format for compiled classes.').ratio < 0.55);
});

test('a proper noun repeated three times is a scraped heading, twice is ordinary prose', () => {
  assert.ok(repeatedCapitalisedLabel('A page about Javascript. Essential Javascript Essential Javascript is free.'));
  assert.equal(repeatedCapitalisedLabel('A cookie is set by the Set-Cookie header and returned in the Cookie header.'), null);
});

// The boundary of what this filter claims to do. Prose that is not a testable assertion still
// passes here; refusing it is the critical reviewer's job and the hypothesis contract's, not a
// wording filter's.
test('ordinary prose that is not a testable claim still passes, because that is a later judgement', () => {
  assert.equal(documentFurniture('It is written to provide a clear and concise explanation of topics for both beginner and advanced programmers.').furniture, false);
  assert.equal(documentFurniture('Most examples are linked to an online playground that allows you to change the code and re-run it.').furniture, false);
});

test('extraction no longer emits furniture as a bounded assertion', () => {
  const page = `${FURNITURE[1]} ${CLAIMS[0]} ${FURNITURE[12]} ${CLAIMS[4]}`;
  const extracted = boundedAssertions(page);
  assert.ok(extracted.includes(CLAIMS[0]), 'the real claim survives extraction');
  assert.ok(extracted.includes(CLAIMS[4]), 'so does the second');
  for (const furniture of [FURNITURE[1], FURNITURE[12]]) {
    assert.ok(!extracted.some((item) => item.includes(furniture.slice(0, 40))), 'no furniture reaches candidate custody');
  }
});
