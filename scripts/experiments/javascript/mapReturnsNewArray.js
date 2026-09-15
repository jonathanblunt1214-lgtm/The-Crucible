'use strict';
// Experiment fixture for the claim that Array.prototype.map returns a new array and leaves the
// original untouched. Self-measuring for the same reason the Java fixture is: it reports what
// the runtime did rather than what the harness expected.
const input = [1, 2, 3];
const output = input.map((value) => value * 2);
process.stdout.write(`IDENTITY|${output === input ? 'same-reference' : 'distinct-reference'}\n`);
process.stdout.write(`INPUT|${JSON.stringify(input)}\n`);
process.stdout.write(`OUTPUT|${JSON.stringify(output)}\n`);
process.stdout.write(`EMPTY|${JSON.stringify([].map((value) => value))}\n`);
