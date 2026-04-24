const {
  cleanText,
  clamp,
  extractFocusPhrase,
  getDomain,
  slugify,
  splitSentences,
  stableHash,
  tokenize,
  uniqueBy,
} = require("./text-utils");

const PACKET_SCHEMA_VERSION = "live-news-story-packet-v1";
const AGENT_VERSION = "live-news-agents-2026-04-24";
const DEFAULT_PACKET_LIMIT = 24;

const SENSITIVE_CATEGORY_NAMES = new Set(["National", "International", "Top", "Local"]);
const SENSITIVE_PATTERNS = [
  /\bwar\b/i,
  /\battack(ed|s)?\b/i,
  /\bdeath(s)?\b/i,
  /\bdied\b/i,
  /\bkill(ed|s|ing)?\b/i,
  /\bcrime\b/i,
  /\btrial\b/i,
  /\bcourt\b/i,
  /\blawsuit\b/i,
  /\bcharged?\b/i,
  /\bshoot(ing|s)?\b/i,
  /\belection(s)?\b/i,
  /\bhealth\b/i,
  /\bmedical\b/i,
  /\bminor(s)?\b/i,
  /\bchildren\b/i,
  /\bdisaster\b/i,
  /\bflood\b/i,
  /\bwildfire\b/i,
];

function normalizeSourceName(item) {
  return cleanText(item.sourceName || item.source || item.primarySourceName || "Source");
}

function normalizeSourceUrl(item) {
  return cleanText(item.sourceUrl || item.homepage || "");
}

function normalizeSupportingSources(item) {
  const primarySourceName = normalizeSourceName(item);
  const primarySourceUrl = cleanText(item.link || item.originalSourceUrl || "");
  const rawLinks = Array.isArray(item.supportingLinks) ? item.supportingLinks : [];
  const fromSupportingLinks = rawLinks.map((link) => ({
    sourceName: cleanText(link.sourceName || link.source || "Source"),
    sourceUrl: cleanText(link.link || link.url || ""),
    publishedAt: cleanText(link.publishedAt || ""),
    category: cleanText(link.category || item.category || "Top"),
    domain: getDomain(link.link || link.url || ""),
  }));
  const primary = {
    sourceName: primarySourceName,
    sourceUrl: primarySourceUrl,
    publishedAt: cleanText(item.publishedAt || ""),
    category: cleanText(item.category || "Top"),
    domain: getDomain(primarySourceUrl),
  };

  return uniqueBy([primary, ...fromSupportingLinks], (source) => source.sourceUrl || source.sourceName)
    .filter((source) => source.sourceName || source.sourceUrl)
    .slice(0, 8);
}

function detectRiskFlags(item, text) {
  const flags = [];
  const category = cleanText(item.category || "Top");
  if (SENSITIVE_CATEGORY_NAMES.has(category)) {
    flags.push("editorial_review_default");
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      flags.push(`sensitive:${pattern.source.replace(/\\b|\\|\\(|\\)|\\?|\\+/g, "").slice(0, 24)}`);
    }
  }
  return Array.from(new Set(flags)).slice(0, 8);
}

function buildFacts(item, supportingSources) {
  const facts = [];
  const title = cleanText(item.title || "");
  const category = cleanText(item.category || "Top");
  const sourceName = normalizeSourceName(item);

  if (title) {
    facts.push({
      type: "source_headline",
      text: title,
      sourceName,
      sourceUrl: cleanText(item.link || ""),
    });
  }
  if (category) {
    facts.push({
      type: "category",
      text: `The story is categorized as ${category}.`,
      sourceName: "Live News classification",
      sourceUrl: "",
    });
  }
  if (item.publishedAt) {
    facts.push({
      type: "timestamp",
      text: `The latest source timestamp is ${item.publishedAt}.`,
      sourceName,
      sourceUrl: cleanText(item.link || ""),
    });
  }
  if (supportingSources.length > 1) {
    facts.push({
      type: "source_cluster",
      text: `${supportingSources.length} source entries are grouped with this story.`,
      sourceName: "Live News source clustering",
      sourceUrl: "",
    });
  }

  return facts;
}

function buildStoryPacket(item, index = 0, options = {}) {
  const title = cleanText(item.title || "");
  const summary = cleanText(item.summary || "");
  const category = cleanText(item.category || "Top");
  const publishedAt = cleanText(item.publishedAt || "");
  const sourceName = normalizeSourceName(item);
  const sourceUrl = normalizeSourceUrl(item);
  const originalSourceUrl = cleanText(item.link || item.originalSourceUrl || "");
  const sourceDomain = cleanText(item.sourceDomain || item.domain || getDomain(originalSourceUrl));
  const baseId = cleanText(item.id || originalSourceUrl || `${title}:${publishedAt}:${index}`);
  const storyId = `ln-${stableHash(baseId, 14)}`;
  const focusPhrase = extractFocusPhrase(title, category);
  const supportingSources = normalizeSupportingSources(item);
  const riskFlags = detectRiskFlags(item, `${title} ${summary} ${category}`);
  const sourceCount = Math.max(
    Number(item.sourceCount || 0),
    supportingSources.filter((source) => source.sourceName).length
  );
  const sourceDiversityScore = clamp(Math.round((Math.min(sourceCount, 5) / 5) * 100), 20, 100);
  const summarySentences = splitSentences(summary).slice(0, 2);
  const headlineTokens = tokenize(title).slice(0, 12);

  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    agentVersion: AGENT_VERSION,
    storyId,
    slug: `${slugify(focusPhrase)}-${storyId.slice(-6)}`,
    canonicalLiveNewsUrl: `/stories/${slugify(focusPhrase)}-${storyId.slice(-6)}`,
    storyState: "packet_ready",
    category,
    subcategory: "",
    urgencyState: Number(item.score || 0) >= 95 ? "high" : Number(item.score || 0) >= 88 ? "watch" : "routine",
    city: cleanText(item.city || ""),
    state: cleanText(item.state || ""),
    country: cleanText(item.country || "US"),
    focusPhrase,
    primarySourceName: sourceName,
    primarySourceUrl: sourceUrl,
    originalSourceUrl,
    sourceDomain,
    supportingSources,
    originalPublisherTitle: title,
    sourcePublishedAt: publishedAt,
    collectedAt: options.generatedAt || new Date().toISOString(),
    updatedAt: options.generatedAt || new Date().toISOString(),
    sourceDiversityScore,
    crossSourceCount: sourceCount || supportingSources.length || 1,
    facts: buildFacts(item, supportingSources),
    summaryCandidates: summarySentences,
    disputedOrUnclearClaims: [],
    keyEntities: headlineTokens,
    timeline: publishedAt
      ? [
          {
            label: "Source published",
            at: publishedAt,
          },
        ]
      : [],
    whyItMattersCandidate: buildWhyItMattersCandidate(category, focusPhrase),
    attributionLine: buildAttributionLine(sourceName, supportingSources),
    prohibitedPhrasesFromSources: uniqueBy([title, ...summarySentences], (value) => value.toLowerCase()).filter(Boolean),
    sensitiveTopicFlags: riskFlags,
    requiredHumanReview: true,
    qualityInputs: {
      titleLength: title.length,
      summaryLength: summary.length,
      hasOriginalSourceUrl: Boolean(originalSourceUrl),
      sourceCount: sourceCount || supportingSources.length || 1,
    },
  };
}

function buildWhyItMattersCandidate(category, focusPhrase) {
  const phrase = cleanText(focusPhrase || "this story");
  const templates = {
    Business: `${phrase} may affect companies, workers, investors, or consumer costs.`,
    Tech: `${phrase} may change how people, companies, or regulators use technology.`,
    Sports: `${phrase} gives readers a quick way to understand the latest result or decision.`,
    Entertainment: `${phrase} helps readers track a culture and media story without digging through multiple updates.`,
    Local: `${phrase} may affect daily life, public services, traffic, schools, or local planning.`,
    International: `${phrase} may affect global policy, security, diplomacy, or markets.`,
    National: `${phrase} may affect public policy, communities, or national conversation.`,
    Top: `${phrase} is drawing attention across current coverage and may have broader public impact.`,
  };
  return templates[category] || templates.Top;
}

function buildAttributionLine(primarySourceName, supportingSources) {
  const names = uniqueBy(
    supportingSources.map((source) => cleanText(source.sourceName)).filter(Boolean),
    (name) => name.toLowerCase()
  );
  if (names.length <= 1) return `Source: ${primarySourceName || "original source"}.`;
  const supporting = names.filter((name) => name !== primarySourceName).slice(0, 3);
  return `Source: ${primarySourceName || names[0]}, with supporting coverage from ${supporting.join(", ")}.`;
}

function normalizeNewsPayload(payload) {
  const topStories = Array.isArray(payload?.topStories) ? payload.topStories : [];
  const feed = Array.isArray(payload?.feed) ? payload.feed : [];
  const combined = [...topStories, ...feed];
  return uniqueBy(combined, (item) => item.id || item.link || `${item.title}:${item.publishedAt}`);
}

function buildStoryPackets(payload, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const limit = Math.max(1, Number(options.limit || DEFAULT_PACKET_LIMIT));
  return normalizeNewsPayload(payload)
    .slice(0, limit)
    .map((item, index) => buildStoryPacket(item, index, { generatedAt }));
}

module.exports = {
  AGENT_VERSION,
  PACKET_SCHEMA_VERSION,
  buildStoryPacket,
  buildStoryPackets,
  normalizeNewsPayload,
};
