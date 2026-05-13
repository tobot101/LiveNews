const fs = require("fs");
const path = require("path");
const {
  normalizeLocalSource,
  normalizeSourceFeed,
  normalizeSourceFetchRun,
  normalizeUserSubmittedSource,
  readLocalSources,
  readSourceFeeds,
  readSourceFetchRuns,
  readUserSubmittedSources,
  slugify,
  validateLocalSource,
  validateSourceFeed,
  validateUserSubmittedSource,
} = require("./local-intelligence-models");

const DEFAULT_PATHS = {
  localSources: path.join(__dirname, "..", "data", "local-sources.json"),
  sourceFeeds: path.join(__dirname, "..", "data", "source-feeds.json"),
  sourceFetchRuns: path.join(__dirname, "..", "data", "source-fetch-runs.json"),
  userSubmittedSources: path.join(__dirname, "..", "data", "user-submitted-sources.json"),
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nowIso(now = new Date()) {
  return new Date(now).toISOString();
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

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function assertSafeUrl(value, fieldName = "url") {
  const url = cleanText(value);
  if (!url) throw new Error(`${fieldName} is required`);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${fieldName} must use http or https`);
  }
  return parsed.toString();
}

function sourceNeedsSkip(source = {}) {
  if (!source) return "missing_source";
  if (source.crawl_status === "blocked_by_robots") return "blocked_by_robots";
  if (source.crawl_status === "paused") return "paused";
  if (source.crawl_status === "pending_review") return "pending_review";
  if (source.crawl_status === "failed") return "failed";
  if (source.requires_login || source.requiresLogin || source.requires_credentials || source.requiresCredentials) {
    return "requires_login";
  }
  if (source.paywalled || source.has_paywall || source.paywall) return "paywalled";
  return "";
}

function feedNeedsSkip(feed = {}) {
  if (!feed.active) return "feed_inactive";
  if (String(feed.url || "").includes("{{")) return "feed_template_requires_runtime_query";
  if (feed.requires_login || feed.requiresLogin || feed.requires_credentials || feed.requiresCredentials) {
    return "requires_login";
  }
  if (feed.paywalled || feed.has_paywall || feed.paywall) return "paywalled";
  return "";
}

function loadSourcesPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.localSources, {
    schemaVersion: "live-news-local-sources-v1",
    updatedAt: null,
    local_sources: [],
  });
}

function saveSourcesPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.localSources, payload);
  return payload;
}

function loadFeedsPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.sourceFeeds, {
    schemaVersion: "live-news-source-feeds-v1",
    updatedAt: null,
    source_feeds: [],
  });
}

function saveFeedsPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.sourceFeeds, payload);
  return payload;
}

function loadSubmissionsPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.userSubmittedSources, {
    schemaVersion: "live-news-user-submitted-sources-v1",
    updatedAt: null,
    user_submitted_sources: [],
  });
}

function saveSubmissionsPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.userSubmittedSources, payload);
  return payload;
}

function loadRunsPayload(paths = {}) {
  const resolved = getPaths(paths);
  return readJson(resolved.sourceFetchRuns, {
    schemaVersion: "live-news-source-fetch-runs-v1",
    updatedAt: null,
    source_fetch_runs: [],
  });
}

function saveRunsPayload(payload, paths = {}) {
  const resolved = getPaths(paths);
  writeJson(resolved.sourceFetchRuns, payload);
  return payload;
}

function createSource(input = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = nowIso(options.now);
  const payload = loadSourcesPayload(paths);
  const normalized = normalizeLocalSource({
    ...input,
    homepage_url: input.homepage_url ? assertSafeUrl(input.homepage_url, "homepage_url") : "",
    created_at: input.created_at || now,
    updated_at: now,
  });
  const validation = validateLocalSource(normalized);
  if (!validation.ok) {
    throw new Error(`Local source is not valid: ${validation.failures.join("; ")}`);
  }
  const exists = (payload.local_sources || []).some((source) => (
    source.id === normalized.id || source.slug === normalized.slug
  ));
  if (exists) throw new Error(`Local source already exists: ${normalized.id}`);
  const nextPayload = {
    ...payload,
    updatedAt: now,
    local_sources: [...(payload.local_sources || []), normalized],
  };
  saveSourcesPayload(nextPayload, paths);
  return normalized;
}

function updateSource(sourceId, patch = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = nowIso(options.now);
  const payload = loadSourcesPayload(paths);
  let updatedSource = null;
  const localSources = (payload.local_sources || []).map((source) => {
    if (source.id !== sourceId && source.slug !== sourceId) return source;
    updatedSource = normalizeLocalSource({
      ...source,
      ...patch,
      homepage_url: patch.homepage_url ? assertSafeUrl(patch.homepage_url, "homepage_url") : (patch.homepageUrl ? assertSafeUrl(patch.homepageUrl, "homepage_url") : source.homepage_url),
      id: source.id,
      created_at: source.created_at,
      updated_at: now,
    });
    const validation = validateLocalSource(updatedSource);
    if (!validation.ok) {
      throw new Error(`Local source update is not valid: ${validation.failures.join("; ")}`);
    }
    return updatedSource;
  });
  if (!updatedSource) throw new Error(`Local source not found: ${sourceId}`);
  saveSourcesPayload({ ...payload, updatedAt: now, local_sources: localSources }, paths);
  return updatedSource;
}

function addSourceFeed(sourceId, feedInput = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = nowIso(options.now);
  const sources = readLocalSources(paths.localSources).local_sources;
  const source = sources.find((candidate) => candidate.id === sourceId || candidate.slug === sourceId);
  if (!source) throw new Error(`Local source not found: ${sourceId}`);
  const payload = loadFeedsPayload(paths);
  const normalized = normalizeSourceFeed({
    ...feedInput,
    source_id: source.id,
    url: assertSafeUrl(feedInput.url, "feed url"),
    created_at: feedInput.created_at || now,
    updated_at: now,
  });
  const validation = validateSourceFeed(normalized);
  if (!validation.ok) {
    throw new Error(`Source feed is not valid: ${validation.failures.join("; ")}`);
  }
  const exists = (payload.source_feeds || []).some((feed) => (
    feed.id === normalized.id || feed.url === normalized.url
  ));
  if (exists) throw new Error(`Source feed already exists: ${normalized.id}`);
  saveFeedsPayload({
    ...payload,
    updatedAt: now,
    source_feeds: [...(payload.source_feeds || []), normalized],
  }, paths);
  return normalized;
}

function pauseSource(sourceId, options = {}) {
  return updateSource(sourceId, { crawl_status: "paused" }, options);
}

function markRobotsBlocked(sourceId, options = {}) {
  return updateSource(sourceId, {
    crawl_status: "blocked_by_robots",
    robots_checked_at: nowIso(options.now),
  }, options);
}

function updateSourceFeed(feedId, patch = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = nowIso(options.now);
  const payload = loadFeedsPayload(paths);
  let updatedFeed = null;
  const feeds = (payload.source_feeds || []).map((feed) => {
    if (feed.id !== feedId) return feed;
    updatedFeed = normalizeSourceFeed({
      ...feed,
      ...patch,
      id: feed.id,
      source_id: feed.source_id,
      url: patch.url ? assertSafeUrl(patch.url, "feed url") : feed.url,
      created_at: feed.created_at,
      updated_at: now,
    });
    const validation = validateSourceFeed(updatedFeed);
    if (!validation.ok) throw new Error(`Source feed update is not valid: ${validation.failures.join("; ")}`);
    return updatedFeed;
  });
  if (!updatedFeed) throw new Error(`Source feed not found: ${feedId}`);
  saveFeedsPayload({ ...payload, updatedAt: now, source_feeds: feeds }, paths);
  return updatedFeed;
}

function getSourcesDueForFetch(options = {}) {
  const paths = getPaths(options.paths);
  const now = new Date(options.now || new Date());
  const sources = readLocalSources(paths.localSources).local_sources;
  const feeds = readSourceFeeds(paths.sourceFeeds).source_feeds;
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return feeds
    .map((feed) => {
      const source = sourceById.get(feed.source_id);
      const sourceSkipReason = sourceNeedsSkip(source);
      const feedSkipReason = feedNeedsSkip(feed);
      const nextFetchAt = feed.next_fetch_at ? new Date(feed.next_fetch_at) : null;
      const due = !sourceSkipReason && !feedSkipReason && (!nextFetchAt || Number.isNaN(nextFetchAt.getTime()) || nextFetchAt <= now);
      return {
        source,
        feed,
        due,
        skipReason: sourceSkipReason || feedSkipReason || "",
      };
    })
    .filter((entry) => entry.due);
}

function getSourceHealth(sourceId, options = {}) {
  const paths = getPaths(options.paths);
  const now = new Date(options.now || new Date());
  const sources = readLocalSources(paths.localSources).local_sources;
  const feeds = readSourceFeeds(paths.sourceFeeds).source_feeds;
  const runs = readSourceFetchRuns(paths.sourceFetchRuns).source_fetch_runs;
  const source = sources.find((candidate) => candidate.id === sourceId || candidate.slug === sourceId);
  if (!source) throw new Error(`Local source not found: ${sourceId}`);
  const sourceFeeds = feeds.filter((feed) => feed.source_id === source.id);
  const feedIds = new Set(sourceFeeds.map((feed) => feed.id));
  const sourceRuns = runs.filter((run) => feedIds.has(run.source_feed_id));
  const lastRun = [...sourceRuns].sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0] || null;
  const successfulRuns = sourceRuns.filter((run) => run.status === "success");
  const failedRuns = sourceRuns.filter((run) => run.status === "failed");
  const dueFeeds = sourceFeeds.filter((feed) => {
    const nextFetchAt = feed.next_fetch_at ? new Date(feed.next_fetch_at) : null;
    return feed.active && (!nextFetchAt || Number.isNaN(nextFetchAt.getTime()) || nextFetchAt <= now);
  });
  return {
    source,
    crawlStatus: source.crawl_status,
    feedCount: sourceFeeds.length,
    activeFeedCount: sourceFeeds.filter((feed) => feed.active).length,
    dueFeedCount: sourceNeedsSkip(source) ? 0 : dueFeeds.length,
    lastRun,
    successCount: successfulRuns.length,
    failureCount: failedRuns.length,
    lastSuccessfulFetchAt: source.last_successful_fetch_at,
    lastFailedFetchAt: source.last_failed_fetch_at,
    healthy: source.crawl_status === "active" && failedRuns.length === 0,
    checkedAt: now.toISOString(),
  };
}

function submitUserSource(input = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = nowIso(options.now);
  const payload = loadSubmissionsPayload(paths);
  const submittedUrl = assertSafeUrl(input.submitted_url || input.submittedUrl, "submitted_url");
  const normalized = normalizeUserSubmittedSource({
    ...input,
    submitted_url: submittedUrl,
    status: "pending",
    created_at: input.created_at || now,
  });
  const validation = validateUserSubmittedSource(normalized);
  if (!validation.ok) throw new Error(`User-submitted source is not valid: ${validation.failures.join("; ")}`);
  const exists = (payload.user_submitted_sources || []).some((source) => source.id === normalized.id);
  if (exists) throw new Error(`User-submitted source already exists: ${normalized.id}`);
  saveSubmissionsPayload({
    ...payload,
    updatedAt: now,
    user_submitted_sources: [...(payload.user_submitted_sources || []), normalized],
  }, paths);
  return normalized;
}

function approveUserSource(submissionId, sourceInput = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = nowIso(options.now);
  const payload = loadSubmissionsPayload(paths);
  let approvedSubmission = null;
  const submissions = (payload.user_submitted_sources || []).map((submission) => {
    if (submission.id !== submissionId) return submission;
    approvedSubmission = normalizeUserSubmittedSource({
      ...submission,
      status: "approved",
      notes: sourceInput.notes || submission.notes,
      reviewed_at: now,
    });
    return approvedSubmission;
  });
  if (!approvedSubmission) throw new Error(`User-submitted source not found: ${submissionId}`);
  const submittedHost = hostnameFromUrl(approvedSubmission.submitted_url);
  const source = createSource({
    name: sourceInput.name || submittedHost || "User submitted source",
    slug: sourceInput.slug || slugify(sourceInput.name || submittedHost || approvedSubmission.submitted_url),
    homepage_url: sourceInput.homepage_url || approvedSubmission.submitted_url,
    source_type: sourceInput.source_type || "community",
    trust_level: sourceInput.trust_level || "community",
    crawl_status: sourceInput.crawl_status || "pending_review",
  }, { ...options, paths, now });
  let feed = null;
  if (sourceInput.feed_url || sourceInput.feedUrl || sourceInput.createFeed !== false) {
    feed = addSourceFeed(source.id, {
      feed_type: sourceInput.feed_type || "rss",
      url: sourceInput.feed_url || sourceInput.feedUrl || approvedSubmission.submitted_url,
      active: sourceInput.feed_active === true,
      fetch_frequency_minutes: sourceInput.fetch_frequency_minutes || 15,
    }, { ...options, paths, now });
  }
  saveSubmissionsPayload({ ...payload, updatedAt: now, user_submitted_sources: submissions }, paths);
  return { submission: approvedSubmission, source, feed };
}

function logSourceFetchRun(runInput = {}, options = {}) {
  const paths = getPaths(options.paths);
  const now = nowIso(options.now);
  const payload = loadRunsPayload(paths);
  const normalized = normalizeSourceFetchRun({
    ...runInput,
    started_at: runInput.started_at || now,
    finished_at: runInput.finished_at || now,
  });
  saveRunsPayload({
    ...payload,
    updatedAt: now,
    source_fetch_runs: [normalized, ...(payload.source_fetch_runs || [])].slice(0, 5000),
  }, paths);
  return normalized;
}

function createSourceRegistryService(options = {}) {
  const paths = getPaths(options.paths);
  return {
    addSourceFeed: (sourceId, feedInput, callOptions = {}) => addSourceFeed(sourceId, feedInput, { ...options, ...callOptions, paths }),
    approveUserSource: (submissionId, sourceInput, callOptions = {}) => approveUserSource(submissionId, sourceInput, { ...options, ...callOptions, paths }),
    createSource: (input, callOptions = {}) => createSource(input, { ...options, ...callOptions, paths }),
    getSourceHealth: (sourceId, callOptions = {}) => getSourceHealth(sourceId, { ...options, ...callOptions, paths }),
    getSourcesDueForFetch: (callOptions = {}) => getSourcesDueForFetch({ ...options, ...callOptions, paths }),
    logSourceFetchRun: (runInput, callOptions = {}) => logSourceFetchRun(runInput, { ...options, ...callOptions, paths }),
    markRobotsBlocked: (sourceId, callOptions = {}) => markRobotsBlocked(sourceId, { ...options, ...callOptions, paths }),
    pauseSource: (sourceId, callOptions = {}) => pauseSource(sourceId, { ...options, ...callOptions, paths }),
    submitUserSource: (input, callOptions = {}) => submitUserSource(input, { ...options, ...callOptions, paths }),
    updateSource: (sourceId, patch, callOptions = {}) => updateSource(sourceId, patch, { ...options, ...callOptions, paths }),
    updateSourceFeed: (feedId, patch, callOptions = {}) => updateSourceFeed(feedId, patch, { ...options, ...callOptions, paths }),
  };
}

module.exports = {
  addSourceFeed,
  approveUserSource,
  createSource,
  createSourceRegistryService,
  getSourceHealth,
  getSourcesDueForFetch,
  logSourceFetchRun,
  markRobotsBlocked,
  pauseSource,
  feedNeedsSkip,
  sourceNeedsSkip,
  submitUserSource,
  updateSource,
  updateSourceFeed,
};
