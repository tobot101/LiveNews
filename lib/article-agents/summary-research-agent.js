const { cleanText, splitSentences, stableHash, tokenize } = require("./text-utils");

const SUMMARY_RESEARCH_VERSION = "live-news-summary-research-v1";
const DEFAULT_TIMEOUT_MS = 1800;
const DEFAULT_MAX_HTML_BYTES = 280000;
const DEFAULT_MAX_FACTS = 8;
const TOPIC_RESEARCH_LIMIT = 5;
const BOILERPLATE_PATTERNS = [
  /accept cookies/i,
  /advertisement/i,
  /all rights reserved/i,
  /already have an account/i,
  /click here/i,
  /cookie policy/i,
  /copyright/i,
  /download our app/i,
  /follow us/i,
  /newsletter/i,
  /privacy policy/i,
  /sign in/i,
  /sign up/i,
  /subscribe/i,
  /terms of service/i,
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;|&mdash;/g, " - ")
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&lsquo;|&#8216;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return Number.isFinite(number) ? String.fromCharCode(number) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isFinite(number) ? String.fromCharCode(number) : "";
    });
}

function cleanEvidenceText(value) {
  return cleanText(decodeHtml(value))
    .replace(/\s*\|\s*[^|]{2,80}$/g, "")
    .replace(/\s+-\s+[^-]{2,80}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTagAttributes(tag) {
  const attrs = {};
  for (const match of String(tag || "").matchAll(/([:@\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] || match[3] || match[4] || "");
  }
  return attrs;
}

function extractMetaMap(html) {
  const meta = {};
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = getTagAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    const value = attrs.content || "";
    if (!key || !value || meta[key]) continue;
    meta[key] = cleanEvidenceText(value);
  }
  return meta;
}

function extractTitle(html) {
  const title = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return cleanEvidenceText(title);
}

function collectJsonLdEvidence(value, bucket) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonLdEvidence(entry, bucket));
    return;
  }
  if (typeof value !== "object") return;

  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] || "");
  const looksArticle = /\b(NewsArticle|Article|ReportageNewsArticle|BlogPosting|WebPage)\b/i.test(type);
  if (looksArticle) {
    bucket.push(value.headline, value.name, value.description, value.articleBody);
  }
  collectJsonLdEvidence(value["@graph"], bucket);
  collectJsonLdEvidence(value.mainEntity, bucket);
  collectJsonLdEvidence(value.mainEntityOfPage, bucket);
}

function extractJsonLdEvidence(html) {
  const evidence = [];
  for (const match of String(html || "").matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw) continue;
    try {
      collectJsonLdEvidence(JSON.parse(raw), evidence);
    } catch {
      continue;
    }
  }
  return evidence.map(cleanEvidenceText).filter(Boolean);
}

function stripHtmlBlocks(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(header|footer|nav|aside)\b[\s\S]*?<\/\1>/gi, " ");
}

function extractParagraphEvidence(html) {
  const evidence = [];
  const cleanedHtml = stripHtmlBlocks(html);
  for (const match of cleanedHtml.matchAll(/<(?:p|h1|h2|li)\b[^>]*>([\s\S]*?)<\/(?:p|h1|h2|li)>/gi)) {
    const text = cleanEvidenceText(match[1].replace(/<[^>]+>/g, " "));
    if (isUsefulEvidence(text)) evidence.push(text);
    if (evidence.length >= 12) break;
  }
  return evidence;
}

function isUsefulEvidence(value) {
  const text = cleanEvidenceText(value);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 7 || words.length > 75) return false;
  if (BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (!/[.!?]$/.test(text) && words.length < 12) return false;
  return tokenize(text).length >= 4;
}

function splitEvidenceIntoFacts(value, maxFacts = DEFAULT_MAX_FACTS) {
  const facts = [];
  for (const sentence of splitSentences(value)) {
    const clean = cleanEvidenceText(sentence);
    if (!isUsefulEvidence(clean)) continue;
    facts.push(clean);
    if (facts.length >= maxFacts) break;
  }
  return facts;
}

function uniqueEvidence(values, max = DEFAULT_MAX_FACTS) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const clean = cleanEvidenceText(value);
    if (!clean) continue;
    const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key) || !isUsefulEvidence(clean)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= max) break;
  }
  return result;
}

function buildTopicResearchQuery(item) {
  const title = cleanEvidenceText(item?.title || "");
  const tokens = tokenize(title).slice(0, 9);
  if (tokens.length >= 4) return tokens.join(" ");
  return title.split(/\s+/).slice(0, 10).join(" ");
}

function stripCdata(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function extractXmlTag(block, tagName) {
  const match = String(block || "").match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  const decoded = decodeHtml(stripCdata(match?.[1] || ""));
  return cleanEvidenceText(decoded.replace(/<[^>]*>/g, " "));
}

function extractTopicFactsFromRss(xml, originalItem = {}) {
  const facts = [];
  const originalSource = String(originalItem?.sourceName || "").toLowerCase();
  const originalTitleTokens = new Set(tokenize(originalItem?.title || ""));
  const requiredOverlap = originalTitleTokens.size >= 4 ? 2 : 1;
  const hasTopicOverlap = (value) => {
    if (!originalTitleTokens.size) return true;
    const overlap = tokenize(value).filter((token) => originalTitleTokens.has(token)).length;
    return overlap >= requiredOverlap;
  };
  for (const match of String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const itemXml = match[1];
    const title = extractXmlTag(itemXml, "title");
    const description = extractXmlTag(itemXml, "description");
    const source = extractXmlTag(itemXml, "source");
    if (source && originalSource && source.toLowerCase() === originalSource) continue;
    if (hasTopicOverlap(title)) facts.push(title);
    if (hasTopicOverlap(description)) facts.push(description);
    if (facts.length >= TOPIC_RESEARCH_LIMIT * 2) break;
  }
  return uniqueEvidence(facts, TOPIC_RESEARCH_LIMIT);
}

async function fetchTopicResearchFacts(item, options = {}) {
  if (options.enableTopicResearch === false || typeof fetch !== "function" || typeof AbortController !== "function") {
    return {
      ok: false,
      reason: "topic_research_disabled",
      facts: [],
      stages: [{ stage: "topic_research", status: "skipped" }],
    };
  }
  const query = buildTopicResearchQuery(item);
  if (!query || query.length < 12) {
    return {
      ok: false,
      reason: "topic_query_too_thin",
      facts: [],
      stages: [{ stage: "topic_research", status: "skipped" }],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.topicTimeoutMs || options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  try {
    const response = await fetch(`https://news.google.com/rss/search?${params.toString()}`, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "Accept": "application/rss+xml,application/xml,text/xml",
        "User-Agent": "LiveNewsBot/1.0 (+https://newsmorenow.com)",
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `topic_research_rejected_${response.status}`,
        facts: [],
        stages: [{ stage: "topic_research", status: "rejected", statusCode: response.status }],
      };
    }
    const facts = extractTopicFactsFromRss(await response.text(), item);
    return {
      ok: facts.length > 0,
      reason: facts.length ? "" : "topic_research_empty",
      facts,
      stages: [{ stage: "topic_research", status: facts.length ? "found" : "empty", facts: facts.length }],
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "topic_research_timeout" : "topic_research_failed",
      facts: [],
      stages: [{ stage: "topic_research", status: "failed" }],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractResearchFromHtml(html, baseUrl = "") {
  const meta = extractMetaMap(html);
  const title = meta["og:title"] || meta["twitter:title"] || extractTitle(html);
  const description =
    meta["og:description"] ||
    meta["twitter:description"] ||
    meta.description ||
    meta["sailthru.description"] ||
    "";
  const jsonLdEvidence = extractJsonLdEvidence(html);
  const paragraphEvidence = extractParagraphEvidence(html);
  const facts = uniqueEvidence(
    [
      description,
      ...jsonLdEvidence.flatMap((entry) => splitEvidenceIntoFacts(entry, 3)),
      ...paragraphEvidence,
    ],
    DEFAULT_MAX_FACTS
  );

  return {
    sourceUrl: baseUrl,
    title,
    description,
    siteName: meta["og:site_name"] || "",
    facts,
    evidenceText: uniqueEvidence([description, ...facts], 10).join(" "),
    stages: [
      {
        stage: "source_page_metadata",
        status: title || description ? "found" : "empty",
      },
      {
        stage: "source_page_body",
        status: paragraphEvidence.length ? "found" : "empty",
        facts: paragraphEvidence.length,
      },
    ],
  };
}

async function fetchSourcePageResearch(link, options = {}) {
  if (!link || typeof fetch !== "function" || typeof AbortController !== "function") {
    return {
      ok: false,
      reason: "source_fetch_unavailable",
      facts: [],
      stages: [{ stage: "source_page_fetch", status: "skipped" }],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(link, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "LiveNewsBot/1.0 (+https://newsmorenow.com)",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("html")) {
      return {
        ok: false,
        reason: `source_fetch_rejected_${response.status}`,
        facts: [],
        stages: [{ stage: "source_page_fetch", status: "rejected", statusCode: response.status }],
      };
    }
    const html = (await response.text()).slice(0, Number(options.maxHtmlBytes || DEFAULT_MAX_HTML_BYTES));
    const extracted = extractResearchFromHtml(html, response.url || link);
    return {
      ok: extracted.facts.length > 0,
      reason: extracted.facts.length ? "" : "no_useful_source_facts",
      ...extracted,
      stages: [{ stage: "source_page_fetch", status: "fetched" }, ...extracted.stages],
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "source_fetch_timeout" : "source_fetch_failed",
      facts: [],
      stages: [{ stage: "source_page_fetch", status: "failed" }],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRelatedFacts(item) {
  const currentTitleTokens = new Set(tokenize(item?.title || ""));
  return uniqueEvidence(
    (item?.supportingLinks || []).flatMap((source) => [
      source.title,
      source.summary,
      source.sourceName,
    ]),
    6
  ).filter((fact) => {
    const factTokens = tokenize(fact);
    if (!factTokens.length) return false;
    return factTokens.some((token) => currentTitleTokens.has(token)) || factTokens.length >= 5;
  });
}

function mergeResearchEvidence(item, sourceResearch, topicResearch = null) {
  const relatedFacts = buildRelatedFacts(item);
  const facts = uniqueEvidence([
    ...(sourceResearch?.facts || []),
    ...(topicResearch?.facts || []),
    ...relatedFacts,
  ], DEFAULT_MAX_FACTS);
  const stages = [
    ...(sourceResearch?.stages || []),
    ...(topicResearch?.stages || []),
    {
      stage: "related_source_cluster",
      status: relatedFacts.length ? "found" : "empty",
      facts: relatedFacts.length,
    },
  ];
  return {
    version: SUMMARY_RESEARCH_VERSION,
    id: stableHash(`${item?.id || ""}:${item?.link || ""}:${facts.join("|")}`),
    researchedAt: new Date().toISOString(),
    sourceUrl: sourceResearch?.sourceUrl || item?.link || "",
    sourceMetadata: {
      title: sourceResearch?.title || "",
      description: sourceResearch?.description || "",
      siteName: sourceResearch?.siteName || "",
    },
    facts,
    topicFacts: topicResearch?.facts || [],
    relatedFacts,
    evidenceText: uniqueEvidence([
      sourceResearch?.description,
      ...(sourceResearch?.facts || []),
      ...(topicResearch?.facts || []),
      ...relatedFacts,
    ], 12).join(" "),
    stages,
    status: facts.length ? "ready" : "needs_review",
    reason: facts.length ? "" : sourceResearch?.reason || "no_research_evidence",
  };
}

function createSummaryResearchStats() {
  return {
    version: SUMMARY_RESEARCH_VERSION,
    checked: 0,
    fetched: 0,
    ready: 0,
    failed: 0,
    cacheHits: 0,
    topicFetched: 0,
    relatedFacts: 0,
    lastUpdated: null,
    reasons: {},
  };
}

function recordReason(stats, reason) {
  const key = reason || "unknown";
  stats.reasons[key] = (stats.reasons[key] || 0) + 1;
}

async function hydrateSummaryResearch(items, options = {}) {
  const stats = options.stats || createSummaryResearchStats();
  const cache = options.cache || new Map();
  const limit = Math.max(0, Number(options.limit || items.length || 0));
  const concurrency = Math.max(1, Number(options.concurrency || 3));
  const targets = (items || [])
    .filter((item) => item?.link)
    .slice(0, limit);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const item = targets[cursor];
      cursor += 1;
      stats.checked += 1;
      const cacheKey = item.link;
      let sourceResearch;
      if (cache.has(cacheKey)) {
        stats.cacheHits += 1;
        sourceResearch = cache.get(cacheKey);
      } else {
        sourceResearch = await fetchSourcePageResearch(item.link, options);
        cache.set(cacheKey, sourceResearch);
        if (sourceResearch.ok) stats.fetched += 1;
      }

      let topicResearch = null;
      if ((sourceResearch?.facts || []).length < 3) {
        topicResearch = await fetchTopicResearchFacts(item, options);
        if (topicResearch.ok) stats.topicFetched += 1;
      }

      const research = mergeResearchEvidence(item, sourceResearch, topicResearch);
      item.summaryResearch = research;
      stats.relatedFacts += research.relatedFacts.length;
      if (research.status === "ready") {
        stats.ready += 1;
      } else {
        stats.failed += 1;
        recordReason(stats, research.reason);
      }
    }
  });
  await Promise.allSettled(workers);
  stats.lastUpdated = new Date().toISOString();
  return stats;
}

module.exports = {
  SUMMARY_RESEARCH_VERSION,
  createSummaryResearchStats,
  extractResearchFromHtml,
  fetchSourcePageResearch,
  fetchTopicResearchFacts,
  hydrateSummaryResearch,
  mergeResearchEvidence,
};
