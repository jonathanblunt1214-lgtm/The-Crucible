const UPDATE_REPOSITORY = 'update repository';
const UPDATE_REPOSITORY_NOTICE = 'This updates the project repository list inside The Crucible, stored in .thecrucible-repositories.json on the Main repository. It also updates branch assignments; development branches are assigned only to repositories the user directs them to, and matching main-/development- suffixes or final / suffixes always stay linked.';
const UPDATE_REPOSITORY_COMMAND = /^(?:(?:please|kindly)\s+|(?:(?:can|could|would|will)\s+you\s+)(?:please\s+)?)?update\s+(?:(?:the|this|current|my)\s+)?repo(?:sitory)?(?:\s+(?:please|now|for me))?$/;

function canonicalizeRepositoryOperation(command) {
  if (typeof command !== 'string') return null;
  const normalized = command.trim().replace(/[.!?]+$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  return UPDATE_REPOSITORY_COMMAND.test(normalized) ? UPDATE_REPOSITORY : null;
}

function interpretRepositoryOperation(command) {
  const operation = canonicalizeRepositoryOperation(command);
  if (!operation) return null;
  return {
    operation,
    updatesCrucibleRepositoryList: true,
    userNotice: UPDATE_REPOSITORY_NOTICE,
  };
}

module.exports = { UPDATE_REPOSITORY, UPDATE_REPOSITORY_NOTICE, UPDATE_REPOSITORY_COMMAND, canonicalizeRepositoryOperation, interpretRepositoryOperation };
