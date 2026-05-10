const { normalizeTrendSignal } = require("../trend-intelligence");

function normalizeGoogleTrendsRelativeSignal(input = {}) {
  return normalizeTrendSignal({
    ...input,
    source: "google_trends",
    absoluteVolumeEstimate: null,
    notes:
      input.notes ||
      "Google Trends-style 0-100 values are normalized relative interest, not raw search volume.",
  });
}

async function loadGoogleTrendsSignals(options = {}) {
  const fixtures = Array.isArray(options.fixtures) ? options.fixtures : [];
  return fixtures.map(normalizeGoogleTrendsRelativeSignal).filter(Boolean);
}

module.exports = {
  loadGoogleTrendsSignals,
  normalizeGoogleTrendsRelativeSignal,
};
