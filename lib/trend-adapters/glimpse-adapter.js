const { loadOptionalAdapterSignals } = require("./adapter-utils");

async function loadGlimpseSignals(options = {}) {
  return loadOptionalAdapterSignals("glimpse", options, {
    confidence: 0.68,
    notes: "Glimpse data should be treated as directional trend context, not verified fact.",
  });
}

module.exports = { loadGlimpseSignals };
