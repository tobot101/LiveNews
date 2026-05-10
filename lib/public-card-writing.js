const { cleanText } = require("./article-agents/text-utils");

const GENERIC_FALLBACK_PATTERNS = [
  /\bread the original source for the full report\b/i,
  /\bsource-linked coverage\b/i,
  /\blive news is tracking\b/i,
  /\bthis article discusses\b/i,
  /\bin a recent development\b/i,
  /\bthe story continues to unfold\b/i,
  /\bread more about this story\b/i,
  /\blatest update on this topic\b/i,
  /\bwhat you need to know\b/i,
  /\ba major update has emerged\b/i,
  /\breaders are reacting\b/i,
  /\byou won'?t believe\b/i,
  /\bshocking\b/i,
  /^top story:\s*/i,
];

const PUBLIC_SAFETY_TERMS = [
  "evacuation order",
  "shelter in place",
  "boil water notice",
  "road closure",
  "public advisory",
  "emergency alert",
  "officials warned",
  "official warning",
  "recall notice",
  "safety advisory",
  "missing person",
  "active alert",
  "weather warning",
  "health warning",
];

const PUBLIC_SAFETY_CATEGORIES = new Set([
  "public_safety",
  "emergency",
  "alert",
  "weather_alert",
  "evacuation",
  "road_closure",
  "missing_person",
  "recall",
  "health_warning",
  "disaster",
  "official_advisory",
]);

function truncateText(value, maxLength = 210) {
  const text = cleanText(value);
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
}

function isPublicSafetyRelevant(item = {}) {
  if (item.publicSafetyRelevant === true || item.writingQuality?.context?.publicSafetyRelevant === true) return true;
  const category = cleanText(item.category).toLowerCase().replace(/\s+/g, "_");
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => cleanText(tag).toLowerCase().replace(/\s+/g, "_")) : [];
  if (PUBLIC_SAFETY_CATEGORIES.has(category) || tags.some((tag) => PUBLIC_SAFETY_CATEGORIES.has(tag))) return true;
  const text = [
    item.liveNewsHeadline,
    item.title,
    item.description,
    item.liveNewsSummary,
    item.summary,
    item.whyItMatters,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return PUBLIC_SAFETY_TERMS.some((term) => text.includes(term));
}

function detectPublicWritingRisk(text, item = {}) {
  const value = cleanText(text);
  const risks = [];
  if (!value) risks.push("missing");
  if (GENERIC_FALLBACK_PATTERNS.some((pattern) => pattern.test(value))) risks.push("generic_fallback_or_robotic_phrase");
  if (/\bstay safe\b/i.test(value) && !isPublicSafetyRelevant(item)) risks.push("unsupported_public_safety_language");
  return {
    safe: risks.length === 0,
    risks,
  };
}

function firstSafeCandidate(item, candidates) {
  for (const candidate of candidates) {
    const text = cleanText(candidate.value);
    if (!text) continue;
    const risk = detectPublicWritingRisk(text, item);
    if (!risk.safe) continue;
    return {
      source: candidate.source,
      text,
      approved: Boolean(candidate.approved),
    };
  }
  return null;
}

function getSafeDisplayTitle(item = {}) {
  const selected = firstSafeCandidate(item, [
    { source: "liveNewsHeadline", value: item.liveNewsHeadline, approved: true },
    { source: "approvedTitle", value: item.approvedTitle || item.approvedHeadline, approved: true },
    { source: "title", value: item.title || item.headline, approved: Boolean(item.hasLiveNewsStory) },
  ]);
  return selected?.text || "Untitled story";
}

function getSafeDisplaySummary(item = {}, maxLength = 210) {
  const selected = firstSafeCandidate(item, [
    { source: "approvedDescription", value: item.approvedDescription || item.liveNewsDescription, approved: true },
    { source: "description", value: item.description, approved: Boolean(item.hasLiveNewsStory || item.writingQualityStatus === "ready") },
    { source: "liveNewsSummary", value: item.liveNewsSummary || item.summaryShort, approved: true },
    { source: "liveNewsDek", value: item.liveNewsDek || item.dek, approved: Boolean(item.hasLiveNewsStory) },
    { source: "summaryText", value: item.summaryText || item.summaryLong || item.liveNewsSummaryLong, approved: Boolean(item.hasLiveNewsStory) },
    { source: "summaryAgent", value: item.summaryAgent?.version ? item.summary : "", approved: true },
    { source: "summary", value: item.summary, approved: false },
  ]);
  return selected ? truncateText(selected.text, maxLength) : "";
}

function getPublicCardWritingStatus(item = {}) {
  const title = getSafeDisplayTitle(item);
  const summary = getSafeDisplaySummary(item, 260);
  const reasons = [];
  if (!summary) reasons.push("safe_summary_missing");
  if (detectPublicWritingRisk(item.summary || item.liveNewsSummary || "", item).risks.length) {
    reasons.push("weak_summary_blocked");
  }
  return {
    status: summary ? "ready" : title ? "title_only" : "needs_review",
    title,
    summary,
    publicSafetyRelevant: isPublicSafetyRelevant(item),
    reasons,
  };
}

module.exports = {
  detectPublicWritingRisk,
  getPublicCardWritingStatus,
  getSafeDisplaySummary,
  getSafeDisplayTitle,
  isPublicSafetyRelevant,
  truncateText,
};
