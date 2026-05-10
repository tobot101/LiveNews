const QUIET_CONTEXT_BLOCKED_TERMS = [
  "developing",
  "multiple sources",
  "source-linked",
  "intelligence",
  "radar",
  "score",
];

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNames(values) {
  const seen = new Set();
  return (values || [])
    .map(cleanText)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getCoverageSourceNames(item) {
  const primary = cleanText(item?.sourceName || item?.source || "");
  const fromRelated = Array.isArray(item?.relatedSources) ? item.relatedSources : [];
  const fromSupporting = Array.isArray(item?.supportingLinks)
    ? item.supportingLinks.map((source) => source?.sourceName || source?.source || source?.domain)
    : [];
  const names = uniqueNames([primary, ...fromRelated, ...fromSupporting]);
  return {
    primary,
    names,
    others: names.filter((name) => name.toLowerCase() !== primary.toLowerCase()),
  };
}

function formatSourceList(names) {
  const cleanNames = uniqueNames(names).slice(0, 3);
  if (cleanNames.length === 0) return "";
  if (cleanNames.length === 1) return cleanNames[0];
  if (cleanNames.length === 2) return `${cleanNames[0]} and ${cleanNames[1]}`;
  return `${cleanNames[0]}, ${cleanNames[1]}, and ${cleanNames[2]}`;
}

function removeBlockedContextTerms(value) {
  return QUIET_CONTEXT_BLOCKED_TERMS.reduce((text, term) => {
    return text.replace(new RegExp(term, "ig"), "").replace(/\s+/g, " ").trim();
  }, cleanText(value));
}

function buildCoverageContext(item) {
  const { names, others } = getCoverageSourceNames(item);
  const sourceCount = Math.max(Number(item?.sourceCount || 0), names.length);
  if (sourceCount < 2 || others.length < 1) return "";

  const visibleSources = formatSourceList(others);
  if (!visibleSources) return "";

  const remainingCount = Math.max(0, sourceCount - 1 - uniqueNames(others).slice(0, 3).length);
  const extra = remainingCount > 0 ? `, with ${remainingCount} more outlet${remainingCount === 1 ? "" : "s"} in the mix` : "";
  return removeBlockedContextTerms(`Also covered by ${visibleSources}${extra}.`);
}

function applyCoverageContext(item) {
  if (!item) return item;
  const coverageContext = buildCoverageContext(item);
  if (!coverageContext) {
    const { coverageContext: _unused, ...rest } = item;
    return rest;
  }
  return {
    ...item,
    coverageContext,
  };
}

function applyCoverageContextsToItems(items) {
  return (items || []).map(applyCoverageContext);
}

function applyCoverageContextsToPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    topStoryOfDay: applyCoverageContext(payload.topStoryOfDay),
    topStoryOfWeek: applyCoverageContext(payload.topStoryOfWeek),
    topStories: applyCoverageContextsToItems(payload.topStories),
    feed: applyCoverageContextsToItems(payload.feed),
  };
}

module.exports = {
  buildCoverageContext,
  applyCoverageContext,
  applyCoverageContextsToItems,
  applyCoverageContextsToPayload,
};
