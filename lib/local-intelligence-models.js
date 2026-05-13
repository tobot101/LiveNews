const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CITY_INDEX_STATUSES = new Set(["watch", "noindex", "index"]);
const LOCAL_SOURCE_TYPES = new Set([
  "local_news",
  "tv",
  "radio",
  "official_city",
  "official_county",
  "police_fire",
  "school",
  "transit",
  "weather",
  "event",
  "blog",
  "community",
  "sports",
  "other",
]);
const LOCAL_SOURCE_TRUST_LEVELS = new Set([
  "official",
  "established_publisher",
  "community",
  "blog",
  "unknown",
]);
const LOCAL_SOURCE_CRAWL_STATUSES = new Set([
  "active",
  "paused",
  "blocked_by_robots",
  "failed",
  "pending_review",
]);
const SOURCE_FEED_TYPES = new Set(["rss", "atom", "sitemap", "api", "html"]);
const SOURCE_COVERAGE_TYPES = new Set(["primary", "nearby", "statewide", "regional"]);
const SOURCE_FETCH_RUN_STATUSES = new Set(["success", "failed", "skipped"]);
const INPUT_SIGNAL_STATUSES = new Set(["new", "classified", "clustered", "rejected", "expired_private"]);
const STORY_CONFIDENCE_LABELS = new Set([
  "official",
  "confirmed_multiple_sources",
  "reported_one_source",
  "community_source",
  "developing",
  "low_confidence",
]);
const STORY_URGENCY_LEVELS = new Set(["breaking", "high", "normal", "low"]);
const STORY_PUBLIC_STATUSES = new Set(["live", "expired", "hidden", "rejected"]);
const STORY_INDEX_STATUSES = new Set(["noindex", "index"]);
const STORY_CLUSTER_EVENT_TYPES = new Set([
  "first_seen",
  "source_added",
  "official_update",
  "summary_updated",
  "confidence_changed",
  "expired",
]);
const USER_SUBMITTED_SOURCE_STATUSES = new Set(["pending", "approved", "rejected"]);

const DEFAULT_CREATED_AT = "2026-05-12T00:00:00.000Z";
const CITIES_PATH = path.join(__dirname, "..", "data", "local-cities.json");
const LOCAL_SOURCES_PATH = path.join(__dirname, "..", "data", "local-sources.json");
const SOURCE_FEEDS_PATH = path.join(__dirname, "..", "data", "source-feeds.json");
const SOURCE_CITY_COVERAGE_PATH = path.join(__dirname, "..", "data", "source-city-coverage.json");
const SOURCE_FETCH_RUNS_PATH = path.join(__dirname, "..", "data", "source-fetch-runs.json");
const INPUT_SIGNALS_PATH = path.join(__dirname, "..", "data", "input-signals.json");
const STORY_CLUSTERS_PATH = path.join(__dirname, "..", "data", "story-clusters.json");
const STORY_CLUSTER_SIGNALS_PATH = path.join(__dirname, "..", "data", "story-cluster-signals.json");
const STORY_CLUSTER_EVENTS_PATH = path.join(__dirname, "..", "data", "story-cluster-events.json");
const CITY_TOPIC_COVERAGE_PATH = path.join(__dirname, "..", "data", "city-topic-coverage.json");
const USER_SUBMITTED_SOURCES_PATH = path.join(__dirname, "..", "data", "user-submitted-sources.json");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableHash(value, length = 16) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function asNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

function asPositiveNumber(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return number;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function normalizeTimestamp(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function normalizeJsonField(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeCity(input = {}) {
  const name = cleanText(input.name || input.city || "");
  const stateAbbr = cleanText(input.state_abbr || input.state || "").toUpperCase();
  const stateName = cleanText(input.state_name || input.stateName || "");
  const slug = cleanText(input.slug || slugify(name));
  const stateSlug = cleanText(input.state_slug || slugify(stateName || stateAbbr));
  const id = cleanText(input.id || [slug, stateAbbr.toLowerCase()].filter(Boolean).join("-"));
  const coverageScore = clamp(input.coverage_score ?? input.coverageScore ?? 0, 0, 100);
  const indexStatus = CITY_INDEX_STATUSES.has(input.index_status) ? input.index_status : "watch";
  return {
    id,
    name,
    slug,
    state_name: stateName,
    state_slug: stateSlug,
    state_abbr: stateAbbr,
    county_name: cleanText(input.county_name || input.countyName || ""),
    timezone: cleanText(input.timezone || ""),
    latitude: asNumberOrNull(input.latitude ?? input.lat),
    longitude: asNumberOrNull(input.longitude ?? input.lon),
    population: asNumberOrNull(input.population),
    coverage_score: coverageScore,
    index_status: indexStatus,
    last_fresh_story_at: normalizeTimestamp(input.last_fresh_story_at || input.lastFreshStoryAt),
    created_at: normalizeTimestamp(input.created_at || input.createdAt, DEFAULT_CREATED_AT),
    updated_at: normalizeTimestamp(input.updated_at || input.updatedAt, DEFAULT_CREATED_AT),
  };
}

function validateCity(city = {}) {
  const failures = [];
  if (!cleanText(city.id)) failures.push("id is required");
  if (!cleanText(city.name)) failures.push("name is required");
  if (!cleanText(city.slug)) failures.push("slug is required");
  if (!cleanText(city.state_name)) failures.push("state_name is required");
  if (!cleanText(city.state_slug)) failures.push("state_slug is required");
  if (!cleanText(city.state_abbr)) failures.push("state_abbr is required");
  if (!CITY_INDEX_STATUSES.has(city.index_status)) failures.push("index_status must be watch, noindex, or index");
  if (Number(city.coverage_score) < 0 || Number(city.coverage_score) > 100) failures.push("coverage_score must be 0-100");
  return { ok: failures.length === 0, failures };
}

function normalizeLocalSource(input = {}) {
  const name = cleanText(input.name || "");
  const slug = cleanText(input.slug || slugify(name));
  const sourceType = LOCAL_SOURCE_TYPES.has(input.source_type) ? input.source_type : "other";
  const trustLevel = LOCAL_SOURCE_TRUST_LEVELS.has(input.trust_level) ? input.trust_level : "unknown";
  const crawlStatus = LOCAL_SOURCE_CRAWL_STATUSES.has(input.crawl_status) ? input.crawl_status : "pending_review";
  return {
    id: cleanText(input.id || slug),
    name,
    slug,
    homepage_url: cleanText(input.homepage_url || input.homepageUrl || ""),
    source_type: sourceType,
    trust_level: trustLevel,
    crawl_status: crawlStatus,
    robots_checked_at: normalizeTimestamp(input.robots_checked_at || input.robotsCheckedAt),
    last_successful_fetch_at: normalizeTimestamp(input.last_successful_fetch_at || input.lastSuccessfulFetchAt),
    last_failed_fetch_at: normalizeTimestamp(input.last_failed_fetch_at || input.lastFailedFetchAt),
    created_at: normalizeTimestamp(input.created_at || input.createdAt, DEFAULT_CREATED_AT),
    updated_at: normalizeTimestamp(input.updated_at || input.updatedAt, DEFAULT_CREATED_AT),
  };
}

function validateLocalSource(source = {}) {
  const failures = [];
  if (!cleanText(source.id)) failures.push("id is required");
  if (!cleanText(source.name)) failures.push("name is required");
  if (!cleanText(source.slug)) failures.push("slug is required");
  if (!LOCAL_SOURCE_TYPES.has(source.source_type)) failures.push("source_type is invalid");
  if (!LOCAL_SOURCE_TRUST_LEVELS.has(source.trust_level)) failures.push("trust_level is invalid");
  if (!LOCAL_SOURCE_CRAWL_STATUSES.has(source.crawl_status)) failures.push("crawl_status is invalid");
  return { ok: failures.length === 0, failures };
}

function normalizeSourceFeed(input = {}) {
  const feedType = SOURCE_FEED_TYPES.has(input.feed_type) ? input.feed_type : "rss";
  const sourceId = cleanText(input.source_id || input.sourceId || "");
  const id = cleanText(input.id || [sourceId, feedType].filter(Boolean).join("-"));
  return {
    id,
    source_id: sourceId,
    feed_type: feedType,
    url: cleanText(input.url || ""),
    active: input.active !== false,
    fetch_frequency_minutes: asPositiveNumber(input.fetch_frequency_minutes || input.fetchFrequencyMinutes, 15),
    last_fetched_at: normalizeTimestamp(input.last_fetched_at || input.lastFetchedAt),
    next_fetch_at: normalizeTimestamp(input.next_fetch_at || input.nextFetchAt),
    etag: cleanText(input.etag || ""),
    last_modified_header: cleanText(input.last_modified_header || input.lastModifiedHeader || ""),
    created_at: normalizeTimestamp(input.created_at || input.createdAt, DEFAULT_CREATED_AT),
    updated_at: normalizeTimestamp(input.updated_at || input.updatedAt, DEFAULT_CREATED_AT),
  };
}

function validateSourceFeed(feed = {}) {
  const failures = [];
  if (!cleanText(feed.id)) failures.push("id is required");
  if (!cleanText(feed.source_id)) failures.push("source_id is required");
  if (!SOURCE_FEED_TYPES.has(feed.feed_type)) failures.push("feed_type is invalid");
  if (!cleanText(feed.url)) failures.push("url is required");
  if (Number(feed.fetch_frequency_minutes) < 1) failures.push("fetch_frequency_minutes must be at least 1");
  return { ok: failures.length === 0, failures };
}

function normalizeSourceCityCoverage(input = {}) {
  const coverageType = SOURCE_COVERAGE_TYPES.has(input.coverage_type) ? input.coverage_type : "regional";
  return {
    source_id: cleanText(input.source_id || input.sourceId || ""),
    city_id: cleanText(input.city_id || input.cityId || ""),
    confidence: clamp(input.confidence ?? 0, 0, 100),
    coverage_type: coverageType,
  };
}

function validateSourceCityCoverage(coverage = {}) {
  const failures = [];
  if (!cleanText(coverage.source_id)) failures.push("source_id is required");
  if (!cleanText(coverage.city_id)) failures.push("city_id is required");
  if (Number(coverage.confidence) < 0 || Number(coverage.confidence) > 100) failures.push("confidence must be 0-100");
  if (!SOURCE_COVERAGE_TYPES.has(coverage.coverage_type)) failures.push("coverage_type is invalid");
  return { ok: failures.length === 0, failures };
}

function normalizeSourceFetchRun(input = {}) {
  const sourceFeedId = cleanText(input.source_feed_id || input.sourceFeedId || "");
  const startedAt = normalizeTimestamp(input.started_at || input.startedAt, DEFAULT_CREATED_AT);
  const status = SOURCE_FETCH_RUN_STATUSES.has(input.status) ? input.status : "skipped";
  return {
    id: cleanText(input.id || `fetch-run-${stableHash(`${sourceFeedId}:${startedAt}`)}`),
    source_feed_id: sourceFeedId,
    started_at: startedAt,
    finished_at: normalizeTimestamp(input.finished_at || input.finishedAt),
    status,
    status_code: asNumberOrNull(input.status_code || input.statusCode),
    items_found: asNonNegativeNumber(input.items_found || input.itemsFound, 0),
    items_new: asNonNegativeNumber(input.items_new || input.itemsNew, 0),
    error_message: cleanText(input.error_message || input.errorMessage || ""),
  };
}

function validateSourceFetchRun(run = {}) {
  const failures = [];
  if (!cleanText(run.id)) failures.push("id is required");
  if (!cleanText(run.source_feed_id)) failures.push("source_feed_id is required");
  if (!SOURCE_FETCH_RUN_STATUSES.has(run.status)) failures.push("status is invalid");
  if (Number(run.items_found) < 0) failures.push("items_found must be zero or greater");
  if (Number(run.items_new) < 0) failures.push("items_new must be zero or greater");
  return { ok: failures.length === 0, failures };
}

function normalizeInputSignal(input = {}) {
  const canonicalUrl = cleanText(input.canonical_url || input.canonicalUrl || input.url || "");
  const originalUrl = cleanText(input.original_url || input.originalUrl || canonicalUrl);
  const title = cleanText(input.title || "");
  const discoveredAt = normalizeTimestamp(input.discovered_at || input.discoveredAt, DEFAULT_CREATED_AT);
  const signalStatus = INPUT_SIGNAL_STATUSES.has(input.signal_status) ? input.signal_status : "new";
  return {
    id: cleanText(input.id || `signal-${stableHash(`${canonicalUrl}:${title}`)}`),
    source_id: cleanText(input.source_id || input.sourceId || ""),
    source_feed_id: cleanText(input.source_feed_id || input.sourceFeedId || ""),
    canonical_url: canonicalUrl,
    original_url: originalUrl,
    title,
    excerpt: cleanText(input.excerpt || input.summary || ""),
    author: cleanText(input.author || ""),
    published_at: normalizeTimestamp(input.published_at || input.publishedAt),
    discovered_at: discoveredAt,
    fetched_at: normalizeTimestamp(input.fetched_at || input.fetchedAt),
    content_hash: cleanText(input.content_hash || input.contentHash || stableHash(`${title}:${input.excerpt || ""}`, 18)),
    url_hash: cleanText(input.url_hash || input.urlHash || stableHash(canonicalUrl || originalUrl, 18)),
    raw_source_type: cleanText(input.raw_source_type || input.rawSourceType || ""),
    city_candidates_json: normalizeJsonField(input.city_candidates_json || input.cityCandidates, []),
    topic_candidates_json: normalizeJsonField(input.topic_candidates_json || input.topicCandidates, []),
    entities_json: normalizeJsonField(input.entities_json || input.entities, {}),
    language: cleanText(input.language || "en"),
    signal_status: signalStatus,
    rejection_reason: cleanText(input.rejection_reason || input.rejectionReason || ""),
    created_at: normalizeTimestamp(input.created_at || input.createdAt, discoveredAt),
    updated_at: normalizeTimestamp(input.updated_at || input.updatedAt, discoveredAt),
  };
}

function validateInputSignal(signal = {}) {
  const failures = [];
  if (!cleanText(signal.id)) failures.push("id is required");
  if (!cleanText(signal.source_id)) failures.push("source_id is required");
  if (!cleanText(signal.source_feed_id)) failures.push("source_feed_id is required");
  if (!cleanText(signal.canonical_url)) failures.push("canonical_url is required");
  if (!cleanText(signal.title)) failures.push("title is required");
  if (!INPUT_SIGNAL_STATUSES.has(signal.signal_status)) failures.push("signal_status is invalid");
  return { ok: failures.length === 0, failures };
}

function normalizeStoryCluster(input = {}) {
  const headline = cleanText(input.headline || input.title || "");
  const cityId = cleanText(input.city_id || input.cityId || "");
  const slug = cleanText(input.slug || slugify(headline));
  const firstSeenAt = normalizeTimestamp(input.first_seen_at || input.firstSeenAt, DEFAULT_CREATED_AT);
  const confidenceLabel = STORY_CONFIDENCE_LABELS.has(input.confidence_label) ? input.confidence_label : "developing";
  const urgency = STORY_URGENCY_LEVELS.has(input.urgency) ? input.urgency : "normal";
  const publicStatus = STORY_PUBLIC_STATUSES.has(input.public_status) ? input.public_status : "live";
  const indexStatus = STORY_INDEX_STATUSES.has(input.index_status) ? input.index_status : "noindex";
  return {
    id: cleanText(input.id || `cluster-${stableHash(`${cityId}:${slug}`)}`),
    city_id: cityId,
    primary_topic: cleanText(input.primary_topic || input.primaryTopic || "general_local"),
    slug,
    headline,
    summary: cleanText(input.summary || ""),
    confidence_label: confidenceLabel,
    urgency,
    first_seen_at: firstSeenAt,
    last_updated_at: normalizeTimestamp(input.last_updated_at || input.lastUpdatedAt, firstSeenAt),
    public_started_at: normalizeTimestamp(input.public_started_at || input.publicStartedAt),
    expires_at: normalizeTimestamp(input.expires_at || input.expiresAt),
    public_status: publicStatus,
    index_status: indexStatus,
    source_count: asNonNegativeNumber(input.source_count || input.sourceCount, 0),
    official_source_count: asNonNegativeNumber(input.official_source_count || input.officialSourceCount, 0),
    latest_signal_id: cleanText(input.latest_signal_id || input.latestSignalId || ""),
    image_url: cleanText(input.image_url || input.imageUrl || input.thumbnail_url || input.thumbnailUrl || ""),
    image_alt: cleanText(input.image_alt || input.imageAlt || ""),
    created_at: normalizeTimestamp(input.created_at || input.createdAt, firstSeenAt),
    updated_at: normalizeTimestamp(input.updated_at || input.updatedAt, firstSeenAt),
  };
}

function validateStoryCluster(cluster = {}) {
  const failures = [];
  if (!cleanText(cluster.id)) failures.push("id is required");
  if (!cleanText(cluster.city_id)) failures.push("city_id is required");
  if (!cleanText(cluster.slug)) failures.push("slug is required");
  if (!cleanText(cluster.headline)) failures.push("headline is required");
  if (!STORY_CONFIDENCE_LABELS.has(cluster.confidence_label)) failures.push("confidence_label is invalid");
  if (!STORY_URGENCY_LEVELS.has(cluster.urgency)) failures.push("urgency is invalid");
  if (!STORY_PUBLIC_STATUSES.has(cluster.public_status)) failures.push("public_status is invalid");
  if (!STORY_INDEX_STATUSES.has(cluster.index_status)) failures.push("index_status is invalid");
  return { ok: failures.length === 0, failures };
}

function normalizeStoryClusterSignal(input = {}) {
  return {
    story_cluster_id: cleanText(input.story_cluster_id || input.storyClusterId || ""),
    input_signal_id: cleanText(input.input_signal_id || input.inputSignalId || ""),
    source_id: cleanText(input.source_id || input.sourceId || ""),
    is_primary: input.is_primary === true || input.isPrimary === true,
    added_at: normalizeTimestamp(input.added_at || input.addedAt, DEFAULT_CREATED_AT),
  };
}

function validateStoryClusterSignal(link = {}) {
  const failures = [];
  if (!cleanText(link.story_cluster_id)) failures.push("story_cluster_id is required");
  if (!cleanText(link.input_signal_id)) failures.push("input_signal_id is required");
  if (!cleanText(link.source_id)) failures.push("source_id is required");
  return { ok: failures.length === 0, failures };
}

function normalizeStoryClusterEvent(input = {}) {
  const eventType = STORY_CLUSTER_EVENT_TYPES.has(input.event_type) ? input.event_type : "source_added";
  return {
    id: cleanText(input.id || `cluster-event-${stableHash(`${input.story_cluster_id || input.storyClusterId}:${input.event_time || input.eventTime}:${eventType}`)}`),
    story_cluster_id: cleanText(input.story_cluster_id || input.storyClusterId || ""),
    event_time: normalizeTimestamp(input.event_time || input.eventTime, DEFAULT_CREATED_AT),
    event_type: eventType,
    description: cleanText(input.description || ""),
    created_at: normalizeTimestamp(input.created_at || input.createdAt, DEFAULT_CREATED_AT),
  };
}

function validateStoryClusterEvent(event = {}) {
  const failures = [];
  if (!cleanText(event.id)) failures.push("id is required");
  if (!cleanText(event.story_cluster_id)) failures.push("story_cluster_id is required");
  if (!STORY_CLUSTER_EVENT_TYPES.has(event.event_type)) failures.push("event_type is invalid");
  return { ok: failures.length === 0, failures };
}

function normalizeCityTopicCoverage(input = {}) {
  const indexStatus = CITY_INDEX_STATUSES.has(input.index_status) ? input.index_status : "watch";
  return {
    id: cleanText(input.id || `city-topic-${stableHash(`${input.city_id || input.cityId}:${input.topic}`)}`),
    city_id: cleanText(input.city_id || input.cityId || ""),
    topic: cleanText(input.topic || "general_local"),
    fresh_story_count_24h: asNonNegativeNumber(input.fresh_story_count_24h || input.freshStoryCount24h, 0),
    fresh_story_count_7d: asNonNegativeNumber(input.fresh_story_count_7d || input.freshStoryCount7d, 0),
    source_count_7d: asNonNegativeNumber(input.source_count_7d || input.sourceCount7d, 0),
    official_source_count_7d: asNonNegativeNumber(input.official_source_count_7d || input.officialSourceCount7d, 0),
    coverage_score: clamp(input.coverage_score ?? input.coverageScore ?? 0, 0, 100),
    index_status: indexStatus,
    last_updated_at: normalizeTimestamp(input.last_updated_at || input.lastUpdatedAt, DEFAULT_CREATED_AT),
  };
}

function validateCityTopicCoverage(coverage = {}) {
  const failures = [];
  if (!cleanText(coverage.id)) failures.push("id is required");
  if (!cleanText(coverage.city_id)) failures.push("city_id is required");
  if (!cleanText(coverage.topic)) failures.push("topic is required");
  if (!CITY_INDEX_STATUSES.has(coverage.index_status)) failures.push("index_status is invalid");
  if (Number(coverage.coverage_score) < 0 || Number(coverage.coverage_score) > 100) failures.push("coverage_score must be 0-100");
  return { ok: failures.length === 0, failures };
}

function normalizeUserSubmittedSource(input = {}) {
  const status = USER_SUBMITTED_SOURCE_STATUSES.has(input.status) ? input.status : "pending";
  const submittedUrl = cleanText(input.submitted_url || input.submittedUrl || "");
  return {
    id: cleanText(input.id || `submitted-source-${stableHash(submittedUrl)}`),
    submitted_url: submittedUrl,
    submitted_city: cleanText(input.submitted_city || input.submittedCity || ""),
    submitted_email_optional: cleanText(input.submitted_email_optional || input.submittedEmailOptional || ""),
    status,
    notes: cleanText(input.notes || ""),
    created_at: normalizeTimestamp(input.created_at || input.createdAt, DEFAULT_CREATED_AT),
    reviewed_at: normalizeTimestamp(input.reviewed_at || input.reviewedAt),
  };
}

function validateUserSubmittedSource(source = {}) {
  const failures = [];
  if (!cleanText(source.id)) failures.push("id is required");
  if (!cleanText(source.submitted_url)) failures.push("submitted_url is required");
  if (!USER_SUBMITTED_SOURCE_STATUSES.has(source.status)) failures.push("status is invalid");
  return { ok: failures.length === 0, failures };
}

function readLocalCities(filePath = CITIES_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-local-cities-v1", cities: [] });
  return {
    ...payload,
    cities: (payload.cities || []).map(normalizeCity),
  };
}

function readLocalSources(filePath = LOCAL_SOURCES_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-local-sources-v1", local_sources: [] });
  return {
    ...payload,
    local_sources: (payload.local_sources || []).map(normalizeLocalSource),
  };
}

function readSourceFeeds(filePath = SOURCE_FEEDS_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-source-feeds-v1", source_feeds: [] });
  return {
    ...payload,
    source_feeds: (payload.source_feeds || []).map(normalizeSourceFeed),
  };
}

function readSourceCityCoverage(filePath = SOURCE_CITY_COVERAGE_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-source-city-coverage-v1", source_city_coverage: [] });
  return {
    ...payload,
    source_city_coverage: (payload.source_city_coverage || []).map(normalizeSourceCityCoverage),
  };
}

function readSourceFetchRuns(filePath = SOURCE_FETCH_RUNS_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-source-fetch-runs-v1", source_fetch_runs: [] });
  return {
    ...payload,
    source_fetch_runs: (payload.source_fetch_runs || []).map(normalizeSourceFetchRun),
  };
}

function readInputSignals(filePath = INPUT_SIGNALS_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-input-signals-v1", input_signals: [] });
  return {
    ...payload,
    input_signals: (payload.input_signals || []).map(normalizeInputSignal),
  };
}

function readStoryClusters(filePath = STORY_CLUSTERS_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-story-clusters-v1", story_clusters: [] });
  return {
    ...payload,
    story_clusters: (payload.story_clusters || []).map(normalizeStoryCluster),
  };
}

function readStoryClusterSignals(filePath = STORY_CLUSTER_SIGNALS_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-story-cluster-signals-v1", story_cluster_signals: [] });
  return {
    ...payload,
    story_cluster_signals: (payload.story_cluster_signals || []).map(normalizeStoryClusterSignal),
  };
}

function readStoryClusterEvents(filePath = STORY_CLUSTER_EVENTS_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-story-cluster-events-v1", story_cluster_events: [] });
  return {
    ...payload,
    story_cluster_events: (payload.story_cluster_events || []).map(normalizeStoryClusterEvent),
  };
}

function readCityTopicCoverage(filePath = CITY_TOPIC_COVERAGE_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-city-topic-coverage-v1", city_topic_coverage: [] });
  return {
    ...payload,
    city_topic_coverage: (payload.city_topic_coverage || []).map(normalizeCityTopicCoverage),
  };
}

function readUserSubmittedSources(filePath = USER_SUBMITTED_SOURCES_PATH) {
  const payload = readJson(filePath, { schemaVersion: "live-news-user-submitted-sources-v1", user_submitted_sources: [] });
  return {
    ...payload,
    user_submitted_sources: (payload.user_submitted_sources || []).map(normalizeUserSubmittedSource),
  };
}

function getCityBySlug(slug, payload = readLocalCities()) {
  const target = cleanText(slug);
  return (payload.cities || []).find((city) => city.slug === target || city.id === target) || null;
}

module.exports = {
  CITY_INDEX_STATUSES,
  INPUT_SIGNAL_STATUSES,
  LOCAL_SOURCE_CRAWL_STATUSES,
  LOCAL_SOURCE_TRUST_LEVELS,
  LOCAL_SOURCE_TYPES,
  SOURCE_COVERAGE_TYPES,
  SOURCE_FEED_TYPES,
  SOURCE_FETCH_RUN_STATUSES,
  STORY_CLUSTER_EVENT_TYPES,
  STORY_CONFIDENCE_LABELS,
  STORY_INDEX_STATUSES,
  STORY_PUBLIC_STATUSES,
  STORY_URGENCY_LEVELS,
  USER_SUBMITTED_SOURCE_STATUSES,
  getCityBySlug,
  normalizeCityTopicCoverage,
  normalizeCity,
  normalizeInputSignal,
  normalizeLocalSource,
  normalizeSourceCityCoverage,
  normalizeSourceFeed,
  normalizeSourceFetchRun,
  normalizeStoryCluster,
  normalizeStoryClusterEvent,
  normalizeStoryClusterSignal,
  normalizeUserSubmittedSource,
  readCityTopicCoverage,
  readInputSignals,
  readLocalCities,
  readLocalSources,
  readSourceCityCoverage,
  readSourceFeeds,
  readSourceFetchRuns,
  readStoryClusterEvents,
  readStoryClusters,
  readStoryClusterSignals,
  readUserSubmittedSources,
  slugify,
  validateCityTopicCoverage,
  validateCity,
  validateInputSignal,
  validateLocalSource,
  validateSourceCityCoverage,
  validateSourceFeed,
  validateSourceFetchRun,
  validateStoryCluster,
  validateStoryClusterEvent,
  validateStoryClusterSignal,
  validateUserSubmittedSource,
};
