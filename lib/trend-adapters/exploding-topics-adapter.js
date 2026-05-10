const { loadOptionalAdapterSignals } = require("./adapter-utils");

async function loadExplodingTopicsSignals(options = {}) {
  return loadOptionalAdapterSignals("exploding_topics", options, {
    confidence: 0.7,
    notes: "Exploding Topics data should be treated as directional emerging-interest context.",
  });
}

module.exports = { loadExplodingTopicsSignals };
