const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getLocalIntelligenceConfig } = require("./local-intelligence-config");
const {
  normalizeInputSignal,
  normalizeStoryCluster,
  normalizeStoryClusterEvent,
  normalizeStoryClusterSignal,
  readInputSignals,
  readLocalSources,
  readStoryClusterEvents,
  readStoryClusters,
  readStoryClusterSignals,
  slugify,
} = require("./local-intelligence-models");

const CLUSTERING_VERSION = "live-news-local-story-clustering-v1";
const MATCH_WINDOW_HOURS = 72;
const TITLE_SIMILARITY_THRESHOLD = 0.52;
const OFFICIAL_SOURCE_TYPES = new Set([
  "official_city",
  "official_county",
  "police_fire",
  "school",
  "transit",
  "weather",
]);
const CONFIDENCE_STRENGTH = {
  low_confidence: 0,
  community_source: 1,
  developing: 2,
  reported_one_source: 3,
  confirmed_multiple_sources: 4,
  official: 5,
};
const URGENCY_STRENGTH = {
  low: 0,
  normal: 1,
  high: 2,
  breaking: 3,
};
const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "and",
  "are",
  "around",
  "at",
  "city",
  "county",
  "for",
  "from",
  "in",
  "into",
  "is",
  "local",
  "near",
  "new",
  "news",
  "of",
  "on",
  "the",
  "to",
  "update",
  "with",
]);

const DEFAULT_PATHS = {
  inputSignals: path.join(__dirname, "..", "data", "input-signals.json"),
  localSources: path.join(__dirname, "..", "data", "local-sources.json"),
  storyClusters: path.join(__dirname, "..", "data", "story-clusters.json"),
  storyClusterSignals: path.join(__dirname, "..", "data", "story-cluster-signals.json"),
  storyClusterEvents: path.join(__dirname, "..", "data", "story-cluster-events.json"),
};

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

function getPaths(paths = {}) {
  return { ...DEFAULT_PATHS, ...paths };
}

function parseTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function signalTime(signal = {}, now = new Date()) {
  return parseTime(signal.published_at) ||
    parseTime(signal.fetched_at) ||
    parseTime(signal.discovered_at) ||
    parseTime(signal.updated_at) ||
    new Date(now);
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
}

function normalizeForMatch(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTitle(value) {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function calculateTitleSimilarity(left, right) {
  const leftTokens = new Set(tokenizeTitle(left));
  const rightTokens = new Set(tokenizeTitle(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const dice = (2 * shared) / (leftTokens.size + rightTokens.size);
  const containment = shared / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(dice, containment * 0.82);
}

function getPrimaryCityId(signal = {}) {
  const candidates = [...(signal.city_candidates_json || [])].sort(
    (left, right) => Number(right.confidence || 0) - Number(left.confidence || 0)
  );
  return cleanText(candidates[0]?.city_id || candidates[0]?.id || signal.city_id || "unknown-locality");
}

function getPrimaryTopic(signal = {}) {
  const candidates = [...(signal.topic_candidates_json || [])].sort(
    (left, right) => Number(right.confidence || 0) - Number(left.confidence || 0)
  );
  return cleanText(candidates[0]?.topic || candidates[0]?.id || signal.primary_topic || "community");
}

function getSignalUrgency(signal = {}) {
  const stored = cleanText(signal.entities_json?.localClassification?.urgency);
  if (["breaking", "high", "normal", "low"].includes(stored)) return stored;
  const topic = getPrimaryTopic(signal);
  if (topic === "breaking") return "breaking";
  if (["crime-public-safety", "traffic"].includes(topic)) return "high";
  return "normal";
}

function getSourceById(sourceId, sources = []) {
  return (sources || []).find((source) => source.id === sourceId || source.slug === sourceId) || null;
}

function isOfficialSource(source = {}) {
  return source?.trust_level === "official" || OFFICIAL_SOURCE_TYPES.has(source?.source_type);
}

function isEstablishedPublisher(source = {}) {
  return source?.trust_level === "established_publisher" || ["local_news", "tv", "radio"].includes(source?.source_type);
}

function isCommunitySource(source = {}) {
  return ["community", "blog"].includes(source?.trust_level) || ["community", "blog"].includes(source?.source_type);
}

function getSignalSource(signal = {}, sources = []) {
  return getSourceById(signal.source_id, sources);
}

function getEntityContainer(signal = {}) {
  return signal.entities_json || {};
}

function getLocalEntities(signal = {}) {
  return getEntityContainer(signal).local_entities || {};
}

function getOfficialIncidentReferences(signal = {}) {
  const entities = getEntityContainer(signal);
  const localEntities = getLocalEntities(signal);
  const direct = [
    entities.incident_id,
    entities.incidentId,
    entities.case_number,
    entities.caseNumber,
    entities.alert_id,
    entities.alertId,
    entities.advisory_id,
    entities.advisoryId,
    localEntities.incident_id,
    localEntities.case_number,
    localEntities.alert_id,
  ];
  const text = [signal.title, signal.excerpt].filter(Boolean).join(" ");
  const regexMatches = cleanText(text).match(/\b(?:incident|case|alert|advisory|order|permit|project)\s*(?:#|no\.?|number)?\s*[:.-]?\s*([a-z0-9][a-z0-9-]{2,})\b/gi) || [];
  const extracted = regexMatches.map((match) => normalizeForMatch(match));
  return [...new Set([...direct, ...extracted].map(normalizeForMatch).filter(Boolean))];
}

function getEntityKeys(signal = {}) {
  const localEntities = getLocalEntities(signal);
  const entityGroups = [
    localEntities.organizations,
    localEntities.places,
    localEntities.counties,
    localEntities.neighborhoods,
    localEntities.roads,
    localEntities.schools,
    localEntities.agencies,
    getEntityContainer(signal).organizations,
    getEntityContainer(signal).places,
  ];
  return [...new Set(entityGroups.flatMap((group) => group || []).map(normalizeForMatch).filter(Boolean))];
}

function intersects(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function sharedEntityCount(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length;
}

function loadClustersPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.storyClusters, {
    schemaVersion: "live-news-story-clusters-v1",
    updatedAt: null,
    story_clusters: [],
  });
}

function saveClustersPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.storyClusters, payload);
  return payload;
}

function loadClusterSignalsPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.storyClusterSignals, {
    schemaVersion: "live-news-story-cluster-signals-v1",
    updatedAt: null,
    story_cluster_signals: [],
  });
}

function saveClusterSignalsPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.storyClusterSignals, payload);
  return payload;
}

function loadClusterEventsPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.storyClusterEvents, {
    schemaVersion: "live-news-story-cluster-events-v1",
    updatedAt: null,
    story_cluster_events: [],
  });
}

function saveClusterEventsPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.storyClusterEvents, payload);
  return payload;
}

function loadInputSignalsPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.inputSignals, {
    schemaVersion: "live-news-input-signals-v1",
    updatedAt: null,
    input_signals: [],
  });
}

function saveInputSignalsPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.inputSignals, payload);
  return payload;
}

function getLinkedSignals(cluster, clusterSignals = [], inputSignals = []) {
  const linkedIds = new Set(
    (clusterSignals || [])
      .filter((link) => link.story_cluster_id === cluster.id)
      .map((link) => link.input_signal_id)
  );
  return (inputSignals || []).filter((signal) => linkedIds.has(signal.id));
}

function getSharedUrlOrHashMatch(signal = {}, linkedSignals = []) {
  for (const linked of linkedSignals || []) {
    if (signal.canonical_url && linked.canonical_url && signal.canonical_url === linked.canonical_url) {
      return { matched: true, reason: "shared_canonical_url" };
    }
    if (signal.url_hash && linked.url_hash && signal.url_hash === linked.url_hash) {
      return { matched: true, reason: "shared_url_hash" };
    }
    if (signal.content_hash && linked.content_hash && signal.content_hash === linked.content_hash) {
      return { matched: true, reason: "shared_content_hash" };
    }
  }
  return { matched: false, reason: "" };
}

function hasOfficialIncidentOrEntityMatch(signal = {}, linkedSignals = [], sources = []) {
  const signalRefs = getOfficialIncidentReferences(signal);
  const signalEntities = getEntityKeys(signal);
  const signalSource = getSignalSource(signal, sources);
  for (const linked of linkedSignals || []) {
    const linkedRefs = getOfficialIncidentReferences(linked);
    if (signalRefs.length && intersects(signalRefs, linkedRefs)) {
      return { matched: true, reason: "same_official_incident_reference" };
    }
    const linkedSource = getSignalSource(linked, sources);
    const officialRelationship = isOfficialSource(signalSource) || isOfficialSource(linkedSource);
    if (officialRelationship && sharedEntityCount(signalEntities, getEntityKeys(linked)) >= 2) {
      return { matched: true, reason: "same_official_entity_reference" };
    }
  }
  return { matched: false, reason: "" };
}

function isWithinClusterTimeWindow(signal = {}, cluster = {}, now = new Date(), hours = MATCH_WINDOW_HOURS) {
  const signalDate = signalTime(signal, now);
  const clusterDate = parseTime(cluster.last_updated_at) || parseTime(cluster.first_seen_at) || new Date(now);
  const deltaMs = Math.abs(signalDate.getTime() - clusterDate.getTime());
  return deltaMs <= Number(hours || MATCH_WINDOW_HOURS) * 60 * 60 * 1000;
}

function findMatchingStoryCluster(signalInput = {}, clusters = [], clusterSignals = [], inputSignals = [], sources = [], options = {}) {
  const signal = normalizeInputSignal(signalInput);
  const now = options.now || new Date();
  const cityId = getPrimaryCityId(signal);
  const topic = getPrimaryTopic(signal);
  let bestMatch = null;

  for (const cluster of clusters || []) {
    const linkedSignals = getLinkedSignals(cluster, clusterSignals, inputSignals);
    const sharedUrlOrHash = getSharedUrlOrHashMatch(signal, linkedSignals);
    if (sharedUrlOrHash.matched) {
      return { cluster, score: 1, reason: sharedUrlOrHash.reason, linkedSignals };
    }

    const sameCity = cluster.city_id === cityId;
    const sameTopic = cluster.primary_topic === topic;
    const live = cluster.public_status === "live";
    const inWindow = isWithinClusterTimeWindow(signal, cluster, now, options.matchWindowHours || MATCH_WINDOW_HOURS);

    if (sameCity && sameTopic && live && inWindow) {
      const similarity = calculateTitleSimilarity(signal.title, cluster.headline);
      if (similarity >= (options.titleSimilarityThreshold || TITLE_SIMILARITY_THRESHOLD)) {
        const candidate = { cluster, score: similarity, reason: "same_city_topic_time_title_similarity", linkedSignals };
        if (!bestMatch || candidate.score > bestMatch.score) bestMatch = candidate;
      }
    }

    const officialMatch = hasOfficialIncidentOrEntityMatch(signal, linkedSignals, sources);
    if (!bestMatch && officialMatch.matched && (cluster.city_id === cityId || cityId === "unknown-locality")) {
      return { cluster, score: 0.98, reason: officialMatch.reason, linkedSignals };
    }
  }

  return bestMatch;
}

function getSignalSetConfidenceLabel(signals = [], sources = []) {
  const sourceIds = [...new Set((signals || []).map((signal) => signal.source_id).filter(Boolean))];
  const sourceRecords = sourceIds.map((sourceId) => getSourceById(sourceId, sources)).filter(Boolean);
  const officialCount = sourceRecords.filter(isOfficialSource).length;
  const establishedCount = sourceRecords.filter(isEstablishedPublisher).length;
  const communityCount = sourceRecords.filter(isCommunitySource).length;
  const hasClearCity = (signals || []).some((signal) => getPrimaryCityId(signal) !== "unknown-locality");
  const hasWeakSourceOnly = sourceRecords.every((source) => !isOfficialSource(source) && !isEstablishedPublisher(source) && !isCommunitySource(source));
  const hasDevelopingLanguage = (signals || []).some((signal) => /\b(developing|ongoing|investigation|details limited|preliminary)\b/i.test(`${signal.title} ${signal.excerpt}`));
  if (officialCount > 0) return "official";
  if (sourceIds.length >= 2 && establishedCount >= 1) return "confirmed_multiple_sources";
  if (establishedCount === 1) return "reported_one_source";
  if (!hasClearCity) return "low_confidence";
  if (communityCount >= 1) return "community_source";
  if (hasDevelopingLanguage) return "developing";
  if (!hasClearCity || hasWeakSourceOnly) return "low_confidence";
  return "developing";
}

function strongerConfidenceLabel(left, right) {
  return (CONFIDENCE_STRENGTH[right] || 0) > (CONFIDENCE_STRENGTH[left] || 0) ? right : left;
}

function getClusterIndexStatus(confidenceLabel) {
  return confidenceLabel === "low_confidence" ? "noindex" : "index";
}

function getSourceCounts(signals = [], sources = []) {
  const sourceIds = [...new Set((signals || []).map((signal) => signal.source_id).filter(Boolean))];
  const officialSourceIds = sourceIds.filter((sourceId) => isOfficialSource(getSourceById(sourceId, sources)));
  return {
    sourceCount: sourceIds.length,
    officialSourceCount: officialSourceIds.length,
  };
}

function getStrongestUrgency(signals = []) {
  return (signals || []).map(getSignalUrgency).sort(
    (left, right) => (URGENCY_STRENGTH[right] || 0) - (URGENCY_STRENGTH[left] || 0)
  )[0] || "normal";
}

function getLatestSignal(signals = [], now = new Date()) {
  return [...(signals || [])].sort((left, right) => signalTime(right, now) - signalTime(left, now))[0] || null;
}

function buildClusterFromSignal(signalInput = {}, sources = [], options = {}) {
  const config = options.config || getLocalIntelligenceConfig();
  const signal = normalizeInputSignal(signalInput);
  const now = options.now || new Date();
  const publicStartedAt = signalTime(signal, now).toISOString();
  const expiresAt = addDays(publicStartedAt, config.storyPublicTtlDays).toISOString();
  const confidenceLabel = getSignalSetConfidenceLabel([signal], sources);
  const title = cleanText(signal.title || "Local update");
  const summary = cleanText(signal.excerpt).slice(0, 500);
  return normalizeStoryCluster({
    id: `cluster-${stableHash(`${getPrimaryCityId(signal)}:${getPrimaryTopic(signal)}:${title}:${publicStartedAt}`, 18)}`,
    city_id: getPrimaryCityId(signal),
    primary_topic: getPrimaryTopic(signal),
    slug: slugify(title) || `local-story-${stableHash(signal.id)}`,
    headline: title,
    summary,
    confidence_label: confidenceLabel,
    urgency: getSignalUrgency(signal),
    first_seen_at: publicStartedAt,
    last_updated_at: publicStartedAt,
    public_started_at: publicStartedAt,
    expires_at: expiresAt,
    public_status: new Date(expiresAt) <= new Date(now) ? "expired" : "live",
    index_status: getClusterIndexStatus(confidenceLabel),
    source_count: 1,
    official_source_count: isOfficialSource(getSignalSource(signal, sources)) ? 1 : 0,
    latest_signal_id: signal.id,
    created_at: publicStartedAt,
    updated_at: new Date(now).toISOString(),
  });
}

function updateClusterFromSignals(clusterInput = {}, signals = [], sources = [], options = {}) {
  const cluster = normalizeStoryCluster(clusterInput);
  const now = options.now || new Date();
  const latest = getLatestSignal(signals, now);
  const counts = getSourceCounts(signals, sources);
  const calculatedLabel = getSignalSetConfidenceLabel(signals, sources);
  const confidenceLabel = strongerConfidenceLabel(cluster.confidence_label, calculatedLabel);
  const latestTime = latest ? signalTime(latest, now).toISOString() : cluster.last_updated_at;
  return normalizeStoryCluster({
    ...cluster,
    headline: cluster.headline || latest?.title || "Local update",
    summary: cluster.summary || cleanText(latest?.excerpt).slice(0, 500),
    confidence_label: confidenceLabel,
    urgency: getStrongestUrgency(signals),
    last_updated_at: latestTime,
    public_status: cluster.public_status,
    index_status: getClusterIndexStatus(confidenceLabel),
    source_count: counts.sourceCount,
    official_source_count: counts.officialSourceCount,
    latest_signal_id: latest?.id || cluster.latest_signal_id,
    updated_at: new Date(now).toISOString(),
  });
}

function createClusterSignalLink(cluster, signal, isPrimary = false, now = new Date()) {
  return normalizeStoryClusterSignal({
    story_cluster_id: cluster.id,
    input_signal_id: signal.id,
    source_id: signal.source_id,
    is_primary: isPrimary,
    added_at: new Date(now).toISOString(),
  });
}

function createClusterEvent(cluster, eventType, description, now = new Date()) {
  return normalizeStoryClusterEvent({
    story_cluster_id: cluster.id,
    event_time: new Date(now).toISOString(),
    event_type: eventType,
    description,
    created_at: new Date(now).toISOString(),
  });
}

function markSignalClustered(signalId, paths = {}, now = new Date()) {
  const payload = loadInputSignalsPayload(paths);
  let changed = false;
  const inputSignals = (payload.input_signals || []).map((signal) => {
    if (signal.id !== signalId) return signal;
    changed = true;
    return normalizeInputSignal({ ...signal, signal_status: "clustered", updated_at: new Date(now).toISOString() });
  });
  if (changed) {
    saveInputSignalsPayload({ ...payload, updatedAt: new Date(now).toISOString(), input_signals: inputSignals }, paths);
  }
  return changed;
}

function clusterInputSignal(signalInput = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = options.now || new Date();
  const signal = normalizeInputSignal(signalInput);
  const sources = options.sources || readLocalSources(paths.localSources).local_sources;
  const inputSignalsPayload = loadInputSignalsPayload(paths);
  const inputSignals = [
    signal,
    ...(inputSignalsPayload.input_signals || []).filter((item) => item.id !== signal.id),
  ].map(normalizeInputSignal);
  const clustersPayload = loadClustersPayload(paths);
  const linksPayload = loadClusterSignalsPayload(paths);
  const eventsPayload = loadClusterEventsPayload(paths);
  const clusters = (clustersPayload.story_clusters || []).map(normalizeStoryCluster);
  const links = (linksPayload.story_cluster_signals || []).map(normalizeStoryClusterSignal);
  const match = findMatchingStoryCluster(signal, clusters, links, inputSignals, sources, options);

  if (!match) {
    const cluster = buildClusterFromSignal(signal, sources, options);
    const link = createClusterSignalLink(cluster, signal, true, now);
    const event = createClusterEvent(cluster, "first_seen", `Created cluster from signal ${signal.id}.`, now);
    saveClustersPayload({
      ...clustersPayload,
      updatedAt: new Date(now).toISOString(),
      story_clusters: [cluster, ...clusters],
    }, paths);
    saveClusterSignalsPayload({
      ...linksPayload,
      updatedAt: new Date(now).toISOString(),
      story_cluster_signals: [link, ...links],
    }, paths);
    saveClusterEventsPayload({
      ...eventsPayload,
      updatedAt: new Date(now).toISOString(),
      story_cluster_events: [event, ...(eventsPayload.story_cluster_events || [])],
    }, paths);
    markSignalClustered(signal.id, paths, now);
    return { action: "created", cluster, clusterSignal: link, events: [event], match: null };
  }

  const alreadyLinked = links.some((link) => link.story_cluster_id === match.cluster.id && link.input_signal_id === signal.id);
  const newLink = alreadyLinked ? null : createClusterSignalLink(match.cluster, signal, false, now);
  const nextLinks = newLink ? [newLink, ...links] : links;
  const linkedSignals = [
    signal,
    ...getLinkedSignals(match.cluster, nextLinks, inputSignals).filter((item) => item.id !== signal.id),
  ];
  const beforeLabel = match.cluster.confidence_label;
  const updatedCluster = updateClusterFromSignals(match.cluster, linkedSignals, sources, options);
  const updatedClusters = clusters.map((cluster) => cluster.id === updatedCluster.id ? updatedCluster : cluster);
  const source = getSignalSource(signal, sources);
  const eventType = isOfficialSource(source) ? "official_update" : "source_added";
  const events = [
    createClusterEvent(updatedCluster, eventType, `Attached signal ${signal.id} to cluster by ${match.reason}.`, now),
  ];
  if (updatedCluster.confidence_label !== beforeLabel) {
    events.push(createClusterEvent(
      updatedCluster,
      "confidence_changed",
      `Confidence changed from ${beforeLabel} to ${updatedCluster.confidence_label}.`,
      now
    ));
  }
  saveClustersPayload({
    ...clustersPayload,
    updatedAt: new Date(now).toISOString(),
    story_clusters: updatedClusters,
  }, paths);
  saveClusterSignalsPayload({
    ...linksPayload,
    updatedAt: new Date(now).toISOString(),
    story_cluster_signals: nextLinks,
  }, paths);
  saveClusterEventsPayload({
    ...eventsPayload,
    updatedAt: new Date(now).toISOString(),
    story_cluster_events: [...events, ...(eventsPayload.story_cluster_events || [])],
  }, paths);
  markSignalClustered(signal.id, paths, now);
  return { action: alreadyLinked ? "already_attached" : "attached", cluster: updatedCluster, clusterSignal: newLink, events, match };
}

function clusterInputSignals(signals = [], options = {}) {
  return (signals || []).map((signal) => clusterInputSignal(signal, options));
}

function clusterUnclusteredInputSignals(options = {}) {
  const paths = getPaths(options.paths);
  const payload = readInputSignals(paths.inputSignals);
  const candidates = (payload.input_signals || []).filter((signal) => ["new", "classified"].includes(signal.signal_status));
  return clusterInputSignals(candidates, options);
}

function createLocalStoryClusteringService(options = {}) {
  return {
    clusterInputSignal: (signal, callOptions = {}) => clusterInputSignal(signal, { ...options, ...callOptions }),
    clusterInputSignals: (signals, callOptions = {}) => clusterInputSignals(signals, { ...options, ...callOptions }),
    clusterUnclusteredInputSignals: (callOptions = {}) => clusterUnclusteredInputSignals({ ...options, ...callOptions }),
    findMatchingStoryCluster,
  };
}

module.exports = {
  CLUSTERING_VERSION,
  MATCH_WINDOW_HOURS,
  TITLE_SIMILARITY_THRESHOLD,
  buildClusterFromSignal,
  calculateTitleSimilarity,
  clusterInputSignal,
  clusterInputSignals,
  clusterUnclusteredInputSignals,
  createLocalStoryClusteringService,
  findMatchingStoryCluster,
  getOfficialIncidentReferences,
  getSignalSetConfidenceLabel,
  hasOfficialIncidentOrEntityMatch,
  isOfficialSource,
  updateClusterFromSignals,
};
