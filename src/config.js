const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) { if (!condition) throw new Error(message); }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function validateCommand(command, section, index) {
  assert(isObject(command), `${section}[${index}] must be an object.`);
  assert(typeof command.name === 'string' && command.name.trim(), `${section}[${index}].name is required.`);
  assert(typeof command.run === 'string' && command.run.trim(), `${section}[${index}].run is required.`);
  assert(!/[\\/]/.test(command.run), `${section}[${index}].run must be an executable name, not a path.`);
  assert(command.args === undefined || (Array.isArray(command.args) && command.args.every((value) => typeof value === 'string')), `${section}[${index}].args must be strings.`);
  assert(command.cwd === undefined || (typeof command.cwd === 'string' && command.cwd.trim()), `${section}[${index}].cwd must be a relative path.`);
  if (command.cwd) assert(!path.isAbsolute(command.cwd) && !command.cwd.split(/[\\/]/).includes('..'), `${section}[${index}].cwd cannot escape the repository.`);
  return { name:command.name.trim(), run:command.run.trim(), args:command.args || [], cwd:command.cwd || '.' };
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const number = value === undefined ? fallback : value;
  assert(Number.isInteger(number) && number >= minimum && number <= maximum, `${label} must be an integer from ${minimum} through ${maximum}.`);
  return number;
}

function validateConfig(input) {
  assert(isObject(input), 'Configuration must be a JSON object.');
  assert(input.schemaVersion === 1, 'schemaVersion must be 1.');
  assert(isObject(input.project) && typeof input.project.name === 'string' && input.project.name.trim(), 'project.name is required.');
  assert(isObject(input.commands), 'commands is required.');
  const prepare = input.commands.prepare || [];
  const verify = input.commands.verify;
  assert(Array.isArray(prepare), 'commands.prepare must be an array.');
  assert(Array.isArray(verify) && verify.length, 'commands.verify must contain at least one command.');
  assert(prepare.length <= 30 && verify.length <= 30, 'Each command group supports at most 30 commands.');
  const artifacts = input.artifacts || [];
  assert(Array.isArray(artifacts) && artifacts.every((item) => typeof item === 'string' && item && !path.isAbsolute(item) && !item.split(/[\\/]/).includes('..')), 'artifacts must contain safe repository-relative paths.');
  const clutter = isObject(input.clutter) ? input.clutter : {};
  const allow = clutter.allow || [];
  assert(Array.isArray(allow) && allow.every((item) => typeof item === 'string' && item), 'clutter.allow must contain path patterns.');
  const workload = isObject(input.workload) ? input.workload : {};
  return {
    schemaVersion:1,
    project:{ name:input.project.name.trim(), projectId:input.project.projectId || null },
    commands:{ prepare:prepare.map((item, index) => validateCommand(item, 'commands.prepare', index)), verify:verify.map((item, index) => validateCommand(item, 'commands.verify', index)) },
    artifacts,
    clutter:{ allow, allowDuplicateContent:Boolean(clutter.allowDuplicateContent) },
    workload:{
      workers:boundedInteger(workload.workers, 4, 1, 8, 'workload.workers'),
      cycles:boundedInteger(workload.cycles, 2, 1, 20, 'workload.cycles'),
      timeoutMinutes:boundedInteger(workload.timeoutMinutes, 4, 1, 30, 'workload.timeoutMinutes'),
    },
  };
}

function loadConfig(root, configPath = '.thecrucible.json') {
  const target = path.resolve(root, configPath);
  assert(target.startsWith(`${path.resolve(root)}${path.sep}`), 'Configuration path escapes the repository.');
  assert(fs.existsSync(target), `${configPath} is required.`);
  return validateConfig(JSON.parse(fs.readFileSync(target, 'utf8')));
}

module.exports = { loadConfig, validateConfig };
