const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FOLDER_ROLES, discoverProjectFolders, validateFolderTopology, askFolderTopology } = require('../src/folderTopology');

function projectWithFolders(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-folder-topology-'));
  for (const name of names) fs.mkdirSync(path.join(root, name));
  return root;
}

test('discovers top-level project folders, excluding dotfiles and ignored infrastructure directories', () => {
  const root = projectWithFolders(['app', 'checks', 'history', '.git', '.github', 'node_modules']);
  fs.writeFileSync(path.join(root, 'README.md'), 'not a directory');
  assert.deepEqual(discoverProjectFolders(root), ['app', 'checks', 'history']);
});

test('discovered folders are sorted', () => {
  const root = projectWithFolders(['zebra', 'alpha', 'mango']);
  assert.deepEqual(discoverProjectFolders(root), ['alpha', 'mango', 'zebra']);
});

test('FOLDER_ROLES lists exactly the four supported roles', () => {
  assert.deepEqual(FOLDER_ROLES, ['influences-main', 'checks-only', 'archive', 'independent']);
});

test('validateFolderTopology passes through undefined unchanged', () => {
  assert.equal(validateFolderTopology(undefined), null);
});

test('validateFolderTopology requires explicit mode and between 3 and 50 folders', () => {
  assert.throws(() => validateFolderTopology({ mode:'explicit', folders:[{ path:'a', roles:['independent'] }, { path:'b', roles:['independent'] }] }), /3 through 50 folders/);
  assert.throws(() => validateFolderTopology({ mode:'implicit', folders:[] }), /3 through 50 folders/);
  assert.throws(() => validateFolderTopology(null), /3 through 50 folders/);
});

test('validateFolderTopology rejects a folder path that is not one safe top-level name', () => {
  const base = { path:'a', roles:['independent'] };
  const make = (path) => ({ mode:'explicit', folders:[{ ...base, path }, { path:'b', roles:['independent'] }, { path:'c', roles:['independent'] }] });
  assert.throws(() => validateFolderTopology(make('/etc/passwd')), /must be one top-level folder name/);
  assert.throws(() => validateFolderTopology(make('nested/path')), /must be one top-level folder name/);
  assert.throws(() => validateFolderTopology(make('back\\slash')), /must be one top-level folder name/);
  assert.throws(() => validateFolderTopology(make('..')), /must be one top-level folder name/);
  assert.throws(() => validateFolderTopology(make('')), /must be one top-level folder name/);
});

test('validateFolderTopology rejects duplicate folder paths, case-insensitively', () => {
  const folders = [{ path:'App', roles:['independent'] }, { path:'app', roles:['independent'] }, { path:'other', roles:['independent'] }];
  assert.throws(() => validateFolderTopology({ mode:'explicit', folders }), /duplicate folders/);
});

test('validateFolderTopology rejects unsupported roles', () => {
  const folders = [{ path:'a', roles:['made-up-role'] }, { path:'b', roles:['independent'] }, { path:'c', roles:['independent'] }];
  assert.throws(() => validateFolderTopology({ mode:'explicit', folders }), /supported roles/);
});

test('an independent folder cannot also carry another role', () => {
  const folders = [{ path:'a', roles:['independent', 'archive'] }, { path:'b', roles:['independent'] }, { path:'c', roles:['independent'] }];
  assert.throws(() => validateFolderTopology({ mode:'explicit', folders }), /cannot also influence Main/);
});

test('validateFolderTopology rejects unsafe link identifiers', () => {
  const folders = [{ path:'a', roles:['independent'], links:['../escape'] }, { path:'b', roles:['independent'] }, { path:'c', roles:['independent'] }];
  assert.throws(() => validateFolderTopology({ mode:'explicit', folders }), /safe link identifiers/);
});

test('validateFolderTopology normalizes valid input: dedupes roles and lowercases links', () => {
  const folders = [
    { path:'app', roles:['influences-main', 'influences-main'], links:['Backend', 'backend'] },
    { path:'checks', roles:['checks-only'] },
    { path:'history', roles:['archive'] },
  ];
  const result = validateFolderTopology({ mode:'explicit', folders });
  assert.deepEqual(result, {
    mode:'explicit',
    folders:[
      { path:'app', roles:['influences-main'], links:['backend'] },
      { path:'checks', roles:['checks-only'], links:[] },
      { path:'history', roles:['archive'], links:[] },
    ],
  });
});

test('askFolderTopology returns null without prompting when fewer than 3 folders are supplied', async () => {
  const prompt = { question: async () => { throw new Error('should not be asked'); } };
  assert.equal(await askFolderTopology('/unused', prompt, ['only', 'two']), null);
});

test('askFolderTopology asks per folder and builds a validated topology from the answers', async () => {
  const answers = ['influences-main', 'shared-lib', 'checks-only, archive', '', 'independent', 'nope,not,used'];
  const prompt = { question: async () => answers.shift() };
  const result = await askFolderTopology('/unused', prompt, ['app', 'checks', 'history']);
  assert.deepEqual(result, {
    mode:'explicit',
    folders:[
      { path:'app', roles:['influences-main'], links:['shared-lib'] },
      { path:'checks', roles:['checks-only', 'archive'], links:[] },
      { path:'history', roles:['independent'], links:['nope', 'not', 'used'] },
    ],
  });
});

test('askFolderTopology discovers folders itself when none are supplied', async () => {
  const root = projectWithFolders(['app', 'checks', 'history']);
  const prompt = { question: async () => 'independent' };
  const result = await askFolderTopology(root, prompt);
  assert.deepEqual(result.folders.map((folder) => folder.path), ['app', 'checks', 'history']);
});
