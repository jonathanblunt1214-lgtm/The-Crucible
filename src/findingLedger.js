'use strict';
// Durable memory for the one rule that makes a graduated response graduated.
//
// gradedOversightResponse already knows that a fault which returns after a repair must escalate
// rather than buy a second window. It could never act on that knowledge. The rule reads a
// `history` argument, that argument defaulted to none, and nothing in the running organism ever
// supplied it - so every recurrence arrived looking like a first occurrence, and the escalation
// branch was unreachable in practice. The rule was written down and not enforced.
//
// This is the missing half: the record that outlives the run. Two properties do the work.
//
//   - Append-only and hash-chained. A history the organism can edit is not a history *of* the
//     organism. A broken chain is read as tampering and refuses to answer at all, because the
//     dangerous failure here is not an error - it is a ledger that quietly reports a clean past.
//   - Keyed by findingId, which gradedOversightResponse content-addresses from the fault itself,
//     so the same fault described differently is still recognisably the same fault.
//
// Nothing here decides anything. It remembers, and hands what it remembers to the assessment.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { recordFinding, assessFinding } = require('./gradedOversightResponse');

const LEDGER_SCHEMA_VERSION = 1;
// The first link points at nothing, and says so in a way that cannot be confused with a hash.
const GENESIS = '0'.repeat(64);

const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const linkHash = ({ seq, previousSha256, record }) => sha256({ seq, previousSha256, record });

// An absent ledger is an organism with no recorded past, which is the honest reading of a first
// run. A present but broken one is the opposite of no history, and is never treated as none.
function readLedger(file) {
  if (!fs.existsSync(file)) return { schemaVersion: LEDGER_SCHEMA_VERSION, entries: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Finding ledger at ${file} is unreadable (${String(error.message || error)}); an unreadable history is not an empty one.`);
  }
  if (!parsed || parsed.schemaVersion !== LEDGER_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
    throw new Error(`Finding ledger at ${file} is not a ledger of schema version ${LEDGER_SCHEMA_VERSION}.`);
  }
  let previousSha256 = GENESIS;
  parsed.entries.forEach((entry, index) => {
    if (entry.seq !== index) throw new Error(`Finding ledger entry ${index} is out of sequence; an entry was inserted or removed.`);
    if (entry.previousSha256 !== previousSha256) throw new Error(`Finding ledger entry ${index} does not follow entry ${index - 1}; the chain was cut, so the recorded past cannot be trusted.`);
    if (entry.entrySha256 !== linkHash(entry)) throw new Error(`Finding ledger entry ${index} was rewritten after it was recorded; a repair history the organism can edit is not a history.`);
    previousSha256 = entry.entrySha256;
  });
  return parsed;
}

// One link. The record is whatever repairOutcome produced, kept whole rather than summarised,
// because the summary is what a later reader would have to trust instead of the evidence.
function appendOutcome({ file, outcome }) {
  if (!file) throw new Error('A ledger path is required; recurrence cannot be enforced against a history with nowhere to live.');
  if (!outcome || !outcome.findingId) throw new Error('An outcome carrying a recorded findingId is required.');
  const ledger = readLedger(file);
  const previous = ledger.entries.at(-1);
  const entry = {
    seq: ledger.entries.length,
    previousSha256: previous ? previous.entrySha256 : GENESIS,
    record: JSON.parse(JSON.stringify(outcome)),
  };
  entry.entrySha256 = linkHash(entry);
  const next = { schemaVersion: LEDGER_SCHEMA_VERSION, entries: [...ledger.entries, entry] };
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, file);
  return entry;
}

// Shaped for assessFinding, which asks two questions of each prior entry: was a repair attempted,
// and did anyone independent confirm it held.
function historyFor({ file, findingId }) {
  return readLedger(file).entries
    .map((entry) => entry.record)
    .filter((record) => record.findingId === findingId)
    .map((record) => ({
      findingId: record.findingId,
      attempted: Boolean(record.attempted),
      independentlyVerified: record.independentlyVerified,
      observedAt: record.observedAt,
    }));
}

// The wired path: record the fault, judge it against what actually happened before, and say so.
// The assessment is made against the history as it stood *before* this occurrence, because a
// fault cannot be evidence about itself.
function assessRecurrence({ file, kind, organ, boundary, detail, health = null, observedAt = new Date().toISOString(), maxAttempts }) {
  const finding = recordFinding({ kind, organ, boundary, detail, observedAt });
  const history = historyFor({ file, findingId: finding.findingId });
  const options = { finding, history, health };
  if (maxAttempts !== undefined) options.maxAttempts = maxAttempts;
  const decision = assessFinding(options);
  return { finding, history, decision, recurrence: history.length };
}

module.exports = { LEDGER_SCHEMA_VERSION, GENESIS, readLedger, appendOutcome, historyFor, assessRecurrence };
