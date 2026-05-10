const { loadOptionalAdapterSignals } = require("./adapter-utils");

async function loadSemrushSignals(options = {}) {
  return loadOptionalAdapterSignals("semrush", options, {
    confidence: 0.68,
    notes: "Semrush volume and keyword data should be directional and source-attributed when imported.",
  });
}

module.exports = { loadSemrushSignals };
