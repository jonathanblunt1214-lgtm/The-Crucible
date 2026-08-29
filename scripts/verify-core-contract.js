'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const corePath = process.argv[2];
if (!corePath) throw new Error('Usage: node scripts/verify-core-contract.js <canonical scientificLearning.js>');
const resolvedCore = path.resolve(corePath);
if (!fs.existsSync(resolvedCore)) throw new Error(`Canonical scientific-learning module not found: ${resolvedCore}`);

const pluginSource = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');
const context = {
  register() {},
  nexus: { call: async () => ({}), emitTelemetry() {} },
  crypto: require('node:crypto').webcrypto,
  TextEncoder,
  TextDecoder,
  btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
  atob(value) { return Buffer.from(value, 'base64').toString('binary'); }
};
vm.runInNewContext(`${pluginSource}\n;globalThis.__learningContract={states:LEARNING_STATES,gates:REQUIRED_LEARNING_GATES,prohibited:PROHIBITED_PROMOTION_KINDS};`, context, { filename: 'index.js' });
const coreSource = fs.readFileSync(resolvedCore, 'utf8');
function coreArray(name) {
  const match = coreSource.match(new RegExp(`const ${name} = Object\\.freeze\\((\\[[\\s\\S]*?\\])\\);`));
  if (!match) throw new Error(`Canonical scientific-learning ${name} contract was not found.`);
  return vm.runInNewContext(match[1], Object.create(null));
}
const normalize = (value) => JSON.parse(JSON.stringify(value));
const assertions = [
  ['states', normalize(coreArray('STATES')), normalize(context.__learningContract.states)],
  ['required gates', normalize(coreArray('REQUIRED_GATES')), normalize(context.__learningContract.gates)],
  ['prohibited promotion kinds', normalize(coreArray('PROHIBITED_PROMOTION_KINDS')), normalize(context.__learningContract.prohibited)]
];
for (const [label, expected, actual] of assertions) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Plugin scientific-learning ${label} drifted from canonical main.`);
}
console.log('[The Crucible Nexus plugin] canonical scientific-learning contract parity passed.');
