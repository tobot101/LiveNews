const { readLocalCities } = require("./local-intelligence-models");
const { getLiveStoriesForCity, isPublicStoryLive } = require("./local-story-expiration");

const URGENCY_WEIGHTS = {
  breaking: 100,
  high: 60,
  normal: 20,
  low: 5,
};

const CONFIDENCE_BONUS = {
  official: 40,
  confirmed_multiple_sources: 30,
  reported_one_source: 10,
  community_source: 0,
  developing: 5,
};

const TOPIC_IMPORTANCE_BONUS = {
  weather: 35,
  emergency: 35,
  traffic: 25,
  "crime-public-safety": 25,
  crime_public_safety: 25,
  public_safety: 25,
  schools: 20,
  "city-hall": 15,
  city_hall: 15,
  events: 10,
  sports: 8,
  community: 5,
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function getNowAndOptions(now, options = {}) {
  if (now && typeof now === "object" && !(now instanceof Date) && !Number.isFinite(now.getTime?.())) {
    const merged = { ...now };
    return {
      now: new Date(merged.now || Date.now()),
      options: merged,
    };
  }
  return {
    now: new Date(now || options.now || Date.now()),
    options: { ...options, now: now || options.now || new Date() },
  };
}

function getCity(cityId, options = {}) {
  const cities = readLocalCities(options.paths?.localCities).cities || [];
  return cities.find((city) => city.id === cityId) || null;
}

function getStoryTime(story = {}) {
  return toDate(story.last_updated_at || story.public_started_at || story.first_seen_at || story.created_at);
}

function getLocalDateKey(date, timezone = "UTC") {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function isSameLocalDay(value, now, timezone) {
  const date = toDate(value);
  if (!date) return false;
  return getLocalDateKey(date, timezone) === getLocalDateKey(now, timezone);
}

function getRecencyBonus(story = {}, now = new Date()) {
  const storyTime = getStoryTime(story);
  if (!storyTime) return 0;
  const ageHours = Math.max(0, (new Date(now).getTime() - storyTime.getTime()) / 3600000);
  return Math.max(0, Math.round(35 - (ageHours / (7 * 24)) * 35));
}

function getTopicImportanceBonus(topic = "") {
  const normalized = cleanText(topic).toLowerCase();
  return TOPIC_IMPORTANCE_BONUS[normalized] || TOPIC_IMPORTANCE_BONUS[normalized.replace(/_/g, "-")] || 0;
}

function getEngagementBonus(story = {}) {
  const views = Number(story.views || story.view_count || story.engagement?.views || 0);
  const clicks = Number(story.clicks || story.link_clicks || story.engagement?.clicks || 0);
  const saves = Number(story.saves || story.engagement?.saves || 0);
  const score = views * 0.02 + clicks * 0.35 + saves * 0.5;
  return Math.min(20, Math.round(score));
}

function getLowQualityPenalty(story = {}) {
  let penalty = 0;
  if (cleanText(story.summary).length < 40) penalty += 15;
  if (cleanText(story.headline).length < 12) penalty += 10;
  if (Number(story.source_count || 0) < 1) penalty += 50;
  return penalty;
}

function isEligibleLiveCityStory(story = {}, cityId = "", options = {}) {
  return (
    story.city_id === cityId &&
    story.confidence_label !== "low_confidence" &&
    Number(story.source_count || 0) >= 1 &&
    Boolean(cleanText(story.headline)) &&
    Boolean(cleanText(story.summary)) &&
    isPublicStoryLive(story, options)
  );
}

function scoreLocalTopStory(story = {}, now = new Date()) {
  if (story.confidence_label === "low_confidence") return -Infinity;
  return (
    (URGENCY_WEIGHTS[story.urgency] || 0) +
    Number(story.source_count || 0) * 8 +
    Number(story.official_source_count || 0) * 15 +
    getRecencyBonus(story, now) +
    (CONFIDENCE_BONUS[story.confidence_label] || 0) +
    getTopicImportanceBonus(story.primary_topic) +
    getEngagementBonus(story) -
    getLowQualityPenalty(story)
  );
}

function withScore(story = {}, label = "", now = new Date()) {
  return {
    ...story,
    topStoryLabel: label,
    topStoryScore: scoreLocalTopStory(story, now),
  };
}

function sortByTopStoryScore(stories = [], now = new Date()) {
  return [...stories].sort((left, right) => {
    const scoreDelta = scoreLocalTopStory(right, now) - scoreLocalTopStory(left, now);
    if (scoreDelta) return scoreDelta;
    return (getStoryTime(right)?.getTime() || 0) - (getStoryTime(left)?.getTime() || 0);
  });
}

function getEligibleLiveCityStories(cityId, window = {}) {
  const { now, options } = getNowAndOptions(window.now || window, window);
  return getLiveStoriesForCity(cityId, { ...options, now })
    .filter((story) => isEligibleLiveCityStory(story, cityId, { ...options, now }));
}

function getTopStoryOfDay(cityId, nowInput = new Date(), optionsInput = {}) {
  const { now, options } = getNowAndOptions(nowInput, optionsInput);
  const city = getCity(cityId, options);
  const timezone = city?.timezone || "UTC";
  const eligible = getEligibleLiveCityStories(cityId, { ...options, now });
  const today = eligible.filter((story) => isSameLocalDay(story.last_updated_at || story.public_started_at, now, timezone));
  const last24h = eligible.filter((story) => {
    const storyTime = getStoryTime(story);
    return storyTime && now.getTime() - storyTime.getTime() <= 24 * 60 * 60 * 1000;
  });
  const pool = today.length ? today : last24h.length ? last24h : eligible;
  if (!pool.length) return null;
  const label = today.length || last24h.length ? "Top Story of the Day" : "Latest Local Story";
  return withScore(sortByTopStoryScore(pool, now)[0], label, now);
}

function getTopStoryOfWeek(cityId, nowInput = new Date(), excludeStoryId = "", optionsInput = {}) {
  const { now, options } = getNowAndOptions(nowInput, optionsInput);
  const eligible = getEligibleLiveCityStories(cityId, { ...options, now });
  if (!eligible.length) return null;
  const alternatives = excludeStoryId
    ? eligible.filter((story) => story.id !== excludeStoryId)
    : eligible;
  const pool = alternatives.length ? alternatives : eligible;
  return withScore(sortByTopStoryScore(pool, now)[0], "Top Story of the Week", now);
}

function getCityTopStories(cityId, nowInput = new Date(), optionsInput = {}) {
  const { now, options } = getNowAndOptions(nowInput, optionsInput);
  const eligibleStories = getEligibleLiveCityStories(cityId, { ...options, now });
  const day = getTopStoryOfDay(cityId, now, options);
  const week = getTopStoryOfWeek(cityId, now, day?.id || "", options);
  return {
    cityId,
    day,
    week,
    eligibleStories,
    generatedAt: now.toISOString(),
  };
}

module.exports = {
  getCityTopStories,
  getEligibleLiveCityStories,
  getTopStoryOfDay,
  getTopStoryOfWeek,
  scoreLocalTopStory,
};
