const { cleanText, stableHash, tokenize } = require("./article-agents/text-utils");
const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const {
  DEFAULT_SOCIAL_STYLE_MEMORY,
  readSocialStyleMemory,
  saveSocialStyleMemory,
} = require("./social-intelligence");

const SOCIAL_PERFORMANCE_SCHEMA_VERSION = "live-news-social-performance-memory-v3";
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
  "commentsCount",
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
  /^usernames?$/i,
  /user[_-]?name/i,
  /user[_-]?id/i,
  /profile[_-]?id/i,
  /personal[_-]?profiles?/i,
  /individual[_-]?identit(y|ies)/i,
  /private[_-]?messages?/i,
  /direct[_-]?messages?/i,
  /^dm$/i,
  /^dms$/i,
  /comment[_-]?text/i,
  /comments[_-]?text/i,
  /public[_-]?comment[_-]?text/i,
  /copied[_-]?comments?/i,
  /exact[_-]?comments?/i,
  /comment[_-]?quote/i,
  /comment[_-]?body/i,
  /raw[_-]?comments/i,
  /commenters?/i,
  /screen[_-]?names?/i,
  /profile[_-]?urls?/i,
];

const UNSAFE_AGGREGATE_TEXT_PATTERNS = [
  { id: "username_or_handle", pattern: /@\w[\w.]{1,30}/gi, replacement: "[private handle removed]" },
  {
    id: "private_message",
    pattern: /\b(private message|direct message|dm\b|dms\b|inbox message|messaged me|texted me)\b/gi,
    replacement: "[private message reference removed]",
  },
  {
    id: "personal_profile",
    pattern: /\b(usernames?|user names?|profiles?|profile links?|personal accounts?|screen names?|handles?)\b/gi,
    replacement: "[personal profile reference removed]",
  },
  {
    id: "copied_comment_text",
    pattern: /\b(comment text|copied comments?|exact comments?|comment quote|comment body|raw comments?|a commenter said|comments said|fans are saying|internet reacts)\b:?/gi,
    replacement: "[copied comment reference removed]",
  },
  {
    id: "private_admin_url",
    pattern: /https?:\/\/[^\s"'<>]*\/admin\/[^\s"'<>]*/gi,
    replacement: "[private admin URL removed]",
  },
  {
    id: "token_or_secret",
    pattern: /\b(?:bearer\s+[a-z0-9._-]+|access_token|admin_token|meta_token|railway_token|private_secret|client_secret|token=)[^\s"'<>]*/gi,
    replacement: "[private credential removed]",
  },
  { id: "quoted_text", pattern: /["“”'][^"“”']{12,280}["“”']/g, replacement: "[quoted text removed]" },
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
    "Do not store usernames, copied comment text, private messages, cookies, tokens, or profile data.",
    "Use public-interest signals only when they come from trusted, public, aggregate sources.",
    "Treat public trends as attention signals, not verified facts.",
    "Optimize for exact Live News article clicks, source trust, usefulness, saves, and shares, not outrage.",
    "Writing-shape lessons come only from aggregate performance or editor-approved corrections.",
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
  return Object.fromEntries(
    METRIC_FIELDS.map((field) => {
      if (field === "commentsCount") return [field, normalizeNumber(input.commentsCount ?? input.comments)];
      return [field, normalizeNumber(input[field])];
    })
  );
}

function getMetric(metrics = {}, field) {
  if (field === "commentsCount") return normalizeNumber(metrics.commentsCount ?? metrics.comments);
  return normalizeNumber(metrics[field]);
}

function sanitizeAggregateNoteWithBlockedData(value) {
  let text = cleanText(value);
  const removed = new Set();
  for (const entry of UNSAFE_AGGREGATE_TEXT_PATTERNS) {
    if (entry.pattern.test(text)) {
      removed.add(entry.id);
      text = text.replace(entry.pattern, entry.replacement);
    }
    entry.pattern.lastIndex = 0;
  }
  return {
    text: cleanText(text).slice(0, 500),
    blockedData: {
      removed: [...removed],
      safeNote: "Unsafe private, comment, profile, or credential details were removed before storage.",
    },
  };
}

function sanitizeAggregateNote(value) {
  return sanitizeAggregateNoteWithBlockedData(value).text;
}

function sanitizeLessonText(value) {
  return sanitizeAggregateNote(value)
    .replace(/\[redacted handle\]/gi, "a private handle")
    .replace(/\[private detail removed\]/gi, "private detail")
    .replace(/\[quoted text removed\]/gi, "quoted text")
    .slice(0, 500);
}

function normalizePostingTime(input = {}) {
  return cleanText(input.postingTime || input.postedAt) || nowIso();
}

function deriveArticleId(input = {}, exactArticleUrl = "") {
  const explicit = cleanText(input.articleId || input.storyId || "");
  if (explicit) return explicit;
  const path = exactArticleUrl.startsWith("/stories/")
    ? exactArticleUrl
    : (() => {
        try {
          return new URL(exactArticleUrl).pathname;
        } catch {
          return "";
        }
      })();
  return cleanText(path.split("/").filter(Boolean).pop() || "");
}

function humanizeCaptionShape(shape = "") {
  const normalized = cleanText(shape).toLowerCase();
  const known = {
    clear_player_matchup_first_sentence: "a clear player matchup in the first sentence",
    player_matchup_first_sentence: "a clear player matchup in the first sentence",
    player_matchup: "a clear player matchup",
    generic_title_based: "generic title-based",
    title_based: "title-based",
    source_first: "source-first",
    reader_impact: "reader-impact",
    concise_news: "concise-news",
    context_first: "context-first",
  };
  if (known[normalized]) return known[normalized];
  return normalized.replace(/[_-]+/g, " ") || "unknown";
}

function humanizeWritingShape(shape = "") {
  const normalized = cleanText(shape).toLowerCase();
  const known = {
    specific_event_plus_context: "specific event plus context",
    specific_event_plus_place_context: "specific event plus place context",
    person_or_group_plus_action: "person or group plus action",
    latest_development_plus_background: "latest development plus background",
    source_backed_explainer: "source-backed explainer",
    matchup_or_event_significance: "matchup or event significance",
    company_action_plus_reader_impact: "company action plus reader impact",
    product_or_platform_plus_user_context: "product or platform plus user context",
    search_intent_plus_source_safe_context: "search intent plus source-safe context",
    platform_caption_plus_exact_story_link: "platform caption plus exact story link",
    fallback_style_summary: "fallback-style summaries",
    generic_fallback: "generic fallback",
    unknown: "unknown",
  };
  if (known[normalized]) return known[normalized];
  return normalized.replace(/[_-]+/g, " ") || "unknown";
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
  const noteScan = sanitizeAggregateNoteWithBlockedData(input.editorNotes || input.notes || "");
  const manualPostUrlScan = sanitizeAggregateNoteWithBlockedData(input.manualPostUrl || "");

  if (!PLATFORMS.has(platform)) failures.push("Platform must be instagram or facebook.");
  if (!exactArticleUrl) failures.push("A manual post result must point to an exact /stories/... Live News article URL.");
  if (!cleanText(input.postingTime || input.postedAt)) warnings.push("Posting time is missing; current time will be used.");
  if (privateKeyHits.length) failures.push(`Private or personal fields are not allowed: ${privateKeyHits.join(", ")}.`);
  if (noteScan.blockedData.removed.length) {
    warnings.push(`Unsafe editor-note details were removed: ${noteScan.blockedData.removed.join(", ")}.`);
  }
  if (manualPostUrlScan.blockedData.removed.some((id) => id === "private_admin_url" || id === "token_or_secret")) {
    failures.push("Manual post URL cannot include private admin URLs, tokens, or credentials.");
  }
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
  const reach = getMetric(metrics, "reach");
  const views = getMetric(metrics, "views");
  const linkClicks = getMetric(metrics, "linkClicks");
  const saves = getMetric(metrics, "saves");
  const shares = getMetric(metrics, "shares");
  const commentsCount = getMetric(metrics, "commentsCount");
  const likes = getMetric(metrics, "likes");
  const hides = getMetric(metrics, "hides");
  const reports = getMetric(metrics, "reports");
  const follows = getMetric(metrics, "follows");
  const positive =
    linkClicks * 5 +
    saves * 3 +
    shares * 3 +
    commentsCount * 1.2 +
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
    positiveSignals: linkClicks + saves + shares + commentsCount + follows,
    negativeSignals: hides + reports,
  };
}

function buildOwnedPerformanceLesson(record) {
  const metrics = record.metrics || {};
  const scores = record.scores || computePostScores(metrics);
  const category = record.category || "top";
  const captionShape = humanizeCaptionShape(record.captionShape || "unknown caption");
  const writingShape = humanizeWritingShape(record.writingShape || "unknown");
  const writingShapeId = cleanText(record.writingShape || "").toLowerCase();
  const usableWritingShape = writingShapeId && !/fallback|generic|unknown/.test(writingShapeId);
  const platform = record.platform || "social";
  const parts = [];
  const tentative = scores.positiveSignals < 20 || getMetric(metrics, "reach") < 500;

  if (getMetric(metrics, "reports") > 0 || getMetric(metrics, "hides") > Math.max(3, getMetric(metrics, "reach") * 0.01)) {
    parts.push(`${platform} ${category} posts with ${captionShape} need calmer wording when hides or reports appear.`);
  }
  if (getMetric(metrics, "linkClicks") >= 10 || scores.clickThroughRate >= 0.02) {
    parts.push(`${platform} ${category} posts using ${captionShape} helped readers reach exact Live News article pages.`);
  }
  if (usableWritingShape && (getMetric(metrics, "linkClicks") >= 10 || scores.clickThroughRate >= 0.02)) {
    parts.push(`${platform} ${category} posts shaped around ${writingShape} created stronger exact-article traffic than vague fallback wording.`);
  }
  if (getMetric(metrics, "saves") + getMetric(metrics, "shares") >= getMetric(metrics, "likes") && getMetric(metrics, "saves") + getMetric(metrics, "shares") > 0) {
    parts.push(`${platform} ${category} posts earned useful saves/shares, which is stronger than lightweight likes.`);
  }
  if (getMetric(metrics, "likes") > 0 && getMetric(metrics, "linkClicks") === 0) {
    parts.push(`${platform} ${category} posts got attention without article traffic; strengthen the article reason and exact-link callout.`);
  }
  if (!parts.length) {
    parts.push(`${platform} ${category} post results were recorded for future comparison without changing strategy yet.`);
  }

  return {
    lessonId: `ln-social-lesson-${stableHash(`${record.performanceId}:${parts.join("|")}`, 12)}`,
    type: "owned_performance",
    confidence: tentative ? "tentative" : "medium",
    sampleSize: 1,
    tentative,
    createdAt: nowIso(),
    category,
    platform,
    exactArticleUrl: record.exactArticleUrl,
    captionShape: record.captionShape,
    writingShape: record.writingShape,
    selectedVariant: record.selectedVariant,
    lesson: sanitizeLessonText(parts.join(" ")),
    aggregateMetrics: {
      reach: getMetric(metrics, "reach"),
      linkClicks: getMetric(metrics, "linkClicks"),
      saves: getMetric(metrics, "saves"),
      shares: getMetric(metrics, "shares"),
      hides: getMetric(metrics, "hides"),
      reports: getMetric(metrics, "reports"),
      score: scores.score,
    },
    usesOnlyAggregateMetrics: true,
    privateDataExcluded: true,
    safeToUseInDrafting: true,
  };
}

function normalizeManualPostRecord(input, validation) {
  const metrics = validation.normalized.metrics;
  const postingTime = normalizePostingTime(input);
  const exactArticleUrl = validation.normalized.exactArticleUrl;
  const articleId = deriveArticleId(input, exactArticleUrl);
  const sanitizedNotes = sanitizeAggregateNoteWithBlockedData(input.editorNotes || input.notes || "");
  const writingShape = cleanText(input.writingShape || input.descriptionShape || input.storyWritingShape || "unknown");
  const record = {
    schemaVersion: "live-news-manual-social-post-v1",
    performanceId: `ln-social-performance-${stableHash(`${validation.normalized.platform}:${exactArticleUrl}:${postingTime}`, 14)}`,
    recordedAt: nowIso(),
    postingTime,
    postedAt: postingTime,
    articleId,
    platform: validation.normalized.platform,
    storyId: cleanText(input.storyId || ""),
    socialDraftId: cleanText(input.socialDraftId || ""),
    selectedVariant: cleanText(input.selectedVariant || input.variantId || "unknown"),
    exactArticleUrl,
    manualPostUrl: cleanText(input.manualPostUrl || ""),
    category: normalizeCategory(input.category),
    captionShape: cleanText(input.captionShape || "unknown"),
    mediaShape: cleanText(input.mediaShape || "unknown"),
    writingShape,
    postType: cleanText(input.postType || "manual_post"),
    editorNotes: sanitizedNotes.text,
    blockedData: sanitizedNotes.blockedData,
    ...metrics,
    metrics,
    scores: computePostScores(metrics),
    privacy: {
      aggregateOnly: true,
      storesPersonalData: false,
      storesCommentsText: false,
      storesTokens: false,
    },
  };
  record.lessons = [buildOwnedPerformanceLesson(record)];
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

function buildCaptionShapeComparisonLessons(posts = []) {
  const groups = new Map();
  for (const post of posts) {
    const key = `${post.platform || "social"}|${post.category || "top"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }

  const lessons = [];
  for (const [key, groupPosts] of groups.entries()) {
    const [platform, category] = key.split("|");
    const shapeStats = new Map();
    for (const post of groupPosts) {
      const shape = cleanText(post.captionShape || "unknown");
      if (!shapeStats.has(shape)) {
        shapeStats.set(shape, {
          captionShape: shape,
          sampleSize: 0,
          score: 0,
          linkClicks: 0,
          saves: 0,
          shares: 0,
          hides: 0,
          reports: 0,
        });
      }
      const stats = shapeStats.get(shape);
      stats.sampleSize += 1;
      stats.score += getMetric(post.scores || {}, "score");
      stats.linkClicks += getMetric(post.metrics || post, "linkClicks");
      stats.saves += getMetric(post.metrics || post, "saves");
      stats.shares += getMetric(post.metrics || post, "shares");
      stats.hides += getMetric(post.metrics || post, "hides");
      stats.reports += getMetric(post.metrics || post, "reports");
    }

    const ranked = [...shapeStats.values()]
      .map((stats) => ({
        ...stats,
        averageScore: stats.sampleSize ? stats.score / stats.sampleSize : 0,
      }))
      .sort((a, b) => b.averageScore - a.averageScore);

    if (ranked.length < 2 || ranked[0].averageScore <= 0) continue;
    const top = ranked[0];
    const next = ranked[1];
    if (top.averageScore < Math.max(8, next.averageScore * 1.15)) continue;
    const sampleSize = top.sampleSize + next.sampleSize;
    const confidence = sampleSize >= 5 ? "medium" : "tentative";
    const topShape = humanizeCaptionShape(top.captionShape);
    const nextShape = humanizeCaptionShape(next.captionShape);
    lessons.push({
      lessonId: `ln-shape-comparison-${stableHash(`${platform}:${category}:${top.captionShape}:${next.captionShape}`, 12)}`,
      type: "caption_shape_comparison",
      confidence,
      sampleSize,
      tentative: confidence === "tentative",
      createdAt: nowIso(),
      category,
      platform,
      captionShape: top.captionShape,
      comparedWith: next.captionShape,
      lesson: sanitizeLessonText(
        `${category.charAt(0).toUpperCase()}${category.slice(1)} posts with ${topShape} performed better than ${nextShape} captions based on aggregate clicks, saves, shares, and low negative feedback.`
      ),
      aggregateMetrics: {
        topShape,
        comparedShape: nextShape,
        topAverageScore: Number(top.averageScore.toFixed(2)),
        comparedAverageScore: Number(next.averageScore.toFixed(2)),
        sampleSize,
      },
      usesOnlyAggregateMetrics: true,
      privateDataExcluded: true,
      safeToUseInDrafting: true,
    });
  }
  return lessons;
}

function buildWritingShapeComparisonLessons(posts = []) {
  const groups = new Map();
  for (const post of posts) {
    if (!cleanText(post.writingShape) || cleanText(post.writingShape) === "unknown") continue;
    const key = `${post.platform || "social"}|${post.category || "top"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }

  const lessons = [];
  for (const [key, groupPosts] of groups.entries()) {
    const [platform, category] = key.split("|");
    const shapeStats = new Map();
    for (const post of groupPosts) {
      const shape = cleanText(post.writingShape || "unknown");
      if (!shapeStats.has(shape)) {
        shapeStats.set(shape, {
          writingShape: shape,
          sampleSize: 0,
          score: 0,
          linkClicks: 0,
          saves: 0,
          shares: 0,
          hides: 0,
          reports: 0,
        });
      }
      const stats = shapeStats.get(shape);
      stats.sampleSize += 1;
      stats.score += getMetric(post.scores || {}, "score");
      stats.linkClicks += getMetric(post.metrics || post, "linkClicks");
      stats.saves += getMetric(post.metrics || post, "saves");
      stats.shares += getMetric(post.metrics || post, "shares");
      stats.hides += getMetric(post.metrics || post, "hides");
      stats.reports += getMetric(post.metrics || post, "reports");
    }

    const ranked = [...shapeStats.values()]
      .map((stats) => ({
        ...stats,
        averageScore: stats.sampleSize ? stats.score / stats.sampleSize : 0,
      }))
      .sort((a, b) => b.averageScore - a.averageScore);

    if (ranked.length < 2 || ranked[0].averageScore <= 0) continue;
    const top = ranked[0];
    const next = ranked[1];
    if (top.averageScore < Math.max(8, next.averageScore * 1.15)) continue;
    const sampleSize = top.sampleSize + next.sampleSize;
    const confidence = sampleSize >= 5 ? "medium" : "tentative";
    const topShape = humanizeWritingShape(top.writingShape);
    const nextShape = humanizeWritingShape(next.writingShape);
    lessons.push({
      lessonId: `ln-writing-shape-comparison-${stableHash(`${platform}:${category}:${top.writingShape}:${next.writingShape}`, 12)}`,
      type: "writing_shape_comparison",
      confidence,
      sampleSize,
      tentative: confidence === "tentative",
      createdAt: nowIso(),
      category,
      platform,
      writingShape: top.writingShape,
      comparedWith: next.writingShape,
      lesson: sanitizeLessonText(
        `${category.charAt(0).toUpperCase()}${category.slice(1)} posts using ${topShape} writing performed better than ${nextShape} based on aggregate clicks, saves, shares, and low negative feedback.`
      ),
      aggregateMetrics: {
        topShape,
        comparedShape: nextShape,
        topAverageScore: Number(top.averageScore.toFixed(2)),
        comparedAverageScore: Number(next.averageScore.toFixed(2)),
        sampleSize,
      },
      usesOnlyAggregateMetrics: true,
      privateDataExcluded: true,
      safeToUseInDrafting: true,
    });
  }
  return lessons;
}

function compactLessons(lessons) {
  const seen = new Set();
  const result = [];
  for (const lesson of lessons) {
    if (!lesson.lesson || seen.has(lesson.lessonId)) continue;
    const safeLesson = {
      ...lesson,
      lesson: sanitizeLessonText(lesson.lesson),
      usesOnlyAggregateMetrics: lesson.usesOnlyAggregateMetrics !== false,
      privateDataExcluded: lesson.privateDataExcluded !== false,
      safeToUseInDrafting: lesson.safeToUseInDrafting !== false,
    };
    if (/@\w|private message|direct message|copied comment|comment text|username|profile id|user id/i.test(safeLesson.lesson)) {
      continue;
    }
    seen.add(safeLesson.lessonId);
    result.push(safeLesson);
  }
  return result.slice(0, 80);
}

function refreshPerformanceMemoryLessons(store) {
  const posts = (store.manualPosts || []).slice(0, 80);
  const comparisons = buildCaptionShapeComparisonLessons(posts);
  const writingShapeComparisons = buildWritingShapeComparisonLessons(posts);
  const owned = posts.map(buildOwnedPerformanceLesson);
  const publicLessons = (store.publicInterestSignals || []).slice(0, 60).map(buildPublicInterestLesson);
  const combined = buildCombinedLessons(store);
  return compactLessons([...comparisons, ...writingShapeComparisons, ...combined, ...owned, ...publicLessons, ...(store.lessons || [])]);
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
      for (const field of METRIC_FIELDS) sum[field] += getMetric(post.metrics || post, field);
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
      captionShape: lesson.captionShape,
      writingShape: lesson.writingShape,
      selectedVariant: lesson.selectedVariant,
      lesson: lesson.lesson,
      usesOnlyAggregateMetrics: lesson.usesOnlyAggregateMetrics !== false,
      privateDataExcluded: lesson.privateDataExcluded !== false,
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
