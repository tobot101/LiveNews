const { cleanText, stableHash, tokenize } = require("./article-agents/text-utils");
const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const {
  DEFAULT_SOCIAL_STYLE_MEMORY,
  readSocialStyleMemory,
  saveSocialStyleMemory,
} = require("./social-intelligence");

const SOCIAL_PERFORMANCE_SCHEMA_VERSION = "live-news-social-performance-memory-v1";
const PLATFORMS = new Set(["instagram", "facebook"]);
const PUBLIC_SIGNAL_TYPES = new Set([
  "google_trends",
  "trending_search",
  "trusted_news_pattern",
  "public_platform_trend",
  "official_data",
  "manual_public_signal",
]);
const METRIC_FIELDS = [
  "reach",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "linkClicks",
  "profileVisits",
  "follows",
  "hides",
  "reports",
];
const FORBIDDEN_PRIVATE_KEYS = [
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /secret/i,
  /password/i,
  /cookie/i,
  /email/i,
  /phone/i,
  /username/i,
  /user[_-]?id/i,
  /profile[_-]?id/i,
  /private[_-]?message/i,
  /^dm$/i,
  /comment[_-]?text/i,
  /comments[_-]?text/i,
  /raw[_-]?comments/i,
];

const DEFAULT_SOCIAL_PERFORMANCE_MEMORY = {
  schemaVersion: SOCIAL_PERFORMANCE_SCHEMA_VERSION,
  mode: "private_aggregate_learning_only",
  updatedAt: null,
  autoPostAllowed: false,
  publicVisible: false,
  manualPosts: [],
  publicInterestSignals: [],
  lessons: [],
  safeguards: [
    "Store aggregate post results only.",
    "Do not store usernames, comments, private messages, cookies, tokens, or profile data.",
    "Use public-interest signals only when they come from trusted, public, aggregate sources.",
    "Treat public trends as attention signals, not verified facts.",
    "Optimize for exact Live News article clicks, source trust, usefulness, saves, and shares, not outrage.",
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePlatform(value) {
  return cleanText(value).toLowerCase();
}

function normalizeCategory(value) {
  const text = cleanText(value).toLowerCase();
  if (text === "technology") return "tech";
  if (text === "world") return "international";
  return text || "top";
}

function normalizeExactArticleUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (text.startsWith("/stories/")) return text;
  try {
    const url = new URL(text);
    if (!/^(www\.)?newsmorenow\.com$/i.test(url.hostname)) return "";
    if (!url.pathname.startsWith("/stories/")) return "";
    return `https://newsmorenow.com${url.pathname}`;
  } catch {
    return "";
  }
}

function isExactArticleUrl(value) {
  return Boolean(normalizeExactArticleUrl(value));
}

function normalizeNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function normalizeMetrics(input = {}) {
  return Object.fromEntries(METRIC_FIELDS.map((field) => [field, normalizeNumber(input[field])]));
}

function scanForbiddenPrivateKeys(value, path = "") {
  const hits = [];
  if (!value || typeof value !== "object") return hits;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_PRIVATE_KEYS.some((pattern) => pattern.test(key))) hits.push(nextPath);
    if (nested && typeof nested === "object") hits.push(...scanForbiddenPrivateKeys(nested, nextPath));
  }
  return hits;
}

function validateManualPerformanceInput(input = {}) {
  const failures = [];
  const warnings = [];
  const platform = normalizePlatform(input.platform);
  const exactArticleUrl = normalizeExactArticleUrl(input.exactArticleUrl || input.liveNewsUrl || input.storyUrl);
  const privateKeyHits = scanForbiddenPrivateKeys(input);
  const metrics = normalizeMetrics(input.metrics || input);

  if (!PLATFORMS.has(platform)) failures.push("Platform must be instagram or facebook.");
  if (!exactArticleUrl) failures.push("A manual post result must point to an exact /stories/... Live News article URL.");
  if (!cleanText(input.postedAt)) warnings.push("Posted time is missing; current time will be used.");
  if (privateKeyHits.length) failures.push(`Private or personal fields are not allowed: ${privateKeyHits.join(", ")}.`);
  if (input.personalData === true || input.containsPersonalData === true) {
    failures.push("Manual performance records cannot contain personal data.");
  }
  if (metrics.linkClicks > metrics.reach && metrics.reach > 0) {
    warnings.push("Link clicks are higher than reach; confirm the aggregate metrics before saving.");
  }
  if (metrics.reports > 0 || metrics.hides > 0) {
    warnings.push("This post has hides or reports, so future lessons should lower intensity and check tone.");
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    normalized: {
      platform,
      exactArticleUrl,
      metrics,
    },
  };
}

function validatePublicInterestSignal(input = {}) {
  const failures = [];
  const warnings = [];
  const sourceType = cleanText(input.sourceType || "manual_public_signal").toLowerCase();
  const topic = cleanText(input.topic || input.query || "");
  const sourceUrl = cleanText(input.sourceUrl || "");
  const privateKeyHits = scanForbiddenPrivateKeys(input);

  if (!PUBLIC_SIGNAL_TYPES.has(sourceType)) failures.push("Public signal source type is not allowed.");
  if (!topic) failures.push("Public signal topic is required.");
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    failures.push("Public signal must include a trusted public source URL.");
  }
  if (privateKeyHits.length) failures.push(`Private or personal fields are not allowed: ${privateKeyHits.join(", ")}.`);
  if (input.personalData === true || input.containsPersonalData === true) {
    failures.push("Public-interest signals must be aggregate and cannot contain personal data.");
  }
  if (sourceType === "google_trends" && !/trends\.google\./i.test(sourceUrl)) {
    warnings.push("Google Trends signals should use an official trends.google.* URL.");
  }

  return { ok: failures.length === 0, failures, warnings };
}

function computePostScores(metrics = {}) {
  const reach = normalizeNumber(metrics.reach);
  const views = normalizeNumber(metrics.views);
  const linkClicks = normalizeNumber(metrics.linkClicks);
  const saves = normalizeNumber(metrics.saves);
  const shares = normalizeNumber(metrics.shares);
  const comments = normalizeNumber(metrics.comments);
  const likes = normalizeNumber(metrics.likes);
  const hides = normalizeNumber(metrics.hides);
  const reports = normalizeNumber(metrics.reports);
  const follows = normalizeNumber(metrics.follows);
  const positive =
    linkClicks * 5 +
    saves * 3 +
    shares * 3 +
    comments * 1.2 +
    follows * 2 +
    likes * 0.25 +
    views * 0.01;
  const negative = hides * 4 + reports * 18;
  const score = Math.max(0, Math.round(positive - negative));
  const clickThroughRate = reach > 0 ? Number((linkClicks / reach).toFixed(4)) : 0;
  const usefulnessRate = reach > 0 ? Number(((saves + shares + linkClicks) / reach).toFixed(4)) : 0;
  return {
    score,
    clickThroughRate,
    usefulnessRate,
    positiveSignals: linkClicks + saves + shares + comments + follows,
    negativeSignals: hides + reports,
  };
}

function buildOwnedPerformanceLesson(record) {
  const metrics = record.metrics || {};
  const scores = record.scores || computePostScores(metrics);
  const category = record.category || "top";
  const captionShape = record.captionShape || "unknown caption";
  const platform = record.platform || "social";
  const parts = [];

  if (metrics.reports > 0 || metrics.hides > Math.max(3, metrics.reach * 0.01)) {
    parts.push(`${platform} ${category} posts with ${captionShape} need calmer wording when hides or reports appear.`);
  }
  if (metrics.linkClicks >= 10 || scores.clickThroughRate >= 0.02) {
    parts.push(`${platform} ${category} posts with ${captionShape} moved users to exact Live News articles.`);
  }
  if (metrics.saves + metrics.shares >= metrics.likes && metrics.saves + metrics.shares > 0) {
    parts.push(`${platform} ${category} posts earned useful saves/shares, which is stronger than lightweight likes.`);
  }
  if (metrics.likes > 0 && metrics.linkClicks === 0) {
    parts.push(`${platform} ${category} posts got attention without article traffic; strengthen the article reason and exact-link callout.`);
  }
  if (!parts.length) {
    parts.push(`${platform} ${category} post results were recorded for future comparison without changing strategy yet.`);
  }

  return {
    lessonId: `ln-social-lesson-${stableHash(`${record.performanceId}:${parts.join("|")}`, 12)}`,
    type: "owned_performance",
    confidence: scores.positiveSignals >= 20 ? "medium" : "early_signal",
    createdAt: nowIso(),
    category,
    platform,
    exactArticleUrl: record.exactArticleUrl,
    captionShape,
    lesson: parts.join(" "),
    safeToUseInDrafting: true,
  };
}

function normalizeManualPostRecord(input, validation) {
  const metrics = validation.normalized.metrics;
  const postedAt = cleanText(input.postedAt) || nowIso();
  const exactArticleUrl = validation.normalized.exactArticleUrl;
  const record = {
    schemaVersion: "live-news-manual-social-post-v1",
    performanceId: `ln-social-performance-${stableHash(`${validation.normalized.platform}:${exactArticleUrl}:${postedAt}`, 14)}`,
    recordedAt: nowIso(),
    postedAt,
    platform: validation.normalized.platform,
    storyId: cleanText(input.storyId || ""),
    socialDraftId: cleanText(input.socialDraftId || ""),
    exactArticleUrl,
    manualPostUrl: cleanText(input.manualPostUrl || ""),
    category: normalizeCategory(input.category),
    captionShape: cleanText(input.captionShape || "unknown"),
    mediaShape: cleanText(input.mediaShape || "unknown"),
    postType: cleanText(input.postType || "manual_post"),
    metrics,
    scores: computePostScores(metrics),
    privacy: {
      aggregateOnly: true,
      storesPersonalData: false,
      storesCommentsText: false,
      storesTokens: false,
    },
  };
  return record;
}

function normalizePublicInterestSignal(input) {
  const score = Math.min(100, Math.max(0, normalizeNumber(input.publicInterestScore || input.trendScore || input.score)));
  const collectedAt = cleanText(input.collectedAt) || nowIso();
  return {
    schemaVersion: "live-news-public-interest-signal-v1",
    signalId: `ln-public-signal-${stableHash(`${input.sourceType}:${input.topic || input.query}:${input.sourceUrl}:${collectedAt}`, 14)}`,
    recordedAt: nowIso(),
    collectedAt,
    sourceType: cleanText(input.sourceType || "manual_public_signal").toLowerCase(),
    sourceName: cleanText(input.sourceName || "Trusted public source"),
    sourceUrl: cleanText(input.sourceUrl),
    topic: cleanText(input.topic || input.query),
    category: normalizeCategory(input.category),
    geo: cleanText(input.geo || "US"),
    publicInterestScore: score,
    relatedQueries: (input.relatedQueries || [])
      .map(cleanText)
      .filter(Boolean)
      .slice(0, 12),
    notes: cleanText(input.notes || ""),
    privacy: {
      aggregatePublicSignal: true,
      storesPersonalData: false,
      storesCookies: false,
    },
  };
}

function buildPublicInterestLesson(signal) {
  const level = signal.publicInterestScore >= 80 ? "high" : signal.publicInterestScore >= 50 ? "moderate" : "early";
  return {
    lessonId: `ln-public-interest-${stableHash(`${signal.signalId}:${level}`, 12)}`,
    type: "public_interest",
    confidence: level === "high" ? "medium" : "early_signal",
    createdAt: nowIso(),
    category: signal.category,
    platform: "public_web",
    topic: signal.topic,
    sourceType: signal.sourceType,
    sourceUrl: signal.sourceUrl,
    lesson: `${signal.topic} shows ${level} public interest from ${signal.sourceName}. Use this as an attention signal, then verify facts through Live News source data before drafting.`,
    safeToUseInDrafting: true,
  };
}

function sharedTokenCount(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function buildCombinedLessons(store) {
  const posts = store.manualPosts || [];
  const signals = store.publicInterestSignals || [];
  const lessons = [];
  for (const post of posts.slice(0, 40)) {
    const matched = signals
      .filter((signal) => signal.category === post.category || sharedTokenCount(signal.topic, post.exactArticleUrl) > 0)
      .sort((a, b) => b.publicInterestScore - a.publicInterestScore)
      .slice(0, 2);
    for (const signal of matched) {
      const highInterest = signal.publicInterestScore >= 70;
      const strongTraffic = post.scores?.clickThroughRate >= 0.02 || post.metrics?.linkClicks >= 10;
      if (highInterest && strongTraffic) {
        lessons.push({
          lessonId: `ln-combined-${stableHash(`${post.performanceId}:${signal.signalId}:aligned`, 12)}`,
          type: "public_plus_owned",
          confidence: "medium",
          createdAt: nowIso(),
          category: post.category,
          platform: post.platform,
          topic: signal.topic,
          exactArticleUrl: post.exactArticleUrl,
          lesson: `${signal.topic} had public-interest support and the ${post.captionShape} ${post.platform} post brought users to the exact article. Keep this angle style for similar source-backed stories.`,
          safeToUseInDrafting: true,
        });
      } else if (highInterest && !strongTraffic) {
        lessons.push({
          lessonId: `ln-combined-${stableHash(`${post.performanceId}:${signal.signalId}:missed`, 12)}`,
          type: "public_plus_owned",
          confidence: "early_signal",
          createdAt: nowIso(),
          category: post.category,
          platform: post.platform,
          topic: signal.topic,
          exactArticleUrl: post.exactArticleUrl,
          lesson: `${signal.topic} had public interest, but the related ${post.platform} post did not create strong exact-article traffic. Improve the human angle, visual clarity, or callout before repeating it.`,
          safeToUseInDrafting: true,
        });
      }
    }
  }
  return lessons;
}

function compactLessons(lessons) {
  const seen = new Set();
  const result = [];
  for (const lesson of lessons) {
    if (!lesson.lesson || seen.has(lesson.lessonId)) continue;
    seen.add(lesson.lessonId);
    result.push(lesson);
  }
  return result.slice(0, 80);
}

function refreshPerformanceMemoryLessons(store) {
  const owned = (store.manualPosts || []).slice(0, 60).map(buildOwnedPerformanceLesson);
  const publicLessons = (store.publicInterestSignals || []).slice(0, 60).map(buildPublicInterestLesson);
  const combined = buildCombinedLessons(store);
  return compactLessons([...combined, ...owned, ...publicLessons, ...(store.lessons || [])]);
}

function createEmptySocialPerformanceMemory() {
  return clone(DEFAULT_SOCIAL_PERFORMANCE_MEMORY);
}

function readSocialPerformanceMemory() {
  const store = readJson(STORE_PATHS.socialPerformance, DEFAULT_SOCIAL_PERFORMANCE_MEMORY);
  return {
    ...clone(DEFAULT_SOCIAL_PERFORMANCE_MEMORY),
    ...store,
    schemaVersion: SOCIAL_PERFORMANCE_SCHEMA_VERSION,
  };
}

function saveSocialPerformanceMemory(store) {
  writeJson(STORE_PATHS.socialPerformance, {
    ...clone(DEFAULT_SOCIAL_PERFORMANCE_MEMORY),
    ...store,
    schemaVersion: SOCIAL_PERFORMANCE_SCHEMA_VERSION,
    updatedAt: nowIso(),
    autoPostAllowed: false,
    publicVisible: false,
  });
}

function addManualPostPerformance(store, input) {
  const validation = validateManualPerformanceInput(input);
  if (!validation.ok) {
    const error = new Error(`Manual social performance is not safe to save: ${validation.failures.join(" ")}`);
    error.failures = validation.failures;
    throw error;
  }
  const record = normalizeManualPostRecord(input, validation);
  const manualPosts = [
    record,
    ...(store.manualPosts || []).filter((item) => item.performanceId !== record.performanceId),
  ].slice(0, 250);
  const nextStore = {
    ...store,
    manualPosts,
    updatedAt: nowIso(),
  };
  nextStore.lessons = refreshPerformanceMemoryLessons(nextStore);
  return {
    store: nextStore,
    record,
    warnings: validation.warnings,
  };
}

function addPublicInterestSignal(store, input) {
  const validation = validatePublicInterestSignal(input);
  if (!validation.ok) {
    const error = new Error(`Public-interest signal is not safe to save: ${validation.failures.join(" ")}`);
    error.failures = validation.failures;
    throw error;
  }
  const signal = normalizePublicInterestSignal(input);
  const publicInterestSignals = [
    signal,
    ...(store.publicInterestSignals || []).filter((item) => item.signalId !== signal.signalId),
  ].slice(0, 250);
  const nextStore = {
    ...store,
    publicInterestSignals,
    updatedAt: nowIso(),
  };
  nextStore.lessons = refreshPerformanceMemoryLessons(nextStore);
  return {
    store: nextStore,
    signal,
    warnings: validation.warnings,
  };
}

function summarizePerformanceMemory(store) {
  const posts = store.manualPosts || [];
  const signals = store.publicInterestSignals || [];
  const total = posts.reduce(
    (sum, post) => {
      for (const field of METRIC_FIELDS) sum[field] += normalizeNumber(post.metrics?.[field]);
      sum.score += normalizeNumber(post.scores?.score);
      return sum;
    },
    Object.fromEntries([...METRIC_FIELDS, "score"].map((field) => [field, 0]))
  );
  const byCategory = posts.reduce((counts, post) => {
    counts[post.category] = (counts[post.category] || 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: "live-news-social-performance-summary-v1",
    mode: store.mode,
    autoPostAllowed: false,
    publicVisible: false,
    postCount: posts.length,
    publicSignalCount: signals.length,
    lessonCount: (store.lessons || []).length,
    totals: total,
    byCategory,
    strongestLessons: (store.lessons || []).slice(0, 8),
    safeguards: store.safeguards || DEFAULT_SOCIAL_PERFORMANCE_MEMORY.safeguards,
  };
}

function syncSocialStyleMemoryWithPerformance(store, styleMemory = readSocialStyleMemory()) {
  const lessons = (store.lessons || [])
    .filter((lesson) => lesson.safeToUseInDrafting)
    .slice(0, 40)
    .map((lesson) => ({
      lessonId: lesson.lessonId,
      type: lesson.type,
      confidence: lesson.confidence,
      category: lesson.category,
      platform: lesson.platform,
      lesson: lesson.lesson,
      learnedAt: nowIso(),
    }));
  const existing = styleMemory.performanceLessons || [];
  const seen = new Set();
  const performanceLessons = [...lessons, ...existing].filter((lesson) => {
    const key = lesson.lessonId || lesson.lesson;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
  const nextStyleMemory = {
    ...DEFAULT_SOCIAL_STYLE_MEMORY,
    ...styleMemory,
    performanceLessons,
    updatedAt: nowIso(),
    autoPostAllowed: false,
  };
  return nextStyleMemory;
}

function recordManualPostPerformance(input) {
  const current = readSocialPerformanceMemory();
  const result = addManualPostPerformance(current, input);
  saveSocialPerformanceMemory(result.store);
  const styleMemory = syncSocialStyleMemoryWithPerformance(result.store);
  saveSocialStyleMemory(styleMemory);
  return result;
}

function recordPublicInterestSignal(input) {
  const current = readSocialPerformanceMemory();
  const result = addPublicInterestSignal(current, input);
  saveSocialPerformanceMemory(result.store);
  const styleMemory = syncSocialStyleMemoryWithPerformance(result.store);
  saveSocialStyleMemory(styleMemory);
  return result;
}

function refreshSavedPerformanceLessons() {
  const current = readSocialPerformanceMemory();
  const nextStore = {
    ...current,
    lessons: refreshPerformanceMemoryLessons(current),
    updatedAt: nowIso(),
  };
  saveSocialPerformanceMemory(nextStore);
  const styleMemory = syncSocialStyleMemoryWithPerformance(nextStore);
  saveSocialStyleMemory(styleMemory);
  return nextStore;
}

module.exports = {
  DEFAULT_SOCIAL_PERFORMANCE_MEMORY,
  SOCIAL_PERFORMANCE_SCHEMA_VERSION,
  addManualPostPerformance,
  addPublicInterestSignal,
  createEmptySocialPerformanceMemory,
  readSocialPerformanceMemory,
  recordManualPostPerformance,
  recordPublicInterestSignal,
  refreshPerformanceMemoryLessons,
  refreshSavedPerformanceLessons,
  saveSocialPerformanceMemory,
  summarizePerformanceMemory,
  syncSocialStyleMemoryWithPerformance,
  validateManualPerformanceInput,
  validatePublicInterestSignal,
};
