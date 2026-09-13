const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { crucibleError } = require('./failureCodes');

const DEFAULT_REGISTRY = path.join(__dirname, '..', 'TASK-ROUTING.json');

function fail(message, extra = {}) {
  throw crucibleError('CRU-0045', message, extra);
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function loadTaskRouting(file = DEFAULT_REGISTRY) {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Cannot read the canonical task-routing registry at ${file}: ${error.message}`);
  }
  validateTaskRouting(registry);
  return registry;
}

function validateTaskRouting(registry) {
  if (!registry || registry.schemaVersion !== 1) fail('TASK-ROUTING.json must use schemaVersion 1.');
  const canonical = registry.canonical;
  if (!canonical || !Number.isSafeInteger(canonical.repositoryId) || canonical.repositoryId <= 0) fail('The canonical routing repository must carry a positive stable repositoryId.');
  if (typeof canonical.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(canonical.repository)) fail('The canonical routing repository must be owner/name.');
  if (canonical.branch !== 'development' || canonical.path !== 'TASK-ROUTING.json') fail('The canonical routing registry must remain development:TASK-ROUTING.json.');
  if (!Array.isArray(registry.repositories) || !registry.repositories.length) fail('At least one governed repository is required.');
  if (!Array.isArray(registry.categories) || !registry.categories.length) fail('At least one task category is required.');

  const repositoryIds = new Set();
  const repositoryNames = new Set();
  for (const repository of registry.repositories) {
    if (!Number.isSafeInteger(repository.id) || repository.id <= 0 || repositoryIds.has(repository.id)) fail('Repository IDs must be unique positive integers.');
    if (typeof repository.name !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repository.name) || repositoryNames.has(repository.name.toLowerCase())) fail('Repository names must be unique owner/name values.');
    if (!repository.branches || typeof repository.branches !== 'object' || Array.isArray(repository.branches)) fail(`Repository ${repository.name} has no branch registry.`);
    repositoryIds.add(repository.id);
    repositoryNames.add(repository.name.toLowerCase());
  }

  const categoryIds = new Set();
  for (const category of registry.categories) {
    if (!category || typeof category.id !== 'string' || !category.id.trim() || categoryIds.has(category.id)) fail('Task category IDs must be unique non-empty strings.');
    const repository = registry.repositories.find((candidate) => candidate.id === category.destination?.repositoryId);
    if (!repository) fail(`Category ${category.id} targets an unknown stable repository ID.`);
    if (!repository.branches[category.destination.branch] && category.destination.branch !== 'main') fail(`Category ${category.id} targets an unregistered branch.`);
    categoryIds.add(category.id);
  }
  return true;
}

function repositoryFor(registry, identity = {}) {
  const byId = identity.repositoryId === undefined ? null : registry.repositories.find((candidate) => candidate.id === Number(identity.repositoryId));
  const name = String(identity.repository || identity.repositoryName || '').trim().toLowerCase();
  const byName = name ? registry.repositories.find((candidate) => candidate.name.toLowerCase() === name) : null;
  if (byId && byName && byId !== byName) fail('Explicit repository ID and name identify different repositories.');
  return byId || byName || null;
}

function isSharedPath(file, registry) {
  const normalized = normalizePath(file);
  return (registry.sharedEvidencePaths || []).some((candidate) => normalizePath(candidate) === normalized);
}

function categoriesForPath(file, registry) {
  const normalized = normalizePath(file);
  if (!normalized || isSharedPath(normalized, registry)) return [];
  return registry.categories.filter((category) =>
    (category.pathExact || []).some((candidate) => normalizePath(candidate) === normalized)
    || (category.pathPrefixes || []).some((candidate) => normalized.startsWith(normalizePath(candidate)))
  );
}

function categoryRoute(category, registry) {
  const repository = registry.repositories.find((candidate) => candidate.id === category.destination.repositoryId);
  return {
    category: category.id,
    repositoryId: repository.id,
    repository: repository.name,
    branch: category.destination.branch,
    nextBranch: category.nextBranch || null,
    access: category.access,
  };
}

function blockedRoute(route, reason, evidence = {}) {
  return { status: 'blocked', ...route, reason, evidence, requiresQuestion: false };
}

function enforceAccess(category, registry, context, reason, evidence) {
  const route = categoryRoute(category, registry);
  const operation = String(context.operation || 'write');
  if (['create-branch', 'delete-branch'].includes(operation)) {
    return blockedRoute(route, `Routing never authorizes ${operation}; exact owner authority and a separate verified operation are required.`, evidence);
  }
  if (route.branch === 'main') return blockedRoute(route, 'Direct main writes are forbidden; promotion must use release and the governed workflow.', evidence);
  if (category.access === 'write') return { status: 'ready', ...route, reason, evidence, requiresQuestion: false };
  if (category.access === 'automation-only') {
    return context.automation === true && operation === category.requiredOperation
      ? { status: 'ready', ...route, reason, evidence, requiresQuestion: false }
      : blockedRoute(route, `${route.branch} accepts only the ${category.requiredOperation} automation.`, evidence);
  }
  if (category.access === 'read-only-unless-owner-approved') {
    if (operation === 'read') return { status: 'ready', ...route, reason, evidence, requiresQuestion: false };
    return context.ownerAuthorized === true
      ? { status: 'ready', ...route, reason, evidence, requiresQuestion: false }
      : blockedRoute(route, `${route.branch} is read-only unless the owner explicitly approves this exact write.`, evidence);
  }
  if (category.access === 'promotion-workflow-only') {
    return context.ownerAuthorized === true && context.systemWorkflow === true && operation === category.requiredOperation
      ? { status: 'ready', ...route, reason, evidence, requiresQuestion: false }
      : blockedRoute(route, 'Release work requires exact owner authorization and the release-to-main system workflow.', evidence);
  }
  return blockedRoute(route, `Unknown access policy ${category.access}.`, evidence);
}

function splitDecision(categoryIds, registry, evidence) {
  return {
    status: 'split-required',
    routes: categoryIds.map((id) => categoryRoute(registry.categories.find((category) => category.id === id), registry)),
    reason: 'Affected paths span multiple task categories and must be split into separate repository-scoped commits.',
    evidence,
    requiresQuestion: false,
  };
}

function classifyTask(context = {}, registry = loadTaskRouting()) {
  validateTaskRouting(registry);
  const paths = unique((context.paths || []).map(normalizePath).filter(Boolean));
  const pathMatches = paths.map((file) => ({ file, categories: categoriesForPath(file, registry).map((category) => category.id) }));
  const pathCategoryIds = unique(pathMatches.flatMap((match) => match.categories));
  const ambiguousPaths = pathMatches.filter((match) => match.categories.length > 1);
  const evidence = { paths: pathMatches, promptTerms: [], projectTerms: [], explicit: null };

  if (ambiguousPaths.length || pathCategoryIds.length > 1) return splitDecision(pathCategoryIds, registry, evidence);

  const explicit = context.explicit || null;
  if (explicit) {
    const repository = repositoryFor(registry, explicit);
    if (!repository) return { status: 'blocked', reason: 'The explicit repository is not registered by stable ID and exact name.', evidence: { ...evidence, explicit }, requiresQuestion: false };
    const branch = String(explicit.branch || '').trim();
    if (!repository.branches[branch]) return { status: 'blocked', repositoryId: repository.id, repository: repository.name, branch, reason: 'The explicit branch is not registered; routing never creates a branch.', evidence: { ...evidence, explicit }, requiresQuestion: false };
    if (branch === 'main') return { status: 'blocked', repositoryId: repository.id, repository: repository.name, branch, reason: 'Direct main writes are forbidden; the explicit promotion request must route through release and the governed workflow.', evidence: { ...evidence, explicit }, requiresQuestion: false };
    const category = registry.categories.find((candidate) => candidate.destination.repositoryId === repository.id && (candidate.destination.branch === branch || candidate.nextBranch === branch));
    if (!category) return { status: 'blocked', repositoryId: repository.id, repository: repository.name, branch, reason: 'No governed task category authorizes the explicit destination.', evidence: { ...evidence, explicit }, requiresQuestion: false };
    return enforceAccess(category, registry, context, `Explicit repository and branch instruction selected ${repository.name}:${branch}.`, { ...evidence, explicit });
  }

  const prompt = normalizeText(context.prompt);
  const project = normalizeText(context.project);
  const promptCategories = registry.categories.filter((category) => (category.promptTerms || []).some((term) => prompt.includes(normalizeText(term))));
  evidence.promptTerms = promptCategories.map((category) => category.id);

  if (pathCategoryIds.length === 1) {
    const selected = registry.categories.find((category) => category.id === pathCategoryIds[0]);
    const conflicts = promptCategories.filter((category) => category.id !== selected.id);
    if (conflicts.length) {
      return { status: 'ambiguous', reason: `Task wording selects ${conflicts.map((item) => item.id).join(', ')} but affected paths select ${selected.id}.`, evidence, requiresQuestion: true, question: `Should this task use ${selected.id} or ${conflicts.map((item) => item.id).join(', ')}?` };
    }
    return enforceAccess(selected, registry, context, `Affected paths select ${selected.id}.`, evidence);
  }

  if (promptCategories.length > 1) return { status: 'ambiguous', reason: `Task wording matches multiple categories: ${promptCategories.map((item) => item.id).join(', ')}.`, evidence, requiresQuestion: true, question: `Which category should this task use: ${promptCategories.map((item) => item.id).join(', ')}?` };
  if (promptCategories.length === 1) return enforceAccess(promptCategories[0], registry, context, `Task wording selects ${promptCategories[0].id}.`, evidence);

  const projectCategories = registry.categories.filter((category) => (category.projectTerms || []).some((term) => project.includes(normalizeText(term))));
  evidence.projectTerms = projectCategories.map((category) => category.id);
  if (projectCategories.length === 1) return enforceAccess(projectCategories[0], registry, context, `Project context selects ${projectCategories[0].id}.`, evidence);

  return { status: 'unknown', reason: 'No registered category uniquely matches the task wording, affected paths, or project context.', evidence, requiresQuestion: true, question: 'Which registered task category and destination should this task use?' };
}

function routingRecord(decision, { prompt = '', paths = [], selectedAt = new Date().toISOString() } = {}) {
  if (decision.status !== 'ready') fail(`Cannot record a routing decision with status ${decision.status}.`);
  return {
    category: decision.category,
    repositoryId: decision.repositoryId,
    repository: decision.repository,
    branch: decision.branch,
    reason: decision.reason,
    explicitOverride: Boolean(decision.evidence?.explicit),
    selectedAt,
    promptSha256: sha256(prompt),
    affectedPathsSha256: sha256(unique(paths.map(normalizePath).filter(Boolean)).sort().join('\n')),
  };
}

function verifyRecordedDecision({ record, repositoryId, repository, branch, paths = [], prompt, operation = 'write', ownerAuthorized = false, automation = false, systemWorkflow = false }, registry = loadTaskRouting()) {
  if (!record || typeof record !== 'object') fail('AI-HANDOFF.json activePlan.taskRouting is required before a push.');
  const category = registry.categories.find((candidate) => candidate.id === record.category);
  if (!category) fail(`Recorded task category ${record.category || '(none)'} is not registered.`);
  const expected = categoryRoute(category, registry);
  const numericRepositoryId = repositoryId === undefined || repositoryId === null || repositoryId === '' ? null : Number(repositoryId);
  if (numericRepositoryId !== null && numericRepositoryId !== expected.repositoryId) fail(`Repository ID ${numericRepositoryId} does not match routed stable ID ${expected.repositoryId}.`);
  if (String(repository || '').toLowerCase() !== expected.repository.toLowerCase()) fail(`Repository ${repository || '(unknown)'} does not match routed repository ${expected.repository}.`);
  if (branch !== expected.branch) fail(`Branch ${branch || '(detached)'} does not match routed branch ${expected.branch}.`);
  for (const key of ['repositoryId', 'repository', 'branch']) if (String(record[key]) !== String(expected[key])) fail(`Recorded ${key} does not match the canonical route.`);
  if (typeof record.reason !== 'string' || !record.reason.trim() || Number.isNaN(Date.parse(record.selectedAt))) fail('The recorded route must carry a reason and parseable selectedAt timestamp.');
  if (!/^[a-f0-9]{64}$/.test(record.promptSha256 || '') || !/^[a-f0-9]{64}$/.test(record.affectedPathsSha256 || '')) fail('The recorded route must carry SHA-256 prompt and affected-path digests.');

  const pathMatches = unique(paths.map(normalizePath).filter(Boolean)).map((file) => ({ file, categories: categoriesForPath(file, registry).map((item) => item.id) }));
  const unknown = pathMatches.filter((match) => !match.categories.length && !isSharedPath(match.file, registry));
  if (unknown.length) fail(`Changed paths are not registered: ${unknown.map((item) => item.file).join(', ')}.`);
  const categories = unique(pathMatches.flatMap((match) => match.categories));
  if (categories.length > 1) fail(`Changed paths span multiple categories (${categories.join(', ')}); split them into separate repository-scoped commits.`);
  if (categories.length === 1 && categories[0] !== record.category && record.explicitOverride !== true) fail(`Changed paths select ${categories[0]} but AI-HANDOFF records ${record.category}.`);
  const actualPathDigest = sha256(pathMatches.map((match) => match.file).sort().join('\n'));
  if (record.affectedPathsSha256 !== actualPathDigest) fail('The recorded affected-path digest does not match the proposed commit. Regenerate the route record after the commit scope is final.');
  if (prompt !== undefined && record.promptSha256 !== sha256(prompt)) fail('The recorded prompt digest does not match activePlan.currentPrompt.');

  const access = enforceAccess(category, registry, { operation, ownerAuthorized, automation, systemWorkflow }, record.reason, { paths: pathMatches });
  if (access.status !== 'ready') fail(access.reason);
  return { ok: true, ...expected, paths: pathMatches, reason: record.reason };
}

module.exports = {
  DEFAULT_REGISTRY,
  normalizePath,
  normalizeText,
  sha256,
  loadTaskRouting,
  validateTaskRouting,
  repositoryFor,
  isSharedPath,
  categoriesForPath,
  categoryRoute,
  classifyTask,
  routingRecord,
  verifyRecordedDecision,
};
