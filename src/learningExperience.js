const { makeCandidate, sha } = require('./scientificLearning');

const EXPERIENCE_KEYS = Object.freeze([
  'schemaVersion', 'projectId', 'attemptId', 'boundedClaim', 'claimBoundary',
  'generalizationBoundary', 'action', 'environment', 'expectedOutcome',
  'actualOutcome', 'outcome', 'actionSha256', 'environmentSha256',
  'resultSha256', 'artifactSha256', 'actorId', 'observedAt',
]);

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
}
function digest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}
function validateExperience(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('experience must be an object.');
  const extras = Object.keys(value).filter((key) => !EXPERIENCE_KEYS.includes(key));
  if (extras.length) throw new Error(`experience contains unknown field(s): ${extras.join(', ')}.`);
  if (value.schemaVersion !== 1) throw new Error('experience.schemaVersion must be 1.');
  for (const key of ['projectId', 'attemptId', 'boundedClaim', 'claimBoundary', 'generalizationBoundary', 'action', 'environment', 'expectedOutcome', 'actualOutcome', 'actorId']) text(value[key], `experience.${key}`);
  if (!['succeeded', 'failed'].includes(value.outcome)) throw new Error('experience.outcome must be succeeded or failed.');
  for (const key of ['actionSha256', 'environmentSha256', 'resultSha256', 'artifactSha256']) digest(value[key], `experience.${key}`);
  if (!Number.isFinite(Date.parse(value.observedAt))) throw new Error('experience.observedAt must be an ISO timestamp.');
  return Object.freeze(structuredClone(value));
}

function experienceCandidate(value) {
  const experience = validateExperience(value);
  const contentSha256 = sha(experience);
  return makeCandidate({
    id: `experience-${contentSha256}`,
    projectId: experience.projectId,
    claim: experience.boundedClaim,
    claimBoundary: experience.claimBoundary,
    generalizationBoundary: experience.generalizationBoundary,
    kind: 'experience-observation',
    provenance: {
      sourceType: 'bounded-task-experience',
      sourceId: experience.attemptId,
      retrievedAt: experience.observedAt,
      author: experience.actorId,
      license: 'project-private-experience-evidence',
      contentSha256,
    },
    createdAt: experience.observedAt,
  });
}

class LearningExperienceRecorder {
  constructor({ store, projectId }) {
    if (!store || typeof store.ingestMany !== 'function') throw new Error('A durable scientific-learning store is required.');
    text(projectId, 'projectId');
    if (store.projectId !== projectId) throw new Error('Experience recorder and store must use the same project identity.');
    this.store = store;
    this.projectId = projectId;
  }
  record(experiences) {
    if (!Array.isArray(experiences) || !experiences.length) throw new Error('experiences must be a non-empty array.');
    const candidates = experiences.map(experienceCandidate);
    const ids = new Set(candidates.map((candidate) => candidate.id));
    if (ids.size !== candidates.length) throw new Error('Experience batch contains duplicate observations.');
    return this.store.ingestMany(candidates);
  }
}

module.exports = { EXPERIENCE_KEYS, validateExperience, experienceCandidate, LearningExperienceRecorder };
