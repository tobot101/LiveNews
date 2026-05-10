const { loadOptionalAdapterSignals } = require("./adapter-utils");

async function loadAhrefsSignals(options = {}) {
  return loadOptionalAdapterSignals("ahrefs", options, {
    confidence: 0.68,
    notes: "Ahrefs data should be treated as directional search-interest context, not verified fact.",
  });
}

module.exports = { loadAhrefsSignals };
