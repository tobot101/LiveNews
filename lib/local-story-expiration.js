const fs = require("fs");
const path = require("path");
const { getLocalIntelligenceConfig } = require("./local-intelligence-config");
const {
  normalizeStoryCluster,
  normalizeStoryClusterEvent,
  readStoryClusters,
} = require("./local-intelligence-models");

const DEFAULT_PATHS = {
  storyClusters: path.join(__dirname, "..", "data", "story-clusters.json"),
  storyClusterEvents: path.join(__dirname, "..", "data", "story-cluster-events.json"),
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStoryPublicStartedAt(story = {}) {
  return parseDate(story.public_started_at || story.publicStartedAt || story.first_seen_at || story.firstSeenAt);
}

function getStoryExpiresAt(story = {}) {
  return parseDate(story.expires_at || story.expiresAt);
}

function getCutoff(now = new Date(), ttlDays = getLocalIntelligenceConfig().storyPublicTtlDays) {
  return new Date(new Date(now).getTime() - Number(ttlDays || 7) * 24 * 60 * 60 * 1000);
}

function isPublicStoryLive(story = {}, options = {}) {
  const now = new Date(options.now || new Date());
  const ttlDays = Number(options.ttlDays || getLocalIntelligenceConfig().storyPublicTtlDays || 7);
  const startedAt = getStoryPublicStartedAt(story);
  const expiresAt = getStoryExpiresAt(story);
  return (
    story.public_status === "live" &&
    Boolean(startedAt) &&
    startedAt >= getCutoff(now, ttlDays) &&
    Boolean(expiresAt) &&
    expiresAt > now
  );
}

function getPublicStoryWindowState(story = {}, options = {}) {
  const now = new Date(options.now || new Date());
  const config = getLocalIntelligenceConfig();
  const googleNewsTtlHours = Number(options.googleNewsTtlHours || config.googleNewsTtlHours || 48);
  const startedAt = getStoryPublicStartedAt(story);
  const ageHours = startedAt ? (now.getTime() - startedAt.getTime()) / 3600000 : Infinity;
  const live = isPublicStoryLive(story, { ...options, now });
  const googleNewsEligible = live && ageHours >= 0 && ageHours <= googleNewsTtlHours;
  return {
    live,
    ageHours,
    publicWindowDays: Number(options.ttlDays || config.storyPublicTtlDays || 7),
    googleNewsWindowHours: googleNewsTtlHours,
    publicEligible: live,
    googleNewsEligible,
    cityTopicEligible: live,
    alertEligible: googleNewsEligible,
    newsletterEligible: googleNewsEligible,
    expired: !live,
    window:
      googleNewsEligible ? "0-48h" :
      live ? "day-3-7" :
      "expired",
  };
}

function shouldExpireStory(story = {}, options = {}) {
  const now = new Date(options.now || new Date());
  if (story.public_status !== "live") return false;
  const startedAt = getStoryPublicStartedAt(story);
  const expiresAt = getStoryExpiresAt(story);
  if (!startedAt) return true;
  if (startedAt < getCutoff(now, options.ttlDays)) return true;
  if (expiresAt && expiresAt <= now) return true;
  return false;
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

function createExpiredEvent(cluster = {}, now = new Date()) {
  return normalizeStoryClusterEvent({
    story_cluster_id: cluster.id,
    event_time: new Date(now).toISOString(),
    event_type: "expired",
    description: "Story cluster expired from public local coverage after the 7-day public window.",
    created_at: new Date(now).toISOString(),
  });
}

function expireOldStories(options = {}) {
  const paths = getPaths(options.paths);
  const now = new Date(options.now || new Date());
  const clusterPayload = loadClustersPayload(paths);
  const eventPayload = loadClusterEventsPayload(paths);
  const existingExpiredEventKeys = new Set(
    (eventPayload.story_cluster_events || [])
      .filter((event) => event.event_type === "expired")
      .map((event) => event.story_cluster_id)
  );
  const expiredEvents = [];
  let expiredCount = 0;
  const storyClusters = (clusterPayload.story_clusters || []).map((clusterInput) => {
    const cluster = normalizeStoryCluster(clusterInput);
    if (!shouldExpireStory(cluster, { ...options, now })) return cluster;
    expiredCount += 1;
    const expiredCluster = normalizeStoryCluster({
      ...cluster,
      public_status: "expired",
      index_status: "noindex",
      updated_at: now.toISOString(),
    });
    if (!existingExpiredEventKeys.has(cluster.id)) {
      expiredEvents.push(createExpiredEvent(expiredCluster, now));
    }
    return expiredCluster;
  });
  if (expiredCount > 0) {
    saveClustersPayload({
      ...clusterPayload,
      updatedAt: now.toISOString(),
      story_clusters: storyClusters,
    }, paths);
    if (expiredEvents.length) {
      saveClusterEventsPayload({
        ...eventPayload,
        updatedAt: now.toISOString(),
        story_cluster_events: [...expiredEvents, ...(eventPayload.story_cluster_events || [])],
      }, paths);
    }
  }
  return {
    expiredCount,
    eventCount: expiredEvents.length,
    checkedCount: storyClusters.length,
    updatedAt: now.toISOString(),
  };
}

function getAllStoryClusters(options = {}) {
  const paths = getPaths(options.paths);
  return readStoryClusters(paths.storyClusters).story_clusters;
}

function getLiveStoryClusters(options = {}) {
  return getAllStoryClusters(options).filter((story) => isPublicStoryLive(story, options));
}

function getLiveStoriesForCity(cityId, options = {}) {
  const targetCityId = cleanText(cityId);
  if (!targetCityId) return [];
  return getLiveStoryClusters(options).filter((story) => story.city_id === targetCityId);
}

function getLiveStoriesForTopic(cityId, topic, options = {}) {
  const targetTopic = cleanText(topic);
  return getLiveStoriesForCity(cityId, options).filter((story) => story.primary_topic === targetTopic);
}

function getPublicSearchableStoryClusters(options = {}) {
  return getLiveStoryClusters(options);
}

function getRegularSitemapStoryClusters(options = {}) {
  return getLiveStoryClusters(options).filter((story) => story.index_status === "index");
}

function getGoogleNewsSitemapStoryClusters(options = {}) {
  return getRegularSitemapStoryClusters(options).filter((story) =>
    getPublicStoryWindowState(story, options).googleNewsEligible
  );
}

function findStoryClusterBySlug(slug, options = {}) {
  const target = cleanText(slug).toLowerCase();
  if (!target) return null;
  return getAllStoryClusters(options).find((story) => cleanText(story.slug).toLowerCase() === target) || null;
}

function getExpiredStoryClusterResponse(story = null, options = {}) {
  if (!story) return { expired: false, status: 404, message: "" };
  if (isPublicStoryLive(story, options)) return { expired: false, status: 200, message: "" };
  const startedAt = getStoryPublicStartedAt(story);
  const expiresAt = getStoryExpiresAt(story);
  const now = new Date(options.now || new Date());
  const expiredByWindow = !startedAt || startedAt < getCutoff(now, options.ttlDays) || (expiresAt && expiresAt <= now);
  if (story.public_status === "expired" || expiredByWindow) {
    return {
      expired: true,
      status: 410,
      message: "This Live News local story cluster has expired from public coverage.",
    };
  }
  return { expired: false, status: 404, message: "" };
}

module.exports = {
  expireOldStories,
  findStoryClusterBySlug,
  getExpiredStoryClusterResponse,
  getGoogleNewsSitemapStoryClusters,
  getLiveStoriesForCity,
  getLiveStoriesForTopic,
  getPublicSearchableStoryClusters,
  getPublicStoryWindowState,
  getRegularSitemapStoryClusters,
  isPublicStoryLive,
  shouldExpireStory,
};
