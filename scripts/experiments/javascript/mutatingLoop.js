'use strict';
// Negative control, and it must FAIL the expected property: this mutates in place and hands back
// the very same reference, so IDENTITY is same-reference and INPUT has changed.
const input = [1, 2, 3];
for (let index = 0; index < input.length; index += 1) input[index] = input[index] * 2;
const output = input;
process.stdout.write(`IDENTITY|${output === input ? 'same-reference' : 'distinct-reference'}\n`);
process.stdout.write(`INPUT|${JSON.stringify(input)}\n`);
process.stdout.write(`OUTPUT|${JSON.stringify(output)}\n`);
process.stdout.write(`EMPTY|${JSON.stringify([].map((value) => value))}\n`);
