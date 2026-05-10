const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const { cleanText, clamp, stableHash, tokenize, uniqueBy } = require("./article-agents/text-utils");

const TREND_SIGNAL_SCHEMA_VERSION = "live-news-trend-signal-memory-v1";
const ALLOWED_TREND_SOURCES = new Set([
  "google_trends",
  "search_console",
  "semrush",
  "ahrefs",
  "glimpse",
  "exploding_topics",
  "pinterest_trends",
  "answerthepublic",
  "internal_analytics",
  "social_memory",
  "manual",
]);
const ALLOWED_TIMEFRAMES = new Set(["24h", "48h", "72h", "7d", "30d"]);
const FORBIDDEN_PRIVATE_KEYS = [
  "username",
  "usernames",
  "handle",
  "profile",
  "profileUrl",
  "profileId",
  "userId",
  "privateMessage",
  "privateMessages",
  "dm",
  "directMessage",
  "commentText",
  "publicCommentText",
  "copiedComment",
  "cookie",
  "cookies",
  "token",
  "accessToken",
  "secret",
];
const TOPIC_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "amid",
  "among",
  "and",
  "are",
  "been",
  "being",
  "breaking",
  "could",
  "from",
  "have",
  "into",
  "latest",
  "live",
  "news",
  "over",
  "said",
  "says",
  "story",
  "that",
  "the",
  "their",
  "this",
  "through",
  "under",
  "update",
  "updates",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
]);

const DEFAULT_TREND_MEMORY = {
  schemaVersion: TREND_SIGNAL_SCHEMA_VERSION,
  mode: "safe_aggregate_trend_learning_only",
  updatedAt: null,
  autoPromoteAllowed: false,
  publicVisible: false,
  signals: [],
  siteMetrics: [],
  editorBoosts: [],
  safeguards: [
    "Use authorized APIs, exports, manually entered public data, and first-party aggregate analytics only.",
    "Do not store usernames, copied comments, private messages, personal profiles, cookies, tokens, or individual identities.",
    "Treat Google Trends-style 0-100 values as relative normalized interest, not raw search volume.",
    "Treat third-party volume numbers as directional signals, not absolute truth.",
    "Use trend signals to improve story selection and reader usefulness, never to invent facts.",
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCategory(category) {
  const normalized = cleanText(category).toLowerCase();
  if (normalized === "technology") return "technology";
  if (normalized === "tech") return "technology";
  if (normalized === "international") return "world";
  return normalized || "top";
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTimeframe(value, fallback = "7d") {
  const timeframe = cleanText(value).toLowerCase();
  return ALLOWED_TIMEFRAMES.has(timeframe) ? timeframe : fallback;
}

function normalizeSource(value) {
  const source = cleanText(value).toLowerCase();
  return ALLOWED_TREND_SOURCES.has(source) ? source : "manual";
}

function containsForbiddenPrivateData(value, path = "") {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((item, index) => containsForbiddenPrivateData(item, `${path}.${index}`));
  }
  if (typeof value === "object") {
    return Object.entries(value).some(([key, nested]) => {
      const normalizedKey = key.toLowerCase();
      if (FORBIDDEN_PRIVATE_KEYS.some((blocked) => normalizedKey.includes(blocked.toLowerCase()))) {
        return true;
      }
      return containsForbiddenPrivateData(nested, path ? `${path}.${key}` : key);
    });
  }
  const text = cleanText(value);
  return (
    /private message|direct message|copied comment|comment text|username|profile id|user id|access token|api token/i.test(text) ||
    /[?&](access_?token|api_?key|client_secret|secret)=/i.test(text)
  );
}

function extractKeywords(value, limit = 8) {
  const counts = new Map();
  for (const token of tokenize(value)) {
    if (TOPIC_STOPWORDS.has(token) || token.length < 3) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token)
    .slice(0, limit);
}

function storyText(story = {}) {
  return [
    story.liveNewsHeadline,
    story.title,
    story.liveNewsSummary,
    story.summaryShort,
    story.summary,
    story.category,
    story.sourceName,
    ...(Array.isArray(story.relatedSources) ? story.relatedSources : []),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function getStoryId(story = {}) {
  return cleanText(story.id || story.storyId || story.approvedStorySlug || story.link || story.title);
}

function getStoryIdentityKey(story = {}) {
  return cleanText(story.approvedStoryUrl || story.liveNewsUrl || story.link || story.id || story.title).toLowerCase();
}

function getStoryExactArticleUrl(story = {}, origin = "https://newsmorenow.com") {
  const direct = cleanText(story.approvedStoryUrl || story.liveNewsUrl || story.exactArticleUrl || "");
  if (direct.startsWith("/stories/")) return `${origin.replace(/\/$/, "")}${direct}`;
  if (/^https?:\/\/[^/]+\/stories\//i.test(direct)) return direct;
  const link = cleanText(story.link || "");
  if (/^https?:\/\/[^/]+\/stories\//i.test(link)) return link;
  return "";
}

function publishedAgeHours(story = {}, now = new Date()) {
  const published = new Date(story.publishedAt || story.isoDate || story.pubDate || 0);
  if (Number.isNaN(published.getTime())) return 9999;
  return Math.max(0, (now.getTime() - published.getTime()) / 36e5);
}

function freshnessScore(story, maxHours, now) {
  const age = publishedAgeHours(story, now);
  if (age > maxHours) return 0;
  return clamp(100 - (age / maxHours) * 100, 0, 100);
}

function sourceSignificanceScore(story = {}) {
  const sourceCount = Math.max(1, safeNumber(story.sourceCount, 1));
  const sourceWeight = Math.max(1, safeNumber(story.sourceWeight, 1));
  const score = safeNumber(story.score || story.baseScore, 65);
  return clamp(sourceCount * 14 + sourceWeight * 12 + score * 0.55, 0, 100);
}

function storyQualityScore(story = {}) {
  const summary = cleanText(story.liveNewsSummary || story.summary || "");
  const hasImage = Boolean(story.imageUrl || story.resolvedImageUrl || story.socialImageUrl);
  const summaryPoints = summary.split(/\s+/).filter(Boolean).length >= 18 ? 28 : 12;
  const sourcePoints = cleanText(story.sourceName).length ? 18 : 6;
  const titlePoints = cleanText(story.title).length > 20 ? 22 : 10;
  return clamp(summaryPoints + sourcePoints + titlePoints + (hasImage ? 12 : 0), 0, 100);
}

function keywordOverlap(a = [], b = []) {
  const left = new Set((a || []).map((item) => cleanText(item).toLowerCase()).filter(Boolean));
  const right = new Set((b || []).map((item) => cleanText(item).toLowerCase()).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const value of left) {
    if (right.has(value)) hits += 1;
  }
  return hits / Math.min(left.size, right.size);
}

function normalizeTrendSignal(input = {}) {
  if (!input || typeof input !== "object") return null;
  if (containsForbiddenPrivateData(input)) return null;
  const source = normalizeSource(input.source || input.sourceType);
  const topic = cleanText(input.topic || input.topicName || input.query || "Live News topic");
  const keywords = [
    ...(Array.isArray(input.keywords) ? input.keywords : []),
    ...(Array.isArray(input.relatedQueries) ? input.relatedQueries : []),
    ...extractKeywords(topic, 4),
  ]
    .map(cleanText)
    .filter(Boolean);
  const normalizedInterest = clamp(safeNumber(input.normalizedInterest ?? input.publicInterestScore, 0), 0, 100);
  const absoluteVolumeEstimate =
    source === "google_trends"
      ? null
      : input.absoluteVolumeEstimate === null || input.absoluteVolumeEstimate === undefined
        ? null
        : Math.max(0, Math.round(safeNumber(input.absoluteVolumeEstimate, 0)));
  const collectedAt = cleanText(input.collectedAt || input.recordedAt || input.createdAt) || nowIso();
  const timeframe = normalizeTimeframe(input.timeframe, source === "google_trends" ? "7d" : "7d");
  const signal = {
    id:
      cleanText(input.id || input.signalId) ||
      stableHash([source, topic, timeframe, input.region || input.geo || "US", collectedAt].join("|"), 16),
    source,
    topic,
    keywords: [...new Set(keywords)].slice(0, 12),
    category: normalizeCategory(input.category),
    region: cleanText(input.region || input.geo || "US") || "US",
    timeframe,
    normalizedInterest,
    absoluteVolumeEstimate,
    baselineDelta: safeNumber(input.baselineDelta, 0),
    growthRate: safeNumber(input.growthRate, 0),
    sustainedDays: clamp(safeNumber(input.sustainedDays, timeframe === "24h" ? 1 : 2), 0, 30),
    relatedQueries: (Array.isArray(input.relatedQueries) ? input.relatedQueries : [])
      .map(cleanText)
      .filter(Boolean)
      .slice(0, 12),
    confidence: clamp(safeNumber(input.confidence, source === "manual" ? 0.55 : 0.7), 0, 1),
    sourceUrl: cleanText(input.sourceUrl || input.url || "") || null,
    collectedAt,
    notes: cleanText(input.notes || (source === "google_trends" ? "Normalized relative interest, not raw search volume." : "")),
  };
  if (!signal.keywords.length) signal.keywords = extractKeywords(signal.topic, 6);
  return signal;
}

function createTrendTopic({ topicName, category, keywords, relatedStoryIds, trendSignals }) {
  const cleanKeywords = [...new Set((keywords || []).map(cleanText).filter(Boolean))].slice(0, 14);
  const signals = (trendSignals || []).map(normalizeTrendSignal).filter(Boolean);
  const confidence = signals.length
    ? clamp(signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length, 0, 1)
    : 0.45;
  const topicId = stableHash([
    normalizeCategory(category),
    cleanText(topicName).toLowerCase(),
    cleanKeywords.slice(0, 6).join("-"),
  ].join("|"), 14);
  return {
    topicId,
    topicName: cleanText(topicName) || cleanKeywords.slice(0, 3).join(" ") || "Live News topic",
    category: normalizeCategory(category),
    keywords: cleanKeywords,
    relatedStoryIds: [...new Set((relatedStoryIds || []).map(cleanText).filter(Boolean))],
    trendSignals: signals,
    dailyScore: 0,
    weeklyScore: 0,
    confidence,
    whyItMattersToday: "",
    whyItMattersThisWeek: "",
    risks: [],
  };
}

function findMatchingSignalsForStory(story, trendSignals) {
  const text = storyText(story).toLowerCase();
  const storyKeywords = extractKeywords(text, 12);
  return (trendSignals || [])
    .map(normalizeTrendSignal)
    .filter(Boolean)
    .filter((signal) => {
      if (normalizeCategory(signal.category) !== "top" && normalizeCategory(signal.category) !== normalizeCategory(story.category)) {
        const overlap = keywordOverlap(storyKeywords, signal.keywords);
        if (overlap < 0.25) return false;
      }
      if (signal.topic && text.includes(signal.topic.toLowerCase())) return true;
      return keywordOverlap(storyKeywords, signal.keywords) >= 0.22;
    });
}

function makeTopicKey(story, matchingSignals) {
  const category = normalizeCategory(story.category);
  if (matchingSignals.length) {
    const strongest = [...matchingSignals].sort(
      (a, b) => b.normalizedInterest * b.confidence - a.normalizedInterest * a.confidence
    )[0];
    return `${category}:${cleanText(strongest.topic).toLowerCase()}`;
  }
  const keywords = extractKeywords(storyText(story), 5);
  return `${category}:${keywords.slice(0, 3).join("-") || stableHash(storyText(story), 8)}`;
}

function clusterStoriesByTrendTopic(stories = [], trendSignals = []) {
  const groups = new Map();
  for (const story of stories || []) {
    const matchingSignals = findMatchingSignalsForStory(story, trendSignals);
    const key = makeTopicKey(story, matchingSignals);
    const storyKeywords = extractKeywords(storyText(story), 10);
    if (!groups.has(key)) {
      groups.set(key, {
        topicName: matchingSignals[0]?.topic || storyKeywords.slice(0, 4).join(" ") || story.title || "Live News topic",
        category: normalizeCategory(story.category),
        keywords: [],
        stories: [],
        signals: [],
      });
    }
    const group = groups.get(key);
    group.stories.push(story);
    group.keywords.push(...storyKeywords);
    group.signals.push(...matchingSignals);
  }

  return [...groups.values()].map((group) =>
    createTrendTopic({
      topicName: group.topicName,
      category: group.category,
      keywords: group.keywords,
      relatedStoryIds: group.stories.map(getStoryId),
      trendSignals: uniqueBy(group.signals, (signal) => signal.id),
    })
  );
}

function getMetricForStory(story, siteMetrics = []) {
  const storyId = getStoryId(story);
  const identity = getStoryIdentityKey(story);
  const keywords = extractKeywords(storyText(story), 8);
  return (siteMetrics || []).reduce(
    (sum, metric) => {
      if (containsForbiddenPrivateData(metric)) return sum;
      const metricStoryId = cleanText(metric.storyId || metric.articleId || "");
      const metricUrl = cleanText(metric.exactArticleUrl || metric.url || "");
      const metricTopic = cleanText(metric.topic || "");
      const metricKeywords = Array.isArray(metric.keywords) ? metric.keywords.map(cleanText) : extractKeywords(metricTopic, 8);
      const matches =
        metricStoryId === storyId ||
        (metricUrl && identity && metricUrl.toLowerCase().includes(identity)) ||
        keywordOverlap(keywords, metricKeywords) >= 0.28;
      if (!matches) return sum;
      return {
        engagementVelocity: sum.engagementVelocity + safeNumber(metric.engagementVelocity, 0),
        views: sum.views + safeNumber(metric.views, 0),
        clicks: sum.clicks + safeNumber(metric.linkClicks || metric.clicks, 0),
        socialScore: sum.socialScore + safeNumber(metric.socialScore || metric.score, 0),
        sustainedDays: Math.max(sum.sustainedDays, safeNumber(metric.sustainedDays, 0)),
      };
    },
    { engagementVelocity: 0, views: 0, clicks: 0, socialScore: 0, sustainedDays: 0 }
  );
}

function trendStrength(signals, timeframePreference = "daily") {
  const preferred = timeframePreference === "daily" ? new Set(["24h", "48h", "72h"]) : new Set(["72h", "7d", "30d"]);
  const weighted = (signals || []).map((signal) => {
    const normalized = normalizeTrendSignal(signal);
    if (!normalized) return 0;
    const timeframeWeight = preferred.has(normalized.timeframe) ? 1 : 0.65;
    const sustainedWeight = timeframePreference === "weekly" ? clamp(normalized.sustainedDays / 3, 0.35, 1.4) : 1;
    const growth = clamp(50 + normalized.baselineDelta * 0.3 + normalized.growthRate * 0.25, 0, 100) / 100;
    return normalized.normalizedInterest * normalized.confidence * timeframeWeight * sustainedWeight * (0.8 + growth * 0.4);
  });
  return clamp(weighted.reduce((max, score) => Math.max(max, score), 0), 0, 100);
}

function getTopicForStory(story, topics) {
  const storyId = getStoryId(story);
  return topics.find((topic) => topic.relatedStoryIds.includes(storyId)) || null;
}

function signalSummary(signals = []) {
  return uniqueBy(
    signals.map(normalizeTrendSignal).filter(Boolean),
    (signal) => signal.id
  )
    .sort((a, b) => b.normalizedInterest * b.confidence - a.normalizedInterest * a.confidence)
    .slice(0, 6)
    .map((signal) => ({
      id: signal.id,
      source: signal.source,
      topic: signal.topic,
      timeframe: signal.timeframe,
      normalizedInterest: signal.normalizedInterest,
      absoluteVolumeEstimate: signal.absoluteVolumeEstimate,
      confidence: signal.confidence,
      sustainedDays: signal.sustainedDays,
      collectedAt: signal.collectedAt,
    }));
}

function selectionBase({ label, story, topic, score, confidence, whySelected, duplicateStatus, freshnessWindow, sustainedDays, origin }) {
  return {
    label,
    storyId: getStoryId(story),
    topicId: topic?.topicId || "",
    title: cleanText(story?.liveNewsHeadline || story?.title || ""),
    exactArticleUrl: getStoryExactArticleUrl(story, origin),
    score: Math.round(clamp(score, 0, 100)),
    confidence: Number(clamp(confidence, 0, 1).toFixed(2)),
    whySelected: cleanText(whySelected),
    signalsUsed: signalSummary(topic?.trendSignals || []),
    freshnessWindow,
    sustainedDays,
    duplicateStatus,
    topicName: topic?.topicName || "",
    topicKeywords: topic?.keywords || [],
    story,
  };
}

function explainTrendRanking(selection = {}) {
  if (!selection.storyId) return "No story was selected.";
  const parts = [
    selection.whySelected,
    selection.signalsUsed?.length
      ? `Signals came from ${selection.signalsUsed.map((signal) => signal.source).join(", ")}.`
      : "No live external trend API was required; the system used story freshness, source strength, and safe internal signals.",
  ].filter(Boolean);
  if (selection.duplicateStatus && selection.duplicateStatus !== "unique") {
    parts.push(`Duplicate status: ${selection.duplicateStatus}.`);
  }
  return parts.join(" ");
}

function rankTopStoryOfDay(candidates = [], trendSignals = [], siteMetrics = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const origin = options.origin || "https://newsmorenow.com";
  const topics = clusterStoriesByTrendTopic(candidates, trendSignals);
  const currentCandidates = (candidates || []).filter((story) => publishedAgeHours(story, now) <= 24);
  const pool = currentCandidates.length ? currentCandidates : candidates || [];
  const ranked = pool
    .map((story) => {
      const topic = getTopicForStory(story, topics) || createTrendTopic({
        topicName: extractKeywords(storyText(story), 4).join(" "),
        category: story.category,
        keywords: extractKeywords(storyText(story), 8),
        relatedStoryIds: [getStoryId(story)],
        trendSignals: [],
      });
      const metrics = getMetricForStory(story, siteMetrics);
      const dailyTrend = trendStrength(topic.trendSignals, "daily");
      const score =
        freshnessScore(story, 24, now) * 0.26 +
        dailyTrend * 0.2 +
        clamp(metrics.engagementVelocity * 8 + metrics.clicks * 1.8 + metrics.views * 0.12, 0, 100) * 0.14 +
        sourceSignificanceScore(story) * 0.17 +
        storyQualityScore(story) * 0.12 +
        clamp(metrics.socialScore, 0, 100) * 0.06 +
        clamp(safeNumber(options.editorBoosts?.[getStoryId(story)], story.editorBoost || 0), 0, 100) * 0.05;
      return { story, topic, score };
    })
    .sort((a, b) => b.score - a.score || new Date(b.story.publishedAt) - new Date(a.story.publishedAt));

  const best = ranked[0];
  if (!best) return null;
  const confidence = clamp((best.topic.confidence || 0.45) * 0.55 + Math.min(best.score, 100) / 100 * 0.45, 0, 1);
  const whySelected = `Chosen for today's homepage because it combines current freshness, source strength, reader relevance, and ${best.topic.trendSignals.length ? "safe aggregate trend interest" : "available site/story signals"}.`;
  return selectionBase({
    label: "Top Story of the Day",
    story: best.story,
    topic: {
      ...best.topic,
      dailyScore: best.score,
      whyItMattersToday: "This is the strongest current article in the 24-hour window.",
    },
    score: best.score,
    confidence,
    whySelected,
    duplicateStatus: "unique",
    freshnessWindow: "24h",
    sustainedDays: Math.max(0, ...((best.topic.trendSignals || []).map((signal) => signal.sustainedDays || 0))),
    origin,
  });
}

function topicSustainedDays(topic, stories, siteMetrics = []) {
  const signalDays = Math.max(0, ...((topic.trendSignals || []).map((signal) => safeNumber(signal.sustainedDays, 0))));
  const metricDays = Math.max(
    0,
    ...((siteMetrics || [])
      .filter((metric) => !containsForbiddenPrivateData(metric))
      .map((metric) => safeNumber(metric.sustainedDays, 0)))
  );
  const dates = (stories || [])
    .map((story) => new Date(story.publishedAt || 0))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);
  const storySpanDays = dates.length > 1 ? Math.max(1, Math.ceil((dates[dates.length - 1] - dates[0]) / 864e5) + 1) : 0;
  return Math.max(signalDays, metricDays, storySpanDays);
}

function rankStoryOfWeek(candidates = [], trendSignals = [], siteMetrics = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const origin = options.origin || "https://newsmorenow.com";
  const daySelection = options.daySelection || null;
  const dayStory = daySelection?.story || null;
  const dayIdentity = dayStory ? getStoryIdentityKey(dayStory) : "";
  const dayTopicId = cleanText(daySelection?.topicId || "");
  const topics = clusterStoriesByTrendTopic(candidates, trendSignals);
  const storyById = new Map((candidates || []).map((story) => [getStoryId(story), story]));
  const eligible = topics
    .map((topic) => {
      const stories = topic.relatedStoryIds.map((id) => storyById.get(id)).filter(Boolean);
      const sustainedDays = topicSustainedDays(topic, stories, siteMetrics);
      const hasSustainedEvidence = sustainedDays >= 2;
      const oneDaySpike = trendStrength(topic.trendSignals, "daily") > 70 && sustainedDays < 2;
      const sortedStories = [...stories].sort(
        (a, b) =>
          storyQualityScore(b) - storyQualityScore(a) ||
          sourceSignificanceScore(b) - sourceSignificanceScore(a) ||
          new Date(b.publishedAt) - new Date(a.publishedAt)
      );
      const bestStory = sortedStories.find((story) => getStoryIdentityKey(story) !== dayIdentity) || sortedStories[0];
      if (!bestStory) return null;
      const metrics = getMetricForStory(bestStory, siteMetrics);
      const exactDuplicate = dayIdentity && getStoryIdentityKey(bestStory) === dayIdentity;
      const sameTopic = dayTopicId && topic.topicId === dayTopicId;
      const duplicatePenalty = exactDuplicate ? (topics.length > 1 ? 45 : 18) : sameTopic ? 8 : 0;
      const weakSustainedPenalty = hasSustainedEvidence ? 0 : 55;
      const oneDayPenalty = oneDaySpike ? 35 : 0;
      const score =
        trendStrength(topic.trendSignals, "weekly") * 0.24 +
        clamp(sustainedDays * 20, 0, 100) * 0.2 +
        sourceSignificanceScore(bestStory) * 0.16 +
        storyQualityScore(bestStory) * 0.12 +
        freshnessScore(bestStory, 24 * 7, now) * 0.08 +
        clamp(metrics.clicks * 1.5 + metrics.views * 0.1 + metrics.engagementVelocity * 5, 0, 100) * 0.12 +
        clamp(safeNumber(bestStory.editorBoost || options.editorBoosts?.[getStoryId(bestStory)], 0), 0, 100) * 0.08 -
        duplicatePenalty -
        weakSustainedPenalty -
        oneDayPenalty;
      const risks = [
        !hasSustainedEvidence ? "weekly story needs stronger sustained-interest evidence" : "",
        oneDaySpike ? "one-day spike penalized for weekly selection" : "",
        exactDuplicate ? "same article as Top Story of the Day" : "",
      ].filter(Boolean);
      return {
        topic: {
          ...topic,
          weeklyScore: score,
          whyItMattersThisWeek: "This topic has multi-day interest or coverage signals.",
          risks,
        },
        story: bestStory,
        score,
        sustainedDays,
        exactDuplicate,
        sameTopic,
        hasSustainedEvidence,
      };
    })
    .filter(Boolean)
    .filter((entry) => entry.hasSustainedEvidence || options.allowWeakFallback === true)
    .sort((a, b) => b.score - a.score || b.sustainedDays - a.sustainedDays);

  let best = eligible.find((entry) => !entry.exactDuplicate) || eligible[0];
  if (!best) return null;
  if (best.exactDuplicate && eligible.some((entry) => !entry.exactDuplicate)) {
    best = eligible.find((entry) => !entry.exactDuplicate);
  }
  const duplicateStatus = best.exactDuplicate ? "same_article_as_day" : best.sameTopic ? "same_topic_as_day" : "unique";
  const confidence = clamp((best.topic.confidence || 0.45) * 0.55 + Math.min(Math.max(best.score, 0), 100) / 100 * 0.45, 0, 1);
  const whySelected =
    duplicateStatus === "same_topic_as_day"
      ? "Chosen for the week as a sustained story arc, while the daily spotlight focuses on the latest development."
      : "Chosen for the week because the topic shows sustained multi-day interest, source strength, and enough reader value to remain useful beyond a one-day spike.";
  return selectionBase({
    label: "Story of the Week",
    story: best.story,
    topic: best.topic,
    score: best.score,
    confidence,
    whySelected,
    duplicateStatus,
    freshnessWindow: "2-7d",
    sustainedDays: best.sustainedDays,
    origin,
  });
}

function readTrendSignalMemory() {
  const store = readJson(STORE_PATHS.trendSignalMemory, DEFAULT_TREND_MEMORY);
  const signals = (store.signals || []).map(normalizeTrendSignal).filter(Boolean);
  const siteMetrics = (store.siteMetrics || []).filter((metric) => !containsForbiddenPrivateData(metric));
  return {
    ...clone(DEFAULT_TREND_MEMORY),
    ...store,
    schemaVersion: TREND_SIGNAL_SCHEMA_VERSION,
    signals,
    siteMetrics,
    autoPromoteAllowed: false,
    publicVisible: false,
  };
}

function saveTrendSignalMemory(store) {
  const safeSignals = (store.signals || []).map(normalizeTrendSignal).filter(Boolean);
  const safeSiteMetrics = (store.siteMetrics || []).filter((metric) => !containsForbiddenPrivateData(metric));
  const safeEditorBoosts = (store.editorBoosts || []).filter((boost) => !containsForbiddenPrivateData(boost));
  writeJson(STORE_PATHS.trendSignalMemory, {
    ...clone(DEFAULT_TREND_MEMORY),
    ...store,
    schemaVersion: TREND_SIGNAL_SCHEMA_VERSION,
    signals: safeSignals,
    siteMetrics: safeSiteMetrics,
    editorBoosts: safeEditorBoosts,
    updatedAt: nowIso(),
    autoPromoteAllowed: false,
    publicVisible: false,
  });
}

function buildTrendSignalsFromSocialPerformance(store = {}) {
  return (store.publicInterestSignals || [])
    .map((signal) =>
      normalizeTrendSignal({
        source: signal.sourceType === "trending_search" ? "manual" : signal.sourceType,
        topic: signal.topic,
        keywords: signal.relatedQueries,
        relatedQueries: signal.relatedQueries,
        category: signal.category,
        region: signal.geo || "US",
        timeframe: signal.timeframe || "7d",
        normalizedInterest: signal.publicInterestScore,
        absoluteVolumeEstimate: null,
        baselineDelta: signal.baselineDelta || 0,
        growthRate: signal.growthRate || 0,
        sustainedDays: signal.sustainedDays || (safeNumber(signal.publicInterestScore, 0) >= 70 ? 2 : 1),
        confidence: signal.confidence || 0.66,
        sourceUrl: signal.sourceUrl,
        collectedAt: signal.recordedAt || signal.collectedAt,
        notes: signal.notes || "Safe aggregate public-interest signal imported from Social Performance Memory.",
      })
    )
    .filter(Boolean);
}

function buildTrendSiteMetricsFromSocialPerformance(store = {}) {
  return (store.manualPosts || [])
    .filter((post) => !containsForbiddenPrivateData(post))
    .map((post) => ({
      source: "social_memory",
      collectionMethod: "manual_aggregate_post_metrics",
      articleId: cleanText(post.articleId),
      storyId: cleanText(post.articleId),
      exactArticleUrl: cleanText(post.exactArticleUrl),
      topic: cleanText(post.topic || post.category || ""),
      keywords: extractKeywords(`${post.category || ""} ${post.captionShape || ""} ${post.mediaShape || ""}`, 8),
      category: normalizeCategory(post.category),
      timeframe: "7d",
      views: safeNumber(post.metrics?.views || post.views, 0),
      linkClicks: safeNumber(post.metrics?.linkClicks || post.linkClicks, 0),
      engagementVelocity: safeNumber(post.scores?.score || post.score, 0) / 12,
      socialScore: safeNumber(post.scores?.score || post.score, 0),
      sustainedDays: safeNumber(post.sustainedDays, 1),
    }));
}

function buildTrendInputs({ trendMemory, socialPerformanceMemory } = {}) {
  const memory = trendMemory || readTrendSignalMemory();
  const socialSignals = buildTrendSignalsFromSocialPerformance(socialPerformanceMemory || {});
  const socialMetrics = buildTrendSiteMetricsFromSocialPerformance(socialPerformanceMemory || {});
  return {
    signals: uniqueBy([...(memory.signals || []), ...socialSignals].map(normalizeTrendSignal).filter(Boolean), (signal) => signal.id),
    siteMetrics: [...(memory.siteMetrics || []), ...socialMetrics].filter((metric) => !containsForbiddenPrivateData(metric)),
    editorBoosts: memory.editorBoosts || [],
  };
}

function publicSelection(selection) {
  if (!selection) return null;
  const { story: _story, ...safe } = selection;
  return {
    ...safe,
    explanation: explainTrendRanking(selection),
  };
}

module.exports = {
  ALLOWED_TREND_SOURCES,
  DEFAULT_TREND_MEMORY,
  TREND_SIGNAL_SCHEMA_VERSION,
  buildTrendInputs,
  buildTrendSignalsFromSocialPerformance,
  buildTrendSiteMetricsFromSocialPerformance,
  clusterStoriesByTrendTopic,
  containsForbiddenPrivateData,
  createTrendTopic,
  explainTrendRanking,
  extractKeywords,
  getStoryExactArticleUrl,
  getStoryId,
  getStoryIdentityKey,
  normalizeTrendSignal,
  publicSelection,
  rankStoryOfWeek,
  rankTopStoryOfDay,
  readTrendSignalMemory,
  saveTrendSignalMemory,
};
