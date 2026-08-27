const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { SUITE_CATEGORIES, applySuiteSelection } = require('./suiteSelection');
const { askFolderTopology } = require('./folderTopology');

async function configureSuite(configPath = '.thecrucible.json', io = {}) {
  const target = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(target, 'utf8'));
  const prompt = io.prompt || readline.createInterface({ input:stdin, output:stdout });
  try {
    const modeAnswer = (await prompt.question('Run the whole Crucible suite or selected categories? [all/selected]: ')).trim().toLowerCase();
    const mode = modeAnswer === 'selected' ? 'selected' : modeAnswer === 'all' ? 'all' : null;
    if (!mode) throw new Error('Choose all or selected.');
    let categories = [];
    if (mode === 'selected') {
      const answer = await prompt.question(`Choose comma-separated categories (${SUITE_CATEGORIES.join(', ')}): `);
      categories = answer.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    }
    const updated = applySuiteSelection(config, mode, categories);
    if (!updated.project.folderTopology) {
      const topology = await askFolderTopology(path.dirname(target), prompt, io.folderNames);
      if (topology) updated.project.folderTopology = topology;
    }
    fs.writeFileSync(target, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    return updated.suite;
  } finally {
    if (!io.prompt) prompt.close();
  }
}

if (require.main === module) configureSuite(process.argv[2]).then((suite) => console.log(`[The Crucible] Persisted suite mode: ${suite.mode}${suite.categories ? ` (${suite.categories.join(', ')})` : ''}.`)).catch((error) => { console.error(`[The Crucible] ${error.message}`); process.exitCode = 1; });

module.exports = { configureSuite };
