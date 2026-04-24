const crypto = require("crypto");

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "amid",
  "among",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "but",
  "can",
  "could",
  "from",
  "have",
  "into",
  "latest",
  "live",
  "more",
  "news",
  "over",
  "said",
  "says",
  "than",
  "that",
  "the",
  "their",
  "this",
  "through",
  "under",
  "update",
  "updates",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(value, length = 16) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function slugify(value) {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "story";
}

function splitSentences(value) {
  const clean = cleanText(value);
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function titleCase(value) {
  return cleanText(value)
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 2) return word.toLowerCase();
      return `${word[0].toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function extractFocusPhrase(title, category = "") {
  const tokens = tokenize(title).slice(0, 7);
  if (tokens.length >= 3) {
    return titleCase(tokens.join(" "));
  }
  const clean = cleanText(title).replace(/^(live updates?|breaking|watch):?\s+/i, "");
  if (clean) return titleCase(clean.split(/\s+/).slice(0, 7).join(" "));
  return `${category || "Top"} Story`;
}

module.exports = {
  cleanText,
  clamp,
  extractFocusPhrase,
  getDomain,
  slugify,
  splitSentences,
  stableHash,
  titleCase,
  tokenize,
  uniqueBy,
};
