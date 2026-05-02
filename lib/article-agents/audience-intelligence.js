const fs = require("fs");
const path = require("path");
const { cleanText, tokenize } = require("./text-utils");
const { FALLBACK_SUMMARY, getSourceEvidenceText } = require("./summary-quality");

const AUDIENCE_INTELLIGENCE_VERSION = "live-news-audience-intelligence-v1";
const PATTERN_PATH = path.join(__dirname, "..", "..", "data", "audience-patterns.json");

const CATEGORY_ALIASES = {
  international: "world",
  technology: "tech",
};

function normalizeCategory(value) {
  const key = cleanText(value || "top").toLowerCase();
  return CATEGORY_ALIASES[key] || key || "top";
}

function readPatternConfig(options = {}) {
  if (options.patternConfig) return options.patternConfig;
  try {
    return JSON.parse(fs.readFileSync(PATTERN_PATH, "utf8"));
  } catch {
    return {
      schemaVersion: "live-news-audience-patterns-v1",
      patterns: [],
    };
  }
}

function normalizePhrase(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, " ")
    .trim();
}

function includesPhrase(haystack, phrase) {
  const normalized = normalizePhrase(phrase);
  if (!normalized) return false;
  return haystack.includes(normalized);
}

function getEvidenceText(item) {
  const supporting = (item?.supportingLinks || [])
    .flatMap((source) => [source.title, source.summary, source.sourceName])
    .filter(Boolean);
  return cleanText([
    item?.title,
    item?.category,
    item?.sourceName || item?.source,
    getSourceEvidenceText(item),
    ...supporting,
  ].filter(Boolean).join(" "));
}

function categoryMatches(pattern, category) {
  const categories = Array.isArray(pattern.categories) ? pattern.categories.map(normalizeCategory) : [];
  return categories.includes(category) || categories.includes("*");
}

function scorePattern(pattern, evidenceText, category) {
  const normalizedEvidence = normalizePhrase(evidenceText);
  const keywords = Array.isArray(pattern.keywords) ? pattern.keywords : [];
  const matchedKeywords = keywords.filter((keyword) => includesPhrase(normalizedEvidence, keyword));
  if (!matchedKeywords.length && !categoryMatches(pattern, category)) return null;

  const categoryBoost = categoryMatches(pattern, category) ? 2 : 0;
  const priority = Number(pattern.priority || 50);
  const score = matchedKeywords.length * 4 + categoryBoost + priority / 100;
  if (score < 4 && pattern.id !== "reader_clarity") return null;

  return {
    id: pattern.id,
    label: pattern.label || pattern.id,
    score: Math.round(score * 100) / 100,
    matchedKeywords,
    humanQuestions: Array.isArray(pattern.humanQuestions) ? pattern.humanQuestions.slice(0, 3) : [],
  };
}

function getHumanSignals(matches) {
  const signals = [];
  for (const match of matches) {
    for (const keyword of match.matchedKeywords || []) {
      const normalized = normalizePhrase(keyword);
      if (normalized && !signals.includes(normalized)) signals.push(normalized);
      if (signals.length >= 12) return signals;
    }
  }
  return signals;
}

function deriveAudienceIntelligence(item, options = {}) {
  const category = normalizeCategory(item?.category);
  const config = readPatternConfig(options);
  const patterns = Array.isArray(config.patterns) ? config.patterns : [];
  const evidenceText = getEvidenceText(item);
  const matches = patterns
    .map((pattern) => scorePattern(pattern, evidenceText, category))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const primary = matches[0] || {
    id: "reader_clarity",
    label: "reader clarity",
    score: 0,
    matchedKeywords: [],
    humanQuestions: ["What changed?", "Who is affected?", "Why does it matter?"],
  };
  const humanSignals = getHumanSignals(matches);
  return {
    version: AUDIENCE_INTELLIGENCE_VERSION,
    category,
    primaryPattern: {
      id: primary.id,
      label: primary.label,
      score: primary.score,
    },
    secondaryPatterns: matches.slice(1, 4).map((match) => ({
      id: match.id,
      label: match.label,
      score: match.score,
    })),
    matchedKeywords: humanSignals,
    humanQuestions: primary.humanQuestions,
    evidenceStrength: humanSignals.length,
    status: humanSignals.length ? "patterned" : "thin",
  };
}

function scoreSummaryForAudience(summary, intelligence) {
  const clean = cleanText(summary);
  if (!clean || clean === FALLBACK_SUMMARY) return 0;
  const normalizedSummary = normalizePhrase(clean);
  const matched = (intelligence?.matchedKeywords || []).filter((keyword) => includesPhrase(normalizedSummary, keyword));
  const primaryScore = Number(intelligence?.primaryPattern?.score || 0);
  const patternBonus = matched.length * 4;
  const evidenceBonus = Math.min(6, Number(intelligence?.evidenceStrength || 0));
  const plainnessBonus = tokenize(clean).length <= 28 ? 2 : 0;
  return Math.round((primaryScore + patternBonus + evidenceBonus + plainnessBonus) * 100) / 100;
}

function getAudienceHealth(items = []) {
  const list = Array.isArray(items) ? items : [];
  const counts = {};
  let checkedCount = 0;
  let patternedCount = 0;
  let thinCount = 0;
  for (const item of list) {
    const audience = item.summaryAgent?.audience || item.audienceIntelligence;
    if (!audience?.version) continue;
    checkedCount += 1;
    if (audience.status === "patterned") patternedCount += 1;
    if (audience.status === "thin") thinCount += 1;
    const key = audience.primaryPattern?.id || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    version: AUDIENCE_INTELLIGENCE_VERSION,
    checkedCount,
    patternedCount,
    thinCount,
    patternRate: checkedCount ? Math.round((patternedCount / checkedCount) * 1000) / 1000 : 0,
    primaryPatternCounts: counts,
  };
}

module.exports = {
  AUDIENCE_INTELLIGENCE_VERSION,
  deriveAudienceIntelligence,
  getAudienceHealth,
  scoreSummaryForAudience,
};
