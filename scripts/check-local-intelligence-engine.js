const fs = require("fs");
const path = require("path");
const {
  LOCAL_INTELLIGENCE_CONFIG,
  NEWS_SITEMAP_WINDOW_HOURS,
  PUBLIC_WINDOW_DAYS,
  buildLocalIntakePlan,
  buildLocalIntelligenceRun,
  buildLocalSignal,
  classifyLocalSignal,
  clusterLocalSignals,
  filterCurrentPublicStories,
  getApprovedLocalSources,
  getCityPageSeoState,
  getExpiredStoryResponse,
  isWithinNewsSitemapWindow,
  isWithinPublicWindow,
  processCursorSource,
  readLocalSourceRegistry,
} = require("../lib/local-intelligence-engine");
const {
  DEFAULT_LOCAL_INTELLIGENCE_ENV,
  buildLocalIntelligenceConfig,
} = require("../lib/local-intelligence-config");
const { runLocalWorkerBatch } = require("../lib/local-intelligence-worker");
const {
  normalizeCity,
  normalizeCityTopicCoverage,
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
  readStoryClusterSignals,
  readStoryClusters,
  readUserSubmittedSources,
  validateCity,
  validateCityTopicCoverage,
  validateInputSignal,
  validateLocalSource,
  validateSourceCityCoverage,
  validateSourceFeed,
  validateSourceFetchRun,
  validateStoryCluster,
  validateStoryClusterEvent,
  validateStoryClusterSignal,
  validateUserSubmittedSource,
} = require("../lib/local-intelligence-models");

const root = path.join(__dirname, "..");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const place = {
  name: "San Diego",
  state: "CA",
  stateName: "California",
  display: "San Diego, CA",
};

const registry = readLocalSourceRegistry();
const approvedSources = getApprovedLocalSources(registry);
expect(approvedSources.length >= 1, "Local source registry should expose at least one approved public source.");
expect(
  approvedSources.every((source) => source.approvedPublicSource === true && source.requiresCredentials !== true),
  "Approved local sources must be public and credential-free."
);

const localCities = readLocalCities();
const localSources = readLocalSources();
const sourceFeeds = readSourceFeeds();
const sourceCityCoverage = readSourceCityCoverage();
const sourceFetchRuns = readSourceFetchRuns();
const inputSignals = readInputSignals();
const storyClusters = readStoryClusters();
const storyClusterSignals = readStoryClusterSignals();
const storyClusterEvents = readStoryClusterEvents();
const cityTopicCoverage = readCityTopicCoverage();
const userSubmittedSources = readUserSubmittedSources();

expect(localCities.cities.length >= 1, "Local cities table should contain seed cities.");
expect(localCities.cities.every((city) => validateCity(city).ok), "Every local city should match the cities schema.");
expect(localSources.local_sources.length >= 1, "Local sources table should contain seed sources.");
expect(localSources.local_sources.every((source) => validateLocalSource(source).ok), "Every local source should match the local_sources schema.");
expect(sourceFeeds.source_feeds.length >= 1, "Source feeds table should contain at least one feed.");
expect(sourceFeeds.source_feeds.every((feed) => validateSourceFeed(feed).ok), "Every source feed should match the source_feeds schema.");
expect(sourceCityCoverage.source_city_coverage.every((coverage) => validateSourceCityCoverage(coverage).ok), "Every source-city coverage row should match the source_city_coverage schema.");
expect(sourceFetchRuns.source_fetch_runs.every((run) => validateSourceFetchRun(run).ok), "Every source fetch run should match the source_fetch_runs schema.");
expect(inputSignals.input_signals.every((signal) => validateInputSignal(signal).ok), "Every input signal should match the input_signals schema.");
expect(storyClusters.story_clusters.every((cluster) => validateStoryCluster(cluster).ok), "Every story cluster should match the story_clusters schema.");
expect(storyClusterSignals.story_cluster_signals.every((link) => validateStoryClusterSignal(link).ok), "Every story cluster signal link should match the story_cluster_signals schema.");
expect(storyClusterEvents.story_cluster_events.every((event) => validateStoryClusterEvent(event).ok), "Every story cluster event should match the story_cluster_events schema.");
expect(cityTopicCoverage.city_topic_coverage.every((coverage) => validateCityTopicCoverage(coverage).ok), "Every city-topic coverage row should match the city_topic_coverage schema.");
expect(userSubmittedSources.user_submitted_sources.every((source) => validateUserSubmittedSource(source).ok), "Every user submitted source should match the user_submitted_sources schema.");

const modelCity = normalizeCity({
  name: "San Diego",
  state_name: "California",
  state_abbr: "CA",
  county_name: "San Diego County",
  coverage_score: 88,
  index_status: "index",
});
expect(modelCity.slug === "san-diego", "City model should create a stable city slug.");
expect(modelCity.state_slug === "california", "City model should create a stable state slug.");
expect(validateCity(modelCity).ok, "Normalized city fixture should validate.");

const modelSource = normalizeLocalSource({
  name: "San Diego City",
  homepage_url: "https://www.sandiego.gov",
  source_type: "official_city",
  trust_level: "official",
  crawl_status: "active",
});
expect(modelSource.source_type === "official_city", "Local source model should preserve official_city type.");
expect(modelSource.trust_level === "official", "Local source model should preserve official trust level.");
expect(validateLocalSource(modelSource).ok, "Normalized local source fixture should validate.");

const modelFeed = normalizeSourceFeed({
  source_id: modelSource.id,
  feed_type: "rss",
  url: "https://www.sandiego.gov/rss.xml",
  fetch_frequency_minutes: 15,
});
expect(modelFeed.fetch_frequency_minutes === 15, "Source feed model should preserve fetch frequency.");
expect(validateSourceFeed(modelFeed).ok, "Normalized source feed fixture should validate.");

const modelCoverage = normalizeSourceCityCoverage({
  source_id: modelSource.id,
  city_id: modelCity.id,
  confidence: 96,
  coverage_type: "primary",
});
expect(modelCoverage.coverage_type === "primary", "Source-city coverage model should preserve primary coverage type.");
expect(validateSourceCityCoverage(modelCoverage).ok, "Normalized source-city coverage fixture should validate.");

const modelFetchRun = normalizeSourceFetchRun({
  source_feed_id: modelFeed.id,
  started_at: daysAgo(0.01),
  status: "success",
  status_code: 200,
  items_found: 12,
  items_new: 4,
});
expect(modelFetchRun.status === "success", "Source fetch run model should preserve success status.");
expect(validateSourceFetchRun(modelFetchRun).ok, "Normalized source fetch run fixture should validate.");

const modelSignal = normalizeInputSignal({
  source_id: modelSource.id,
  source_feed_id: modelFeed.id,
  canonical_url: "https://www.sandiego.gov/local-update",
  title: "San Diego posts new local update",
  excerpt: "Officials posted a public update for residents.",
  city_candidates_json: [{ city_id: modelCity.id, confidence: 95 }],
  topic_candidates_json: [{ topic: "local_government", confidence: 90 }],
  entities_json: { organizations: ["City of San Diego"] },
  signal_status: "classified",
});
expect(modelSignal.city_candidates_json[0].city_id === modelCity.id, "Input signal model should preserve city candidate JSON.");
expect(modelSignal.signal_status === "classified", "Input signal model should preserve signal status.");
expect(validateInputSignal(modelSignal).ok, "Normalized input signal fixture should validate.");

const modelCluster = normalizeStoryCluster({
  city_id: modelCity.id,
  primary_topic: "local_government",
  headline: "San Diego local update gives residents new city context",
  summary: "The city posted a public update for residents.",
  confidence_label: "official",
  urgency: "normal",
  public_status: "live",
  index_status: "index",
  source_count: 1,
  official_source_count: 1,
  latest_signal_id: modelSignal.id,
});
expect(modelCluster.confidence_label === "official", "Story cluster model should preserve confidence label.");
expect(modelCluster.public_status === "live", "Story cluster model should preserve public status.");
expect(validateStoryCluster(modelCluster).ok, "Normalized story cluster fixture should validate.");

const modelClusterSignal = normalizeStoryClusterSignal({
  story_cluster_id: modelCluster.id,
  input_signal_id: modelSignal.id,
  source_id: modelSource.id,
  is_primary: true,
});
expect(modelClusterSignal.is_primary === true, "Story cluster signal model should preserve primary flag.");
expect(validateStoryClusterSignal(modelClusterSignal).ok, "Normalized story cluster signal fixture should validate.");

const modelClusterEvent = normalizeStoryClusterEvent({
  story_cluster_id: modelCluster.id,
  event_type: "first_seen",
  description: "Cluster first appeared in local intelligence.",
});
expect(modelClusterEvent.event_type === "first_seen", "Story cluster event model should preserve event type.");
expect(validateStoryClusterEvent(modelClusterEvent).ok, "Normalized story cluster event fixture should validate.");

const modelTopicCoverage = normalizeCityTopicCoverage({
  city_id: modelCity.id,
  topic: "local_government",
  fresh_story_count_24h: 2,
  fresh_story_count_7d: 7,
  source_count_7d: 3,
  official_source_count_7d: 1,
  coverage_score: 82,
  index_status: "index",
});
expect(modelTopicCoverage.coverage_score === 82, "City-topic coverage model should preserve coverage score.");
expect(validateCityTopicCoverage(modelTopicCoverage).ok, "Normalized city-topic coverage fixture should validate.");

const submittedSource = normalizeUserSubmittedSource({
  submitted_url: "https://example.org/community-feed",
  submitted_city: "San Diego, CA",
  submitted_email_optional: "editor@example.org",
});
expect(submittedSource.status === "pending", "User-submitted source model should default to pending.");
expect(validateUserSubmittedSource(submittedSource).ok, "Normalized user-submitted source fixture should validate.");

const intakePlan = buildLocalIntakePlan(place, ["San Diego CA local news", "San Diego California when:7d"], registry);
expect(intakePlan.requestCount === 2, "Local intake plan should create a request for each query variant.");
expect(intakePlan.fixedIntakeLimit === null, "Local source intake must not impose a fixed article intake limit.");
expect(intakePlan.requests.every((request) => request.approvedPublicSource === true), "Intake requests should only use approved public sources.");
expect(intakePlan.requests.some((request) => request.url.includes("news.google.com/rss/search")), "Current v1 intake should use the existing public RSS search adapter.");
expect(intakePlan.sourceFetchConcurrency === LOCAL_INTELLIGENCE_CONFIG.sourceFetchConcurrency, "Local intake plan should expose configured source fetch concurrency.");
expect(intakePlan.sourceFetchTimeoutMs === LOCAL_INTELLIGENCE_CONFIG.sourceFetchTimeoutMs, "Local intake plan should expose configured source fetch timeout.");
expect(intakePlan.sourceDefaultRateLimitMinutes === LOCAL_INTELLIGENCE_CONFIG.sourceDefaultRateLimitMinutes, "Local intake plan should expose configured default source rate limit.");
expect(intakePlan.crawlerUserAgent === LOCAL_INTELLIGENCE_CONFIG.crawlerUserAgent, "Local intake plan should expose configured crawler user agent.");
expect(intakePlan.baseUrl === LOCAL_INTELLIGENCE_CONFIG.baseUrl, "Local intake plan should expose configured base URL.");
expect(intakePlan.requests.every((request) => request.rateLimit.defaultMinimumDelayMinutes >= 1), "Every intake request should include a safe default rate-limit value.");

const configured = buildLocalIntelligenceConfig({
  STORY_PUBLIC_TTL_DAYS: "7",
  GOOGLE_NEWS_TTL_HOURS: "48",
  SOURCE_FETCH_CONCURRENCY: "5",
  SOURCE_FETCH_TIMEOUT_MS: "15000",
  SOURCE_DEFAULT_RATE_LIMIT_MINUTES: "15",
  CRAWLER_USER_AGENT: "LiveNewsBot/1.0 (+https://newsmorenow.com/contact)",
  BASE_URL: "https://newsmorenow.com",
});
expect(configured.storyPublicTtlDays === 7, "STORY_PUBLIC_TTL_DAYS should validate to 7.");
expect(configured.googleNewsTtlHours === 48, "GOOGLE_NEWS_TTL_HOURS should validate to 48.");
expect(configured.sourceFetchConcurrency === 5, "SOURCE_FETCH_CONCURRENCY should validate to 5.");
expect(configured.sourceFetchTimeoutMs === 15000, "SOURCE_FETCH_TIMEOUT_MS should validate to 15000.");
expect(configured.sourceDefaultRateLimitMinutes === 15, "SOURCE_DEFAULT_RATE_LIMIT_MINUTES should validate to 15.");
expect(configured.crawlerUserAgent.includes("newsmorenow.com/contact"), "Crawler user agent should use the public contact URL.");
expect(configured.baseUrl === "https://newsmorenow.com", "BASE_URL should validate to the canonical production URL.");

const invalidConfig = buildLocalIntelligenceConfig({
  STORY_PUBLIC_TTL_DAYS: "0",
  GOOGLE_NEWS_TTL_HOURS: "bad",
  SOURCE_FETCH_CONCURRENCY: "-1",
  SOURCE_FETCH_TIMEOUT_MS: "20",
  SOURCE_DEFAULT_RATE_LIMIT_MINUTES: "0",
  CRAWLER_USER_AGENT: "",
  BASE_URL: "not a url",
});
expect(invalidConfig.storyPublicTtlDays === DEFAULT_LOCAL_INTELLIGENCE_ENV.STORY_PUBLIC_TTL_DAYS, "Invalid story TTL should fall back safely.");
expect(invalidConfig.googleNewsTtlHours === DEFAULT_LOCAL_INTELLIGENCE_ENV.GOOGLE_NEWS_TTL_HOURS, "Invalid Google News TTL should fall back safely.");
expect(invalidConfig.sourceFetchConcurrency === DEFAULT_LOCAL_INTELLIGENCE_ENV.SOURCE_FETCH_CONCURRENCY, "Invalid source concurrency should fall back safely.");
expect(invalidConfig.sourceFetchTimeoutMs === DEFAULT_LOCAL_INTELLIGENCE_ENV.SOURCE_FETCH_TIMEOUT_MS, "Invalid source timeout should fall back safely.");
expect(invalidConfig.sourceDefaultRateLimitMinutes === DEFAULT_LOCAL_INTELLIGENCE_ENV.SOURCE_DEFAULT_RATE_LIMIT_MINUTES, "Invalid source rate limit should fall back safely.");
expect(invalidConfig.warnings.length >= 5, "Invalid local intelligence config should return validation warnings.");

const currentSignal = buildLocalSignal(
  {
    title: "San Diego council approves downtown transit safety plan",
    summary: "Residents and riders will see new overnight reporting procedures after a city vote.",
    link: "https://example.com/san-diego-transit-safety",
    sourceName: "Metro Desk",
    sourceDomain: "example.com",
    publishedAt: daysAgo(1),
    category: "Local",
  },
  { place }
);
const expiredSignal = buildLocalSignal(
  {
    title: "San Diego library plan from last month",
    summary: "Older civic item.",
    link: "https://example.com/old-library-plan",
    sourceName: "Archive Desk",
    publishedAt: daysAgo(9),
    category: "Local",
  },
  { place }
);

expect(isWithinPublicWindow(currentSignal), "Current local signal should be inside the 7-day public window.");
expect(!isWithinPublicWindow(expiredSignal), "Expired local signal should be outside the 7-day public window.");
expect(filterCurrentPublicStories([currentSignal, expiredSignal]).length === 1, "Public story filter should remove stories older than 7 days.");

const classified = classifyLocalSignal(currentSignal, place);
expect(classified.classification.localRelevanceScore >= 55, "Local classifier should recognize city relevance.");
expect(classified.topic === "public_safety" || classified.topic === "traffic_transit", "Local classifier should assign a useful local topic.");

const clusters = clusterLocalSignals(
  [
    classified,
    classifyLocalSignal(
      buildLocalSignal(
        {
          title: "Downtown transit safety plan approved in San Diego",
          summary: "The city update focuses on riders and overnight reporting.",
          link: "https://example.org/transit-plan",
          sourceName: "City Hall Notes",
          publishedAt: daysAgo(1.1),
          category: "Local",
        },
        { place }
      ),
      place
    ),
    classifyLocalSignal(expiredSignal, place),
  ],
  { place }
);
expect(clusters.length >= 1, "Local clustering should produce at least one current cluster.");
expect(clusters.every((cluster) => isWithinPublicWindow(cluster)), "Local clusters should all be within the 7-day public window.");
expect(clusters[0].supportingLinks.length >= 1, "Local clusters should retain attribution/supporting links.");

const run = buildLocalIntelligenceRun({
  place,
  signals: [currentSignal, expiredSignal],
  registry,
});
expect(run.publicWindowDays === PUBLIC_WINDOW_DAYS, "Local intelligence run should declare the 7-day public window.");
expect(run.expiredSignals.length === 1, "Local intelligence run should retain expired metadata privately.");
expect(run.publicStories.length === 1, "Local intelligence run should expose only current public stories.");
expect(run.health.expiredSignalCount === 1, "Coverage health should include expired signal count.");
expect(run.seo.robots === "noindex, follow", "Thin city pages should be noindex, follow.");

const healthySeo = getCityPageSeoState({
  place,
  clusters: [
    { relatedSources: ["A"] },
    { relatedSources: ["B"] },
    { relatedSources: ["A", "C"] },
  ],
});
expect(healthySeo.indexable === true, "City page SEO should allow indexing when coverage is not thin.");

expect(isWithinNewsSitemapWindow({ publishedAt: daysAgo(1) }), "News sitemap should allow stories inside 48 hours.");
expect(!isWithinNewsSitemapWindow({ publishedAt: daysAgo(3) }), "News sitemap should block stories older than 48 hours.");
expect(NEWS_SITEMAP_WINDOW_HOURS === 48, "News sitemap window should be 48 hours.");

const expiredResponse = getExpiredStoryResponse({ publishedAt: daysAgo(8), slug: "old-story" });
expect(expiredResponse.status === 410, "Expired public story URLs should be eligible for 410 Gone.");

let cursorCalls = 0;
processCursorSource(
  { sourceId: "fixture", cursor: "page-1" },
  async ({ cursor }) => {
    cursorCalls += 1;
    return {
      signals: [{ id: cursor }],
      nextCursor: cursor === "page-1" ? "page-2" : null,
    };
  }
).then(async (cursorResult) => {
  expect(cursorCalls === 2, "Cursor source processing should continue until no cursor remains.");
  expect(cursorResult.signals.length === 2, "Cursor source processing should collect all pages.");

  let activeWorkers = 0;
  let maxActiveWorkers = 0;
  const workerResults = await runLocalWorkerBatch(
    [1, 2, 3, 4],
    async (task) => {
      activeWorkers += 1;
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeWorkers -= 1;
      return task * 2;
    },
    { concurrency: 2, timeoutMs: 1000 }
  );
  expect(maxActiveWorkers <= 2, "Local worker batch should respect configured concurrency.");
  expect(workerResults.every((result) => result.status === "fulfilled"), "Local worker batch should return settled fulfilled results.");
  expect(workerResults.map((result) => result.value).join(",") === "2,4,6,8", "Local worker batch should preserve result order.");

  const timeoutResults = await runLocalWorkerBatch(
    ["slow"],
    () => new Promise((resolve) => setTimeout(resolve, 30)),
    { concurrency: 1, timeoutMs: 5 }
  );
  expect(timeoutResults[0].status === "rejected", "Local worker batch should reject timed-out tasks safely.");
  expect(timeoutResults[0].reason.code === "LOCAL_INTELLIGENCE_TIMEOUT", "Timed-out local worker task should expose a safe timeout code.");

  const docs = fs.readFileSync(path.join(root, "docs", "local-intelligence-engine.md"), "utf8");
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const localJs = fs.readFileSync(path.join(root, "public", "local.js"), "utf8");
  const localHtml = fs.readFileSync(path.join(root, "public", "local.html"), "utf8");

  expect(docs.includes("Seven-Day Public Expiration"), "Architecture doc should explain 7-day public expiration.");
  expect(docs.includes("Source Intake Policy"), "Architecture doc should explain local source intake policy.");
  expect(docs.includes("STORY_PUBLIC_TTL_DAYS"), "Architecture doc should document local intelligence environment configuration.");
  expect(docs.includes("localStorage"), "Architecture doc should explain anonymous localStorage personalization.");
  expect(serverJs.includes("buildLocalIntelligenceRun"), "Server local API should use the Local Intelligence Engine.");
  expect(serverJs.includes("runLocalWorkerBatch"), "Server local intake should use the safe local worker abstraction.");
  expect(serverJs.includes("LOCAL_INTELLIGENCE_CONFIG.crawlerUserAgent"), "Server parser should use the configured crawler user agent.");
  expect(serverJs.includes("isWithinNewsSitemapWindow"), "Server news sitemap should use the 48-hour news window.");
  expect(serverJs.includes("getExpiredStoryResponse"), "Server story route should support expired story responses.");
  expect(localJs.includes("safeStorageGet") && localJs.includes("safeStorageSet"), "Local page should gracefully handle blocked localStorage.");
  expect(localJs.includes("ln_followed_topics"), "Local page should reserve anonymous followed-topic storage.");
  expect(localJs.includes("ln_last_visit_at"), "Local page should store anonymous last visit time.");
  expect(localJs.includes("ln_seen_story_ids"), "Local page should store anonymous seen story IDs.");
  expect(localJs.includes("ln_dismissed_prompts"), "Local page should reserve anonymous dismissed prompt storage.");
  expect(localHtml.includes("last 7 days"), "Local page public copy should describe the 7-day public window.");

  if (failures.length) {
    console.error("Live News local-intelligence check failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log("Live News local-intelligence check passed.");
  console.log(`Approved local sources: ${approvedSources.length}`);
  console.log(`Public clusters checked: ${clusters.length}`);
  console.log(`Cursor pages checked: ${cursorCalls}`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
