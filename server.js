const path = require("path");
const fs = require("fs");
const express = require("express");
const crypto = require("crypto");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 8080;

const sourcesPath = path.join(__dirname, "data", "sources.json");
const fallbackPath = path.join(__dirname, "data", "news.json");

const MAX_AGE_HOURS = Number(process.env.NEWS_MAX_AGE_HOURS || 48);
const REFRESH_MINUTES = Number(process.env.NEWS_REFRESH_INTERVAL_MINUTES || 10);

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

function loadSources() {
  const raw = fs.readFileSync(sourcesPath, "utf8");
  return JSON.parse(raw).sources || [];
}

function loadFallback() {
  const raw = fs.readFileSync(fallbackPath, "utf8");
  return JSON.parse(raw);
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
  const weight = source.weight || 1;
  return Math.round(freshness * 70 + weight * 30);
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
  cache.feed = diversifyBySource(recent, { maxPerSource: 4 });
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    lastUpdated: cache.lastUpdated,
    sources: cache.items.length,
  });
});

refreshNewsSafely();
setInterval(refreshNewsSafely, REFRESH_MINUTES * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
