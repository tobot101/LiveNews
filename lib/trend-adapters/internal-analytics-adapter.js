const { normalizeSearchConsoleMetric } = require("./search-console-adapter");
const { loadOptionalAdapterSignals } = require("./adapter-utils");

async function loadInternalAnalyticsSignals(options = {}) {
  return loadOptionalAdapterSignals("internal_analytics", options, {
    confidence: 0.76,
    notes: "Internal analytics must be first-party aggregate site behavior only.",
  });
}

function normalizeInternalAnalyticsMetric(input = {}) {
  return {
    ...normalizeSearchConsoleMetric(input),
    source: "internal_analytics",
    collectionMethod: "first_party_aggregate_live_news_analytics",
  };
}

module.exports = {
  loadInternalAnalyticsSignals,
  normalizeInternalAnalyticsMetric,
};
