const path = require("path");
const fs = require("fs");
const express = require("express");
const crypto = require("crypto");
const Parser = require("rss-parser");
const {
  enrichNewsPayloadWithApprovedStories,
  findApprovedStoryBySlug,
  getApprovedStorySummaries,
  listApprovedStories,
  readApprovedStore,
} = require("./lib/article-agents/approved-stories");
const { runArticleAgents } = require("./lib/article-agents/pipeline");
const {
  absoluteUrl,
  escapeHtml,
  renderPublicStoryPage,
  renderStoryNotFoundPage,
} = require("./lib/article-agents/story-renderer");
const { STORE_PATHS, readJson, saveAgentRun } = require("./lib/article-agents/store");

const app = express();
const PORT = process.env.PORT || 8080;
const SECURITY_HEADERS = {
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
};

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
});
app.use(express.json({ limit: "256kb" }));

const sourcesPath = path.join(__dirname, "data", "sources.json");
const fallbackPath = path.join(__dirname, "data", "news.json");
const placesPath = path.join(__dirname, "data", "us-places.json");

const MAX_AGE_HOURS = Number(process.env.NEWS_MAX_AGE_HOURS || 48);
const REFRESH_MINUTES = Number(process.env.NEWS_REFRESH_INTERVAL_MINUTES || 10);
const TOP_STORIES_LIMIT = Number(process.env.NEWS_TOP_STORIES_LIMIT || 8);
const FEED_LIMIT = Number(process.env.NEWS_FEED_LIMIT || 170);
const LOCAL_POOL_LIMIT = Number(process.env.LOCAL_POOL_LIMIT || 60);
const LOCAL_SOURCE_CAP = Number(process.env.LOCAL_SOURCE_CAP || 4);
const AGENT_DRAFT_LIMIT = Number(process.env.LIVE_NEWS_DRAFT_LIMIT || 16);
const AGENT_MODE = process.env.LIVE_NEWS_AGENT_MODE || "review_only";

const EVENT_STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "amid",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "can",
  "day",
  "for",
  "from",
  "gets",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "latest",
  "live",
  "more",
  "new",
  "news",
  "now",
  "of",
  "on",
  "over",
  "says",
  "say",
  "she",
  "still",
  "than",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "up",
  "was",
  "were",
  "what",
  "when",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
]);

const LOCAL_BLOCKED_DOMAINS = new Set([
  "legacy.com",
  "www.legacy.com",
  "tributearchive.com",
  "www.tributearchive.com",
  "dignitymemorial.com",
  "www.dignitymemorial.com",
  "echovita.com",
  "www.echovita.com",
  "nationaltoday.com",
  "www.nationaltoday.com",
]);

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "LiveNewsBot/1.0 (+https://github.com/tobot101/LiveNews)",
  },
});

const cache = {
  items: [],
  topStories: [],
  feed: [],
  lastUpdated: null,
  lastFetched: null,
  sourceErrors: [],
  sourceMix: {},
  configuredSources: 0,
};

let placesIndex = [];
const stateNameByCode = new Map();
let placesMeta = {
  source: "",
  sourceUrl: "",
  totalPlaces: 0,
};
const localCache = new Map();

function loadSources() {
  const raw = fs.readFileSync(sourcesPath, "utf8");
  return JSON.parse(raw).sources || [];
}

function loadFallback() {
  const raw = fs.readFileSync(fallbackPath, "utf8");
  return JSON.parse(raw);
}

function loadPlaces() {
  try {
    const raw = fs.readFileSync(placesPath, "utf8");
    const parsed = JSON.parse(raw);
    stateNameByCode.clear();
    placesMeta = {
      source: parsed.source || "",
      sourceUrl: parsed.sourceUrl || "",
      totalPlaces: parsed.totalPlaces || 0,
    };
    placesIndex = (parsed.places || []).map((place) => {
      if (place.state && place.stateName && !stateNameByCode.has(place.state)) {
        stateNameByCode.set(place.state, place.stateName);
      }
      return {
        ...place,
        search: `${place.display} ${place.officialName} ${place.stateName}`.toLowerCase(),
      };
    });
  } catch (error) {
    placesIndex = [];
    stateNameByCode.clear();
    placesMeta = { source: "", sourceUrl: "", totalPlaces: 0 };
  }
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function withinMaxAge(date) {
  if (!date) return false;
  const ageMs = Date.now() - date.getTime();
  return ageMs <= MAX_AGE_HOURS * 60 * 60 * 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeBaseScore(source, publishedAt) {
  const hoursOld = Math.max(0, (Date.now() - publishedAt.getTime()) / 3600000);
  const freshness = Math.max(0, 1 - hoursOld / MAX_AGE_HOURS);
  const weight = Number(source.weight || 1);
  const weightScore = clamp((weight - 0.85) / 0.45, 0, 1);
  const recencyBoost =
    hoursOld <= 2 ? 1 : hoursOld <= 6 ? 0.7 : hoursOld <= 12 ? 0.35 : 0.1;
  const composite = clamp(0.6 * freshness + 0.25 * weightScore + 0.15 * recencyBoost, 0, 1);
  return Math.round(70 + 24 * composite);
}

function buildSummary(text, maxLength = 260) {
  if (!text) return "";
  const clean = String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(" ").trim() || clean;
  return summary.slice(0, maxLength).trim();
}

function parseSourceFromTitle(title) {
  if (!title) return { title: "", sourceName: "" };
  const parts = String(title).split(" - ");
  if (parts.length >= 2) {
    return {
      title: parts.slice(0, -1).join(" - ").trim(),
      sourceName: parts[parts.length - 1].trim(),
    };
  }
  return { title: String(title).trim(), sourceName: "" };
}

function getDomain(link) {
  try {
    const url = new URL(link);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function tokenizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !EVENT_STOPWORDS.has(word))
    .slice(0, 12);
}

function compareTokenSets(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) {
    return { shared: 0, jaccard: 0, containment: 0, score: 0 };
  }

  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }

  const union = new Set([...setA, ...setB]).size;
  const jaccard = union ? shared / union : 0;
  const containment = shared / Math.min(setA.size, setB.size);
  const score = Math.max(jaccard, 0.65 * containment + 0.35 * jaccard);

  return { shared, jaccard, containment, score };
}

function sameCalendarWindow(a, b) {
  const diffHours = Math.abs(new Date(a.publishedAt) - new Date(b.publishedAt)) / 3600000;
  return diffHours <= 30;
}

function shouldClusterTogether(item, clusterItem) {
  if (!sameCalendarWindow(item, clusterItem)) return false;
  const metrics = compareTokenSets(item.titleTokens || [], clusterItem.titleTokens || []);
  return (
    metrics.shared >= 5 ||
    (metrics.shared >= 4 && metrics.containment >= 0.62) ||
    (metrics.shared >= 3 && metrics.score >= 0.72)
  );
}

function buildClusters(items) {
  const clusters = [];
  const sorted = [...items].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || b.baseScore - a.baseScore
  );

  for (const item of sorted) {
    let target = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const sample = cluster.items.slice(0, 6);
      for (const existing of sample) {
        const metrics = compareTokenSets(item.titleTokens || [], existing.titleTokens || []);
        const score = metrics.score;
        if (!shouldClusterTogether(item, existing)) continue;
        if (score > bestScore) {
          bestScore = score;
          target = cluster;
        }
      }
    }

    if (target) {
      target.items.push(item);
      continue;
    }

    clusters.push({ items: [item] });
  }

  return clusters.map(finalizeCluster);
}

function dominantCategory(items, fallbackCategory) {
  const counts = new Map();
  for (const item of items) {
    const key = item.category || fallbackCategory || "Top";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || fallbackCategory || "Top";
}

function chooseLeadStory(items) {
  return [...items].sort(
    (a, b) =>
      b.baseScore - a.baseScore ||
      b.sourceWeight - a.sourceWeight ||
      new Date(b.publishedAt) - new Date(a.publishedAt)
  )[0];
}

function serializeSupportLink(item) {
  return {
    sourceName: item.sourceName,
    link: item.link,
    publishedAt: item.publishedAt,
    category: item.category,
  };
}

function finalizeCluster(cluster) {
  const items = [...cluster.items].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || b.baseScore - a.baseScore
  );
  const lead = chooseLeadStory(items);
  const sourceNames = Array.from(new Set(items.map((item) => item.sourceName))).filter(Boolean);
  const category = dominantCategory(items, lead.category);
  const coverageBoost = Math.min(6, Math.max(0, sourceNames.length - 1) * 2);
  const score = clamp(Math.round(lead.baseScore + coverageBoost), 70, 100);

  return {
    id: lead.id,
    title: lead.title,
    link: lead.link,
    publishedAt: lead.publishedAt,
    sourceName: lead.sourceName,
    sourceUrl: lead.sourceUrl,
    sourceDomain: lead.domain,
    category,
    score,
    sourceCount: sourceNames.length,
    relatedSources: sourceNames,
    supportingLinks: items.slice(0, 6).map(serializeSupportLink),
    summary: lead.summary || "",
  };
}

function dedupeItems(items) {
  const deduped = new Map();

  for (const item of items) {
    const titleKey = `${item.domain || "source"}:${String(item.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}`;
    const key = item.link || titleKey;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    const currentPublished = new Date(item.publishedAt).getTime();
    const existingPublished = new Date(existing.publishedAt).getTime();
    if (item.baseScore > existing.baseScore || currentPublished > existingPublished) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
}

function buildSourceMix(items) {
  return items.reduce((acc, item) => {
    const key = item.sourceName || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function diversifyBySource(items, { maxPerSource = 0, limit } = {}) {
  if (!items.length) return [];
  const groups = new Map();

  items.forEach((item) => {
    const key = item.sourceName || "Unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  });

  groups.forEach((list) => {
    list.sort(
      (a, b) =>
        (b.sourceCount || 1) - (a.sourceCount || 1) ||
        (b.score || 0) - (a.score || 0) ||
        new Date(b.publishedAt) - new Date(a.publishedAt)
    );
  });

  const sources = Array.from(groups.keys()).sort((a, b) => {
    const firstA = groups.get(a)?.[0];
    const firstB = groups.get(b)?.[0];
    return (
      (firstB?.sourceCount || 1) - (firstA?.sourceCount || 1) ||
      (firstB?.score || 0) - (firstA?.score || 0) ||
      new Date(firstB?.publishedAt || 0) - new Date(firstA?.publishedAt || 0)
    );
  });

  const result = [];
  const counts = new Map();
  const maxItems = limit ?? items.length;

  while (result.length < maxItems) {
    let added = false;

    for (const source of sources) {
      if (result.length >= maxItems) break;
      const list = groups.get(source);
      if (!list || list.length === 0) continue;
      const currentCount = counts.get(source) || 0;
      if (maxPerSource > 0 && currentCount >= maxPerSource) {
        const otherHasItems = sources.some(
          (name) => name !== source && (groups.get(name) || []).length > 0
        );
        if (otherHasItems) continue;
      }
      result.push(list.shift());
      counts.set(source, currentCount + 1);
      added = true;
    }

    if (!added) break;
  }

  return result;
}

function normalizeItem(source, item) {
  const publishedAt = parseDate(item.isoDate || item.pubDate || item.published);
  if (!publishedAt || !withinMaxAge(publishedAt)) return null;
  const link = item.link || item.guid;
  if (!link) return null;
  const title = item.title ? String(item.title).trim() : "";
  if (!title) return null;

  return {
    id: crypto.createHash("sha1").update(link).digest("hex"),
    title,
    link,
    publishedAt: publishedAt.toISOString(),
    sourceName: source.attribution || source.name,
    sourceUrl: source.homepage,
    sourceWeight: Number(source.weight || 1),
    category: source.category || "Top",
    domain: getDomain(link),
    summary: buildSummary(item.contentSnippet || item.content || item.summary || ""),
    baseScore: computeBaseScore(source, publishedAt),
    titleTokens: tokenizeTitle(title),
  };
}

function normalizeLocalItem(item) {
  const publishedAt = parseDate(item.isoDate || item.pubDate || item.published);
  if (!publishedAt || !withinMaxAge(publishedAt)) return null;
  const link = item.link || item.guid;
  if (!link) return null;
  const parsed = parseSourceFromTitle(item.title || "");
  const title = parsed.title;
  if (!title) return null;
  const sourceName = parsed.sourceName || item.creator || getDomain(link) || "Source";
  if (isBlockedLocalItem({ title, sourceName, link })) return null;
  const summary = buildSummary(item.contentSnippet || item.content || item.summary || "", 220);

  return {
    id: crypto.createHash("sha1").update(link).digest("hex"),
    title,
    link,
    publishedAt: publishedAt.toISOString(),
    sourceName,
    sourceDomain: getDomain(link),
    category: "Local",
    sourceCount: 1,
    relatedSources: [sourceName],
    score: clamp(computeBaseScore({ weight: 1 }, publishedAt), 70, 100),
    summary,
  };
}

function isBlockedLocalItem({ title, sourceName, link }) {
  const domain = getDomain(link);
  if (LOCAL_BLOCKED_DOMAINS.has(domain)) return true;
  const haystack = `${title} ${sourceName} ${link}`.toLowerCase();
  return (
    haystack.includes("legacy obituary") ||
    haystack.includes("tribute archive") ||
    haystack.includes("obituaries") ||
    haystack.includes("obituary") ||
    haystack.includes("funeral home") ||
    haystack.includes("national today")
  );
}

function buildLocalQueryVariants(city, state) {
  const cleanedCity = String(city || "").trim();
  const cleanedState = String(state || "").trim();
  const stateName = stateNameByCode.get(cleanedState) || "";
  const baseVariants = [
    [cleanedCity, cleanedState].filter(Boolean).join(" "),
    [cleanedCity, cleanedState, "local news"].filter(Boolean).join(" "),
    [cleanedCity, stateName, "local news"].filter(Boolean).join(" "),
    `"${cleanedCity}" ${cleanedState}`.trim(),
    `"${cleanedCity}" ${stateName}`.trim(),
  ].map((value) => value.trim()).filter(Boolean);
  const withRecency = baseVariants.slice(0, 4).map((value) => `${value} when:2d`);
  return Array.from(new Set([...baseVariants, ...withRecency]));
}

async function fetchLocalNews(city, state) {
  const key = `${city}|${state}`.toLowerCase();
  const cached = localCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < REFRESH_MINUTES * 60 * 1000) {
    return cached.payload;
  }

  const variants = buildLocalQueryVariants(city, state);
  const feeds = await Promise.allSettled(
    variants.map((query) => {
      const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      return parser.parseURL(feedUrl);
    })
  );

  const collected = [];
  for (const result of feeds) {
    if (result.status !== "fulfilled") continue;
    const items = Array.isArray(result.value.items) ? result.value.items : [];
    collected.push(...items.map(normalizeLocalItem).filter(Boolean));
  }

  const deduped = dedupeItems(collected);
  const recent = deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const diversified = diversifyBySource(recent, {
    maxPerSource: LOCAL_SOURCE_CAP,
    limit: LOCAL_POOL_LIMIT,
  });

  const payload = {
    updatedAt: new Date().toISOString(),
    items: diversified,
    query: [city, state].filter(Boolean).join(", "),
    variants,
    sourceCount: new Set(diversified.map((item) => item.sourceName)).size,
  };
  localCache.set(key, { fetchedAt: now, payload });
  return payload;
}

async function fetchSource(source) {
  const feed = await parser.parseURL(source.feedUrl);
  const items = Array.isArray(feed.items) ? feed.items : [];
  return items.map((item) => normalizeItem(source, item)).filter(Boolean);
}

async function refreshNews() {
  const sources = loadSources();
  const collected = [];
  const errors = [];

  cache.configuredSources = sources.length;

  for (const source of sources) {
    try {
      const items = await fetchSource(source);
      collected.push(...items);
    } catch (error) {
      errors.push({
        source: source.name,
        feedUrl: source.feedUrl,
        message: error.message,
      });
    }
  }

  const deduped = dedupeItems(collected);
  const clustered = buildClusters(deduped);

  const ranked = [...clustered].sort(
    (a, b) =>
      (b.sourceCount || 1) - (a.sourceCount || 1) ||
      (b.score || 0) - (a.score || 0) ||
      new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const recent = [...clustered].sort(
    (a, b) =>
      new Date(b.publishedAt) - new Date(a.publishedAt) ||
      (b.sourceCount || 1) - (a.sourceCount || 1) ||
      (b.score || 0) - (a.score || 0)
  );

  cache.items = clustered;
  cache.topStories = diversifyBySource(ranked, { maxPerSource: 2, limit: TOP_STORIES_LIMIT });
  cache.feed = diversifyBySource(recent, {
    maxPerSource: Math.max(12, Math.ceil(FEED_LIMIT / 6)),
    limit: FEED_LIMIT,
  });
  cache.lastUpdated = new Date().toISOString();
  cache.lastFetched = new Date().toISOString();
  cache.sourceErrors = errors;
  cache.sourceMix = buildSourceMix(deduped);
}

function refreshNewsSafely() {
  refreshNews().catch((error) => {
    cache.sourceErrors = [{ source: "system", message: error.message }];
  });
}

function buildCurrentNewsPayload() {
  if (!cache.lastUpdated) {
    const fallback = loadFallback();
    return enrichNewsPayloadWithApprovedStories({
      updatedAt: new Date().toISOString(),
      maxAgeHours: MAX_AGE_HOURS,
      fallback: true,
      limits: {
        topStories: TOP_STORIES_LIMIT,
        feed: FEED_LIMIT,
      },
      ...fallback,
    });
  }

  return enrichNewsPayloadWithApprovedStories({
    updatedAt: cache.lastUpdated,
    maxAgeHours: MAX_AGE_HOURS,
    fallback: false,
    limits: {
      topStories: TOP_STORIES_LIMIT,
      feed: FEED_LIMIT,
    },
    topStories: cache.topStories,
    feed: cache.feed,
    sourceErrors: cache.sourceErrors,
    sourceMix: cache.sourceMix,
    configuredSources: cache.configuredSources,
  });
}

function isLocalRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    req.hostname === "localhost" ||
    req.hostname === "127.0.0.1"
  );
}

function getProvidedAgentToken(req) {
  const auth = String(req.get("authorization") || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return String(req.get("x-live-news-token") || req.query.token || "").trim();
}

function requireAgentAccess(req, res, next) {
  const token = String(process.env.LIVE_NEWS_INTERNAL_TOKEN || "").trim();
  const provided = getProvidedAgentToken(req);
  if (token && provided === token) return next();
  if (!token && isLocalRequest(req)) return next();
  return res.status(404).json({ error: "Not found" });
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${req.get("host")}`;
}

function renderSitemap(req) {
  const origin = getPublicBaseUrl(req);
  const now = new Date().toISOString();
  const staticUrls = [
    { loc: "/", priority: "1.0", changefreq: "hourly", lastmod: now },
    { loc: "/local.html", priority: "0.8", changefreq: "hourly", lastmod: now },
  ];
  const storyUrls = listApprovedStories().map((story) => ({
    loc: story.liveNewsUrl || `/stories/${story.slug}`,
    priority: "0.7",
    changefreq: "daily",
    lastmod: story.updatedAt || story.publishedAt || story.approvedAt || now,
  }));
  const urls = [...staticUrls, ...storyUrls];
  const body = urls
    .map(
      (url) => `  <url>
    <loc>${escapeHtml(absoluteUrl(origin, url.loc))}</loc>
    <lastmod>${escapeHtml(url.lastmod)}</lastmod>
    <changefreq>${escapeHtml(url.changefreq)}</changefreq>
    <priority>${escapeHtml(url.priority)}</priority>
  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestPlace(lat, lon) {
  let best = null;
  let bestDistance = Infinity;
  for (const place of placesIndex) {
    if (place.lat == null || place.lon == null) continue;
    const distance = haversineKm(lat, lon, place.lat, place.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  if (!best) return null;
  const { search, ...rest } = best;
  return { place: rest, distanceKm: Math.round(bestDistance * 10) / 10 };
}

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(renderSitemap(req));
});

app.get("/stories/:slug", (req, res) => {
  const story = findApprovedStoryBySlug(req.params.slug);
  if (!story) {
    return res.status(404).send(renderStoryNotFoundPage());
  }
  res.send(renderPublicStoryPage(story, { origin: getPublicBaseUrl(req) }));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/news", (req, res) => {
  res.json(buildCurrentNewsPayload());
});

app.get("/api/stories", (req, res) => {
  const store = readApprovedStore();
  res.json({
    schemaVersion: store.schemaVersion,
    updatedAt: store.updatedAt,
    stories: getApprovedStorySummaries(),
  });
});

app.get("/api/stories/:slug", (req, res) => {
  const story = findApprovedStoryBySlug(req.params.slug);
  if (!story) return res.status(404).json({ error: "Story not found" });
  res.json(story);
});

app.get("/api/places", (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit || 20), 50);
  if (!query || query.length < 2) {
    return res.json({ results: [], totalPlaces: placesMeta.totalPlaces });
  }
  const matches = placesIndex
    .filter((place) => place.search.includes(query))
    .slice(0, limit)
    .map(({ search, ...rest }) => rest);
  res.json({
    results: matches,
    totalPlaces: placesMeta.totalPlaces,
    source: placesMeta.source,
    sourceUrl: placesMeta.sourceUrl,
  });
});

app.get("/api/places/nearest", (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "Invalid coordinates." });
  }
  const result = findNearestPlace(lat, lon);
  if (!result) {
    return res.json({ place: null });
  }
  res.json(result);
});

app.get("/api/local", async (req, res) => {
  const city = String(req.query.city || "").trim();
  const state = String(req.query.state || "").trim();
  if (!city) {
    return res.json({ updatedAt: new Date().toISOString(), items: [] });
  }
  try {
    const payload = await fetchLocalNews(city, state);
    res.json(payload);
  } catch (error) {
    res.json({
      updatedAt: new Date().toISOString(),
      items: [],
      error: error.message,
    });
  }
});

app.get("/api/agents/status", (req, res) => {
  const approvedCount = listApprovedStories().length;
  res.json({
    ok: true,
    mode: AGENT_MODE,
    reviewOnly: true,
    autoPublish: false,
    articlePagesCreated: approvedCount,
    approvedStories: approvedCount,
    internalAccess:
      Boolean(String(process.env.LIVE_NEWS_INTERNAL_TOKEN || "").trim()) || isLocalRequest(req),
    draftLimit: AGENT_DRAFT_LIMIT,
    safety: {
      humanReviewRequired: true,
      sourceAttributionRequired: true,
      originalSourceLinksRequired: true,
      publisherWordingCopyingAllowed: false,
    },
  });
});

app.get("/api/internal/story-packets", requireAgentAccess, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || AGENT_DRAFT_LIMIT), 1), 50);
  const result = runArticleAgents(buildCurrentNewsPayload(), { limit });
  res.json({
    run: result.run,
    packets: result.packets,
  });
});

app.get("/api/internal/drafts", requireAgentAccess, (req, res) => {
  res.json(
    readJson(STORE_PATHS.drafts, {
      schemaVersion: "live-news-drafts-store-v1",
      mode: "review_only",
      autoPublish: false,
      updatedAt: null,
      run: null,
      drafts: [],
    })
  );
});

app.post("/api/internal/drafts/generate", requireAgentAccess, (req, res) => {
  const limit = Math.min(
    Math.max(Number(req.body?.limit || req.query.limit || AGENT_DRAFT_LIMIT), 1),
    50
  );
  const persist = req.body?.persist === true || req.query.persist === "true";
  const result = runArticleAgents(buildCurrentNewsPayload(), { limit });
  if (persist) {
    saveAgentRun(result);
  }
  res.json({
    ...result,
    persisted: persist,
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    lastUpdated: cache.lastUpdated,
    stories: cache.items.length,
    topStories: cache.topStories.length,
    feedItems: cache.feed.length,
    configuredSources: cache.configuredSources,
    sourceErrors: cache.sourceErrors.length,
    sourceMix: cache.sourceMix,
    limits: {
      topStories: TOP_STORIES_LIMIT,
      feed: FEED_LIMIT,
      maxAgeHours: MAX_AGE_HOURS,
    },
    agents: {
      mode: AGENT_MODE,
      reviewOnly: true,
      autoPublish: false,
      draftLimit: AGENT_DRAFT_LIMIT,
      approvedStories: listApprovedStories().length,
    },
    places: placesMeta.totalPlaces,
  });
});

refreshNewsSafely();
setInterval(refreshNewsSafely, REFRESH_MINUTES * 60 * 1000);
loadPlaces();

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
