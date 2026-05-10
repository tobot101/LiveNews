const { normalizeTrendSignal } = require("../trend-intelligence");

function normalizeAdapterSignals(source, fixtures = [], defaults = {}) {
  return (Array.isArray(fixtures) ? fixtures : [])
    .map((fixture) =>
      normalizeTrendSignal({
        ...defaults,
        ...fixture,
        source,
        notes:
          fixture.notes ||
          defaults.notes ||
          "Optional trend adapter fixture. Configure an authorized API, export, or manual import before using live data.",
      })
    )
    .filter(Boolean);
}

async function loadOptionalAdapterSignals(source, options = {}, defaults = {}) {
  return normalizeAdapterSignals(source, options.fixtures, defaults);
}

module.exports = {
  loadOptionalAdapterSignals,
  normalizeAdapterSignals,
};
