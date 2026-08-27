const SUITE_CATEGORIES = Object.freeze(['governance', 'repository', 'security', 'privacy', 'quality', 'hygiene', 'resilience']);

function validateSuiteSelection(input = {}) {
  const mode = input.mode || 'all';
  if (!['all', 'selected'].includes(mode)) throw new Error('suite.mode must be all or selected.');
  const categories = input.categories || [];
  if (!Array.isArray(categories) || categories.some((item) => !SUITE_CATEGORIES.includes(item))) throw new Error(`suite.categories may contain only: ${SUITE_CATEGORIES.join(', ')}.`);
  const unique = [...new Set(categories)];
  if (mode === 'selected' && !unique.length) throw new Error('suite.categories must select at least one category when suite.mode is selected.');
  return { mode, categories:mode === 'all' ? [...SUITE_CATEGORIES] : unique };
}

function categoryEnabled(suite, category) {
  return suite.mode === 'all' || suite.categories.includes(category);
}

function applySuiteSelection(config, mode, categories = []) {
  const suite = validateSuiteSelection({ mode, categories });
  return { ...config, suite:{ mode:suite.mode, ...(suite.mode === 'selected' ? { categories:suite.categories } : {}) } };
}

module.exports = { SUITE_CATEGORIES, validateSuiteSelection, categoryEnabled, applySuiteSelection };
