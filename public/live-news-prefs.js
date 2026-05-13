(function () {
  const KEY = "liveNews:v1:prefs";
  const EMPTY = {
    savedCity: null,
    followedTopics: {},
    lastVisitByCity: {},
    seenStoryIdsByCity: {},
    promptHistory: {
      push_alerts: { status: "not_asked" },
    },
    updatedAt: "",
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function slugify(value) {
    return cleanText(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeCityId(value) {
    return slugify(value).replace(/^city-/, "");
  }

  function getStorage() {
    try {
      return window.localStorage || null;
    } catch {
      return null;
    }
  }

  function uniqueStrings(values, limit) {
    return Array.from(new Set((values || []).map(cleanText).filter(Boolean))).slice(0, limit || 250);
  }

  function normalizeCity(city) {
    city = city || {};
    const citySlug = slugify(city.citySlug || city.city_slug || city.slug || city.name || city.city);
    const stateSlug = slugify(city.stateSlug || city.state_slug || city.stateName || city.state_name || city.state);
    const stateCode = cleanText(city.state || city.state_abbr || "").toUpperCase();
    const cityId = normalizeCityId(city.cityId || city.id || [citySlug, stateCode.toLowerCase() || stateSlug].filter(Boolean).join("-"));
    const label = cleanText(city.label || city.display || (city.name && stateCode ? `${city.name}, ${stateCode}` : city.name || cityId));
    if (!cityId || !citySlug || !label) return null;
    return { cityId, citySlug, stateSlug, label };
  }

  function normalizePrefs(input) {
    input = input || {};
    const next = {
      savedCity: input.savedCity ? normalizeCity(input.savedCity) : null,
      followedTopics: {},
      lastVisitByCity: {},
      seenStoryIdsByCity: {},
      promptHistory: {},
      updatedAt: cleanText(input.updatedAt) || nowIso(),
    };

    Object.entries(input.followedTopics || {}).forEach(([cityId, topics]) => {
      const normalizedCityId = normalizeCityId(cityId);
      if (normalizedCityId) next.followedTopics[normalizedCityId] = uniqueStrings(topics, 80).map(slugify);
    });

    Object.entries(input.lastVisitByCity || {}).forEach(([cityId, visitedAt]) => {
      const normalizedCityId = normalizeCityId(cityId);
      const date = new Date(visitedAt);
      if (normalizedCityId && !Number.isNaN(date.getTime())) next.lastVisitByCity[normalizedCityId] = date.toISOString();
    });

    Object.entries(input.seenStoryIdsByCity || {}).forEach(([cityId, ids]) => {
      const normalizedCityId = normalizeCityId(cityId);
      if (normalizedCityId) next.seenStoryIdsByCity[normalizedCityId] = uniqueStrings(ids, 500);
    });

    Object.entries(input.promptHistory || {}).forEach(([key, prompt]) => {
      const promptKey = cleanText(key);
      if (!promptKey) return;
      const status = ["accepted", "dismissed", "not_asked"].includes(prompt && prompt.status)
        ? prompt.status
        : "not_asked";
      next.promptHistory[promptKey] = {
        status,
        updatedAt: cleanText(prompt && prompt.updatedAt) || undefined,
        dismissedUntil: cleanText(prompt && prompt.dismissedUntil) || undefined,
      };
    });

    if (!next.promptHistory.push_alerts) next.promptHistory.push_alerts = { status: "not_asked" };
    return next;
  }

  function getLiveNewsPrefs() {
    const storage = getStorage();
    if (!storage) return normalizePrefs(EMPTY);
    try {
      return normalizePrefs(JSON.parse(storage.getItem(KEY) || "null") || EMPTY);
    } catch {
      return normalizePrefs(EMPTY);
    }
  }

  function saveLiveNewsPrefs(prefs) {
    const normalized = normalizePrefs({ ...(prefs || {}), updatedAt: nowIso() });
    const storage = getStorage();
    if (!storage) return normalized;
    try {
      storage.setItem(KEY, JSON.stringify(normalized));
    } catch {
      return normalized;
    }
    return normalized;
  }

  function clearLiveNewsPrefs() {
    const storage = getStorage();
    if (storage) {
      try {
        storage.removeItem(KEY);
        ["ln_local_place", "ln_followed_topics", "ln_seen_story_ids", "ln_dismissed_prompts", "ln_last_visit_at"].forEach((key) => {
          storage.removeItem(key);
        });
      } catch {
        // Graceful fallback when localStorage is unavailable.
      }
    }
    return normalizePrefs(EMPTY);
  }

  function setSavedCity(city) {
    const savedCity = normalizeCity(city);
    const prefs = getLiveNewsPrefs();
    if (savedCity) {
      prefs.savedCity = savedCity;
      prefs.promptHistory.save_city = { status: "accepted", updatedAt: nowIso() };
    }
    saveLiveNewsPrefs(prefs);
    return savedCity;
  }

  function getSavedCity() {
    return getLiveNewsPrefs().savedCity;
  }

  function followTopic(cityId, topic) {
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

  function unfollowTopic(cityId, topic) {
    const prefs = getLiveNewsPrefs();
    const normalizedCityId = normalizeCityId(cityId);
    const normalizedTopic = slugify(topic);
    prefs.followedTopics[normalizedCityId] = (prefs.followedTopics[normalizedCityId] || []).filter((item) => item !== normalizedTopic);
    return saveLiveNewsPrefs(prefs).followedTopics[normalizedCityId] || [];
  }

  function getFollowedTopics(cityId) {
    return getLiveNewsPrefs().followedTopics[normalizeCityId(cityId)] || [];
  }

  function getStoryId(story) {
    return cleanText(story && (story.id || story.storyId || story.storyClusterId || story.slug || story.link || story.url));
  }

  function getStoryUpdatedAt(story) {
    const value = story && (story.lastUpdatedAt || story.updatedAt || story.publishedAt || story.publicStartedAt || story.discoveredAt);
    const time = new Date(value || "").getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function markCityVisited(cityId, visibleStoryIds) {
    const prefs = getLiveNewsPrefs();
    const normalizedCityId = normalizeCityId(cityId);
    if (!normalizedCityId) return prefs;
    prefs.lastVisitByCity[normalizedCityId] = nowIso();
    prefs.seenStoryIdsByCity[normalizedCityId] = uniqueStrings([
      ...(visibleStoryIds || []),
      ...(prefs.seenStoryIdsByCity[normalizedCityId] || []),
    ], 500);
    return saveLiveNewsPrefs(prefs);
  }

  function getSeenStoryIds(cityId) {
    return getLiveNewsPrefs().seenStoryIdsByCity[normalizeCityId(cityId)] || [];
  }

  function getNewStoriesSinceLastVisit(cityId, currentStories) {
    const prefs = getLiveNewsPrefs();
    const normalizedCityId = normalizeCityId(cityId);
    const lastVisit = new Date(prefs.lastVisitByCity[normalizedCityId] || "").getTime();
    if (!Number.isFinite(lastVisit)) return [];
    const seen = new Set(prefs.seenStoryIdsByCity[normalizedCityId] || []);
    return (currentStories || []).filter((story) => {
      const id = getStoryId(story);
      return id && !seen.has(id) && getStoryUpdatedAt(story) > lastVisit;
    });
  }

  function dismissPrompt(promptKey, days) {
    const prefs = getLiveNewsPrefs();
    const key = cleanText(promptKey);
    const dismissedUntil = new Date(Date.now() + Math.max(1, Number(days) || 14) * 24 * 60 * 60 * 1000).toISOString();
    prefs.promptHistory[key] = { status: "dismissed", updatedAt: nowIso(), dismissedUntil };
    saveLiveNewsPrefs(prefs);
    return prefs.promptHistory[key];
  }

  function shouldShowPrompt(promptKey) {
    const prompt = getLiveNewsPrefs().promptHistory[cleanText(promptKey)];
    if (!prompt) return true;
    if (prompt.status === "accepted") return false;
    if (prompt.status !== "dismissed") return true;
    const dismissedUntil = new Date(prompt.dismissedUntil || "").getTime();
    return !Number.isFinite(dismissedUntil) || dismissedUntil <= Date.now();
  }

  window.LiveNewsPrefs = {
    key: KEY,
    getLiveNewsPrefs,
    saveLiveNewsPrefs,
    clearLiveNewsPrefs,
    setSavedCity,
    getSavedCity,
    followTopic,
    unfollowTopic,
    getFollowedTopics,
    markCityVisited,
    getSeenStoryIds,
    getNewStoriesSinceLastVisit,
    dismissPrompt,
    shouldShowPrompt,
  };
})();
