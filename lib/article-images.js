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
const STRONG_ARTICLE_IMAGE_WIDTH = 320;
const STRONG_ARTICLE_IMAGE_HEIGHT = 180;
const STRONG_ARTICLE_IMAGE_AREA = 90000;

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
  const hints = getImageDimensionHints(url.toString());
  return [hints.width, hints.height].some(
    (dimension) => dimension > 0 && dimension < MIN_ARTICLE_IMAGE_EDGE
  );
}

function getImageDimensionHints(value) {
  const normalized = normalizeImageUrl(value);
  if (!normalized) return {};
  const url = new URL(normalized);
  const hintedDimensions = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!SMALL_DIMENSION_KEYS.has(key.toLowerCase())) continue;
    const number = Number(String(value).match(/\d{2,4}/)?.[0] || 0);
    if (number) {
      hintedDimensions.push({
        key: key.toLowerCase(),
        value: number,
      });
    }
  }

  const width =
    hintedDimensions.find((entry) => ["w", "width"].includes(entry.key))?.value ||
    hintedDimensions.find((entry) => ["s", "size", "sz"].includes(entry.key))?.value ||
    0;
  const height =
    hintedDimensions.find((entry) => ["h", "height"].includes(entry.key))?.value ||
    hintedDimensions.find((entry) => ["s", "size", "sz"].includes(entry.key))?.value ||
    0;

  const text = `${url.pathname} ${url.search}`;
  const compactPairs = text.matchAll(
    /(?:^|[^\d])(\d{1,4})x(\d{1,4})(?:[^\d]|$)/gi
  );
  for (const match of compactPairs) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first >= 80 && second >= 80) {
      return {
        width: first,
        height: second,
      };
    }
    if (width >= STRONG_ARTICLE_IMAGE_WIDTH && first > 0 && second > 0 && first <= 40 && second <= 40) {
      return {
        width,
        height: Math.round((width * second) / first),
      };
    }
  }

  return {
    width,
    height,
  };
}

function isStrongArticleImageSize(width, height) {
  const safeWidth = Number(width || 0);
  const safeHeight = Number(height || 0);
  return (
    safeWidth >= STRONG_ARTICLE_IMAGE_WIDTH &&
    safeHeight >= STRONG_ARTICLE_IMAGE_HEIGHT &&
    safeWidth * safeHeight >= STRONG_ARTICLE_IMAGE_AREA
  );
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
  getImageDimensionHints,
  isAuthenticArticleImageUrl,
  isStrongArticleImageSize,
  normalizeImageUrl,
  pickAuthenticArticleImageUrl,
};
