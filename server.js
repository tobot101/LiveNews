const path = require("path");
const fs = require("fs");
const express = require("express");
const crypto = require("crypto");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 8080;

const sourcesPath = path.join(__dirname, "data", "sources.json");
const fallbackPath = path.join(__dirname, "data", "news.json");
const placesPath = path.join(__dirname, "data", "us-places.json");

const MAX_AGE_HOURS = Number(process.env.NEWS_MAX_AGE_HOURS || 48);
const REFRESH_MINUTES = Number(process.env.NEWS_REFRESH_INTERVAL_MINUTES || 10);
const FEED_LIMIT = Number(process.env.NEWS_FEED_LIMIT || 120);

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
};

let placesIndex = [];
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
    placesMeta = {
      source: parsed.source || "",
      sourceUrl: parsed.sourceUrl || "",
      totalPlaces: parsed.totalPlaces || 0,
    };
    placesIndex = (parsed.places || []).map((place) => ({
      ...place,
      search: `${place.display} ${place.officialName} ${place.stateName}`.toLowerCase(),
    }));
  } catch (error) {
    placesIndex = [];
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

function computeScore(source, publishedAt) {
  const hoursOld = Math.max(0, (Date.now() - publishedAt.getTime()) / 3600000);
  const freshness = Math.max(0, 1 - hoursOld / MAX_AGE_HOURS);
  const weight = Number(source.weight || 1);
  const weightScore = clamp((weight - 1) / 2, 0, 1);
  const recencyBoost =
    hoursOld <= 2 ? 1 : hoursOld <= 6 ? 0.6 : hoursOld <= 12 ? 0.3 : 0;
  const composite = clamp(0.65 * freshness + 0.25 * weightScore + 0.1 * recencyBoost, 0, 1);
  return Math.round(70 + 30 * composite);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildSummary(text) {
  if (!text) return "";
  const clean = String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const summary = sentences.slice(0, 2).join(" ").trim();
  return summary.slice(0, 220);
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
    return url.hostname.replace(/^www\\./, "");
  } catch {
    return "";
  }
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

function diversifyBySource(items, { maxPerSource = 0, limit } = {}) {
  if (!items.length) return [];
  const groups = new Map();
  items.forEach((item) => {
    const key = item.sourceName || item.source || "Unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  });

  groups.forEach((list) => {
    list.sort(
      (a, b) =>
        (b.score || 0) - (a.score || 0) ||
        new Date(b.publishedAt) - new Date(a.publishedAt)
    );
  });

  const sources = Array.from(groups.entries())
    .sort(([, a], [, b]) => (b[0]?.score || 0) - (a[0]?.score || 0))
    .map(([name]) => name);

  const result = [];
  const counts = new Map();
  const maxItems = limit ?? items.length;

  while (result.length < maxItems) {
    let added = false;
    for (const source of sources) {
      if (result.length >= maxItems) break;
      const list = groups.get(source);
      if (!list || list.length === 0) continue;
      const count = counts.get(source) || 0;
      if (maxPerSource > 0 && count >= maxPerSource) {
        const otherHasItems = sources.some(
          (name) => name !== source && (groups.get(name) || []).length > 0
        );
        if (otherHasItems) continue;
      }
      result.push(list.shift());
      counts.set(source, count + 1);
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
    category: source.category || "Top",
    score: computeScore(source, publishedAt),
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
  return {
    id: crypto.createHash("sha1").update(link).digest("hex"),
    title,
    link,
    publishedAt: publishedAt.toISOString(),
    sourceName,
    sourceDomain: getDomain(link),
    category: "Local",
    score: computeScore({ weight: 1 }, publishedAt),
    summary: buildSummary(item.contentSnippet || item.content || ""),
  };
}

async function fetchLocalNews(city, state) {
  const key = `${city}|${state}`.toLowerCase();
  const cached = localCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < REFRESH_MINUTES * 60 * 1000) {
    return cached.payload;
  }
  const query = [city, state].filter(Boolean).join(" ");
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const feed = await parser.parseURL(feedUrl);
  const items = Array.isArray(feed.items) ? feed.items : [];
  const normalized = items.map(normalizeLocalItem).filter(Boolean);
  const payload = {
    updatedAt: new Date().toISOString(),
    items: normalized,
    query,
  };
  localCache.set(key, { fetchedAt: now, payload });
  return payload;
}

async function fetchSource(source) {
  const feed = await parser.parseURL(source.feedUrl);
  const items = Array.isArray(feed.items) ? feed.items : [];
  return items
    .map((item) => normalizeItem(source, item))
    .filter(Boolean);
}

async function refreshNews() {
  const sources = loadSources();
  const collected = [];
  const errors = [];

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

  const deduped = new Map();
  for (const item of collected) {
    if (!deduped.has(item.link)) {
      deduped.set(item.link, item);
    }
  }

  const items = Array.from(deduped.values());
  const ranked = [...items].sort((a, b) => b.score - a.score);
  const recent = [...items].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  cache.items = items;
  cache.topStories = diversifyBySource(ranked, { maxPerSource: 2, limit: 12 });
  cache.feed = diversifyBySource(recent, { maxPerSource: 0, limit: FEED_LIMIT });
  cache.lastUpdated = new Date().toISOString();
  cache.lastFetched = new Date().toISOString();
  cache.sourceErrors = errors;
}

function refreshNewsSafely() {
  refreshNews().catch((error) => {
    cache.sourceErrors = [{ source: "system", message: error.message }];
  });
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/news", (req, res) => {
  if (!cache.lastUpdated) {
    const fallback = loadFallback();
    return res.json({
      updatedAt: new Date().toISOString(),
      maxAgeHours: MAX_AGE_HOURS,
      fallback: true,
      ...fallback,
    });
  }

  res.json({
    updatedAt: cache.lastUpdated,
    maxAgeHours: MAX_AGE_HOURS,
    fallback: false,
    topStories: cache.topStories,
    feed: cache.feed,
    sourceErrors: cache.sourceErrors,
  });
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    lastUpdated: cache.lastUpdated,
    sources: cache.items.length,
  });
});

refreshNewsSafely();
setInterval(refreshNewsSafely, REFRESH_MINUTES * 60 * 1000);
loadPlaces();

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
