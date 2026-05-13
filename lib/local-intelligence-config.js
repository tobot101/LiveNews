const DEFAULT_LOCAL_INTELLIGENCE_ENV = {
  STORY_PUBLIC_TTL_DAYS: 7,
  GOOGLE_NEWS_TTL_HOURS: 48,
  SOURCE_FETCH_CONCURRENCY: 5,
  SOURCE_FETCH_TIMEOUT_MS: 15000,
  SOURCE_DEFAULT_RATE_LIMIT_MINUTES: 15,
  CRAWLER_USER_AGENT: "LiveNewsBot/1.0 (+https://newsmorenow.com/contact)",
  BASE_URL: "https://newsmorenow.com",
};

function cleanString(value) {
  return String(value || "").trim();
}

function parsePositiveInteger(env, key, fallback, warnings, options = {}) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  const min = Number(options.min || 1);
  const max = Number(options.max || Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    warnings.push(`${key} must be an integer between ${min} and ${max}; using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function normalizeBaseUrl(value, warnings) {
  const raw = cleanString(value || DEFAULT_LOCAL_INTELLIGENCE_ENV.BASE_URL).replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      warnings.push("BASE_URL must use http or https; using default.");
      return DEFAULT_LOCAL_INTELLIGENCE_ENV.BASE_URL;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    warnings.push("BASE_URL must be a valid URL; using default.");
    return DEFAULT_LOCAL_INTELLIGENCE_ENV.BASE_URL;
  }
}

function normalizeCrawlerUserAgent(value, warnings) {
  const userAgent = cleanString(value || DEFAULT_LOCAL_INTELLIGENCE_ENV.CRAWLER_USER_AGENT);
  if (!userAgent) return DEFAULT_LOCAL_INTELLIGENCE_ENV.CRAWLER_USER_AGENT;
  if (userAgent.length > 240) {
    warnings.push("CRAWLER_USER_AGENT is too long; using default.");
    return DEFAULT_LOCAL_INTELLIGENCE_ENV.CRAWLER_USER_AGENT;
  }
  return userAgent;
}

function buildLocalIntelligenceConfig(env = process.env) {
  const warnings = [];
  const storyPublicTtlDays = parsePositiveInteger(
    env,
    "STORY_PUBLIC_TTL_DAYS",
    DEFAULT_LOCAL_INTELLIGENCE_ENV.STORY_PUBLIC_TTL_DAYS,
    warnings,
    { min: 1, max: 31 }
  );
  const googleNewsTtlHours = parsePositiveInteger(
    env,
    "GOOGLE_NEWS_TTL_HOURS",
    DEFAULT_LOCAL_INTELLIGENCE_ENV.GOOGLE_NEWS_TTL_HOURS,
    warnings,
    { min: 1, max: 168 }
  );
  const sourceFetchConcurrency = parsePositiveInteger(
    env,
    "SOURCE_FETCH_CONCURRENCY",
    DEFAULT_LOCAL_INTELLIGENCE_ENV.SOURCE_FETCH_CONCURRENCY,
    warnings,
    { min: 1, max: 25 }
  );
  const sourceFetchTimeoutMs = parsePositiveInteger(
    env,
    "SOURCE_FETCH_TIMEOUT_MS",
    DEFAULT_LOCAL_INTELLIGENCE_ENV.SOURCE_FETCH_TIMEOUT_MS,
    warnings,
    { min: 1000, max: 120000 }
  );
  const sourceDefaultRateLimitMinutes = parsePositiveInteger(
    env,
    "SOURCE_DEFAULT_RATE_LIMIT_MINUTES",
    DEFAULT_LOCAL_INTELLIGENCE_ENV.SOURCE_DEFAULT_RATE_LIMIT_MINUTES,
    warnings,
    { min: 1, max: 1440 }
  );
  const crawlerUserAgent = normalizeCrawlerUserAgent(env.CRAWLER_USER_AGENT, warnings);
  const baseUrl = normalizeBaseUrl(env.BASE_URL || env.PUBLIC_SITE_URL, warnings);

  return {
    storyPublicTtlDays,
    googleNewsTtlHours,
    sourceFetchConcurrency,
    sourceFetchTimeoutMs,
    sourceDefaultRateLimitMinutes,
    crawlerUserAgent,
    baseUrl,
    warnings,
  };
}

function getLocalIntelligenceConfig(env = process.env) {
  return buildLocalIntelligenceConfig(env);
}

module.exports = {
  DEFAULT_LOCAL_INTELLIGENCE_ENV,
  buildLocalIntelligenceConfig,
  getLocalIntelligenceConfig,
};
