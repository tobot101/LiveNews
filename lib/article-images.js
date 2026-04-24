const DECORATIVE_HOST_RULES = [
  (url) => url.hostname.includes("google.com") && url.pathname.includes("/s2/favicons"),
  (url) => url.hostname.includes("gstatic.com") && url.pathname.toLowerCase().includes("favicon"),
  (url) => url.hostname.includes("favicon"),
  (url) => url.hostname === "logo.clearbit.com",
  (url) => url.hostname === "icons.duckduckgo.com",
];

const DECORATIVE_PATH_PATTERNS = [
  /(^|[\/_.-])favicon(s)?([\/_.-]|$)/,
  /(^|[\/_.-])apple-touch-icon([\/_.-]|$)/,
  /(^|[\/_.-])mstile([\/_.-]|$)/,
  /(^|[\/_.-])site[-_]?logo([\/_.-]|$)/,
  /(^|[\/_.-])publisher[-_]?logo([\/_.-]|$)/,
  /(^|[\/_.-])brand[-_]?mark([\/_.-]|$)/,
  /(^|[\/_.-])logo([\/_.-]|$)/,
  /(^|[\/_.-])icon([\/_.-]|$)/,
  /(^|[\/_.-])avatar([\/_.-]|$)/,
];

const SMALL_DIMENSION_KEYS = new Set([
  "h",
  "height",
  "s",
  "size",
  "sz",
  "w",
  "width",
]);

const MIN_ARTICLE_IMAGE_EDGE = 220;

function normalizeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function hasSmallDimensionHint(url) {
  const hintedDimensions = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!SMALL_DIMENSION_KEYS.has(key.toLowerCase())) continue;
    const number = Number(String(value).match(/\d{2,4}/)?.[0] || 0);
    if (number) hintedDimensions.push(number);
  }

  const compactPairs = `${url.pathname} ${url.search}`.matchAll(
    /(?:^|[^\d])(\d{2,4})x(\d{2,4})(?:[^\d]|$)/gi
  );
  for (const match of compactPairs) {
    hintedDimensions.push(Number(match[1]), Number(match[2]));
  }

  return hintedDimensions.some((dimension) => dimension > 0 && dimension < MIN_ARTICLE_IMAGE_EDGE);
}

function getArticleImageRejectionReason(value) {
  const normalized = normalizeImageUrl(value);
  if (!normalized) return "missing or invalid image URL";

  const url = new URL(normalized);
  const path = decodeURIComponent(url.pathname || "").toLowerCase();
  const pathAndQuery = decodeURIComponent(`${url.pathname || ""} ${url.search || ""}`).toLowerCase();

  if (DECORATIVE_HOST_RULES.some((rule) => rule(url))) {
    return "decorative image host";
  }

  if (path.endsWith(".svg") || path.endsWith(".ico")) {
    return "icon file type";
  }

  if (DECORATIVE_PATH_PATTERNS.some((pattern) => pattern.test(pathAndQuery))) {
    return "decorative logo or icon path";
  }

  if (hasSmallDimensionHint(url)) {
    return "image dimensions look too small for an article visual";
  }

  return "";
}

function isAuthenticArticleImageUrl(value) {
  return !getArticleImageRejectionReason(value);
}

function pickAuthenticArticleImageUrl(candidates) {
  for (const candidate of candidates || []) {
    const normalized = normalizeImageUrl(candidate);
    if (normalized && isAuthenticArticleImageUrl(normalized)) return normalized;
  }
  return "";
}

module.exports = {
  getArticleImageRejectionReason,
  isAuthenticArticleImageUrl,
  normalizeImageUrl,
  pickAuthenticArticleImageUrl,
};
