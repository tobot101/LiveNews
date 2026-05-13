const fs = require("fs");
const os = require("os");
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
const { createSourceRegistryService } = require("../lib/local-source-registry");
const {
  canonicalizeUrl,
  createInputSignal,
  dedupeByContentHash,
  dedupeByUrlHash,
  fetchApiFeed,
  fetchAtomFeed,
  fetchHtmlSource,
  fetchRssFeed,
  fetchSitemap,
  fetchSourceFeed,
  normalizeUrl,
} = require("../lib/local-source-fetcher");
const {
  applySignalClassification,
  classifyCityCandidates,
  classifyInputSignal,
  classifyInputSignals,
  classifyTopicCandidates,
  createLocalSignalClassifierService,
  extractLocalEntities,
  getSignalSourceType,
} = require("../lib/local-signal-classifier");
const {
  calculateTitleSimilarity,
  clusterInputSignal,
  clusterInputSignals,
  clusterUnclusteredInputSignals,
  createLocalStoryClusteringService,
  findMatchingStoryCluster,
  getOfficialIncidentReferences,
} = require("../lib/local-story-clustering");
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

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function createRegistryFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-news-local-registry-"));
  const paths = {
    localSources: path.join(dir, "local-sources.json"),
    sourceFeeds: path.join(dir, "source-feeds.json"),
    sourceFetchRuns: path.join(dir, "source-fetch-runs.json"),
    userSubmittedSources: path.join(dir, "user-submitted-sources.json"),
    inputSignals: path.join(dir, "input-signals.json"),
    storyClusters: path.join(dir, "story-clusters.json"),
    storyClusterSignals: path.join(dir, "story-cluster-signals.json"),
    storyClusterEvents: path.join(dir, "story-cluster-events.json"),
    localCities: path.join(dir, "local-cities.json"),
    sourceCityCoverage: path.join(dir, "source-city-coverage.json"),
  };
  writeJson(paths.localSources, {
    schemaVersion: "live-news-local-sources-v1",
    updatedAt: null,
    local_sources: [],
  });
  writeJson(paths.sourceFeeds, {
    schemaVersion: "live-news-source-feeds-v1",
    updatedAt: null,
    source_feeds: [],
  });
  writeJson(paths.sourceFetchRuns, {
    schemaVersion: "live-news-source-fetch-runs-v1",
    updatedAt: null,
    source_fetch_runs: [],
  });
  writeJson(paths.userSubmittedSources, {
    schemaVersion: "live-news-user-submitted-sources-v1",
    updatedAt: null,
    user_submitted_sources: [],
  });
  writeJson(paths.inputSignals, {
    schemaVersion: "live-news-input-signals-v1",
    updatedAt: null,
    input_signals: [],
  });
  writeJson(paths.storyClusters, {
    schemaVersion: "live-news-story-clusters-v1",
    updatedAt: null,
    story_clusters: [],
  });
  writeJson(paths.storyClusterSignals, {
    schemaVersion: "live-news-story-cluster-signals-v1",
    updatedAt: null,
    story_cluster_signals: [],
  });
  writeJson(paths.storyClusterEvents, {
    schemaVersion: "live-news-story-cluster-events-v1",
    updatedAt: null,
    story_cluster_events: [],
  });
  writeJson(paths.localCities, {
    schemaVersion: "live-news-local-cities-v1",
    updatedAt: null,
    cities: [],
  });
  writeJson(paths.sourceCityCoverage, {
    schemaVersion: "live-news-source-city-coverage-v1",
    updatedAt: null,
    source_city_coverage: [],
  });
  return { dir, paths };
}

function readFixtureJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mockResponse({ status = 200, body = "", headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders[String(name || "").toLowerCase()] || "";
      },
    },
    text: async () => body,
  };
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
  latitude: 32.7157,
  longitude: -117.1611,
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

const classifierCity = { ...modelCity, neighborhoods: ["North Park"] };
const losAngelesCity = normalizeCity({
  name: "Los Angeles",
  state_name: "California",
  state_abbr: "CA",
  county_name: "Los Angeles County",
  coverage_score: 80,
  index_status: "index",
});
const classifierSignal = normalizeInputSignal({
  source_id: modelSource.id,
  source_feed_id: modelFeed.id,
  canonical_url: "https://www.sandiego.gov/road-closure",
  title: "San Diego officials announce road closure near North Park",
  excerpt: "The City of San Diego said the San Diego County closure affects I-5 ramps while crews work downtown.",
  entities_json: {
    coordinates: { latitude: 32.7157, longitude: -117.1611 },
    organizations: ["City of San Diego"],
  },
  signal_status: "new",
});
const localClassification = classifyInputSignal(classifierSignal, {
  cities: [classifierCity, losAngelesCity],
  sources: [modelSource],
  sourceCityCoverage: [modelCoverage],
});
expect(localClassification.cityCandidates[0].city_id === modelCity.id, "Signal classifier should rank the covered San Diego city first.");
expect(localClassification.cityCandidates[0].confidence >= 90, "Signal classifier should use source_city_coverage and official source mapping for city confidence.");
expect(localClassification.cityCandidates[0].reasons.some((reason) => reason.includes("source_city_coverage")), "City classifier should explain source_city_coverage matches.");
expect(localClassification.cityCandidates[0].reasons.some((reason) => reason.includes("city name")), "City classifier should explain city/state title or excerpt matches.");
expect(localClassification.cityCandidates[0].reasons.some((reason) => reason.includes("county reference")), "City classifier should use county references.");
expect(localClassification.cityCandidates[0].reasons.some((reason) => reason.includes("neighborhood")), "City classifier should use neighborhood references when available.");
expect(localClassification.cityCandidates[0].reasons.some((reason) => reason.includes("latitude/longitude")), "City classifier should use source latitude/longitude when available.");
expect(localClassification.topicCandidates.some((topic) => topic.topic === "traffic"), "Topic classifier should assign road-closure signals to traffic.");
expect(localClassification.topicCandidates.some((topic) => topic.topic === "city-hall"), "Topic classifier should use official city source type as a city-hall hint.");
expect(localClassification.urgency === "high", "Urgency classifier should mark road closures as high urgency.");
expect(localClassification.sourceType === "official_city", "Signal classifier should assign source type from local_sources.");
expect(localClassification.confidence >= 70, "Signal classifier should return a useful overall confidence score.");
expect(localClassification.localEntities.places.includes("San Diego"), "Signal classifier should extract local place entities.");
expect(localClassification.localEntities.roads.some((road) => /I-5/i.test(road)), "Signal classifier should extract local road entities.");
expect(localClassification.localEntities.organizations.includes("City of San Diego"), "Signal classifier should preserve source-provided organizations.");

const classifiedSignal = applySignalClassification(classifierSignal, localClassification);
expect(classifiedSignal.signal_status === "classified", "Classified signals should move to classified status.");
expect(classifiedSignal.city_candidates_json[0].city_id === modelCity.id, "Classified signal should store city candidates.");
expect(classifiedSignal.topic_candidates_json.some((topic) => topic.topic === "traffic"), "Classified signal should store topic candidates.");
expect(classifiedSignal.entities_json.localClassification.urgency === "high", "Classified signal should store urgency metadata.");
expect(classifiedSignal.entities_json.localClassification.source_type === "official_city", "Classified signal should store source type metadata.");
expect(validateInputSignal(classifiedSignal).ok, "Classified input signal should still validate against input_signals schema.");

const topicFixtures = [
  ["breaking", "Breaking: emergency alert issued for residents", "local_news"],
  ["crime-public-safety", "Police issue missing person public advisory", "police_fire"],
  ["traffic", "Downtown crash closes highway ramp", "local_news"],
  ["weather", "National Weather Service forecast calls for rain", "weather"],
  ["schools", "School board votes on campus plan", "school"],
  ["city-hall", "City council budget hearing set for Tuesday", "official_city"],
  ["events", "Weekend festival and parade announced downtown", "event"],
  ["sports", "Local team opens playoffs at stadium", "sports"],
  ["local-economy", "New restaurant brings jobs downtown", "local_news"],
  ["health", "Hospital opens public health clinic", "local_news"],
  ["transit", "Transit agency changes bus route service", "transit"],
  ["housing", "City considers apartment rent and housing proposal", "local_news"],
  ["courts", "Judge issues ruling in local lawsuit", "local_news"],
  ["community", "Neighborhood library volunteer event expands", "community"],
];
for (const [expectedTopic, title, sourceType] of topicFixtures) {
  const topicSignal = normalizeInputSignal({
    source_id: modelSource.id,
    source_feed_id: modelFeed.id,
    canonical_url: `https://example.org/${expectedTopic}`,
    title,
  });
  const topics = classifyTopicCandidates(topicSignal, { sourceType });
  expect(topics.some((topic) => topic.topic === expectedTopic), `Topic classifier should assign ${expectedTopic}.`);
}

const cityCandidatesFromHelper = classifyCityCandidates(classifierSignal, [classifierCity, losAngelesCity], [modelCoverage], {
  sources: [modelSource],
  source: modelSource,
});
expect(cityCandidatesFromHelper.length >= 1 && cityCandidatesFromHelper[0].city_id === modelCity.id, "classifyCityCandidates helper should return ranked city candidates.");
expect(getSignalSourceType(classifierSignal, [modelSource]) === "official_city", "getSignalSourceType should resolve local source type.");
expect(extractLocalEntities(classifierSignal, { cities: [classifierCity] }).counties.includes("San Diego County"), "extractLocalEntities should identify county references.");
const classifierService = createLocalSignalClassifierService({
  cities: [classifierCity, losAngelesCity],
  sources: [modelSource],
  sourceCityCoverage: [modelCoverage],
});
expect(classifierService.classifyInputSignal(classifierSignal).confidence >= 70, "Classifier service should expose classifyInputSignal.");
expect(classifyInputSignals([classifierSignal, modelSignal], {
  cities: [classifierCity, losAngelesCity],
  sources: [modelSource],
  sourceCityCoverage: [modelCoverage],
}).length === 2, "Batch classification should process every supplied signal without an artificial intake cap.");

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

const clusterFixture = createRegistryFixture();
const publisherSource = normalizeLocalSource({
  id: "metro-desk",
  name: "Metro Desk",
  homepage_url: "https://metro.example.org",
  source_type: "local_news",
  trust_level: "established_publisher",
  crawl_status: "active",
});
const secondPublisherSource = normalizeLocalSource({
  id: "city-newswire",
  name: "City Newswire",
  homepage_url: "https://wire.example.org",
  source_type: "tv",
  trust_level: "established_publisher",
  crawl_status: "active",
});
const communityOnlySource = normalizeLocalSource({
  id: "neighborhood-notes",
  name: "Neighborhood Notes",
  homepage_url: "https://notes.example.org",
  source_type: "blog",
  trust_level: "unknown",
  crawl_status: "active",
});
const clusteringSources = [modelSource, publisherSource, secondPublisherSource, communityOnlySource];
writeJson(clusterFixture.paths.localSources, {
  schemaVersion: "live-news-local-sources-v1",
  updatedAt: null,
  local_sources: clusteringSources,
});

function makeClassifiedSignal({
  id,
  source,
  title,
  excerpt,
  canonicalUrl,
  topic = "traffic",
  cityId = modelCity.id,
  publishedAt = daysAgo(0.2),
  contentHash = "",
  entities = {},
}) {
  const signal = normalizeInputSignal({
    id,
    source_id: source.id,
    source_feed_id: `${source.id}-feed`,
    canonical_url: canonicalUrl || `https://example.org/${id}`,
    title,
    excerpt,
    published_at: publishedAt,
    content_hash: contentHash || undefined,
    city_candidates_json: cityId ? [{ city_id: cityId, confidence: 94, reasons: ["test fixture city"] }] : [],
    topic_candidates_json: [{ topic, confidence: 90, reasons: ["test fixture topic"] }],
    entities_json: entities,
    signal_status: "classified",
  });
  return applySignalClassification(signal, {
    classifierVersion: "test-classifier",
    signalId: signal.id,
    cityCandidates: signal.city_candidates_json,
    topicCandidates: signal.topic_candidates_json,
    urgency: topic === "breaking" ? "breaking" : (topic === "traffic" ? "high" : "normal"),
    urgencyReasons: ["test fixture urgency"],
    sourceType: source.source_type,
    sourceTrustLevel: source.trust_level,
    confidence: cityId ? 88 : 30,
    localEntities: {
      organizations: entities.organizations || [],
      places: cityId ? ["San Diego"] : [],
      roads: entities.roads || [],
      agencies: entities.agencies || [],
    },
    status: cityId ? "classified" : "classified_low_confidence",
  });
}

const officialClosureSignal = makeClassifiedSignal({
  id: "signal-official-closure",
  source: modelSource,
  title: "San Diego officials announce road closure near North Park",
  excerpt: "The city says I-5 ramps will close while crews repair a water line.",
  canonicalUrl: "https://www.sandiego.gov/road-closure-1",
  entities: {
    organizations: ["City of San Diego"],
    roads: ["I-5"],
    incident_id: "SD-ROAD-2026-11",
  },
});
const similarPublisherSignal = makeClassifiedSignal({
  id: "signal-publisher-closure",
  source: publisherSource,
  title: "Road closure announced near North Park in San Diego",
  excerpt: "Drivers are being routed around I-5 ramp work after a city notice.",
  canonicalUrl: "https://metro.example.org/north-park-road-closure",
  entities: {
    organizations: ["City of San Diego"],
    roads: ["I-5"],
  },
});
const sameCanonicalSignal = makeClassifiedSignal({
  id: "signal-same-canonical",
  source: secondPublisherSource,
  title: "Traffic note issued for North Park drivers",
  excerpt: "A separate source points readers to the same road closure notice.",
  canonicalUrl: "https://www.sandiego.gov/road-closure-1",
});
const schoolSignalOne = makeClassifiedSignal({
  id: "signal-school-one",
  source: publisherSource,
  title: "San Diego school board approves campus safety plan",
  excerpt: "The district vote focuses on campus access and student safety.",
  canonicalUrl: "https://metro.example.org/school-board-plan",
  topic: "schools",
});
const schoolSignalTwo = makeClassifiedSignal({
  id: "signal-school-two",
  source: secondPublisherSource,
  title: "Campus safety plan approved by San Diego school board",
  excerpt: "A second source reports the same district vote.",
  canonicalUrl: "https://wire.example.org/campus-safety-plan",
  topic: "schools",
});
const officialIncidentSignalOne = makeClassifiedSignal({
  id: "signal-official-incident-one",
  source: modelSource,
  title: "San Diego police post downtown response update",
  excerpt: "Officials refer residents to case SD-CASE-4401.",
  canonicalUrl: "https://www.sandiego.gov/police-case-4401",
  topic: "crime-public-safety",
  entities: {
    incident_id: "SD-CASE-4401",
    agencies: ["San Diego Police"],
  },
});
const officialIncidentSignalTwo = makeClassifiedSignal({
  id: "signal-official-incident-two",
  source: secondPublisherSource,
  title: "Downtown response note adds official case context",
  excerpt: "The update points to case SD-CASE-4401 and city police records.",
  canonicalUrl: "https://wire.example.org/downtown-response-context",
  topic: "crime-public-safety",
  entities: {
    incident_id: "SD-CASE-4401",
    agencies: ["San Diego Police"],
  },
});
const weakLocalitySignal = makeClassifiedSignal({
  id: "signal-weak-locality",
  source: communityOnlySource,
  title: "Community note mentions a weekend update",
  excerpt: "The item has unclear locality and weak source confirmation.",
  canonicalUrl: "https://notes.example.org/weekend-update",
  topic: "community",
  cityId: "",
});
writeJson(clusterFixture.paths.inputSignals, {
  schemaVersion: "live-news-input-signals-v1",
  updatedAt: null,
  input_signals: [
    officialClosureSignal,
    similarPublisherSignal,
    sameCanonicalSignal,
    schoolSignalOne,
    schoolSignalTwo,
    officialIncidentSignalOne,
    officialIncidentSignalTwo,
    weakLocalitySignal,
  ],
});

expect(calculateTitleSimilarity(
  officialClosureSignal.title,
  similarPublisherSignal.title
) >= 0.52, "Title similarity should recognize reordered but similar local event titles.");

const createdClusterResult = clusterInputSignal(officialClosureSignal, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(createdClusterResult.action === "created", "First signal for an event should create a story cluster.");
expect(createdClusterResult.cluster.confidence_label === "official", "Official source should create an official cluster confidence label.");
expect(createdClusterResult.cluster.source_count === 1, "New cluster should start with one source.");
expect(createdClusterResult.cluster.official_source_count === 1, "New official cluster should count official sources.");
expect(createdClusterResult.cluster.index_status === "index", "Official cluster should be indexable.");
expect(
  new Date(createdClusterResult.cluster.expires_at).getTime() - new Date(createdClusterResult.cluster.public_started_at).getTime() === 7 * 24 * 60 * 60 * 1000,
  "New story cluster should expire seven days after public_started_at."
);
expect(createdClusterResult.events[0].event_type === "first_seen", "New cluster should create a first_seen event.");

const attachedSimilarResult = clusterInputSignal(similarPublisherSignal, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(attachedSimilarResult.action === "attached", "Similar title with same city/topic/time should attach to existing cluster.");
expect(attachedSimilarResult.match.reason === "same_city_topic_time_title_similarity", "Similar event match should explain title/time/city/topic matching.");
expect(attachedSimilarResult.cluster.id === createdClusterResult.cluster.id, "Similar signal should attach to the existing closure cluster.");
expect(attachedSimilarResult.cluster.source_count === 2, "Attached signal should update source_count.");
expect(attachedSimilarResult.cluster.official_source_count === 1, "Attached publisher signal should preserve official_source_count.");
expect(attachedSimilarResult.events.some((event) => event.event_type === "source_added"), "Attached publisher signal should create a source_added event.");

const attachedCanonicalResult = clusterInputSignal(sameCanonicalSignal, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(attachedCanonicalResult.action === "attached", "Shared canonical URL should attach to an existing cluster.");
expect(attachedCanonicalResult.match.reason === "shared_canonical_url" || attachedCanonicalResult.match.reason === "shared_url_hash", "Shared URL/hash match should explain exact URL matching.");

const schoolCreatedResult = clusterInputSignal(schoolSignalOne, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(schoolCreatedResult.cluster.confidence_label === "reported_one_source", "One established publisher source should be reported_one_source.");
const schoolAttachedResult = clusterInputSignal(schoolSignalTwo, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(schoolAttachedResult.cluster.confidence_label === "confirmed_multiple_sources", "Two distinct established sources should upgrade to confirmed_multiple_sources.");
expect(schoolAttachedResult.events.some((event) => event.event_type === "confidence_changed"), "Confidence upgrades should create a confidence_changed event.");

const officialIncidentRefs = getOfficialIncidentReferences(officialIncidentSignalOne);
expect(officialIncidentRefs.some((ref) => ref.includes("sd-case-4401")), "Official incident references should be extracted for matching.");
const officialIncidentCreated = clusterInputSignal(officialIncidentSignalOne, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
const officialIncidentAttached = clusterInputSignal(officialIncidentSignalTwo, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(officialIncidentAttached.cluster.id === officialIncidentCreated.cluster.id, "Same official incident reference should attach to existing cluster.");
expect(officialIncidentAttached.match.reason === "same_official_incident_reference", "Official incident match should explain the incident reference.");
expect(officialIncidentAttached.events.some((event) => event.event_type === "source_added"), "Official incident publisher attachment should create a cluster event.");

const weakClusterResult = clusterInputSignal(weakLocalitySignal, {
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(weakClusterResult.cluster.confidence_label === "low_confidence", "Weak source with unclear locality should create a low_confidence cluster.");
expect(weakClusterResult.cluster.index_status === "noindex", "Low confidence clusters should not be indexable.");

const persistedClusters = readFixtureJson(clusterFixture.paths.storyClusters).story_clusters;
const persistedLinks = readFixtureJson(clusterFixture.paths.storyClusterSignals).story_cluster_signals;
const persistedEvents = readFixtureJson(clusterFixture.paths.storyClusterEvents).story_cluster_events;
expect(persistedClusters.length >= 4, "Story clustering should persist created clusters.");
expect(persistedLinks.length >= 8, "Story clustering should persist cluster-signal links.");
expect(persistedEvents.length >= 8, "Story clustering should persist cluster events.");
expect(persistedClusters.every((cluster) => validateStoryCluster(normalizeStoryCluster(cluster)).ok), "Persisted story clusters should validate.");
expect(persistedLinks.every((link) => validateStoryClusterSignal(normalizeStoryClusterSignal(link)).ok), "Persisted cluster-signal links should validate.");
expect(persistedEvents.every((event) => validateStoryClusterEvent(normalizeStoryClusterEvent(event)).ok), "Persisted cluster events should validate.");

const finderMatch = findMatchingStoryCluster(
  similarPublisherSignal,
  persistedClusters.map(normalizeStoryCluster),
  persistedLinks.map(normalizeStoryClusterSignal),
  readFixtureJson(clusterFixture.paths.inputSignals).input_signals.map(normalizeInputSignal),
  clusteringSources
);
expect(Boolean(finderMatch), "findMatchingStoryCluster should find a matching live cluster.");
const clusteringService = createLocalStoryClusteringService({
  paths: clusterFixture.paths,
  sources: clusteringSources,
});
expect(typeof clusteringService.clusterInputSignal === "function", "Clustering service should expose clusterInputSignal.");
expect(clusterInputSignals([], { paths: clusterFixture.paths }).length === 0, "Batch clustering should safely handle an empty signal list.");
expect(clusterUnclusteredInputSignals({ paths: clusterFixture.paths, sources: clusteringSources }).length === 0, "Clustered fixture signals should not be processed again as unclustered.");

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

const registryFixture = createRegistryFixture();
const registryService = createSourceRegistryService({ paths: registryFixture.paths });
const createdRegistrySource = registryService.createSource({
  name: "San Diego Civic Source",
  homepage_url: "https://www.sandiego.gov",
  source_type: "official_city",
  trust_level: "official",
  crawl_status: "active",
});
expect(createdRegistrySource.id === "san-diego-civic-source", "createSource should create a stable source id.");
const updatedRegistrySource = registryService.updateSource(createdRegistrySource.id, { trust_level: "official" });
expect(updatedRegistrySource.updated_at, "updateSource should return an updated source timestamp.");
const createdRegistryFeed = registryService.addSourceFeed(createdRegistrySource.id, {
  feed_type: "rss",
  url: "https://www.sandiego.gov/rss.xml",
  fetch_frequency_minutes: 15,
  next_fetch_at: daysAgo(0.01),
});
expect(createdRegistryFeed.source_id === createdRegistrySource.id, "addSourceFeed should attach feed to the source.");
expect(registryService.getSourcesDueForFetch().length === 1, "getSourcesDueForFetch should return active feeds due now.");
const pausedRegistrySource = registryService.pauseSource(createdRegistrySource.id);
expect(pausedRegistrySource.crawl_status === "paused", "pauseSource should mark the source paused.");
expect(registryService.getSourcesDueForFetch().length === 0, "Paused sources should not be due for fetch.");
registryService.updateSource(createdRegistrySource.id, { crawl_status: "active" });
const blockedRegistrySource = registryService.markRobotsBlocked(createdRegistrySource.id);
expect(blockedRegistrySource.crawl_status === "blocked_by_robots", "markRobotsBlocked should mark the source blocked by robots.");
expect(registryService.getSourcesDueForFetch().length === 0, "Robots-blocked sources should not be due for fetch.");
registryService.updateSource(createdRegistrySource.id, { crawl_status: "active" });
const registryHealth = registryService.getSourceHealth(createdRegistrySource.id);
expect(registryHealth.feedCount === 1, "getSourceHealth should count source feeds.");
const pendingSubmission = registryService.submitUserSource({
  submitted_url: "https://community.example.org/feed.xml",
  submitted_city: "San Diego, CA",
});
expect(pendingSubmission.status === "pending", "submitUserSource should create a pending submission.");
const approvedSubmission = registryService.approveUserSource(pendingSubmission.id, {
  name: "Community Example",
  source_type: "community",
  trust_level: "community",
  createFeed: false,
});
expect(approvedSubmission.submission.status === "approved", "approveUserSource should approve the submitted source.");
expect(approvedSubmission.source.crawl_status === "pending_review", "Approved user sources should remain pending review unless explicitly activated.");

async function runSourceFetcherChecks() {
  const fetchFixture = createRegistryFixture();
  const fetchRegistry = createSourceRegistryService({ paths: fetchFixture.paths });
  const fetchSource = fetchRegistry.createSource({
    name: "Fetch Test Source",
    homepage_url: "https://fetch.example.org",
    source_type: "local_news",
    trust_level: "established_publisher",
    crawl_status: "active",
  });
  const fetchFeed = fetchRegistry.addSourceFeed(fetchSource.id, {
    feed_type: "rss",
    url: "https://fetch.example.org/rss.xml",
    fetch_frequency_minutes: 15,
    next_fetch_at: daysAgo(0.1),
  });

  expect(normalizeUrl("https://example.org/story#section") === "https://example.org/story", "normalizeUrl should remove fragments.");
  expect(canonicalizeUrl("https://www.example.org/story?utm_source=x&b=2") === "https://example.org/story?b=2", "canonicalizeUrl should remove tracking params and normalize host.");
  expect(dedupeByUrlHash("https://example.org/story") === dedupeByUrlHash("https://example.org/story#comments"), "URL hash should dedupe fragment-only differences.");
  expect(dedupeByContentHash("Title", "Excerpt", "2026-05-12") === dedupeByContentHash(" title ", "excerpt", "2026-05-12T10:00:00Z"), "Content hash should normalize text and date.");

  const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>San Diego RSS update</title><link>https://fetch.example.org/story?utm_source=test</link><description>Residents get a local update.</description><pubDate>Tue, 12 May 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const rssResult = await fetchRssFeed(fetchFeed, {
    fetchImpl: async () => mockResponse({
      body: rssXml,
      headers: { etag: "rss-etag", "last-modified": "Tue, 12 May 2026 10:00:00 GMT" },
    }),
  });
  expect(rssResult.items.length === 1, "fetchRssFeed should return RSS items.");
  expect(rssResult.etag === "rss-etag", "fetchRssFeed should expose ETag.");

  const atomXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><title>San Diego Atom update</title><link href="https://fetch.example.org/atom-story"/><updated>2026-05-12T11:00:00Z</updated><summary>Atom local update.</summary></entry></feed>`;
  const atomResult = await fetchAtomFeed({ ...fetchFeed, feed_type: "atom", url: "https://fetch.example.org/atom.xml" }, {
    fetchImpl: async () => mockResponse({ body: atomXml }),
  });
  expect(atomResult.items.length === 1, "fetchAtomFeed should return Atom items.");

  const sitemapXml = `<?xml version="1.0"?><urlset><url><loc>https://fetch.example.org/a</loc><lastmod>2026-05-12</lastmod></url><url><loc>https://fetch.example.org/b</loc><lastmod>2026-05-12</lastmod></url><url><loc>https://fetch.example.org/c</loc><lastmod>2026-05-12</lastmod></url></urlset>`;
  const sitemapResult = await fetchSitemap({ ...fetchFeed, feed_type: "sitemap", url: "https://fetch.example.org/sitemap.xml" }, {
    fetchImpl: async () => mockResponse({ body: sitemapXml }),
  });
  expect(sitemapResult.items.length === 3, "fetchSitemap should process all sitemap URLs supplied by the page, not a hard first batch.");

  let apiCalls = 0;
  const apiResult = await fetchApiFeed({ ...fetchFeed, feed_type: "api", url: "https://api.example.org/local" }, {
    fetchImpl: async (url) => {
      apiCalls += 1;
      if (String(url).includes("cursor=page-2")) {
        return mockResponse({ body: JSON.stringify({ items: [{ title: "API page two", url: "https://api.example.org/two", summary: "Second page." }] }) });
      }
      return mockResponse({
        body: JSON.stringify({
          items: [{ title: "API page one", url: "https://api.example.org/one", summary: "First page." }],
          nextCursor: "page-2",
        }),
      });
    },
  });
  expect(apiCalls === 2, "fetchApiFeed should follow cursor pagination.");
  expect(apiResult.items.length === 2, "fetchApiFeed should collect items across cursor pages.");

  const htmlFeed = { ...fetchFeed, feed_type: "html", url: "https://fetch.example.org/page.html" };
  const blockedHtml = await fetchHtmlSource(htmlFeed, { source: fetchSource, fetchImpl: async () => mockResponse({ body: "" }) });
  expect(blockedHtml.skipped === true, "fetchHtmlSource should skip HTML unless explicitly allowed.");
  const allowedHtml = await fetchHtmlSource(
    { ...htmlFeed, allow_html_fetch: true },
    {
      source: { ...fetchSource, allow_html_fetch: true },
      fetchImpl: async () => mockResponse({ body: `<html><head><title>Local HTML update</title><meta name="description" content="Short public page description."><link rel="canonical" href="https://fetch.example.org/page.html"></head></html>` }),
    }
  );
  expect(allowedHtml.items.length === 1, "fetchHtmlSource should fetch allowed public HTML source pages.");

  const firstSignalCreate = createInputSignal(rssResult.items[0], { paths: fetchFixture.paths });
  const duplicateSignalCreate = createInputSignal({ ...rssResult.items[0], title: "Different title" }, { paths: fetchFixture.paths });
  expect(firstSignalCreate.created === true, "createInputSignal should store a new signal.");
  expect(duplicateSignalCreate.created === false && duplicateSignalCreate.duplicateReason === "url_hash", "createInputSignal should dedupe by URL hash.");

  const rssXmlForClassifiedFetch = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>San Diego classified source update</title><link>https://fetch.example.org/story-classified?utm_source=test</link><description>City residents get a fresh local signal for classification.</description><pubDate>Tue, 12 May 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  let retryCalls = 0;
  const fetchedFeedResult = await fetchSourceFeed(
    { source: fetchSource, feed: fetchFeed },
    {
      paths: fetchFixture.paths,
      retryBackoffMs: 0,
      fetchImpl: async () => {
        retryCalls += 1;
        if (retryCalls === 1) throw new Error("temporary source failure");
        return mockResponse({
          body: rssXmlForClassifiedFetch,
          headers: { etag: "final-etag", "last-modified": "Tue, 12 May 2026 10:00:00 GMT" },
        });
      },
    }
  );
  expect(retryCalls === 2, "fetchSourceFeed should retry with backoff after a source failure.");
  expect(fetchedFeedResult.status === "success", "fetchSourceFeed should recover and log a successful run after retry.");
  expect(fetchedFeedResult.createdSignals[0].signal.signal_status === "classified", "Fetched source items should be classified before storage.");
  expect(fetchedFeedResult.createdSignals[0].signal.entities_json.localClassification.source_type === "local_news", "Fetched source classification should preserve source type.");
  expect(Array.isArray(fetchedFeedResult.createdSignals[0].signal.city_candidates_json), "Fetched source classification should store city candidates.");
  expect(Array.isArray(fetchedFeedResult.createdSignals[0].signal.topic_candidates_json), "Fetched source classification should store topic candidates.");
  expect(fetchedFeedResult.clusteredSignals.length === 1, "Fetched source items should be clustered after storage.");
  expect(["created", "attached"].includes(fetchedFeedResult.clusteredSignals[0].action), "Fetched source clustering should create or attach a story cluster.");
  const fetchRunsAfterSuccess = readFixtureJson(fetchFixture.paths.sourceFetchRuns).source_fetch_runs;
  expect(fetchRunsAfterSuccess.length === 1 && fetchRunsAfterSuccess[0].status === "success", "fetchSourceFeed should log every successful fetch run.");
  const feedAfterFetch = readFixtureJson(fetchFixture.paths.sourceFeeds).source_feeds[0];
  expect(feedAfterFetch.etag === "final-etag", "fetchSourceFeed should persist ETag after successful fetch.");
  expect(feedAfterFetch.next_fetch_at, "fetchSourceFeed should schedule the next fetch using source frequency.");

  fetchRegistry.markRobotsBlocked(fetchSource.id);
  const skippedFetchResult = await fetchSourceFeed(
    { source: { ...fetchSource, crawl_status: "blocked_by_robots" }, feed: fetchFeed },
    { paths: fetchFixture.paths, fetchImpl: async () => mockResponse({ body: rssXml }) }
  );
  expect(skippedFetchResult.status === "skipped", "fetchSourceFeed should skip robots-blocked sources.");
  const loginSkippedFetchResult = await fetchSourceFeed(
    { source: fetchSource, feed: { ...fetchFeed, requires_login: true } },
    { paths: fetchFixture.paths, fetchImpl: async () => mockResponse({ body: rssXml }) }
  );
  expect(loginSkippedFetchResult.status === "skipped", "fetchSourceFeed should skip feeds requiring login.");
  const fetchRunsAfterSkip = readFixtureJson(fetchFixture.paths.sourceFetchRuns).source_fetch_runs;
  expect(fetchRunsAfterSkip.some((run) => run.status === "skipped"), "Skipped source fetches should be logged.");
}

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
  await runSourceFetcherChecks();

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
