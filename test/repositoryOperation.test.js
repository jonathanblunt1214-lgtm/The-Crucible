const test = require('node:test');
const assert = require('node:assert/strict');
const { UPDATE_REPOSITORY, UPDATE_REPOSITORY_NOTICE, canonicalizeRepositoryOperation, interpretRepositoryOperation } = require('../src/repositoryOperation');

test('common forms of Update Repository are one canonical operation', () => {
  for (const command of [
    'update repository',
    'Update the repository',
    'Update Repository',
    '  UPDATE   REPOSITORY  ',
    'update repo',
    'update the repo',
    'please update this repository',
    'kindly update my repo',
    'can you update the repository?',
    'could you please update current repo.',
    'would you update repository please!',
    'will you update the repo for me',
    'update repository now',
  ]) {
    assert.equal(canonicalizeRepositoryOperation(command), UPDATE_REPOSITORY);
  }
});

test('the named conversational forms disclose that they update The Crucible repository list', () => {
  for (const command of ['please update this repository', 'can you update the repo?']) {
    assert.deepEqual(interpretRepositoryOperation(command), {
      operation:UPDATE_REPOSITORY,
      updatesCrucibleRepositoryList:true,
      userNotice:UPDATE_REPOSITORY_NOTICE,
    });
  }
  assert.match(UPDATE_REPOSITORY_NOTICE, /updates the project repository list inside The Crucible/);
  assert.match(UPDATE_REPOSITORY_NOTICE, /\.thecrucible-repositories\.json.*Main repository/);
});

test('does not broaden destructive, plural, target-bearing, or ambiguous repository commands', () => {
  for (const command of ['', 'update repositories', 'delete repository', 'repository update', 'update octocat/example', 'update Nexus repository', 'update repository and push', 'do not update repository', null]) {
    assert.equal(canonicalizeRepositoryOperation(command), null);
    assert.equal(interpretRepositoryOperation(command), null);
  }
});

test('parser fuzz boundaries reject Unicode lookalikes, controls, negation, and appended actions', () => {
  const hazards = [
    'updаte repository', // Cyrillic a
    'update repо', // Cyrillic o
    'update\u0000repository',
    'update repository\nthen delete it',
    'never update the repo',
    'update repo && push',
    'update repo; delete branch',
    'update repositories?',
  ];
  for (const command of hazards) assert.equal(interpretRepositoryOperation(command), null);
  for (const punctuation of ['', '.', '!', '?', '...']) assert.equal(canonicalizeRepositoryOperation(`PlEaSe   UpDaTe   ThE   RePo${punctuation}`), UPDATE_REPOSITORY);
});
