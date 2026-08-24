const fs = require('node:fs');
const path = require('node:path');
const { verifyConfigurationDigest } = require('./integrity');

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
  const evidence = command.evidence || [];
  assert(Array.isArray(evidence) && evidence.every((item) => typeof item === 'string' && item && !path.isAbsolute(item) && !item.split(/[\\/]/).includes('..')), `${section}[${index}].evidence must contain safe repository-relative files.`);
  return { name:command.name.trim(), run:command.run.trim(), args:command.args || [], cwd:command.cwd || '.', evidence };
}

function validateExceptions(entries, label) {
  assert(Array.isArray(entries) && entries.length <= 100, `${label} must contain at most 100 path exceptions.`);
  for (const entry of entries) {
    if (typeof entry === 'string') assert(entry, `${label} contains an empty path.`);
    else {
      assert(isObject(entry) && typeof entry.path === 'string' && entry.path, `${label} exception.path is required.`);
      assert(entry.reason === undefined || typeof entry.reason === 'string', `${label} exception.reason must be a string.`);
      assert(entry.owner === undefined || typeof entry.owner === 'string', `${label} exception.owner must be a string.`);
      assert(entry.expires === undefined || /^\d{4}-\d{2}-\d{2}$/.test(entry.expires), `${label} exception.expires must be YYYY-MM-DD.`);
      assert(entry.sha256 === undefined || /^[a-f0-9]{64}$/i.test(entry.sha256), `${label} exception.sha256 must be a SHA-256 digest.`);
    }
  }
  return entries;
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
  validateExceptions(allow, 'clutter.allow');
  const privacy = input.privacy;
  assert(isObject(privacy) && typeof privacy.githubIdentity === 'string', 'privacy.githubIdentity is required.');
  assert(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(privacy.githubIdentity), 'privacy.githubIdentity must be a valid GitHub username.');
  const privacyAllow = privacy.allow || [];
  validateExceptions(privacyAllow, 'privacy.allow');
  const workload = isObject(input.workload) ? input.workload : {};
  const execution = isObject(workload.execution) ? workload.execution : {};
  assert(['allow', 'deny'].includes(execution.network || 'allow'), 'workload.execution.network must be allow or deny.');
  for (const [key, maximum] of [['memoryMb', 65536], ['fileSizeMb', 102400], ['processes', 4096]]) if (execution[key] !== undefined) assert(Number.isInteger(execution[key]) && execution[key] >= 1 && execution[key] <= maximum, `workload.execution.${key} is outside its safe bounds.`);
  const security = isObject(input.security) ? input.security : {};
  const securityAllow = security.allow || [];
  const allowBinaries = security.allowBinaries || [];
  const dependencyAudit = security.dependencyAudit || [];
  const provenanceAudit = security.provenanceAudit || [];
  const dependencyPolicy = isObject(security.dependencyPolicy) ? security.dependencyPolicy : {};
  const authenticity = isObject(input.authenticity) ? input.authenticity : {};
  const claims = authenticity.claims || [];
  const reproducibility = isObject(input.reproducibility) ? input.reproducibility : {};
  const reproductionCommands = reproducibility.commands || [];
  const reproductionArtifacts = reproducibility.artifacts || [];
  assert(security.enabled === undefined || typeof security.enabled === 'boolean', 'security.enabled must be a boolean.');
  validateExceptions(securityAllow, 'security.allow');
  validateExceptions(allowBinaries, 'security.allowBinaries');
  assert(Array.isArray(dependencyAudit) && dependencyAudit.length <= 10, 'security.dependencyAudit must contain at most 10 commands.');
  assert(Array.isArray(provenanceAudit) && provenanceAudit.length <= 10, 'security.provenanceAudit must contain at most 10 commands.');
  assert(Array.isArray(dependencyPolicy.allowedRegistryHosts || []) && (dependencyPolicy.allowedRegistryHosts || []).every((item) => typeof item === 'string' && item), 'security.dependencyPolicy.allowedRegistryHosts must contain host names.');
  assert(Array.isArray(dependencyPolicy.denyLicenses || []) && (dependencyPolicy.denyLicenses || []).every((item) => typeof item === 'string' && item), 'security.dependencyPolicy.denyLicenses must contain license identifiers.');
  assert(Array.isArray(claims) && claims.length <= 30, 'authenticity.claims must contain at most 30 evidence commands.');
  assert(Array.isArray(reproductionCommands) && reproductionCommands.length <= 30, 'reproducibility.commands must contain at most 30 commands.');
  assert(Array.isArray(reproductionArtifacts) && reproductionArtifacts.every((item) => typeof item === 'string' && item && !path.isAbsolute(item) && !item.split(/[\\/]/).includes('..')), 'reproducibility.artifacts must contain safe paths.');
  return {
    schemaVersion:1,
    project:{ name:input.project.name.trim(), projectId:input.project.projectId || null },
    commands:{ prepare:prepare.map((item, index) => validateCommand(item, 'commands.prepare', index)), verify:verify.map((item, index) => validateCommand(item, 'commands.verify', index)) },
    artifacts,
    clutter:{ allow, allowDuplicateContent:Boolean(clutter.allowDuplicateContent), blockTrackedIgnored:Boolean(clutter.blockTrackedIgnored) },
    privacy:{ githubIdentity:privacy.githubIdentity, scanContactInformation:Boolean(privacy.scanContactInformation), allow:privacyAllow },
    security:{
      enabled:security.enabled !== false,
      allow:securityAllow,
      allowBinaries,
      maxTextBytes:boundedInteger(security.maxTextBytes, 1_048_576, 1024, 5_242_880, 'security.maxTextBytes'),
      dependencyAudit:dependencyAudit.map((item, index) => validateCommand(item, 'security.dependencyAudit', index)),
      provenanceAudit:provenanceAudit.map((item, index) => validateCommand(item, 'security.provenanceAudit', index)),
      dependencyPolicy:{ enabled:Boolean(dependencyPolicy.enabled), denyGit:dependencyPolicy.denyGit !== false, denyHttp:dependencyPolicy.denyHttp !== false, denyLocal:Boolean(dependencyPolicy.denyLocal), allowedRegistryHosts:dependencyPolicy.allowedRegistryHosts || [], denyLicenses:dependencyPolicy.denyLicenses || [] },
    },
    authenticity:{ claims:claims.map((item, index) => validateCommand(item, 'authenticity.claims', index)), requireArtifacts:Boolean(authenticity.requireArtifacts) },
    governance:{ requireExceptionMetadata:Boolean(input.governance?.requireExceptionMetadata), failOnDisabledSecurity:input.governance?.failOnDisabledSecurity !== false },
    reproducibility:{ enabled:Boolean(reproducibility.enabled), commands:reproductionCommands.map((item, index) => validateCommand(item, 'reproducibility.commands', index)), artifacts:reproductionArtifacts },
    workload:{
      workers:boundedInteger(workload.workers, 4, 1, 8, 'workload.workers'),
      cycles:boundedInteger(workload.cycles, 2, 1, 20, 'workload.cycles'),
      timeoutMinutes:boundedInteger(workload.timeoutMinutes, 4, 1, 30, 'workload.timeoutMinutes'),
      maxOutputBytes:boundedInteger(workload.maxOutputBytes, 1_048_576, 4096, 10_485_760, 'workload.maxOutputBytes'),
      execution:{ network:execution.network || 'allow', memoryMb:execution.memoryMb || null, fileSizeMb:execution.fileSizeMb || null, processes:execution.processes || null, denyBackground:execution.denyBackground !== false },
    },
  };
}

function loadConfig(root, configPath = '.thecrucible.json') {
  const target = path.resolve(root, configPath);
  assert(target.startsWith(`${path.resolve(root)}${path.sep}`), 'Configuration path escapes the repository.');
  assert(fs.existsSync(target), `${configPath} is required.`);
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  verifyConfigurationDigest(parsed);
  return validateConfig(parsed);
}

module.exports = { loadConfig, validateConfig };
