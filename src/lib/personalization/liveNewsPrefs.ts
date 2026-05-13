export const LIVE_NEWS_PREFS_KEY = "liveNews:v1:prefs";

export type PromptStatus = "accepted" | "dismissed" | "not_asked";

export type SavedCityPreference = {
  cityId: string;
  citySlug: string;
  stateSlug: string;
  label: string;
};

export type PromptPreference = {
  status: PromptStatus;
  updatedAt?: string;
  dismissedUntil?: string;
};

export type LiveNewsPrefs = {
  savedCity: SavedCityPreference | null;
  followedTopics: Record<string, string[]>;
  lastVisitByCity: Record<string, string>;
  seenStoryIdsByCity: Record<string, string[]>;
  promptHistory: Record<string, PromptPreference>;
  updatedAt: string;
};

const EMPTY_PREFS: LiveNewsPrefs = {
  savedCity: null,
  followedTopics: {},
  lastVisitByCity: {},
  seenStoryIdsByCity: {},
  promptHistory: {
    push_alerts: { status: "not_asked" },
  },
  updatedAt: "",
};

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCityId(value: unknown): string {
  return slugify(value).replace(/^city-/, "");
}

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function uniqueStrings(values: unknown[], limit = 250): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean))).slice(0, limit);
}

function normalizeCity(city: Partial<SavedCityPreference> & Record<string, unknown>): SavedCityPreference | null {
  const citySlug = slugify(city.citySlug || city.city_slug || city.slug || city.name || city.city);
  const stateSlug = slugify(city.stateSlug || city.state_slug || city.stateName || city.state_name || city.state);
  const stateCode = cleanText(city.state || city.state_abbr || "").toUpperCase();
  const cityId = normalizeCityId(city.cityId || city.id || [citySlug, stateCode.toLowerCase() || stateSlug].filter(Boolean).join("-"));
  const label = cleanText(city.label || city.display || (city.name && stateCode ? `${city.name}, ${stateCode}` : city.name || cityId));
  if (!cityId || !citySlug || !label) return null;
  return { cityId, citySlug, stateSlug, label };
}

function normalizePrefs(input: Partial<LiveNewsPrefs> | null | undefined): LiveNewsPrefs {
  const next: LiveNewsPrefs = {
    savedCity: input?.savedCity ? normalizeCity(input.savedCity as SavedCityPreference & Record<string, unknown>) : null,
    followedTopics: {},
    lastVisitByCity: {},
    seenStoryIdsByCity: {},
    promptHistory: {},
    updatedAt: cleanText(input?.updatedAt) || nowIso(),
  };

  for (const [cityId, topics] of Object.entries(input?.followedTopics || {})) {
    const normalizedCityId = normalizeCityId(cityId);
    if (normalizedCityId) next.followedTopics[normalizedCityId] = uniqueStrings(topics || [], 80).map(slugify);
  }

  for (const [cityId, visitedAt] of Object.entries(input?.lastVisitByCity || {})) {
    const normalizedCityId = normalizeCityId(cityId);
    const date = new Date(String(visitedAt));
    if (normalizedCityId && !Number.isNaN(date.getTime())) next.lastVisitByCity[normalizedCityId] = date.toISOString();
  }

  for (const [cityId, ids] of Object.entries(input?.seenStoryIdsByCity || {})) {
    const normalizedCityId = normalizeCityId(cityId);
    if (normalizedCityId) next.seenStoryIdsByCity[normalizedCityId] = uniqueStrings(ids || [], 500);
  }

  for (const [key, prompt] of Object.entries(input?.promptHistory || {})) {
    const promptKey = cleanText(key);
    if (!promptKey) continue;
    const status = ["accepted", "dismissed", "not_asked"].includes(prompt?.status || "")
      ? prompt.status
      : "not_asked";
    next.promptHistory[promptKey] = {
      status: status as PromptStatus,
      updatedAt: cleanText(prompt?.updatedAt) || undefined,
      dismissedUntil: cleanText(prompt?.dismissedUntil) || undefined,
    };
  }

  if (!next.promptHistory.push_alerts) next.promptHistory.push_alerts = { status: "not_asked" };
  return next;
}

function storyId(story: Record<string, unknown>): string {
  return cleanText(story.id || story.storyId || story.storyClusterId || story.slug || story.link || story.url);
}

function storyUpdatedAt(story: Record<string, unknown>): number {
  const value = story.lastUpdatedAt || story.updatedAt || story.publishedAt || story.publicStartedAt || story.discoveredAt;
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getLiveNewsPrefs(): LiveNewsPrefs {
  const storage = getStorage();
  if (!storage) return normalizePrefs(EMPTY_PREFS);
  try {
    return normalizePrefs(JSON.parse(storage.getItem(LIVE_NEWS_PREFS_KEY) || "null") || EMPTY_PREFS);
  } catch {
    return normalizePrefs(EMPTY_PREFS);
  }
}

export function saveLiveNewsPrefs(prefs: Partial<LiveNewsPrefs>): LiveNewsPrefs {
  const normalized = normalizePrefs({ ...prefs, updatedAt: nowIso() });
  const storage = getStorage();
  if (!storage) return normalized;
  try {
    storage.setItem(LIVE_NEWS_PREFS_KEY, JSON.stringify(normalized));
  } catch {
    return normalized;
  }
  return normalized;
}

export function clearLiveNewsPrefs(): LiveNewsPrefs {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(LIVE_NEWS_PREFS_KEY);
    } catch {
      // Graceful fallback when localStorage is unavailable.
    }
  }
  return normalizePrefs(EMPTY_PREFS);
}

export function setSavedCity(city: Partial<SavedCityPreference> & Record<string, unknown>): SavedCityPreference | null {
  const savedCity = normalizeCity(city);
  const prefs = getLiveNewsPrefs();
  if (savedCity) {
    prefs.savedCity = savedCity;
    prefs.promptHistory.save_city = { status: "accepted", updatedAt: nowIso() };
  }
  saveLiveNewsPrefs(prefs);
  return savedCity;
}

export function getSavedCity(): SavedCityPreference | null {
  return getLiveNewsPrefs().savedCity;
}

export function followTopic(cityId: string, topic: string): string[] {
  const prefs = getLiveNewsPrefs();
  const normalizedCityId = normalizeCityId(cityId);
  const normalizedTopic = slugify(topic);
  if (!normalizedCityId || !normalizedTopic) return [];
  prefs.followedTopics[normalizedCityId] = uniqueStrings([
    ...(prefs.followedTopics[normalizedCityId] || []),
    normalizedTopic,
  ], 80);
  prefs.promptHistory[`follow_topic:${normalizedCityId}:${normalizedTopic}`] = { status: "accepted", updatedAt: nowIso() };
  return saveLiveNewsPrefs(prefs).followedTopics[normalizedCityId] || [];
}

export function unfollowTopic(cityId: string, topic: string): string[] {
  const prefs = getLiveNewsPrefs();
  const normalizedCityId = normalizeCityId(cityId);
  const normalizedTopic = slugify(topic);
  prefs.followedTopics[normalizedCityId] = (prefs.followedTopics[normalizedCityId] || []).filter((item) => item !== normalizedTopic);
  return saveLiveNewsPrefs(prefs).followedTopics[normalizedCityId] || [];
}

export function getFollowedTopics(cityId: string): string[] {
  return getLiveNewsPrefs().followedTopics[normalizeCityId(cityId)] || [];
}

export function markCityVisited(cityId: string, visibleStoryIds: string[] = []): LiveNewsPrefs {
  const prefs = getLiveNewsPrefs();
  const normalizedCityId = normalizeCityId(cityId);
  if (!normalizedCityId) return prefs;
  prefs.lastVisitByCity[normalizedCityId] = nowIso();
  prefs.seenStoryIdsByCity[normalizedCityId] = uniqueStrings([
    ...visibleStoryIds,
    ...(prefs.seenStoryIdsByCity[normalizedCityId] || []),
  ], 500);
  return saveLiveNewsPrefs(prefs);
}

export function getSeenStoryIds(cityId: string): string[] {
  return getLiveNewsPrefs().seenStoryIdsByCity[normalizeCityId(cityId)] || [];
}

export function getNewStoriesSinceLastVisit(cityId: string, currentStories: Record<string, unknown>[] = []): Record<string, unknown>[] {
  const prefs = getLiveNewsPrefs();
  const normalizedCityId = normalizeCityId(cityId);
  const lastVisit = new Date(prefs.lastVisitByCity[normalizedCityId] || "").getTime();
  if (!Number.isFinite(lastVisit)) return [];
  const seen = new Set(prefs.seenStoryIdsByCity[normalizedCityId] || []);
  return currentStories.filter((story) => {
    const id = storyId(story);
    return id && !seen.has(id) && storyUpdatedAt(story) > lastVisit;
  });
}

export function dismissPrompt(promptKey: string, days = 14): PromptPreference {
  const prefs = getLiveNewsPrefs();
  const key = cleanText(promptKey);
  const dismissedUntil = new Date(Date.now() + Math.max(1, Number(days) || 14) * 24 * 60 * 60 * 1000).toISOString();
  prefs.promptHistory[key] = { status: "dismissed", updatedAt: nowIso(), dismissedUntil };
  saveLiveNewsPrefs(prefs);
  return prefs.promptHistory[key];
}

export function shouldShowPrompt(promptKey: string): boolean {
  const prompt = getLiveNewsPrefs().promptHistory[cleanText(promptKey)];
  if (!prompt) return true;
  if (prompt.status === "accepted") return false;
  if (prompt.status !== "dismissed") return true;
  const dismissedUntil = new Date(prompt.dismissedUntil || "").getTime();
  return !Number.isFinite(dismissedUntil) || dismissedUntil <= Date.now();
}
