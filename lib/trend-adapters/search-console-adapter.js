const { normalizeTrendSignal } = require("../trend-intelligence");

function normalizeSearchConsoleMetric(input = {}) {
  return {
    source: "search_console",
    collectionMethod: "first_party_aggregate_site_performance",
    storyId: input.storyId || input.articleId || "",
    exactArticleUrl: input.exactArticleUrl || input.url || "",
    topic: input.topic || input.query || "",
    keywords: Array.isArray(input.keywords) ? input.keywords : [input.query].filter(Boolean),
    category: input.category || "top",
    timeframe: input.timeframe || "7d",
    views: Number(input.impressions || input.views || 0) || 0,
    linkClicks: Number(input.clicks || input.linkClicks || 0) || 0,
    engagementVelocity: Number(input.engagementVelocity || 0) || 0,
    sustainedDays: Number(input.sustainedDays || 0) || 0,
  };
}

function normalizeSearchConsoleTrendSignal(input = {}) {
  return normalizeTrendSignal({
    source: "search_console",
    topic: input.topic || input.query,
    keywords: Array.isArray(input.keywords) ? input.keywords : [input.query].filter(Boolean),
    category: input.category || "top",
    region: input.region || "US",
    timeframe: input.timeframe || "7d",
    normalizedInterest: input.normalizedInterest || input.clickShare || input.impressionShare || 0,
    absoluteVolumeEstimate: null,
    baselineDelta: input.baselineDelta || 0,
    growthRate: input.growthRate || 0,
    sustainedDays: input.sustainedDays || 0,
    confidence: input.confidence || 0.82,
    sourceUrl: null,
    collectedAt: input.collectedAt,
    notes: input.notes || "First-party aggregate Search Console signal for Live News only.",
  });
}

async function loadSearchConsoleSignals(options = {}) {
  const fixtures = Array.isArray(options.fixtures) ? options.fixtures : [];
  return fixtures.map(normalizeSearchConsoleTrendSignal).filter(Boolean);
}

module.exports = {
  loadSearchConsoleSignals,
  normalizeSearchConsoleMetric,
  normalizeSearchConsoleTrendSignal,
};
