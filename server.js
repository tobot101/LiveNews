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
  FALLBACK_SUMMARY,
  applyLiveNewsSummariesToItems,
  applyLiveNewsSummariesToPayload,
  applyLiveNewsSummary,
  buildLiveNewsSummary,
  getSummaryHealth,
} = require("./lib/article-agents/summary-agent");
const {
  createSummaryResearchStats,
  hydrateSummaryResearch,
} = require("./lib/article-agents/summary-research-agent");
const {
  absoluteUrl,
  escapeHtml,
  renderPublicStoryPage,
  renderStoryNotFoundPage,
} = require("./lib/article-agents/story-renderer");
const { STORE_PATHS, readJson, saveAgentRun } = require("./lib/article-agents/store");
const {
  getArticleImageRejectionReason,
  getImageDimensionHints,
  isAuthenticArticleImageUrl,
  isStrongArticleImageSize,
  normalizeImageUrl,
  pickAuthenticArticleImageUrl,
} = require("./lib/article-images");
const { researchPublicMediaImage } = require("./lib/image-research-agent");
const {
  buildLocalQueryVariants,
  resolveLocalPlaceInput,
} = require("./lib/local-news-helpers");

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
const IMAGE_LOOKUP_LIMIT = Number(process.env.IMAGE_LOOKUP_LIMIT || 18);
const IMAGE_LOOKUP_CONCURRENCY = Number(process.env.IMAGE_LOOKUP_CONCURRENCY || 4);
const IMAGE_LOOKUP_TIMEOUT_MS = Number(process.env.IMAGE_LOOKUP_TIMEOUT_MS || 1800);
const IMAGE_VALIDATION_TIMEOUT_MS = Number(process.env.IMAGE_VALIDATION_TIMEOUT_MS || 1400);
const SUMMARY_RESEARCH_LIMIT = Number(process.env.SUMMARY_RESEARCH_LIMIT || FEED_LIMIT);
const SUMMARY_RESEARCH_CONCURRENCY = Number(process.env.SUMMARY_RESEARCH_CONCURRENCY || 3);
const SUMMARY_RESEARCH_TIMEOUT_MS = Number(process.env.SUMMARY_RESEARCH_TIMEOUT_MS || 1800);
const AGENT_DRAFT_LIMIT = Number(process.env.LIVE_NEWS_DRAFT_LIMIT || 16);
const AGENT_MODE = process.env.LIVE_NEWS_AGENT_MODE || "review_only";
const SUMMARY_ADMIN_TOKEN = process.env.LIVE_NEWS_ADMIN_TOKEN || process.env.LIVE_NEWS_REVIEW_TOKEN || "";
const CATEGORY_SECTIONS = ["National", "International", "Business", "Tech", "Sports", "Entertainment"];
const PUBLIC_CANONICAL_ORIGIN = "https://newsmorenow.com";
const SITEMAP_STABLE_PAGES = [
  { path: "/", changefreq: "hourly", priority: "1.0" },
  { path: "/local", changefreq: "hourly", priority: "0.8" },
  { path: "/latest", changefreq: "hourly", priority: "0.8" },
  { path: "/top-stories", changefreq: "hourly", priority: "0.9" },
  { path: "/category/national", changefreq: "hourly", priority: "0.7" },
  { path: "/category/world", changefreq: "hourly", priority: "0.7" },
  { path: "/category/business", changefreq: "hourly", priority: "0.7" },
  { path: "/category/technology", changefreq: "hourly", priority: "0.7" },
  { path: "/category/sports", changefreq: "hourly", priority: "0.7" },
  { path: "/category/entertainment", changefreq: "hourly", priority: "0.7" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/editorial-policy", changefreq: "monthly", priority: "0.5" },
  { path: "/sources", changefreq: "weekly", priority: "0.5" },
  { path: "/privacy", changefreq: "monthly", priority: "0.5" },
  { path: "/contact", changefreq: "monthly", priority: "0.5" },
];
const CATEGORY_ROUTE_CONFIG = {
  national: {
    label: "National",
    apiCategory: "National",
    title: "Live News National Coverage",
    description: "Browse recent national coverage from Live News with attribution and original source links.",
  },
  world: {
    label: "World",
    apiCategory: "International",
    title: "Live News World Coverage",
    description: "Browse recent world and international coverage from Live News with original source links.",
  },
  business: {
    label: "Business",
    apiCategory: "Business",
    title: "Live News Business Coverage",
    description: "Browse business coverage about companies, markets, workers, money, and consumers.",
  },
  technology: {
    label: "Technology",
    apiCategory: "Tech",
    title: "Live News Technology Coverage",
    description: "Browse technology coverage about products, platforms, users, privacy, and tools.",
  },
  sports: {
    label: "Sports",
    apiCategory: "Sports",
    title: "Live News Sports Coverage",
    description: "Browse sports coverage about teams, players, results, and upcoming matchups.",
  },
  entertainment: {
    label: "Entertainment",
    apiCategory: "Entertainment",
    title: "Live News Entertainment Coverage",
    description: "Browse entertainment coverage about releases, people, audiences, and events.",
  },
};
const STATIC_INFO_PAGES = {
  about: {
    title: "About Live News",
    description:
      "Learn how Live News keeps coverage readable, low-clutter, source-linked, and respectful of original publishers.",
    heading: "About Live News",
    kicker: "Readability first",
    body: [
      "Live News is built to make current coverage easier to browse without ads, clutter, or copied publisher wording.",
      "Stories are gathered from official feeds and recent reporting, summarized in plain language, and linked back to the original publisher for full reporting.",
      "The product direction is simple: keep Top Stories focused, keep local coverage easy to reach, and keep attribution visible.",
    ],
  },
  contact: {
    title: "Contact Live News",
    description:
      "Contact Live News about source attribution, corrections, local coverage, or website feedback.",
    heading: "Contact Live News",
    kicker: "Feedback and corrections",
    body: [
      "For corrections, attribution questions, source issues, or website feedback, contact the Live News team through the site owner.",
      "When reporting an issue, include the page URL, story title, source name, and what should be reviewed.",
      "Live News is designed to improve over time while keeping publisher links and reader clarity at the center.",
    ],
  },
  privacy: {
    title: "Live News Privacy",
    description:
      "Read the Live News privacy approach for cookies, personalization, analytics, and no-ad browsing.",
    heading: "Privacy",
    kicker: "No ads, no selling data",
    body: [
      "Live News does not serve ads and does not sell personal data.",
      "Functional settings may remember theme, refresh, feed size, city selection, and cookie choices on your device.",
      "Personalization and analytics are optional. They help improve browsing, but the site remains usable without them.",
    ],
  },
  "editorial-policy": {
    title: "Live News Editorial Policy",
    description:
      "Read how Live News handles summaries, attribution, original source links, and source-respectful coverage.",
    heading: "Editorial Policy",
    kicker: "Source-respectful coverage",
    body: [
      "Live News summarizes source-linked coverage with attribution. Full reporting remains with the original publisher.",
      "Summaries should use plain language, avoid copied publisher wording, and never add facts not supported by available source data.",
      "Original source links are required so readers can verify details and read the complete reporting from the publisher.",
    ],
  },
  sources: {
    title: "Live News Sources",
    description:
      "See how Live News uses official feeds, recent reporting, local search results, attribution, and original source links.",
    heading: "Sources",
    kicker: "Attribution and original links",
    body: [
      "Live News uses official RSS feeds, recent public reporting, and local search results to organize current coverage.",
      "Every story card should show the source name, timestamp, category, summary, and a link back to the original publisher.",
      "Live News does not include external publisher URLs in its sitemap. Publisher links remain visible on article cards for attribution and verification.",
    ],
  },
};

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
  "aviglianonews.it",
  "www.aviglianonews.it",
  "flashscore.co.za",
  "www.flashscore.co.za",
  "nfhsnetwork.com",
  "www.nfhsnetwork.com",
  "docsports.com",
  "www.docsports.com",
  "maxpreps.com",
  "www.maxpreps.com",
  "draftkings.com",
  "www.draftkings.com",
]);

const LOCAL_CITY_ALIASES = {
  "new york": ["nyc", "brooklyn", "queens", "bronx", "manhattan", "staten island", "yankees", "mets", "knicks", "nets", "rangers", "islanders", "liberty"],
  "los angeles": ["l.a.", "dodgers", "lakers", "clippers", "rams", "chargers", "angels", "lafc", "galaxy", "hollywood"],
  chicago: ["cubs", "white sox", "bears", "bulls", "blackhawks", "chicago fire"],
  houston: ["astros", "texans", "rockets", "dynamo"],
  phoenix: ["suns", "cardinals", "diamondbacks", "d-backs", "mercury"],
  philadelphia: ["phillies", "eagles", "76ers", "sixers", "flyers", "union"],
  "san antonio": ["spurs"],
  "san diego": ["padres", "san diego fc", "sdsu", "aztecs", "scripps", "la jolla", "chula vista", "el cajon", "north county", "lake hodges", "mission bay", "scripps ranch", "core columbia", "del mar", "encinitas", "carlsbad", "escondido"],
  dallas: ["cowboys", "mavericks", "mavs", "stars", "fc dallas", "wings"],
  jacksonville: ["jaguars", "jags"],
  austin: ["austin fc", "longhorns"],
  "fort worth": ["tcu", "horned frogs"],
  "san jose": ["sharks", "earthquakes"],
  columbus: ["blue jackets", "crew"],
  charlotte: ["panthers", "hornets", "fc charlotte"],
  indianapolis: ["colts", "pacers"],
  "san francisco": ["49ers", "giants", "warriors", "bay area"],
  seattle: ["seahawks", "mariners", "kraken", "sounders", "storm"],
  denver: ["broncos", "nuggets", "rockies", "avalanche", "rapids"],
  "oklahoma city": ["okc", "thunder"],
  nashville: ["titans", "predators", "nashville sc"],
  "el paso": ["locomotive"],
  washington: ["commanders", "nationals", "wizards", "capitals", "mystics", "d.c. united"],
  boston: ["red sox", "celtics", "bruins", "patriots", "revolution"],
  "las vegas": ["raiders", "golden knights", "aces"],
  portland: ["trail blazers", "blazers", "timbers", "thorns"],
  detroit: ["tigers", "lions", "pistons", "red wings"],
  louisville: ["cardinals"],
  memphis: ["grizzlies"],
  baltimore: ["ravens", "orioles"],
};

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
const articleImageCache = new Map();
const articleImageMetadataCache = new Map();
const summaryResearchCache = new Map();
let localHealthStats = {
  requests: 0,
  emptyResponses: 0,
  lastQuery: "",
  lastResolvedPlace: "",
  lastResultCount: 0,
  lastSourceCount: 0,
  lastError: null,
  lastSummaryHealth: null,
  lastSummaryResearch: null,
  lastAudienceIntelligence: null,
  lastUpdated: null,
};
let imageQualityStats = {
  checked: 0,
  accepted: 0,
  rejected: 0,
  researchedPages: 0,
  alternativesTried: 0,
  fallbacks: 0,
  rejectionReasons: {},
};
let summaryResearchStats = createSummaryResearchStats();

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

function collectMediaUrls(value, bucket) {
  if (!value) return;
  if (typeof value === "string") {
    bucket.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectMediaUrls(entry, bucket));
    return;
  }
  if (typeof value === "object") {
    bucket.push(value.url, value.href, value.$?.url, value.$?.href);
    Object.keys(value).forEach((key) => {
      if (key.toLowerCase().includes("url") || key.toLowerCase().includes("image")) {
        collectMediaUrls(value[key], bucket);
      }
    });
  }
}

function resetImageQualityStats() {
  imageQualityStats = {
    checked: 0,
    accepted: 0,
    rejected: 0,
    researchedPages: 0,
    alternativesTried: 0,
    fallbacks: 0,
    rejectionReasons: {},
  };
}

function recordImageRejection(reason) {
  const key = reason || "unknown";
  imageQualityStats.rejected += 1;
  imageQualityStats.rejectionReasons[key] = (imageQualityStats.rejectionReasons[key] || 0) + 1;
}

function uniqueImageCandidates(candidates) {
  return Array.from(
    new Set(
      (candidates || [])
        .map(normalizeImageUrl)
        .filter((candidate) => candidate && isAuthenticArticleImageUrl(candidate))
    )
  ).slice(0, 12);
}

function extractSrcsetUrls(value, baseUrl) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .map((entry) => resolveImageUrl(entry, baseUrl))
    .filter(Boolean);
}

function extractImageCandidatesFromHtml(value, baseUrl = "") {
  const html = String(value || "");
  const candidates = [];
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    candidates.push(baseUrl ? resolveImageUrl(match[1], baseUrl) : normalizeImageUrl(match[1]));
  }
  for (const match of html.matchAll(/<(?:img|source)[^>]+srcset=["']([^"']+)["']/gi)) {
    candidates.push(...extractSrcsetUrls(match[1], baseUrl));
  }
  for (const match of html.matchAll(
    /<img[^>]+(?:data-src|data-lazy-src|data-original|data-image)=["']([^"']+)["']/gi
  )) {
    candidates.push(baseUrl ? resolveImageUrl(match[1], baseUrl) : normalizeImageUrl(match[1]));
  }
  return uniqueImageCandidates(candidates);
}

function extractImageFromHtml(value, baseUrl = "") {
  return pickAuthenticArticleImageUrl(extractImageCandidatesFromHtml(value, baseUrl));
}

function extractItemImageUrl(item) {
  const candidates = [];
  if (item.enclosure && (!item.enclosure.type || String(item.enclosure.type).startsWith("image/"))) {
    collectMediaUrls(item.enclosure, candidates);
  }
  collectMediaUrls(item.image, candidates);
  collectMediaUrls(item.thumbnail, candidates);
  collectMediaUrls(item["media:content"], candidates);
  collectMediaUrls(item["media:thumbnail"], candidates);
  collectMediaUrls(item["itunes:image"], candidates);
  collectMediaUrls(item.itunes?.image, candidates);
  candidates.push(extractImageFromHtml(item.content), extractImageFromHtml(item.summary));
  return pickAuthenticArticleImageUrl(candidates);
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function resolveImageUrl(value, baseUrl) {
  const decoded = decodeHtmlAttribute(value);
  if (!decoded) return "";
  try {
    return normalizeImageUrl(new URL(decoded, baseUrl).toString());
  } catch {
    return normalizeImageUrl(decoded);
  }
}

function extractMetaImageCandidates(html, baseUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url|:url)?["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/gi,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<link[^>]+rel=["'][^"']*image_src[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*image_src[^"']*["'][^>]*>/gi,
  ];
  const candidates = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      candidates.push(resolveImageUrl(match?.[1], baseUrl));
    }
  }
  candidates.push(...extractJsonLdImageCandidates(html, baseUrl));
  candidates.push(...extractImageCandidatesFromHtml(html, baseUrl));
  return uniqueImageCandidates(candidates);
}

function collectImageValue(value, baseUrl, bucket) {
  if (!value) return;
  if (typeof value === "string") {
    const resolved = resolveImageUrl(value, baseUrl);
    if (resolved) bucket.push(resolved);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectImageValue(entry, baseUrl, bucket));
    return;
  }
  if (typeof value === "object") {
    collectImageValue(value.url || value.contentUrl || value["@id"], baseUrl, bucket);
  }
}

function collectJsonLdImages(value, baseUrl, bucket) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonLdImages(entry, baseUrl, bucket));
    return;
  }
  if (typeof value !== "object") return;
  collectImageValue(value.image, baseUrl, bucket);
  collectImageValue(value.thumbnailUrl, baseUrl, bucket);
  collectImageValue(value.primaryImageOfPage, baseUrl, bucket);
  collectJsonLdImages(value["@graph"], baseUrl, bucket);
}

function extractJsonLdImageCandidates(html, baseUrl) {
  const matches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const allCandidates = [];
  for (const match of matches) {
    const candidates = [];
    const raw = decodeHtmlAttribute(match[1]).trim();
    if (!raw) continue;
    try {
      collectJsonLdImages(JSON.parse(raw), baseUrl, candidates);
    } catch {
      continue;
    }
    allCandidates.push(...candidates);
  }
  return uniqueImageCandidates(allCandidates);
}

function extractOembedUrls(html, baseUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/json\+oembed/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const resolved = resolveImageUrl(href, baseUrl);
    if (resolved) links.push(resolved);
  }
  return Array.from(new Set(links)).slice(0, 2);
}

async function fetchOembedImageCandidates(oembedUrl) {
  const url = normalizeImageUrl(oembedUrl);
  if (!url || typeof fetch !== "function" || typeof AbortController !== "function") return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "LiveNewsBot/1.0 (+https://newsmorenow.com)",
      },
      redirect: "follow",
    });
    if (!response.ok) return [];
    const data = await response.json();
    return uniqueImageCandidates([data.thumbnail_url, data.url]);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArticleImageCandidates(link) {
  const url = normalizeImageUrl(link);
  if (!url) return [];
  if (articleImageCache.has(url)) return articleImageCache.get(url);
  if (typeof fetch !== "function" || typeof AbortController !== "function") return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "LiveNewsBot/1.0 (+https://newsmorenow.com)",
      },
      redirect: "follow",
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("html")) {
      articleImageCache.set(url, []);
      return [];
    }
    const html = (await response.text()).slice(0, 220000);
    imageQualityStats.researchedPages += 1;
    const baseUrl = response.url || url;
    const candidates = [...extractMetaImageCandidates(html, baseUrl)];
    for (const oembedUrl of extractOembedUrls(html, baseUrl)) {
      candidates.push(...(await fetchOembedImageCandidates(oembedUrl)));
    }
    const unique = uniqueImageCandidates(candidates);
    articleImageCache.set(url, unique);
    return unique;
  } catch {
    articleImageCache.set(url, []);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function parsePngDimensions(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGifDimensions(buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") return null;
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function parseWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

function parseImageDimensions(buffer, contentType = "") {
  const lowerType = String(contentType || "").toLowerCase();
  return (
    (lowerType.includes("png") && parsePngDimensions(buffer)) ||
    (lowerType.includes("gif") && parseGifDimensions(buffer)) ||
    (lowerType.includes("webp") && parseWebpDimensions(buffer)) ||
    (lowerType.includes("jpeg") && parseJpegDimensions(buffer)) ||
    parsePngDimensions(buffer) ||
    parseGifDimensions(buffer) ||
    parseWebpDimensions(buffer) ||
    parseJpegDimensions(buffer)
  );
}

async function fetchImageMetadata(imageUrl) {
  const url = normalizeImageUrl(imageUrl);
  if (!url) return { ok: false, reason: "invalid image URL" };
  if (articleImageMetadataCache.has(url)) return articleImageMetadataCache.get(url);

  const hints = getImageDimensionHints(url);
  if (isStrongArticleImageSize(hints.width, hints.height)) {
    const hinted = { ok: true, width: hints.width, height: hints.height, source: "url_hint" };
    articleImageMetadataCache.set(url, hinted);
    return hinted;
  }

  if (typeof fetch !== "function" || typeof AbortController !== "function") {
    return { ok: false, reason: "image metadata fetch unavailable" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_VALIDATION_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Range": "bytes=0-65535",
        "User-Agent": "LiveNewsBot/1.0 (+https://newsmorenow.com)",
      },
      redirect: "follow",
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("image/")) {
      const rejected = { ok: false, reason: "candidate is not an image response" };
      articleImageMetadataCache.set(url, rejected);
      return rejected;
    }
    const dimensions = parseImageDimensions(Buffer.from(await response.arrayBuffer()), contentType);
    const metadata = {
      ok: Boolean(dimensions?.width && dimensions?.height),
      width: dimensions?.width || 0,
      height: dimensions?.height || 0,
      contentType,
      source: "image_probe",
      reason: dimensions ? "" : "image dimensions could not be verified",
    };
    articleImageMetadataCache.set(url, metadata);
    return metadata;
  } catch {
    const rejected = { ok: false, reason: "image metadata fetch failed" };
    articleImageMetadataCache.set(url, rejected);
    return rejected;
  } finally {
    clearTimeout(timeout);
  }
}

async function validateArticleImageCandidate(imageUrl) {
  imageQualityStats.checked += 1;
  const normalized = normalizeImageUrl(imageUrl);
  if (!normalized) {
    recordImageRejection("invalid image URL");
    return false;
  }
  const staticReason = getArticleImageRejectionReason(normalized);
  if (staticReason) {
    recordImageRejection(staticReason);
    return false;
  }
  const metadata = await fetchImageMetadata(normalized);
  if (!metadata.ok) {
    recordImageRejection(metadata.reason || "image metadata rejected");
    return false;
  }
  if (!isStrongArticleImageSize(metadata.width, metadata.height)) {
    recordImageRejection("verified image is too small for an article visual");
    return false;
  }
  imageQualityStats.accepted += 1;
  return true;
}

function getImageLookupLinks(item) {
  const links = [
    item.link,
    item.originalSourceUrl,
    ...(item.supportingLinks || []).map((source) => source.link),
  ]
    .map(normalizeImageUrl)
    .filter(Boolean);
  return Array.from(new Set(links)).slice(0, 4);
}

async function findArticleImageForItem(item) {
  for (const link of getImageLookupLinks(item)) {
    const candidates = await fetchArticleImageCandidates(link);
    for (const imageUrl of candidates) {
      imageQualityStats.alternativesTried += 1;
      if (!(await validateArticleImageCandidate(imageUrl))) continue;
      return {
        imageUrl,
        imageSource: "article_research",
        imageSourceUrl: link,
      };
    }
  }
  const publicMedia = await researchPublicMediaImage(item, {
    timeoutMs: IMAGE_LOOKUP_TIMEOUT_MS,
  });
  if (publicMedia?.imageUrl && (await validateArticleImageCandidate(publicMedia.imageUrl))) {
    imageQualityStats.alternativesTried += 1;
    return publicMedia;
  }
  imageQualityStats.fallbacks += 1;
  return null;
}

async function hydrateArticleImages(items, options = {}) {
  if (!IMAGE_LOOKUP_LIMIT || !items.length) return;
  const limit = Math.max(1, Number(options.limit || IMAGE_LOOKUP_LIMIT));
  const targets = [];
  for (const item of items.filter((entry) => entry && entry.link).slice(0, limit)) {
    if (item.imageUrl && (await validateArticleImageCandidate(item.imageUrl))) continue;
    item.imageUrl = "";
    item.imageSource = "";
    item.imageSourceUrl = "";
    item.imageCredit = "";
    item.imageAlt = "";
    item.imageResearchQuery = "";
    targets.push(item);
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(IMAGE_LOOKUP_CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const item = targets[cursor];
      cursor += 1;
      const found = await findArticleImageForItem(item);
      if (found?.imageUrl) {
        item.imageUrl = found.imageUrl;
        item.imageSource = found.imageSource || "article_research";
        item.imageSourceUrl = found.imageSourceUrl || "";
        item.imageCredit = found.imageCredit || "";
        item.imageAlt = found.imageAlt || "";
        item.imageResearchQuery = found.imageResearchQuery || "";
      }
    }
  });
  await Promise.allSettled(workers);
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
    title: item.title,
    summary: item.summary || "",
    link: item.link,
    publishedAt: item.publishedAt,
    category: item.category,
    imageUrl: item.imageUrl || "",
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

  return applyLiveNewsSummary({
    id: lead.id,
    title: lead.title,
    link: lead.link,
    publishedAt: lead.publishedAt,
    sourceName: lead.sourceName,
    sourceUrl: lead.sourceUrl,
    sourceDomain: lead.domain,
    imageUrl: pickAuthenticArticleImageUrl([
      lead.imageUrl,
      ...items.map((item) => item.imageUrl),
    ]),
    category,
    score,
    sourceCount: sourceNames.length,
    relatedSources: sourceNames,
    supportingLinks: items.slice(0, 6).map(serializeSupportLink),
    summary: lead.summary || "",
  });
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

function getStoryIdentityKey(item) {
  const titleKey = String(item?.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return item?.link || item?.id || `${item?.sourceDomain || item?.domain || item?.sourceName || "source"}:${titleKey}`;
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

function needsSummaryResearch(item) {
  if (!item?.link) return false;
  if (item.summaryResearch?.status === "ready") return false;
  const rawSummaryWords = String(item.summary || "").split(/\s+/).filter(Boolean).length;
  if (rawSummaryWords < 18) return true;
  const result = buildLiveNewsSummary(item);
  return (
    result.text === FALLBACK_SUMMARY ||
    result.supervisor?.status === "needs_editor_review" ||
    result.style === "fallback"
  );
}

function buildSummaryResearchTargets(items) {
  const seen = new Set();
  const priority = [];
  const backup = [];
  for (const item of items || []) {
    if (!item?.link || seen.has(item.link)) continue;
    seen.add(item.link);
    if (needsSummaryResearch(item)) {
      priority.push(item);
    } else {
      backup.push(item);
    }
  }
  return [...priority, ...backup].slice(0, Math.max(0, SUMMARY_RESEARCH_LIMIT));
}

async function hydrateSummaryResearchForItems(items) {
  summaryResearchStats = createSummaryResearchStats();
  const targets = buildSummaryResearchTargets(items);
  if (!targets.length) return;
  await hydrateSummaryResearch(targets, {
    cache: summaryResearchCache,
    stats: summaryResearchStats,
    limit: targets.length,
    concurrency: SUMMARY_RESEARCH_CONCURRENCY,
    timeoutMs: SUMMARY_RESEARCH_TIMEOUT_MS,
  });
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
    imageUrl: extractItemImageUrl(item),
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
    imageUrl: extractItemImageUrl(item),
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
  const titleWordCount = String(title || "").split(/\s+/).filter(Boolean).length;
  if (/^\d{3,6}\s+.+,\s*[a-z .]+,\s*[a-z]{2}\s+\d{5}/i.test(String(title || ""))) return true;
  if (/\bvs\.\s+.+\([A-Za-z]+\s+\d{1,2}/.test(String(title || ""))) return true;
  if (/^game\s+\d+:/i.test(String(title || ""))) return true;
  return (
    titleWordCount <= 2 ||
    haystack.includes("legacy obituary") ||
    haystack.includes("tribute archive") ||
    haystack.includes("obituaries") ||
    haystack.includes("obituary") ||
    haystack.includes("funeral home") ||
    haystack.includes("national today") ||
    haystack.includes("collectible") ||
    haystack.includes("shot cup") ||
    haystack.includes("travel souvenir") ||
    haystack.includes("aazon.co") ||
    haystack.includes("citizen: keeping you safe") ||
    haystack.includes("weekend guide") ||
    haystack.includes(" like a local") ||
    haystack.includes("homes for sale") ||
    haystack.includes("property for sale") ||
    haystack.includes("best desserts") ||
    haystack.includes("top sweet spots") ||
    haystack.includes("near you (202") ||
    haystack.includes("things to do") ||
    haystack.includes("live & on demand") ||
    haystack.includes(" live and on demand") ||
    haystack.includes("live stream") ||
    haystack.includes("where to watch") ||
    haystack.includes("tv channel") ||
    haystack.includes("best bets") ||
    haystack.includes("betting odds") ||
    haystack.includes("prediction,") ||
    haystack.includes("game info") ||
    haystack.includes("final score") ||
    haystack.includes("match highlights") ||
    haystack.includes("match report") ||
    haystack.includes("match snapshot") ||
    haystack.includes("post-match facts") ||
    haystack.includes("game summary") ||
    haystack.includes(" live score") ||
    haystack.includes(" goal -") ||
    haystack.includes("wnba matchup") ||
    haystack.includes("videos -") ||
    haystack.includes("varsity") ||
    haystack.includes("wide receiver") ||
    haystack.includes("draftkings network") ||
    haystack.includes("doc's sports") ||
    haystack.includes("247sports") ||
    haystack.includes("maxpreps") ||
    haystack.includes("nfhs network") ||
    haystack.includes(" live 03/") ||
    haystack.includes(" live 04/") ||
    haystack.includes(" live 05/") ||
    haystack.includes(" live 06/") ||
    haystack.includes("events -")
  );
}

function normalizeLocalMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocalAliasTerms(place) {
  const city = normalizeLocalMatchText(place?.name || "");
  return LOCAL_CITY_ALIASES[city] || [];
}

function hasLocalRelevance(item, place) {
  const city = normalizeLocalMatchText(place?.name || "");
  const state = normalizeLocalMatchText(place?.stateName || place?.state || "");
  const stateCode = normalizeLocalMatchText(place?.state || "");
  const title = normalizeLocalMatchText(item?.title || "");
  const sourceName = normalizeLocalMatchText(item?.sourceName || item?.source || "");
  const summary = normalizeLocalMatchText(item?.summary || item?.sourceSummary || "");
  const link = normalizeLocalMatchText(item?.link || "");
  const haystack = `${title} ${summary} ${sourceName} ${link}`;

  if (city && haystack.includes(city)) return true;
  if (city && city.split(" ").length > 1 && city.split(" ").every((part) => haystack.includes(part))) return true;
  if (state && title.includes(state) && sourceName.includes(city.split(" ")[0] || city)) return true;
  if (stateCode && title.includes(` ${stateCode} `) && sourceName.includes(city.split(" ")[0] || city)) return true;

  return getLocalAliasTerms(place).some((alias) => {
    const normalized = normalizeLocalMatchText(alias);
    return normalized && haystack.includes(normalized);
  });
}

function resolveLocalRequestPlace(city, state) {
  return resolveLocalPlaceInput({
    city,
    state,
    placesIndex,
    stateNameByCode,
  });
}

function recordLocalHealth({
  query,
  place,
  itemCount = 0,
  sourceCount = 0,
  summaryHealth = null,
  summaryResearch = null,
  error = null,
}) {
  localHealthStats = {
    requests: localHealthStats.requests + 1,
    emptyResponses: localHealthStats.emptyResponses + (itemCount === 0 ? 1 : 0),
    lastQuery: query || "",
    lastResolvedPlace: place?.display || place?.name || "",
    lastResultCount: itemCount,
    lastSourceCount: sourceCount,
    lastError: error ? String(error.message || error) : null,
    lastSummaryHealth: summaryHealth,
    lastSummaryResearch: summaryResearch,
    lastAudienceIntelligence: summaryHealth?.audienceIntelligence || null,
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchLocalNews(place) {
  const city = String(place?.name || "").trim();
  const state = String(place?.state || "").trim();
  const key = `${city}|${state}`.toLowerCase();
  const cached = localCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < REFRESH_MINUTES * 60 * 1000) {
    return cached.payload;
  }

  const variants = buildLocalQueryVariants(city, state, stateNameByCode);
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

  const locallyRelevant = collected.filter((item) => hasLocalRelevance(item, place));
  const deduped = dedupeItems(locallyRelevant);
  const recent = deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const diversified = diversifyBySource(recent, {
    maxPerSource: LOCAL_SOURCE_CAP,
    limit: LOCAL_POOL_LIMIT,
  });
  const localSummaryResearchStats = createSummaryResearchStats();
  await hydrateSummaryResearch(diversified, {
    cache: summaryResearchCache,
    stats: localSummaryResearchStats,
    limit: diversified.length,
    concurrency: 3,
    enableTopicResearch: false,
  });
  const summarized = applyLiveNewsSummariesToItems(diversified);
  const summaryHealth = getSummaryHealth(summarized);

  const payload = {
    updatedAt: new Date().toISOString(),
    items: summarized,
    query: place.display || [city, state].filter(Boolean).join(", "),
    place,
    variants,
    sourceCount: new Set(summarized.map((item) => item.sourceName)).size,
    summaryHealth,
    audienceIntelligence: summaryHealth.audienceIntelligence,
    summaryResearch: localSummaryResearchStats,
    diagnostics: {
      queryVariants: variants.length,
      feedSuccesses: feeds.filter((result) => result.status === "fulfilled").length,
      feedFailures: feeds.filter((result) => result.status === "rejected").length,
      collectedItems: collected.length,
      dedupedItems: deduped.length,
      diversifiedItems: summarized.length,
      summaryResearchReady: localSummaryResearchStats.ready,
      summaryFallbacks: summaryHealth.fallbackCount,
      audiencePatterned: summaryHealth.audienceIntelligence?.patternedCount || 0,
    },
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
  resetImageQualityStats();
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
  const topStoryKeys = new Set(cache.topStories.map(getStoryIdentityKey));
  const feedCandidates = recent.filter((item) => !topStoryKeys.has(getStoryIdentityKey(item)));
  cache.feed = diversifyBySource(feedCandidates, {
    maxPerSource: Math.max(12, Math.ceil(FEED_LIMIT / 6)),
    limit: FEED_LIMIT,
  });
  await hydrateSummaryResearchForItems([...cache.topStories, ...cache.feed]);
  await hydrateArticleImages([...cache.topStories, ...cache.feed]);
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
    return enrichNewsPayloadWithApprovedStories(applyLiveNewsSummariesToPayload({
      updatedAt: new Date().toISOString(),
      maxAgeHours: MAX_AGE_HOURS,
      fallback: true,
      limits: {
        topStories: TOP_STORIES_LIMIT,
        feed: FEED_LIMIT,
      },
      ...fallback,
    }));
  }

  return enrichNewsPayloadWithApprovedStories(applyLiveNewsSummariesToPayload({
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
  }));
}

function getUniqueCurrentNewsItems(payload = buildCurrentNewsPayload()) {
  const seen = new Set();
  return [...(payload.topStories || []), ...(payload.feed || [])].filter((item) => {
    const key = item.id || item.link || `${item.title}:${item.publishedAt}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSummaryReviewQueue(payload = buildCurrentNewsPayload()) {
  return getUniqueCurrentNewsItems(payload)
    .filter(
      (item) =>
        item.liveNewsSummary === FALLBACK_SUMMARY ||
        item.summaryAgent?.supervisor?.status === "needs_editor_review"
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      sourceName: item.sourceName,
      category: item.category,
      publishedAt: item.publishedAt,
      link: item.link,
      currentSummary: item.liveNewsSummary,
      rawSummary: item.summary || "",
      failures: item.summaryAgent?.supervisor?.failures || item.summaryAgent?.failures || [],
      supervisor: item.summaryAgent?.supervisor || {},
      research: {
        status: item.summaryResearch?.status || "missing",
        facts: item.summaryResearch?.facts || [],
        stages: item.summaryResearch?.stages || [],
        sourceUrl: item.summaryResearch?.sourceUrl || "",
      },
    }));
}

function requireSummaryAdmin(req, res, next) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Cache-Control", "no-store");
  const provided = req.get("x-live-news-admin-key") || req.query.key || "";
  if (!SUMMARY_ADMIN_TOKEN || provided !== SUMMARY_ADMIN_TOKEN) {
    return res.status(401).type("text/plain").send("Private Live News editor area.");
  }
  return next();
}

function renderSummaryReviewPage(payload = buildCurrentNewsPayload()) {
  const queue = getSummaryReviewQueue(payload);
  const health = payload.summaryHealth || {};
  const rows = queue
    .slice(0, 120)
    .map((item) => {
      const facts = (item.research.facts || [])
        .slice(0, 3)
        .map((fact) => `<li>${escapeHtml(fact)}</li>`)
        .join("");
      const failures = (item.failures || []).map((failure) => escapeHtml(failure)).join(", ") || "Needs review";
      return `
        <article class="admin-review-card">
          <p class="eyebrow">${escapeHtml(item.category || "Story")} • ${escapeHtml(item.sourceName || "Source")}</p>
          <h2><a href="${escapeHtml(item.link || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || "Untitled story")}</a></h2>
          <p><strong>Current public summary:</strong> ${escapeHtml(item.currentSummary || "")}</p>
          <p><strong>Why flagged:</strong> ${failures}</p>
          <p><strong>Research status:</strong> ${escapeHtml(item.research.status)}</p>
          ${facts ? `<ul>${facts}</ul>` : `<p>No usable research facts captured yet.</p>`}
        </article>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <title>Live News Summary Review</title>
  <style>
    body { margin: 0; background: #eef3f8; color: #101827; font-family: Georgia, "Times New Roman", serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 18px; }
    .panel, .admin-review-card { background: #fff; border: 1px solid #c8d6e6; border-radius: 18px; padding: 18px; margin: 0 0 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .metric { background: #f6f8fb; border: 1px solid #d8e3ef; border-radius: 14px; padding: 12px; }
    .metric strong { display: block; font-size: 1.65rem; }
    h1, h2, p { margin-top: 0; }
    h2 { font-size: 1.15rem; }
    a { color: #0b5f8f; }
    .eyebrow { color: #5b708b; font-size: 0.78rem; letter-spacing: .08em; text-transform: uppercase; }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <p class="eyebrow">Private editor dashboard</p>
      <h1>Live News Summary Review</h1>
      <p>This page is private, noindex, and only available with the editor key. It is not linked from public navigation or the sitemap.</p>
      <div class="grid">
        <div class="metric"><strong>${Number(health.checkedCount || 0)}</strong> checked</div>
        <div class="metric"><strong>${Number(health.humanSummaryCount || 0)}</strong> public summaries</div>
        <div class="metric"><strong>${Number(health.supervisedCount || 0)}</strong> teacher rescues</div>
        <div class="metric"><strong>${queue.length}</strong> needs review</div>
      </div>
    </section>
    ${rows || '<section class="panel"><h2>No summary review items right now.</h2></section>'}
  </main>
</body>
</html>`;
}

function readPublicHtml(fileName) {
  return fs.readFileSync(path.join(__dirname, "public", fileName), "utf8");
}

function formatCrawlerTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCrawlerDateBadge(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getCrawlerTitle(item) {
  return item.liveNewsHeadline || item.title || "Untitled story";
}

function getCrawlerSummary(item) {
  return (
    item.liveNewsSummary ||
    item.summaryShort ||
    "Read the original source for the full report."
  );
}

function getCrawlerCategory(item) {
  return item.category || "Top";
}

function getCrawlerSourceName(item) {
  return item.sourceName || item.source || item.sourceDomain || "Source";
}

function renderCrawlerSourceLink(item) {
  const source = getCrawlerSourceName(item);
  if (!item.link) return `<span>${escapeHtml(source)}</span>`;
  return `<a class="story-source-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>`;
}

function renderCrawlerMeta(item) {
  const category = getCrawlerCategory(item);
  const time = formatCrawlerTime(item.publishedAt);
  const timeHtml = time
    ? `<time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(time)}</time>`
    : `<span>Time unavailable</span>`;
  return `
    <div class="story-meta">
      ${renderCrawlerSourceLink(item)} • ${escapeHtml(category)} • ${timeHtml}
    </div>
  `;
}

function renderCrawlerTitleLink(item, className = "") {
  const title = escapeHtml(getCrawlerTitle(item));
  const href = item.approvedStoryUrl || item.liveNewsUrl || item.link || "";
  if (!href) return `<span class="${className}">${title}</span>`;
  const isSource = href === item.link;
  const target = isSource ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<a class="${className}" href="${escapeHtml(href)}"${target}>${title}</a>`;
}

function renderCrawlableLeadCard(item) {
  if (!item) return "";
  return `
    <article class="lead-card" data-article-id="${escapeHtml(item.id || "")}">
      <div class="lead-copy">
        <div class="story-eyebrow">
          <span>${escapeHtml(formatCrawlerDateBadge(item.publishedAt))}</span>
        </div>
        <h1>${renderCrawlerTitleLink(item, "lead-title")}</h1>
        <p>${escapeHtml(getCrawlerSummary(item))}</p>
        ${renderCrawlerMeta(item)}
      </div>
    </article>
  `;
}

function renderCrawlableStoryCard(item, rank = 1) {
  return `
    <li class="story-card" data-article-id="${escapeHtml(item.id || "")}">
      <div class="story-card-top">
        <span class="story-rank">${rank}</span>
        <div class="story-eyebrow">
          <span>${escapeHtml(formatCrawlerDateBadge(item.publishedAt))}</span>
        </div>
      </div>
      <h3>${renderCrawlerTitleLink(item, "story-card-title")}</h3>
      <p>${escapeHtml(getCrawlerSummary(item))}</p>
      ${renderCrawlerMeta(item)}
    </li>
  `;
}

function renderCrawlableFeedItem(item) {
  return `
    <article class="feed-item" data-article-id="${escapeHtml(item.id || "")}">
      <div class="feed-item-main">
        <div class="story-eyebrow">
          <span>${escapeHtml(formatCrawlerDateBadge(item.publishedAt))}</span>
        </div>
        <div class="feed-title">${renderCrawlerTitleLink(item)}</div>
        <p>${escapeHtml(getCrawlerSummary(item))}</p>
        ${renderCrawlerMeta(item)}
      </div>
    </article>
  `;
}

function renderCrawlableHomepage() {
  const html = readPublicHtml("index.html");
  const payload = buildCurrentNewsPayload();
  const leadItem = (payload.topStories || [])[0] || null;
  const topCards = (payload.topStories || []).slice(1, TOP_STORIES_LIMIT);
  const topIds = new Set((payload.topStories || []).map((item) => item.id).filter(Boolean));
  const feedCards = (payload.feed || [])
    .filter((item) => !topIds.has(item.id))
    .slice(0, 50);

  return html
    .replace(
      '<section class="lead-news-band" id="leadStory" aria-label="Lead news story"></section>',
      `<section class="lead-news-band" id="leadStory" aria-label="Lead news story">${renderCrawlableLeadCard(leadItem)}</section>`
    )
    .replace(
      '<ol class="story-list" id="topStories"></ol>',
      `<ol class="story-list" id="topStories">${topCards.map((item, index) => renderCrawlableStoryCard(item, index + 2)).join("")}</ol>`
    )
    .replace(
      '<div class="feed" id="newsFeed"></div>',
      `<div class="feed" id="newsFeed">${feedCards.map(renderCrawlableFeedItem).join("")}</div>`
    )
    .replace("</head>", `    <link rel="canonical" href="${escapeHtml(getCanonicalUrl("/"))}" />\n  </head>`);
}

function renderCanonicalStaticPage(fileName, canonicalPath) {
  return readPublicHtml(fileName).replace(
    "</head>",
    `    <link rel="canonical" href="${escapeHtml(getCanonicalUrl(canonicalPath))}" />\n  </head>`
  );
}

function renderPageShell({ canonicalPath, title, description, kicker, h1, bodyHtml = "" }) {
  const canonicalUrl = getCanonicalUrl(canonicalPath);
  return `<!doctype html>
<html lang="en" data-theme="day">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Newsreader:wght@400;600;700&family=Space+Grotesk:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/" aria-label="Live News home">
        <img class="brand-mark" src="/brand-mark.png" alt="" aria-hidden="true" />
        <div class="brand-text">
          <div class="brand-title">Live News</div>
          <div class="brand-sub">Anytime &amp; Anywhere</div>
        </div>
      </a>
    </header>
    <main class="search-page">
      <section class="panel search-hero">
        <span class="tag">${escapeHtml(kicker || "Live News")}</span>
        <h1>${escapeHtml(h1)}</h1>
        <p>${escapeHtml(description)}</p>
      </section>
      ${bodyHtml}
    </main>
    <footer class="footer">
      <div>Live News • Source-linked coverage • Local pages • No ads</div>
      <div class="footer-note">
        <a href="/about">About</a> •
        <a href="/editorial-policy">Editorial Policy</a> •
        <a href="/sources">Sources</a> •
        <a href="/privacy">Privacy</a> •
        <a href="/contact">Contact</a>
      </div>
    </footer>
  </body>
</html>`;
}

function renderCrawlerList(items) {
  if (!items.length) {
    return `
      <div class="search-empty-card">
        Live News will fill this page as fresh, source-linked coverage is available.
      </div>
    `;
  }
  return `<div class="feed">${items.map(renderCrawlableFeedItem).join("")}</div>`;
}

function renderNewsIndexPage({ canonicalPath, title, description, h1, kicker, items }) {
  return renderPageShell({
    canonicalPath,
    title,
    description,
    h1,
    kicker,
    bodyHtml: `
      <section class="panel search-results-panel">
        <div class="panel-header">
          <h2>${escapeHtml(h1)} stories</h2>
          <span class="tag">${escapeHtml(String(items.length))} visible</span>
        </div>
        ${renderCrawlerList(items)}
      </section>
    `,
  });
}

function renderLatestPage() {
  const payload = buildCurrentNewsPayload();
  const items = (payload.feed || []).slice(0, FEED_LIMIT);
  return renderNewsIndexPage({
    canonicalPath: "/latest",
    title: "Latest News Feed | Live News",
    description:
      "Browse the latest Live News feed with readable summaries, timestamps, attribution, and original source links.",
    h1: "Latest News Feed",
    kicker: "Fresh source-linked coverage",
    items,
  });
}

function renderTopStoriesPage() {
  const payload = buildCurrentNewsPayload();
  const items = (payload.topStories || []).slice(0, TOP_STORIES_LIMIT);
  return renderNewsIndexPage({
    canonicalPath: "/top-stories",
    title: "Top Stories | Live News",
    description:
      "Browse the eight most important Live News top stories with source-respectful summaries and original publisher links.",
    h1: "Top Stories",
    kicker: "Top 8",
    items,
  });
}

function getCategoryRouteConfig(slug) {
  const key = String(slug || "").trim().toLowerCase();
  return CATEGORY_ROUTE_CONFIG[key] ? { slug: key, ...CATEGORY_ROUTE_CONFIG[key] } : null;
}

function getCategorySlugFromValue(value) {
  const requested = String(value || "").trim().toLowerCase();
  return (
    Object.entries(CATEGORY_ROUTE_CONFIG).find(([, config]) => {
      return (
        config.label.toLowerCase() === requested ||
        config.apiCategory.toLowerCase() === requested
      );
    })?.[0] || "national"
  );
}

function renderCategoryRoutePage(slug) {
  const config = getCategoryRouteConfig(slug);
  if (!config) return "";
  const payload = buildCurrentNewsPayload();
  const allItems = getUniqueCurrentNewsItems(payload);
  const items = allItems
    .filter((item) => item.category === config.apiCategory)
    .slice(0, 75);
  return renderNewsIndexPage({
    canonicalPath: `/category/${config.slug}`,
    title: `${config.label} News | Live News`,
    description: config.description,
    h1: `${config.label} News`,
    kicker: "Category coverage",
    items,
  });
}

function renderInfoPage(slug) {
  const page = STATIC_INFO_PAGES[slug];
  if (!page) return "";
  const paragraphs = page.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  return renderPageShell({
    canonicalPath: `/${slug}`,
    title: `${page.title} | Live News`,
    description: page.description,
    h1: page.heading,
    kicker: page.kicker,
    bodyHtml: `
      <section class="panel search-results-panel">
        <div class="story-section">
          ${paragraphs}
        </div>
      </section>
    `,
  });
}

function renderSourcesPage() {
  const sources = loadSources();
  const sourceCards = sources
    .map(
      (source) => `
        <article class="search-empty-card">
          <strong>${escapeHtml(source.name || source.url || "News source")}</strong>
          <span>${escapeHtml(source.category || "General")} coverage • weight ${escapeHtml(source.weight || "1")}</span>
        </article>
      `
    )
    .join("");
  return renderPageShell({
    canonicalPath: "/sources",
    title: "Live News Sources | Live News",
    description:
      "See how Live News uses official feeds, recent reporting, local search results, attribution, and original source links.",
    h1: "Sources",
    kicker: "Attribution and original links",
    bodyHtml: `
      <section class="panel search-results-panel">
        <div class="story-section">
          <p>Live News organizes current coverage from configured feeds, local search results, and source-linked reporting while keeping original publisher links visible.</p>
          <p>The sitemap lists only Live News pages. External publisher URLs stay on article cards for attribution and verification.</p>
        </div>
        <div class="search-results">
          ${sourceCards}
        </div>
      </section>
    `,
  });
}

function normalizeCategorySection(value) {
  const requested = String(value || "").trim().toLowerCase();
  return CATEGORY_SECTIONS.find((category) => category.toLowerCase() === requested) || "";
}

function serializeNewsResultItem(item, extra = {}) {
  const summary = summarizeSearchResult(item);
  return {
    id: item.id,
    title: item.liveNewsHeadline || item.title,
    summary,
    liveNewsSummary: summary,
    category: item.category || "Top",
    sourceName: item.sourceName || item.source || "Source",
    sourceDomain: item.sourceDomain || getDomain(item.link || ""),
    publishedAt: item.publishedAt || "",
    link: item.link || "",
    liveNewsUrl: item.approvedStoryUrl || item.liveNewsUrl || "",
    imageUrl: pickAuthenticArticleImageUrl([item.imageUrl, item.thumbnailUrl]),
    imageSource: item.imageSource || "",
    imageSourceUrl: item.imageSourceUrl || "",
    imageCredit: item.imageCredit || "",
    imageAlt: item.imageAlt || "",
    imageResearchQuery: item.imageResearchQuery || "",
    hasLiveNewsStory: Boolean(item.hasLiveNewsStory || item.approvedStoryUrl || item.liveNewsUrl),
    ...extra,
  };
}

function tokenizeSearchQuery(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !EVENT_STOPWORDS.has(word));
}

function getSearchText(item) {
  return [
    item.title,
    item.liveNewsHeadline,
    item.summary,
    item.liveNewsSummary,
    item.sourceName,
    item.source,
    item.sourceDomain,
    item.category,
    item.relatedSources?.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function summarizeSearchResult(item) {
  const summary = item.liveNewsSummary || item.summary || "";
  return buildSummary(summary, 180);
}

async function searchCurrentNews(query, limit = 30) {
  const cleanQuery = String(query || "").trim();
  const tokens = tokenizeSearchQuery(cleanQuery);
  if (!cleanQuery || tokens.length === 0) {
    return {
      query: cleanQuery,
      count: 0,
      items: [],
    };
  }

  const pool = getUniqueCurrentNewsItems();

  const scored = pool
    .map((item) => {
      const haystack = getSearchText(item);
      const title = String(item.liveNewsHeadline || item.title || "").toLowerCase();
      const source = String(item.sourceName || item.source || "").toLowerCase();
      const category = String(item.category || "").toLowerCase();
      let relevance = 0;
      tokens.forEach((token) => {
        if (title.includes(token)) relevance += 8;
        if (source.includes(token)) relevance += 4;
        if (category.includes(token)) relevance += 4;
        if (haystack.includes(token)) relevance += 2;
      });
      return { item, relevance };
    })
    .filter((entry) => entry.relevance > 0)
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        Number(b.item.score || 0) - Number(a.item.score || 0) ||
        new Date(b.item.publishedAt || 0) - new Date(a.item.publishedAt || 0)
    );

  const limitedScored = scored.slice(0, limit);
  await hydrateArticleImages(limitedScored.map(({ item }) => item), {
    limit: Math.min(limit, IMAGE_LOOKUP_LIMIT),
  });

  return {
    query: cleanQuery,
    count: scored.length,
    items: limitedScored.map(({ item, relevance }) => serializeNewsResultItem(item, { relevance })),
  };
}

async function getCategoryNews(category, limit = 60) {
  const normalizedCategory = normalizeCategorySection(category);
  if (!normalizedCategory) {
    return {
      category: "",
      allowedCategories: CATEGORY_SECTIONS,
      count: 0,
      items: [],
    };
  }

  const items = getUniqueCurrentNewsItems()
    .filter((item) => item.category === normalizedCategory)
    .sort(
      (a, b) =>
        new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) ||
        Number(b.score || 0) - Number(a.score || 0) ||
        (b.sourceCount || 1) - (a.sourceCount || 1)
    );
  const limited = items.slice(0, limit);
  await hydrateArticleImages(limited, {
    limit: Math.min(limit, IMAGE_LOOKUP_LIMIT),
  });

  return {
    category: normalizedCategory,
    allowedCategories: CATEGORY_SECTIONS,
    count: items.length,
    items: limited.map((item) => serializeNewsResultItem(item)),
  };
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

function getCanonicalOrigin() {
  return String(process.env.PUBLIC_SITE_URL || PUBLIC_CANONICAL_ORIGIN).trim().replace(/\/$/, "");
}

function getCanonicalUrl(pathname) {
  return absoluteUrl(getCanonicalOrigin(), pathname);
}

function renderSitemap() {
  const origin = getCanonicalOrigin();
  const now = new Date().toISOString();
  const body = SITEMAP_STABLE_PAGES
    .map(
      (url) => `  <url>
    <loc>${escapeHtml(absoluteUrl(origin, url.path))}</loc>
    <lastmod>${escapeHtml(url.lastmod || now)}</lastmod>
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

function renderNewsSitemap() {
  const stories = listApprovedStories();
  if (!stories.length) return "";
  const origin = getCanonicalOrigin();
  const body = stories
    .map((story) => {
      const loc = story.liveNewsUrl || `/stories/${story.slug}`;
      const lastmod = story.updatedAt || story.publishedAt || story.approvedAt || new Date().toISOString();
      return `  <url>
    <loc>${escapeHtml(absoluteUrl(origin, loc))}</loc>
    <lastmod>${escapeHtml(lastmod)}</lastmod>
  </url>`;
    })
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
  res.type("application/xml").send(renderSitemap());
});

app.get("/news-sitemap.xml", (req, res) => {
  const xml = renderNewsSitemap();
  if (!xml) return res.status(404).type("text/plain").send("No internal Live News story pages are public yet.");
  return res.type("application/xml").send(xml);
});

app.get("/stories/:slug", (req, res) => {
  const story = findApprovedStoryBySlug(req.params.slug);
  if (!story) {
    return res.status(404).send(renderStoryNotFoundPage());
  }
  res.send(renderPublicStoryPage(story, { origin: getPublicBaseUrl(req) }));
});

app.get("/index.html", (req, res) => {
  res.redirect(301, "/");
});

app.get("/", (req, res) => {
  res.type("html").send(renderCrawlableHomepage(req));
});

app.get("/local.html", (req, res) => {
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/local${query}`);
});

app.get("/local", (req, res) => {
  res.type("html").send(renderCanonicalStaticPage("local.html", "/local"));
});

app.get("/latest", (req, res) => {
  res.type("html").send(renderLatestPage());
});

app.get("/top-stories", (req, res) => {
  res.type("html").send(renderTopStoriesPage());
});

app.get("/category.html", (req, res) => {
  res.redirect(301, `/category/${getCategorySlugFromValue(req.query.category)}`);
});

app.get("/category/:slug", (req, res, next) => {
  const html = renderCategoryRoutePage(req.params.slug);
  if (!html) return next();
  return res.type("html").send(html);
});

app.get("/sources", (req, res) => {
  res.type("html").send(renderSourcesPage());
});

app.get(["/about", "/editorial-policy", "/privacy", "/contact"], (req, res) => {
  const slug = req.path.replace(/^\//, "");
  const html = renderInfoPage(slug);
  if (!html) return res.status(404).send("Not found");
  return res.type("html").send(html);
});

app.get("/admin/summaries", requireSummaryAdmin, (req, res) => {
  res.type("html").send(renderSummaryReviewPage());
});

app.get("/api/internal/summary-review", requireSummaryAdmin, (req, res) => {
  const payload = buildCurrentNewsPayload();
  res.json({
    updatedAt: payload.updatedAt,
    summaryHealth: payload.summaryHealth,
    audienceIntelligence: payload.summaryHealth?.audienceIntelligence,
    summaryResearch: summaryResearchStats,
    reviewQueue: getSummaryReviewQueue(payload),
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/news", (req, res) => {
  res.json(buildCurrentNewsPayload());
});

app.get("/api/search", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 75);
  const results = await searchCurrentNews(req.query.q, limit);
  res.json({
    updatedAt: new Date().toISOString(),
    ...results,
  });
});

app.get("/api/category", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 60), 1), 100);
  const results = await getCategoryNews(req.query.category, limit);
  res.status(results.category ? 200 : 400).json({
    updatedAt: new Date().toISOString(),
    ...results,
  });
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
  const place = resolveLocalRequestPlace(city, state);
  if (!place.name) {
    const payload = {
      updatedAt: new Date().toISOString(),
      items: [],
      place,
      query: "",
      variants: [],
      sourceCount: 0,
    };
    recordLocalHealth({ query: "", place, itemCount: 0, sourceCount: 0 });
    return res.json(payload);
  }
  try {
    const payload = await fetchLocalNews(place);
    recordLocalHealth({
      query: payload.query,
      place: payload.place,
      itemCount: payload.items.length,
      sourceCount: payload.sourceCount,
      summaryHealth: payload.summaryHealth,
      summaryResearch: payload.summaryResearch,
    });
    res.json(payload);
  } catch (error) {
    recordLocalHealth({
      query: place.display || city,
      place,
      itemCount: 0,
      sourceCount: 0,
      error,
    });
    res.json({
      updatedAt: new Date().toISOString(),
      items: [],
      place,
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
  const currentPayload = buildCurrentNewsPayload();
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
    summaryHealth: currentPayload.summaryHealth,
    audienceIntelligence: currentPayload.summaryHealth?.audienceIntelligence,
    summaryResearch: summaryResearchStats,
    imageResearch: imageQualityStats,
    localNews: localHealthStats,
    places: placesMeta.totalPlaces,
  });
});

refreshNewsSafely();
setInterval(refreshNewsSafely, REFRESH_MINUTES * 60 * 1000);
loadPlaces();

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
