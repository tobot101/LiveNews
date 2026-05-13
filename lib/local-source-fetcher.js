const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Parser = require("rss-parser");
const { getLocalIntelligenceConfig } = require("./local-intelligence-config");
const { runLocalWorkerBatch } = require("./local-intelligence-worker");
const {
  createSourceRegistryService,
  feedNeedsSkip,
  getSourcesDueForFetch,
  sourceNeedsSkip,
} = require("./local-source-registry");
const {
  normalizeInputSignal,
  readInputSignals,
  validateInputSignal,
} = require("./local-intelligence-models");

const DEFAULT_PATHS = {
  inputSignals: path.join(__dirname, "..", "data", "input-signals.json"),
  localSources: path.join(__dirname, "..", "data", "local-sources.json"),
  sourceFeeds: path.join(__dirname, "..", "data", "source-feeds.json"),
  sourceFetchRuns: path.join(__dirname, "..", "data", "source-fetch-runs.json"),
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stableHash(value, length = 18) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
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

function normalizeUrl(url) {
  const value = cleanText(url);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function canonicalizeUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return "";
  const parsed = new URL(normalized);
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const removableParams = [
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
  ];
  removableParams.forEach((param) => parsed.searchParams.delete(param));
  parsed.searchParams.sort();
  return parsed.toString();
}

function normalizeHashText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeByUrlHash(url) {
  return stableHash(canonicalizeUrl(url));
}

function dedupeByContentHash(title, excerpt, publishedAt) {
  return stableHash([
    normalizeHashText(title),
    normalizeHashText(excerpt),
    cleanText(publishedAt).slice(0, 10),
  ].join("|"));
}

function responseHeader(response, name) {
  if (!response || !response.headers) return "";
  if (typeof response.headers.get === "function") return cleanText(response.headers.get(name) || "");
  const lower = String(name || "").toLowerCase();
  return cleanText(response.headers[name] || response.headers[lower] || "");
}

function buildConditionalHeaders(feed = {}, config = getLocalIntelligenceConfig()) {
  const headers = {
    "User-Agent": config.crawlerUserAgent,
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5",
  };
  if (feed.etag) headers["If-None-Match"] = feed.etag;
  if (feed.last_modified_header) headers["If-Modified-Since"] = feed.last_modified_header;
  return headers;
}

async function wait(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, feed = {}, options = {}) {
  const config = options.config || getLocalIntelligenceConfig();
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available");
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Number(options.timeoutMs || config.sourceFetchTimeoutMs))
    : null;
  try {
    const response = await fetchImpl(url, {
      headers: buildConditionalHeaders(feed, config),
      signal: controller ? controller.signal : undefined,
    });
    if (response.status === 304) {
      return {
        statusCode: 304,
        notModified: true,
        text: "",
        etag: responseHeader(response, "etag"),
        lastModified: responseHeader(response, "last-modified"),
      };
    }
    if (!response.ok) {
      const error = new Error(`Source fetch failed with status ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return {
      statusCode: response.status,
      notModified: false,
      text: await response.text(),
      etag: responseHeader(response, "etag"),
      lastModified: responseHeader(response, "last-modified"),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function mapFeedItem(item = {}, feed = {}, rawSourceType = "rss") {
  const originalUrl = normalizeUrl(item.link || item.guid || item.id || "");
  const canonicalUrl = canonicalizeUrl(originalUrl);
  const title = cleanText(item.title || "");
  const excerpt = cleanText(item.contentSnippet || item.summary || item.content || "");
  return {
    source_id: feed.source_id,
    source_feed_id: feed.id,
    canonical_url: canonicalUrl,
    original_url: originalUrl,
    title,
    excerpt,
    author: cleanText(item.creator || item.author || ""),
    published_at: item.isoDate || item.pubDate || item.published || item.updated || "",
    discovered_at: nowIso(),
    fetched_at: nowIso(),
    content_hash: dedupeByContentHash(title, excerpt, item.isoDate || item.pubDate || ""),
    url_hash: dedupeByUrlHash(canonicalUrl || originalUrl),
    raw_source_type: rawSourceType,
    language: "en",
    signal_status: "new",
  };
}

async function parseXmlFeed(feed, rawSourceType, options = {}) {
  const fetched = await fetchText(feed.url, feed, options);
  if (fetched.notModified) {
    return { statusCode: 304, notModified: true, items: [], etag: fetched.etag, lastModified: fetched.lastModified };
  }
  const parser = new Parser();
  const parsed = await parser.parseString(fetched.text);
  const items = (parsed.items || []).map((item) => mapFeedItem(item, feed, rawSourceType)).filter((item) => item.canonical_url && item.title);
  return {
    statusCode: fetched.statusCode,
    notModified: false,
    items,
    etag: fetched.etag,
    lastModified: fetched.lastModified,
  };
}

function fetchRssFeed(feed, options = {}) {
  return parseXmlFeed(feed, "rss", options);
}

function fetchAtomFeed(feed, options = {}) {
  return parseXmlFeed(feed, "atom", options);
}

function extractSitemapItems(xml, feed = {}) {
  const entries = [];
  const urlBlocks = String(xml || "").match(/<url\b[\s\S]*?<\/url>/gi) || [];
  if (urlBlocks.length) {
    for (const block of urlBlocks) {
      const loc = cleanText((block.match(/<loc>\s*([^<]+)\s*<\/loc>/i) || [])[1] || "");
      const lastmod = cleanText((block.match(/<lastmod>\s*([^<]+)\s*<\/lastmod>/i) || [])[1] || "");
      const canonicalUrl = canonicalizeUrl(loc);
      if (!canonicalUrl) continue;
      entries.push({
        source_id: feed.source_id,
        source_feed_id: feed.id,
        canonical_url: canonicalUrl,
        original_url: normalizeUrl(loc),
        title: canonicalUrl,
        excerpt: "",
        author: "",
        published_at: lastmod,
        discovered_at: nowIso(),
        fetched_at: nowIso(),
        content_hash: dedupeByContentHash(canonicalUrl, "", lastmod),
        url_hash: dedupeByUrlHash(canonicalUrl),
        raw_source_type: "sitemap",
        language: "en",
        signal_status: "new",
      });
    }
  }
  const sitemapLocs = String(xml || "").match(/<loc>\s*([^<]+)\s*<\/loc>/gi) || [];
  if (!entries.length && sitemapLocs.length) {
    for (const tag of sitemapLocs) {
      const loc = cleanText((tag.match(/<loc>\s*([^<]+)\s*<\/loc>/i) || [])[1] || "");
      const canonicalUrl = canonicalizeUrl(loc);
      if (!canonicalUrl) continue;
      entries.push({
        source_id: feed.source_id,
        source_feed_id: feed.id,
        canonical_url: canonicalUrl,
        original_url: normalizeUrl(loc),
        title: canonicalUrl,
        excerpt: "",
        author: "",
        published_at: "",
        discovered_at: nowIso(),
        fetched_at: nowIso(),
        content_hash: dedupeByContentHash(canonicalUrl, "", ""),
        url_hash: dedupeByUrlHash(canonicalUrl),
        raw_source_type: "sitemap",
        language: "en",
        signal_status: "new",
      });
    }
  }
  return entries;
}

async function fetchSitemap(feed, options = {}) {
  const fetched = await fetchText(feed.url, feed, options);
  if (fetched.notModified) {
    return { statusCode: 304, notModified: true, items: [], etag: fetched.etag, lastModified: fetched.lastModified };
  }
  return {
    statusCode: fetched.statusCode,
    notModified: false,
    items: extractSitemapItems(fetched.text, feed),
    etag: fetched.etag,
    lastModified: fetched.lastModified,
  };
}

function extractApiItems(json) {
  if (Array.isArray(json)) return json;
  return json.items || json.results || json.articles || json.data || [];
}

function getApiNextCursor(json) {
  return json.nextCursor || json.next_cursor || json.cursor || json.nextPageToken || json.next_page_token || "";
}

function getApiNextUrl(json) {
  return json.next || json.nextPage || json.next_page || "";
}

function apiItemToSignal(item = {}, feed = {}) {
  const originalUrl = normalizeUrl(item.url || item.link || item.canonical_url || item.webUrl || "");
  const canonicalUrl = canonicalizeUrl(item.canonical_url || item.canonicalUrl || originalUrl);
  const title = cleanText(item.title || item.headline || item.name || "");
  const excerpt = cleanText(item.excerpt || item.summary || item.description || "");
  return {
    source_id: feed.source_id,
    source_feed_id: feed.id,
    canonical_url: canonicalUrl,
    original_url: originalUrl,
    title,
    excerpt,
    author: cleanText(item.author || item.byline || ""),
    published_at: item.published_at || item.publishedAt || item.pubDate || item.date || "",
    discovered_at: nowIso(),
    fetched_at: nowIso(),
    content_hash: dedupeByContentHash(title, excerpt, item.published_at || item.publishedAt || ""),
    url_hash: dedupeByUrlHash(canonicalUrl || originalUrl),
    raw_source_type: "api",
    city_candidates_json: item.city_candidates_json || item.cityCandidates || [],
    topic_candidates_json: item.topic_candidates_json || item.topicCandidates || [],
    entities_json: item.entities_json || item.entities || {},
    language: cleanText(item.language || "en"),
    signal_status: "new",
  };
}

function buildNextApiUrl(currentUrl, nextCursor, nextUrl, feed = {}) {
  if (nextUrl) {
    try {
      return new URL(nextUrl, currentUrl).toString();
    } catch {
      return "";
    }
  }
  if (!nextCursor) return "";
  if (String(feed.url || "").includes("{{cursor}}")) {
    return String(feed.url).replace("{{cursor}}", encodeURIComponent(nextCursor));
  }
  const parsed = new URL(currentUrl);
  parsed.searchParams.set(feed.cursor_param || feed.cursorParam || "cursor", nextCursor);
  return parsed.toString();
}

async function fetchJson(url, feed = {}, options = {}) {
  const fetched = await fetchText(url, feed, {
    ...options,
    config: options.config || getLocalIntelligenceConfig(),
  });
  if (fetched.notModified) return { ...fetched, json: null };
  return { ...fetched, json: JSON.parse(fetched.text || "{}") };
}

async function fetchApiFeed(feed, options = {}) {
  let nextUrl = feed.url;
  let guard = 0;
  const maxPages = Number(options.maxPages || 1000);
  const items = [];
  let lastStatusCode = 200;
  let etag = "";
  let lastModified = "";
  while (nextUrl && guard < maxPages) {
    const fetched = await fetchJson(nextUrl, feed, options);
    lastStatusCode = fetched.statusCode;
    etag = fetched.etag || etag;
    lastModified = fetched.lastModified || lastModified;
    if (fetched.notModified) break;
    const json = fetched.json || {};
    items.push(...extractApiItems(json).map((item) => apiItemToSignal(item, feed)).filter((item) => item.canonical_url && item.title));
    const nextCursor = getApiNextCursor(json);
    nextUrl = buildNextApiUrl(nextUrl, nextCursor, getApiNextUrl(json), feed);
    guard += 1;
  }
  return {
    statusCode: lastStatusCode,
    notModified: lastStatusCode === 304,
    items,
    pagesProcessed: guard,
    exhausted: !nextUrl,
    etag,
    lastModified,
  };
}

function htmlAllowed(feed = {}, options = {}) {
  const source = options.source || {};
  if (feed.feed_type !== "html") return false;
  if (sourceNeedsSkip(source)) return false;
  if (source.paywalled || feed.paywalled || source.requires_login || feed.requires_login) return false;
  return feed.allow_html_fetch === true || source.allow_html_fetch === true || options.allowHtmlFetch === true;
}

function extractHtmlSignal(html, feed = {}) {
  const title = cleanText((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const excerpt = cleanText(
    (String(html).match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) || [])[1] ||
    (String(html).match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) || [])[1] ||
    ""
  );
  const canonical = cleanText((String(html).match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i) || [])[1] || feed.url);
  const canonicalUrl = canonicalizeUrl(canonical);
  return {
    source_id: feed.source_id,
    source_feed_id: feed.id,
    canonical_url: canonicalUrl,
    original_url: normalizeUrl(feed.url),
    title,
    excerpt,
    author: "",
    published_at: "",
    discovered_at: nowIso(),
    fetched_at: nowIso(),
    content_hash: dedupeByContentHash(title, excerpt, ""),
    url_hash: dedupeByUrlHash(canonicalUrl),
    raw_source_type: "html",
    language: "en",
    signal_status: "new",
  };
}

async function fetchHtmlSource(feed, options = {}) {
  if (!htmlAllowed(feed, options)) {
    return {
      statusCode: 0,
      skipped: true,
      skipReason: "html_fetch_not_allowed",
      items: [],
    };
  }
  const fetched = await fetchText(feed.url, feed, options);
  if (fetched.notModified) {
    return { statusCode: 304, notModified: true, items: [], etag: fetched.etag, lastModified: fetched.lastModified };
  }
  const item = extractHtmlSignal(fetched.text, feed);
  return {
    statusCode: fetched.statusCode,
    notModified: false,
    items: item.canonical_url && item.title ? [item] : [],
    etag: fetched.etag,
    lastModified: fetched.lastModified,
  };
}

function readInputSignalsPayload(paths = {}) {
  const resolved = { ...DEFAULT_PATHS, ...paths };
  return readJson(resolved.inputSignals, {
    schemaVersion: "live-news-input-signals-v1",
    updatedAt: null,
    input_signals: [],
  });
}

function saveInputSignalsPayload(payload, paths = {}) {
  const resolved = { ...DEFAULT_PATHS, ...paths };
  writeJson(resolved.inputSignals, payload);
  return payload;
}

function createInputSignal(signalInput = {}, options = {}) {
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const now = nowIso(options.now);
  const payload = readInputSignalsPayload(paths);
  const normalized = normalizeInputSignal({
    ...signalInput,
    created_at: signalInput.created_at || now,
    updated_at: now,
  });
  const validation = validateInputSignal(normalized);
  if (!validation.ok) {
    throw new Error(`Input signal is not valid: ${validation.failures.join("; ")}`);
  }
  const existing = (payload.input_signals || []).find((signal) => (
    signal.url_hash === normalized.url_hash || signal.content_hash === normalized.content_hash
  ));
  if (existing) {
    return {
      created: false,
      duplicate: true,
      duplicateReason: existing.url_hash === normalized.url_hash ? "url_hash" : "content_hash",
      signal: normalizeInputSignal(existing),
    };
  }
  const nextPayload = {
    ...payload,
    updatedAt: now,
    input_signals: [normalized, ...(payload.input_signals || [])],
  };
  saveInputSignalsPayload(nextPayload, paths);
  return { created: true, duplicate: false, signal: normalized };
}

function nextFetchAt(feed = {}, now = new Date()) {
  return new Date(new Date(now).getTime() + Number(feed.fetch_frequency_minutes || 15) * 60 * 1000).toISOString();
}

async function fetchByType(feed, options = {}) {
  if (feed.feed_type === "atom") return fetchAtomFeed(feed, options);
  if (feed.feed_type === "sitemap") return fetchSitemap(feed, options);
  if (feed.feed_type === "api") return fetchApiFeed(feed, options);
  if (feed.feed_type === "html") return fetchHtmlSource(feed, options);
  return fetchRssFeed(feed, options);
}

async function fetchFeedWithRetries(feed, options = {}) {
  const retries = Number(options.retries ?? 2);
  const retryBackoffMs = Number(options.retryBackoffMs ?? 250);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchByType(feed, options);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(retryBackoffMs * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchSourceFeed(entry = {}, options = {}) {
  const source = entry.source || options.source || {};
  const feed = entry.feed || entry;
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const registry = createSourceRegistryService({ paths });
  const startedAt = nowIso(options.now);
  const sourceSkipReason = sourceNeedsSkip(source);
  const feedSkipReason = feedNeedsSkip(feed);
  if (sourceSkipReason || feedSkipReason) {
    const run = registry.logSourceFetchRun({
      source_feed_id: feed.id,
      started_at: startedAt,
      finished_at: nowIso(),
      status: "skipped",
      status_code: 0,
      items_found: 0,
      items_new: 0,
      error_message: sourceSkipReason || feedSkipReason,
    });
    return { status: "skipped", source, feed, run, items: [], createdSignals: [], skipReason: sourceSkipReason || feedSkipReason };
  }

  try {
    const fetched = await fetchFeedWithRetries(feed, { ...options, source });
    const createdSignals = [];
    for (const item of fetched.items || []) {
      const created = createInputSignal(item, { paths, now: options.now });
      createdSignals.push(created);
    }
    const status = fetched.notModified || fetched.skipped ? "skipped" : "success";
    const run = registry.logSourceFetchRun({
      source_feed_id: feed.id,
      started_at: startedAt,
      finished_at: nowIso(),
      status,
      status_code: fetched.statusCode || 0,
      items_found: (fetched.items || []).length,
      items_new: createdSignals.filter((result) => result.created).length,
      error_message: fetched.skipReason || "",
    });
    registry.updateSourceFeed(feed.id, {
      last_fetched_at: nowIso(),
      next_fetch_at: nextFetchAt(feed),
      etag: fetched.etag || feed.etag,
      last_modified_header: fetched.lastModified || feed.last_modified_header,
    });
    if (status === "success") {
      registry.updateSource(source.id, { last_successful_fetch_at: nowIso() });
    }
    return { status, source, feed, run, items: fetched.items || [], createdSignals };
  } catch (error) {
    const run = registry.logSourceFetchRun({
      source_feed_id: feed.id,
      started_at: startedAt,
      finished_at: nowIso(),
      status: "failed",
      status_code: error.statusCode || 0,
      items_found: 0,
      items_new: 0,
      error_message: cleanText(error.message).slice(0, 500),
    });
    if (source.id) registry.updateSource(source.id, { last_failed_fetch_at: nowIso() });
    registry.updateSourceFeed(feed.id, {
      last_fetched_at: nowIso(),
      next_fetch_at: nextFetchAt(feed),
    });
    return { status: "failed", source, feed, run, items: [], createdSignals: [], error };
  }
}

async function fetchDueSourceFeeds(options = {}) {
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const due = getSourcesDueForFetch({ ...options, paths });
  return runLocalWorkerBatch(
    due,
    (entry) => fetchSourceFeed(entry, { ...options, paths }),
    {
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      workerName: "local-source-fetcher",
      config: options.config,
    }
  );
}

module.exports = {
  canonicalizeUrl,
  createInputSignal,
  dedupeByContentHash,
  dedupeByUrlHash,
  fetchApiFeed,
  fetchAtomFeed,
  fetchDueSourceFeeds,
  fetchHtmlSource,
  fetchRssFeed,
  fetchSitemap,
  fetchSourceFeed,
  normalizeUrl,
};
