const AUTHORITY_SOURCE_TYPES = new Set([
  "official_city",
  "official_county",
  "police_fire",
  "school",
  "transit",
  "weather",
]);

function isOfficialCivicLocalAuthoritySource(source = {}) {
  const sourceType = source.sourceType || source.source_type || "";
  const trustLevel = source.trustLevel || source.trust_level || "";
  return trustLevel === "official" || AUTHORITY_SOURCE_TYPES.has(sourceType);
}

function resultFromChecks(checks = {}, reasons = []) {
  const indexable = reasons.length === 0;
  return {
    indexable,
    robots: indexable ? "index, follow" : "noindex, follow",
    reasons,
    checks,
  };
}

function getCityIndexEligibility({
  clusters = [],
  sourceMix = [],
  hasVisibleLastUpdated = false,
  onlyShowsLiveStories = false,
} = {}) {
  const authoritySources = sourceMix.filter(isOfficialCivicLocalAuthoritySource);
  const checks = {
    liveClusterCount: clusters.length,
    distinctSourceCount: sourceMix.length,
    officialCivicLocalAuthoritySourceCount: authoritySources.length,
    hasVisibleLastUpdated: Boolean(hasVisibleLastUpdated),
    onlyShowsLiveStories: Boolean(onlyShowsLiveStories),
  };
  const reasons = [];
  if (checks.liveClusterCount < 5) reasons.push("needs 5+ live story clusters from the last 7 days");
  if (checks.distinctSourceCount < 2) reasons.push("needs 2+ distinct sources");
  if (checks.officialCivicLocalAuthoritySourceCount < 1) reasons.push("needs 1+ official/civic/local authority source");
  if (!checks.hasVisibleLastUpdated) reasons.push("needs visible last-updated timestamp");
  if (!checks.onlyShowsLiveStories) reasons.push("must only show stories from the last 7 days");
  return resultFromChecks(checks, reasons);
}

function getTopicIndexEligibility({
  clusters = [],
  sourceMix = [],
  onlyShowsLiveStories = false,
} = {}) {
  const checks = {
    liveTopicClusterCount: clusters.length,
    distinctSourceCount: sourceMix.length,
    onlyShowsLiveStories: Boolean(onlyShowsLiveStories),
  };
  const reasons = [];
  if (checks.liveTopicClusterCount < 3) reasons.push("needs 3+ live topic clusters from the last 7 days");
  if (checks.distinctSourceCount < 2) reasons.push("needs 2+ distinct sources");
  if (!checks.onlyShowsLiveStories) reasons.push("must only show stories from the last 7 days");
  return resultFromChecks(checks, reasons);
}

module.exports = {
  getCityIndexEligibility,
  getTopicIndexEligibility,
  isOfficialCivicLocalAuthoritySource,
};
