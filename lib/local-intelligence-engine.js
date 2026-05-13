const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getLocalIntelligenceConfig } = require("./local-intelligence-config");

const LOCAL_INTELLIGENCE_CONFIG = getLocalIntelligenceConfig();
const PUBLIC_WINDOW_DAYS = LOCAL_INTELLIGENCE_CONFIG.storyPublicTtlDays;
const NEWS_SITEMAP_WINDOW_HOURS = LOCAL_INTELLIGENCE_CONFIG.googleNewsTtlHours;
const THIN_PAGE_MIN_STORIES = 3;
const THIN_PAGE_MIN_SOURCES = 2;
const SOURCE_REGISTRY_PATH = path.join(__dirname, "..", "data", "local-intelligence-sources.json");
const STORE_PATH = path.join(__dirname, "..", "data", "local-intelligence-store.json");

const LOCAL_TOPIC_RULES = [
  {
    id: "public_safety",
    label: "Public safety",
    terms: ["evacuation", "shelter", "road closure", "missing person", "emergency", "recall", "warning", "advisory", "fire", "police", "crash"],
    sensitive: true,
  },
  {
    id: "weather",
    label: "Weather",
    terms: ["storm", "rain", "snow", "heat", "wind", "weather", "forecast", "flood", "tornado"],
  },
  {
    id: "traffic_transit",
    label: "Traffic & transit",
    terms: ["traffic", "transit", "bus", "train", "rail", "freeway", "highway", "road", "bridge", "airport"],
  },
  {
    id: "schools",
    label: "Schools",
    terms: ["school", "student", "teacher", "district", "campus", "college", "university", "education"],
  },
  {
    id: "local_government",
    label: "Local government",
    terms: ["city council", "mayor", "county", "budget", "ordinance", "zoning", "hearing", "vote"],
  },
  {
    id: "business",
    label: "Local business",
    terms: ["business", "restaurant", "store", "company", "workers", "jobs", "downtown", "development"],
  },
  {
    id: "community",
    label: "Community",
    terms: ["community", "neighborhood", "residents", "festival", "library", "park", "volunteer"],
  },
  {
    id: "sports",
    label: "Sports",
    terms: ["team", "coach", "player", "game", "season", "wins", "stadium", "tournament"],
  },
  {
    id: "arts_entertainment",
    label: "Arts & entertainment",
    terms: ["concert", "movie", "music", "museum", "theater", "festival", "artist", "performance"],
  },
];

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "city",
  "county",
  "for",
  "from",
  "in",
  "is",
  "local",
  "more",
  "new",
  "news",
  "of",
  "on",
  "over",
  "says",
  "the",
  "to",
  "up",
  "with",
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stableHash(value, length = 16) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function readLocalSourceRegistry(filePath = SOURCE_REGISTRY_PATH) {
  return readJson(filePath, {
    schemaVersion: "live-news-local-intelligence-sources-v1",
    updatedAt: null,
    sources: [],
  });
}

function getApprovedLocalSources(registry = readLocalSourceRegistry()) {
  return (registry.sources || []).filter((source) => (
    source &&
    source.enabled !== false &&
    source.approvedPublicSource === true &&
    source.requiresCredentials !== true
  ));
}

function buildGoogleNewsRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function buildLocalIntakePlan(place, queryVariants = [], registry = readLocalSourceRegistry(), options = {}) {
  const config = options.config || getLocalIntelligenceConfig();
  const approvedSources = getApprovedLocalSources(registry);
  const requests = [];
  for (const source of approvedSources) {
    const rateLimit = source.rateLimit || {};
    if (source.id === "google-news-local-rss-search" || source.type === "public_rss_search") {
      for (const query of queryVariants) {
        requests.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          query,
          url: buildGoogleNewsRssUrl(query),
          cursor: null,
          nextCursor: null,
          cursorSupported: Boolean(source.cursorSupport?.supported),
          collectionMethod: source.collectionMethod,
          rateLimit: {
            ...rateLimit,
            defaultMinimumDelayMinutes: Number(rateLimit.defaultMinimumDelayMinutes || config.sourceDefaultRateLimitMinutes),
          },
          timeoutMs: config.sourceFetchTimeoutMs,
          userAgent: config.crawlerUserAgent,
          approvedPublicSource: true,
          place: normalizePlace(place),
        });
      }
    }
  }
  return {
    schemaVersion: "live-news-local-intake-plan-v1",
    place: normalizePlace(place),
    requestCount: requests.length,
    fixedIntakeLimit: null,
    cursorCapable: approvedSources.some((source) => source.cursorSupport?.supported),
    sourceFetchConcurrency: config.sourceFetchConcurrency,
    sourceFetchTimeoutMs: config.sourceFetchTimeoutMs,
    sourceDefaultRateLimitMinutes: config.sourceDefaultRateLimitMinutes,
    crawlerUserAgent: config.crawlerUserAgent,
    baseUrl: config.baseUrl,
    requests,
  };
}

async function processCursorSource(request, fetchPage) {
  const signals = [];
  let cursor = request.cursor || null;
  let guard = 0;
  do {
    const page = await fetchPage({ ...request, cursor });
    signals.push(...(page.signals || []));
    cursor = page.nextCursor || null;
    guard += 1;
  } while (cursor && guard < 1000);
  return {
    request,
    signals,
    pagesProcessed: guard,
    exhausted: !cursor,
  };
}

function normalizePlace(place = {}) {
  const name = cleanText(place.name || place.city || "");
  const state = cleanText(place.state || "").toUpperCase();
  return {
    name,
    state,
    stateName: cleanText(place.stateName || ""),
    display: cleanText(place.display || [name, state].filter(Boolean).join(", ")),
    geoid: cleanText(place.geoid || ""),
  };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageMs(item, now = new Date()) {
  const date = parseDate(item?.publishedAt || item?.approvedAt || item?.updatedAt);
  if (!date) return Infinity;
  return new Date(now).getTime() - date.getTime();
}

function isWithinPublicWindow(item, now = new Date(), days = PUBLIC_WINDOW_DAYS) {
  const age = ageMs(item, now);
  return Number.isFinite(age) && age >= 0 && age <= days * 24 * 60 * 60 * 1000;
}

function isWithinNewsSitemapWindow(story, now = new Date(), hours = NEWS_SITEMAP_WINDOW_HOURS) {
  const age = ageMs(story, now);
  return Number.isFinite(age) && age >= 0 && age <= hours * 60 * 60 * 1000;
}

function filterCurrentPublicStories(items = [], now = new Date()) {
  return (items || []).filter((item) => isWithinPublicWindow(item, now));
}

function getExpiredStoryResponse(story, now = new Date()) {
  if (!story || isWithinPublicWindow(story, now)) {
    return { expired: false, status: 200, message: "" };
  }
  return {
    expired: true,
    status: 410,
    message: "This Live News story has expired from public local/news coverage.",
  };
}

function normalizeSourceSafety(signal = {}) {
  return {
    sourceName: cleanText(signal.sourceName || signal.source || "Source"),
    sourceDomain: cleanText(signal.sourceDomain || signal.domain || ""),
    originalSourceUrl: cleanText(signal.link || signal.originalSourceUrl || ""),
    attributionRequired: true,
    fullArticleRepublished: false,
  };
}

function buildLocalSignal(input = {}, { place = {}, now = new Date() } = {}) {
  const normalizedPlace = normalizePlace(place);
  const link = cleanText(input.link || input.originalSourceUrl || "");
  const title = cleanText(input.title || input.liveNewsHeadline || "");
  const publishedAt = parseDate(input.publishedAt || input.updatedAt || input.approvedAt);
  return {
    id: cleanText(input.id) || `local-${stableHash([link, title, input.publishedAt].join("|"))}`,
    title,
    summary: cleanText(input.summary || input.liveNewsSummary || input.description || ""),
    link,
    sourceName: cleanText(input.sourceName || input.source || "Source"),
    sourceDomain: cleanText(input.sourceDomain || input.domain || ""),
    imageUrl: cleanText(input.imageUrl || input.thumbnailUrl || ""),
    publishedAt: publishedAt ? publishedAt.toISOString() : "",
    category: cleanText(input.category || "Local"),
    city: normalizedPlace.name,
    state: normalizedPlace.state,
    place: normalizedPlace,
    sourceSafety: normalizeSourceSafety(input),
    publicStatus: isWithinPublicWindow({ publishedAt: publishedAt?.toISOString() }, now)
      ? "current"
      : "expired",
  };
}

function normalizeForMatch(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreLocalRelevance(signal, place = signal.place || {}) {
  const normalizedPlace = normalizePlace(place);
  const city = normalizeForMatch(normalizedPlace.name);
  const state = normalizeForMatch(normalizedPlace.stateName || normalizedPlace.state);
  const stateCode = normalizeForMatch(normalizedPlace.state);
  const text = normalizeForMatch([
    signal.title,
    signal.summary,
    signal.sourceName,
    signal.link,
  ].join(" "));
  let score = 0;
  if (city && text.includes(city)) score += 55;
  if (city && city.split(" ").length > 1 && city.split(" ").every((part) => text.includes(part))) score += 15;
  if (state && text.includes(state)) score += 15;
  if (stateCode && text.includes(` ${stateCode} `)) score += 8;
  if (signal.category === "Local") score += 8;
  return Math.min(100, score);
}

function classifyLocalSignal(signal, place = signal.place || {}) {
  const text = normalizeForMatch([
    signal.title,
    signal.summary,
    signal.sourceName,
    signal.link,
  ].join(" "));
  const topicScores = LOCAL_TOPIC_RULES.map((rule) => {
    const matches = rule.terms.filter((term) => text.includes(normalizeForMatch(term)));
    return {
      id: rule.id,
      label: rule.label,
      matches,
      score: matches.length * 12 + (matches.length ? 20 : 0),
      sensitive: Boolean(rule.sensitive),
    };
  }).sort((a, b) => b.score - a.score);
  const best = topicScores[0]?.score > 0 ? topicScores[0] : {
    id: "general_local",
    label: "General local",
    matches: [],
    score: 10,
    sensitive: false,
  };
  const localRelevanceScore = scoreLocalRelevance(signal, place);
  const confidence = Math.min(100, Math.round((best.score + localRelevanceScore) / 2));
  return {
    ...signal,
    topic: best.id,
    topicLabel: best.label,
    topicTags: best.matches,
    classification: {
      topic: best.id,
      topicLabel: best.label,
      confidence,
      localRelevanceScore,
      reasons: [
        ...(best.matches.length ? [`matched terms: ${best.matches.slice(0, 4).join(", ")}`] : ["general local match"]),
        localRelevanceScore >= 55 ? "city match found" : "weak city match",
      ],
      sensitivityFlags: best.sensitive ? ["public_safety_or_sensitive_local_update"] : [],
    },
  };
}

function tokenizeClusterText(value) {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .slice(0, 12);
}

function getClusterKey(signal) {
  const tokens = tokenizeClusterText(signal.title);
  if (!tokens.length) return stableHash(signal.link || signal.id);
  return `${signal.topic || "general"}:${tokens.slice(0, 7).sort().join("-")}`;
}

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function summarizeClusterSource(signal) {
  return {
    sourceName: signal.sourceName,
    sourceUrl: signal.link,
    domain: signal.sourceDomain || getDomain(signal.link),
    publishedAt: signal.publishedAt,
  };
}

function buildClusterFromSignals(clusterSignals, place = {}) {
  const sorted = [...clusterSignals].sort(
    (a, b) =>
      new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) ||
      Number(b.classification?.confidence || 0) - Number(a.classification?.confidence || 0)
  );
  const lead = sorted[0];
  const sourceNames = Array.from(new Set(sorted.map((signal) => signal.sourceName).filter(Boolean)));
  const expiresAt = new Date(new Date(lead.publishedAt).getTime() + PUBLIC_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return {
    ...lead,
    id: `local-cluster-${stableHash(sorted.map((signal) => signal.id || signal.link).join("|"))}`,
    storyClusterId: `local-cluster-${stableHash(getClusterKey(lead), 14)}`,
    title: lead.title,
    summary: lead.summary,
    sourceCount: sourceNames.length,
    relatedSources: sourceNames,
    supportingLinks: sorted.slice(0, 8).map(summarizeClusterSource),
    city: normalizePlace(place).name || lead.city,
    state: normalizePlace(place).state || lead.state,
    topic: lead.topic,
    topicLabel: lead.topicLabel,
    topicTags: Array.from(new Set(sorted.flatMap((signal) => signal.topicTags || []))).slice(0, 8),
    localRelevanceScore: Math.max(...sorted.map((signal) => Number(signal.classification?.localRelevanceScore || 0))),
    expiresAt,
    publicStatus: "current",
    clusterSize: sorted.length,
  };
}

function clusterLocalSignals(signals = [], { place = {}, now = new Date() } = {}) {
  const currentSignals = filterCurrentPublicStories(signals, now);
  const groups = new Map();
  for (const signal of currentSignals) {
    const key = getClusterKey(signal);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(signal);
  }
  return Array.from(groups.values())
    .map((group) => buildClusterFromSignals(group, place))
    .sort(
      (a, b) =>
        new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) ||
        Number(b.localRelevanceScore || 0) - Number(a.localRelevanceScore || 0)
    );
}

function buildLocalIntelligenceRun({ place = {}, signals = [], now = new Date(), registry } = {}) {
  const normalizedPlace = normalizePlace(place);
  const sourceRegistry = registry || readLocalSourceRegistry();
  const normalizedSignals = signals
    .map((signal) => buildLocalSignal(signal, { place: normalizedPlace, now }))
    .map((signal) => classifyLocalSignal(signal, normalizedPlace));
  const publicSignals = filterCurrentPublicStories(normalizedSignals, now);
  const expiredSignals = normalizedSignals.filter((signal) => !isWithinPublicWindow(signal, now));
  const clusters = clusterLocalSignals(publicSignals, { place: normalizedPlace, now });
  const seo = getCityPageSeoState({ place: normalizedPlace, clusters });
  const sourceWarnings = getApprovedLocalSources(sourceRegistry).flatMap((source) => {
    const warnings = [];
    if (source.requiresCredentials) warnings.push(`${source.id}: requires credentials`);
    if (source.approvedPublicSource !== true) warnings.push(`${source.id}: not approved public source`);
    return warnings;
  });
  return {
    schemaVersion: "live-news-local-intelligence-run-v1",
    updatedAt: new Date(now).toISOString(),
    place: normalizedPlace,
    publicWindowDays: PUBLIC_WINDOW_DAYS,
    signals: normalizedSignals,
    publicSignals,
    expiredSignals,
    clusters,
    publicStories: clusters,
    seo,
    health: buildLocalCoverageHealth({
      place: normalizedPlace,
      sourceCount: new Set(publicSignals.map((signal) => signal.sourceName)).size,
      signalCount: normalizedSignals.length,
      publicSignalCount: publicSignals.length,
      expiredSignalCount: expiredSignals.length,
      clusterCount: clusters.length,
      sourceWarnings,
      seo,
    }),
  };
}

function getCityPageSeoState({ place = {}, clusters = [] } = {}) {
  const sourceCount = new Set((clusters || []).flatMap((cluster) => cluster.relatedSources || cluster.sourceName || [])).size;
  const storyCount = (clusters || []).length;
  const thin = storyCount < THIN_PAGE_MIN_STORIES || sourceCount < THIN_PAGE_MIN_SOURCES;
  return {
    robots: thin ? "noindex, follow" : "index, follow",
    indexable: !thin,
    thin,
    reason: thin
      ? `Needs at least ${THIN_PAGE_MIN_STORIES} current stories from ${THIN_PAGE_MIN_SOURCES} sources.`
      : "City page has enough current local coverage.",
    canonicalPath: "/local",
    city: normalizePlace(place).display,
    storyCount,
    sourceCount,
  };
}

function buildLocalCoverageHealth({
  place = {},
  sourceCount = 0,
  signalCount = 0,
  publicSignalCount = 0,
  expiredSignalCount = 0,
  clusterCount = 0,
  sourceWarnings = [],
  seo = null,
} = {}) {
  return {
    schemaVersion: "live-news-local-coverage-health-v1",
    place: normalizePlace(place),
    sourceCount,
    signalCount,
    publicSignalCount,
    expiredSignalCount,
    clusterCount,
    publicWindowDays: PUBLIC_WINDOW_DAYS,
    sourceWarnings,
    seo,
    healthy: sourceWarnings.length === 0 && clusterCount > 0,
    checkedAt: new Date().toISOString(),
  };
}

function readLocalIntelligenceStore(filePath = STORE_PATH) {
  return readJson(filePath, {
    schemaVersion: "live-news-local-intelligence-store-v1",
    updatedAt: null,
    privateRetentionPurpose: [
      "deduplication",
      "source_quality",
      "city_intelligence",
      "trend_detection",
      "future_relevance",
    ],
    runs: [],
    historicalMetadata: [],
  });
}

function sanitizeHistoricalMetadata(run = {}) {
  return (run.signals || []).map((signal) => ({
    id: signal.id,
    titleHash: stableHash(signal.title, 18),
    sourceName: signal.sourceName,
    sourceDomain: signal.sourceDomain,
    city: signal.city,
    state: signal.state,
    topic: signal.topic,
    publishedAt: signal.publishedAt,
    publicStatus: signal.publicStatus,
    recordedAt: run.updatedAt || new Date().toISOString(),
  }));
}

function saveLocalIntelligenceRun(run, { storePath = STORE_PATH, limit = 40 } = {}) {
  const current = readLocalIntelligenceStore(storePath);
  const storedRun = {
    updatedAt: run.updatedAt,
    place: run.place,
    health: run.health,
    seo: run.seo,
    publicWindowDays: run.publicWindowDays,
  };
  const runs = [storedRun, ...(current.runs || [])].slice(0, limit);
  const historicalMetadata = [
    ...sanitizeHistoricalMetadata(run),
    ...(current.historicalMetadata || []),
  ].slice(0, 2000);
  const payload = {
    ...current,
    updatedAt: new Date().toISOString(),
    runs,
    historicalMetadata,
  };
  writeJson(storePath, payload);
  return payload;
}

module.exports = {
  NEWS_SITEMAP_WINDOW_HOURS,
  PUBLIC_WINDOW_DAYS,
  LOCAL_INTELLIGENCE_CONFIG,
  buildLocalCoverageHealth,
  buildLocalIntakePlan,
  buildLocalSignal,
  buildLocalIntelligenceRun,
  classifyLocalSignal,
  clusterLocalSignals,
  filterCurrentPublicStories,
  getApprovedLocalSources,
  getCityPageSeoState,
  getExpiredStoryResponse,
  isWithinNewsSitemapWindow,
  isWithinPublicWindow,
  processCursorSource,
  readLocalIntelligenceStore,
  readLocalSourceRegistry,
  saveLocalIntelligenceRun,
};
