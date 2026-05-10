const { loadOptionalAdapterSignals } = require("./adapter-utils");

async function loadAnswerThePublicSignals(options = {}) {
  return loadOptionalAdapterSignals("answerthepublic", options, {
    confidence: 0.62,
    notes: "AnswerThePublic data should guide reader questions and topic demand only.",
  });
}

module.exports = { loadAnswerThePublicSignals };
