const CADENCE_TIERS = Object.freeze(['every-push', 'daily', 'twice-weekly', 'weekly', 'monthly']);
const CATEGORY_CADENCE = Object.freeze({
  code: 'every-push',
  security: 'daily',
  utility: 'twice-weekly',
  maintenance: 'weekly',
});

function tierRank(tier) {
  const index = CADENCE_TIERS.indexOf(tier);
  if (index === -1) {
    throw new Error(`Unknown cadence tier "${tier}". Valid tiers: ${CADENCE_TIERS.join(', ')}.`);
  }
  return index;
}

function dueCategories(tier, categories) {
  const maxRank = tierRank(tier);
  return categories.filter((category) => {
    const categoryTier = CATEGORY_CADENCE[category];
    if (!categoryTier) throw new Error(`Cadence policy has no frequency for category "${category}".`);
    return tierRank(categoryTier) <= maxRank;
  });
}

function cadenceObligation(tier, categories) {
  return Object.freeze({ tier, dueCategories: Object.freeze([...dueCategories(tier, categories)]) });
}

module.exports = {
  CADENCE_TIERS,
  CATEGORY_CADENCE,
  tierRank,
  dueCategories,
  cadenceObligation,
};
