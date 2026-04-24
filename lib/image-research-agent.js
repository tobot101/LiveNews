const {
  isAuthenticArticleImageUrl,
  isStrongArticleImageSize,
  normalizeImageUrl,
} = require("./article-images");

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const DEFAULT_LIMIT = 5;
const QUERY_STOPWORDS = new Set([
  "about",
  "after",
  "amid",
  "and",
  "are",
  "big",
  "for",
  "from",
  "gets",
  "how",
  "into",
  "its",
  "live",
  "news",
  "plus",
  "says",
  "the",
  "this",
  "through",
  "update",
  "updates",
  "video",
  "watch",
  "with",
]);

const EVENT_TERMS = new Set([
  "earthquake",
  "fire",
  "flood",
  "flooding",
  "hurricane",
  "storm",
  "storms",
  "tornado",
  "tornadoes",
  "wildfire",
]);

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCredit(value) {
  return stripHtml(value)
    .replace(/\s*\|\s*/g, " ")
    .slice(0, 160)
    .trim();
}

function tokenizeQuery(value) {
  return String(value || "")
    .replace(/['’]s\b/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !QUERY_STOPWORDS.has(word.toLowerCase()));
}

function extractLocationNames(value) {
  const blocked = new Set([
    "Live",
    "More",
    "News",
    "Plains",
    "Thursday",
    "Today",
    "Tonight",
    "Top",
    "Watch",
  ]);
  return Array.from(String(value || "").matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g))
    .map((match) => match[0].trim())
    .filter((name) => {
      const lower = name.toLowerCase();
      const words = name.split(/\s+/);
      return (
        !words.some((word) => blocked.has(word)) &&
        !EVENT_TERMS.has(lower) &&
        !QUERY_STOPWORDS.has(lower)
      );
    })
    .slice(0, 5);
}

function hasSpecificResearchSignal(query) {
  const tokens = tokenizeQuery(query);
  return tokens.length >= 2 || tokens.some((token) => EVENT_TERMS.has(token.toLowerCase()));
}

function buildImageResearchQueries(item) {
  const title = String(item?.liveNewsHeadline || item?.title || "").trim();
  const summary = String(item?.liveNewsSummary || item?.summary || "").trim();
  const source = String(item?.sourceName || "").trim();
  const titleTokens = tokenizeQuery(title).slice(0, 9);
  const summaryTokens = tokenizeQuery(summary).slice(0, 6);
  const eventTerm = [...titleTokens, ...summaryTokens].find((token) =>
    EVENT_TERMS.has(token.toLowerCase())
  );
  const locationNames = extractLocationNames(title);
  if (!eventTerm && !locationNames.length) {
    return [];
  }
  const queries = [
    ...locationNames.map((location) => [location, eventTerm].filter(Boolean).join(" ")),
    eventTerm && locationNames.length
      ? [eventTerm, locationNames[0], "damage"].filter(Boolean).join(" ")
      : "",
    titleTokens.join(" "),
    [...titleTokens.slice(0, 5), ...summaryTokens.slice(0, 3)].join(" "),
    [item?.category, ...titleTokens.slice(0, 6)].filter(Boolean).join(" "),
    eventTerm ? `${eventTerm} damage` : "",
  ]
    .map((query) => query.trim())
    .filter(
      (query) =>
        query.length >= 8 &&
        query.toLowerCase() !== source.toLowerCase() &&
        hasSpecificResearchSignal(query)
    );

  return Array.from(new Set(queries)).slice(0, 3);
}

function getExtMetadataValue(info, key) {
  return stripHtml(info?.extmetadata?.[key]?.value || "");
}

function toCommonsCandidates(payload, query) {
  const pages = Object.values(payload?.query?.pages || {});
  const queryTokens = tokenizeQuery(query).map((token) => token.toLowerCase());
  return pages
    .map((page) => {
      const info = page.imageinfo?.[0] || {};
      const imageUrl = normalizeImageUrl(info.thumburl || info.url || "");
      const width = Number(info.thumbwidth || info.width || 0);
      const height = Number(info.thumbheight || info.height || 0);
      const credit =
        cleanCredit(getExtMetadataValue(info, "Artist")) ||
        cleanCredit(getExtMetadataValue(info, "Credit")) ||
        "Wikimedia Commons";
      const license =
        cleanCredit(getExtMetadataValue(info, "LicenseShortName")) ||
        cleanCredit(getExtMetadataValue(info, "UsageTerms"));
      return {
        imageUrl,
        imageSource: "public_media_research",
        imageSourceUrl: normalizeImageUrl(info.descriptionurl || ""),
        imageCredit: [credit, license].filter(Boolean).join(" • "),
        imageAlt: `Related public media for ${query}`,
        imageResearchQuery: query,
        width,
        height,
        mime: String(info.mime || ""),
        title: page.title || "",
      };
    })
    .filter((candidate) => {
      if (!candidate.imageUrl || !isAuthenticArticleImageUrl(candidate.imageUrl)) return false;
      if (!candidate.mime.startsWith("image/") || candidate.mime.includes("svg")) return false;
      const candidateText = `${candidate.title} ${candidate.imageCredit}`.toLowerCase();
      if (queryTokens.length && !queryTokens.some((token) => candidateText.includes(token))) {
        return false;
      }
      return isStrongArticleImageSize(candidate.width, candidate.height);
    });
}

async function searchCommonsForImages(query, options = {}) {
  if (typeof fetch !== "function" || typeof AbortController !== "function") return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 1800));
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: query,
    gsrlimit: String(Number(options.limit || DEFAULT_LIMIT)),
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "1200",
    format: "json",
    origin: "*",
  });

  try {
    const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "LiveNewsBot/1.0 (+https://newsmorenow.com)",
      },
    });
    if (!response.ok) return [];
    return toCommonsCandidates(await response.json(), query);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function researchPublicMediaImage(item, options = {}) {
  for (const query of buildImageResearchQueries(item)) {
    const candidates = await searchCommonsForImages(query, options);
    if (candidates.length) {
      return candidates[0];
    }
  }
  return null;
}

module.exports = {
  buildImageResearchQueries,
  researchPublicMediaImage,
  searchCommonsForImages,
};
