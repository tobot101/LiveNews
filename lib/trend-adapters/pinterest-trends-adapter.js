const { loadOptionalAdapterSignals } = require("./adapter-utils");

async function loadPinterestTrendsSignals(options = {}) {
  return loadOptionalAdapterSignals("pinterest_trends", options, {
    confidence: 0.58,
    notes: "Pinterest Trends should guide visual/topic demand only and should not add article facts.",
  });
}

module.exports = { loadPinterestTrendsSignals };
