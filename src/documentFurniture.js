// Telling a document's furniture apart from what it asserts.
//
// Extraction accepts any sentence containing is, are, uses, requires, can or must as a bounded
// assertion. That admits "Footer navigation Terms Privacy Security Status Community Docs
// Contact Manage cookies Do not share my personal information You can't perform that action at
// this time." - and furniture like that is exactly the text that repeats across independently
// retrieved documents, so it is what survives to corroborate. On the real corpus every one of
// the nineteen corroborated claims was furniture: disclaimers, footers, download gates,
// browser notices, front matter.
//
// The distinction drawn here is STRUCTURAL, never topical. Nothing is rejected for its subject,
// its source, or its publisher - that would narrow what the machine may ever learn, which is
// the opposite of the point. What is rejected is text whose job is to operate the page or
// licence the file rather than to say something about a subject:
//   - navigation and menus, recognised by a run of capitalised labels rather than a sentence;
//   - table-of-contents rows, recognised by leader dots and page-number runs;
//   - fixed legal boilerplate, matched as whole set phrases rather than by legal vocabulary;
//   - interface and consent text, recognised by an action addressed to the reader together
//     with an interface noun.
//
// The last two are deliberately narrow. "A cookie is set by the Set-Cookie response header" is
// a claim about HTTP and survives; "Manage cookies Do not share my personal information" is a
// consent bar and does not. "The Creative Commons Attribution licence requires attribution to
// the original author" is a claim about a licence and survives; "All trademarks and registered
// trademarks are the property of their respective owners" is a colophon and does not.
//
// This rejects furniture. It does not decide what is testable: ordinary prose that happens not
// to be a testable assertion still passes here and is refused later, by the critical reviewer
// and by whatever the experiment's hypothesis requires.

// Whole set phrases, not legal vocabulary. Each of these is boilerplate in the literal sense -
// the same fixed wording reused across unrelated documents - rather than a statement someone
// wrote about a licence.
const BOILERPLATE = [
  /\ball rights reserved\b/i,
  /\bproperty of their respective owners\b/i,
  /\bis an unofficial free book\b/i,
  /\bnot affiliated with official\b/i,
  /\bmay be copyright of their respective owners\b/i,
  /\bsee credits at the end of this book\b/i,
  /\bcompiled from stack overflow documentation\b/i,
  /\bfeel free to share this pdf\b/i,
  /\bterms of (?:service|use)\b.*\bprivacy\b/i,
  /\bthis (?:book|document) (?:is|was) created for educational purposes\b/i,
];

// An action addressed to the reader. On its own this proves nothing - "You can use map to
// transform an array" is second person and is a claim - so it must coincide with an interface
// noun AND with the reader actually being addressed. All three are needed: "An account is
// locked after five consecutive failed sign in attempts" has the action and the noun and is a
// claim about authentication, and the thing it lacks is a reader to address.
const READER_ACTION = /\b(?:sign in|sign out|log in|log out|click|tap here|subscribe|unsubscrib\w+|download|upgrade to|skip to content|manage cookies|add to cart|accept (?:all )?cookies|enable javascript|we(?:'re| are) sorry)\b/i;
const INTERFACE_NOUN = /\b(?:cookies?|newsletter|your email|email address|browser|account|dashboard|cart|download library|checkout|sign-?up|banner|pop-?up|navigation|footer|sidebar|menu|e-?books?)\b/i;

// A sentence that opens by telling the reader to operate something is an instruction, not an
// assertion about a subject. Assertions have a subject; these have an implied "you". Kept to
// interface verbs so that ordinary imperative prose in a specification is unaffected.
const OPENING_INSTRUCTION = /^\s*(?:upgrade to|download|sign in|sign out|log in|log out|click|subscribe|unsubscribe|cancel|accept|skip to|add to|open the|join|enable|manage|get started|learn more|read more|continue reading|share this)\b/i;

// Interface text speaks to whoever is looking at the page.
const SECOND_PERSON = /\b(?:you|your|yours|my|me|we(?:'re| are)? sorry)\b/i;

// Leader dots and page-number runs: a contents row rather than a sentence.
const CONTENTS_ROW = /\.{4,}|…{2,}|\s\d+\s*\.{3,}/;

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

// Capitalised labels strung together are a menu, not a sentence. Measured as a ratio over
// content words rather than a run length, so "The Java Virtual Machine Specification defines
// the class file format" stays well under the threshold while a row of menu labels does not.
// The first word of each sentence is skipped: its capital is grammar.
function capitalisedLabelRatio(text) {
  let capitalised = 0;
  let counted = 0;
  for (const sentence of String(text || '').split(SENTENCE_SPLIT)) {
    const tokens = sentence.trim().split(/\s+/).filter(Boolean);
    for (const [index, raw] of tokens.entries()) {
      const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (token.length < 2 || !/[A-Za-z]/.test(token)) continue;
      counted += 1;
      if (index > 0 && /^[A-Z]/.test(token)) capitalised += 1;
    }
  }
  return { ratio: counted ? capitalised / counted : 0, counted };
}

// A page title scraped together with its own headings repeats the same capitalised word several
// times in one "sentence" - "Essential Javascript ... Essential Javascript Essential Javascript
// is a free book about JavaScript". Ordinary prose does not repeat a proper noun three times.
const REPEATED_LABEL_MINIMUM = 3;
function repeatedCapitalisedLabel(text) {
  const counts = new Map();
  for (const sentence of String(text || '').split(SENTENCE_SPLIT)) {
    const tokens = sentence.trim().split(/\s+/).filter(Boolean);
    for (const [index, raw] of tokens.entries()) {
      if (index === 0) continue;
      const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (token.length < 3 || !/^[A-Z]/.test(token)) continue;
      const key = token.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= REPEATED_LABEL_MINIMUM);
  return repeated.sort((a, b) => b[1] - a[1])[0] || null;
}

const NAVIGATION_RATIO = 0.55;
const NAVIGATION_MINIMUM_WORDS = 6;

// Whether a sentence is part of the document's furniture rather than something it asserts.
// Returns every reason that applied, so a rejection can be read rather than guessed at.
function documentFurniture(sentence) {
  const text = String(sentence || '');
  const reasons = [];

  const { ratio, counted } = capitalisedLabelRatio(text);
  if (counted >= NAVIGATION_MINIMUM_WORDS && ratio >= NAVIGATION_RATIO) {
    reasons.push(`${Math.round(ratio * 100)}% of its words are capitalised labels rather than a sentence, which is a menu or heading run`);
  }
  if (CONTENTS_ROW.test(text)) {
    reasons.push('it carries leader dots or a page-number run, which is a table-of-contents row');
  }
  const boilerplate = BOILERPLATE.find((pattern) => pattern.test(text));
  if (boilerplate) {
    reasons.push('it is fixed legal or colophon boilerplate reused verbatim across unrelated documents');
  }
  const repeated = repeatedCapitalisedLabel(text);
  if (repeated) {
    reasons.push(`the label "${repeated[0]}" repeats ${repeated[1]} times, which is a page title scraped together with its own headings`);
  }
  if (OPENING_INSTRUCTION.test(text)) {
    reasons.push('it opens by telling the reader to operate something, so it is an instruction rather than an assertion about a subject');
  }
  if (READER_ACTION.test(text) && INTERFACE_NOUN.test(text) && SECOND_PERSON.test(text)) {
    reasons.push('it is interface or consent text: an action addressed to the reader together with an interface element');
  }

  return { furniture: reasons.length > 0, reasons };
}

module.exports = { documentFurniture, capitalisedLabelRatio, repeatedCapitalisedLabel, BOILERPLATE, NAVIGATION_RATIO, NAVIGATION_MINIMUM_WORDS };
