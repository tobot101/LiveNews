const LOCAL_LIMIT_DEFAULT = "25";
const TOP_US_CITIES = Array.isArray(window.LIVE_NEWS_TOP_CITIES)
  ? window.LIVE_NEWS_TOP_CITIES
  : [];

const state = {
  limit: LOCAL_LIMIT_DEFAULT,
  place: null,
  feed: [],
  loading: false,
  lastFetched: 0,
  personalization: {
    storageAvailable: true,
    followedTopics: [],
    seenStoryIds: [],
    dismissedPrompts: [],
    lastVisitAt: "",
  },
};

const elements = {
  input: document.getElementById("localPageInput"),
  setButton: document.getElementById("localPageSet"),
  useLocation: document.getElementById("localPageUseLocation"),
  suggestions: document.getElementById("localPageSuggestions"),
  display: document.getElementById("localPageDisplay"),
  status: document.getElementById("localPageStatus"),
  feedList: document.getElementById("localFeedList"),
  limitControl: document.getElementById("localLimitControl"),
  feedTag: document.getElementById("localFeedTag"),
  feedTitle: document.getElementById("localFeedTitle"),
  topCityGrid: document.getElementById("localPageTopCityGrid"),
  modeControl: document.getElementById("modeControl"),
};

function init() {
  hydrateAnonymousPersonalization();
  applyTheme();
  bindControls();
  hydrateLimit();
  hydrateFromQuery();
  hydrateFromStorage();
  renderTopCities();
  updateBrandShift();
  window.addEventListener("resize", updateBrandShift);
}

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    state.personalization.storageAvailable = false;
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    state.personalization.storageAvailable = true;
    return true;
  } catch {
    state.personalization.storageAvailable = false;
    return false;
  }
}

function parseStoredJson(key, fallback) {
  const raw = safeStorageGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function hydrateAnonymousPersonalization() {
  state.personalization.followedTopics = parseStoredJson("ln_followed_topics", []);
  state.personalization.seenStoryIds = parseStoredJson("ln_seen_story_ids", []);
  state.personalization.dismissedPrompts = parseStoredJson("ln_dismissed_prompts", []);
  state.personalization.lastVisitAt = safeStorageGet("ln_last_visit_at") || "";
  safeStorageSet("ln_last_visit_at", new Date().toISOString());
}

function rememberSeenStories(items = []) {
  const ids = items.map((item) => item.id || item.storyClusterId || item.link).filter(Boolean);
  if (!ids.length) return;
  const merged = Array.from(new Set([...ids, ...(state.personalization.seenStoryIds || [])])).slice(0, 250);
  state.personalization.seenStoryIds = merged;
  safeStorageSet("ln_seen_story_ids", JSON.stringify(merged));
}

function isSeenStory(item) {
  const key = item?.id || item?.storyClusterId || item?.link;
  return Boolean(key && state.personalization.seenStoryIds.includes(key));
}

function hydrateLimit() {
  const stored = safeStorageGet("ln_local_limit");
  if (stored) {
    state.limit = stored;
  }
  setLimitUI(state.limit);
}

function applyTheme() {
  const stored = safeStorageGet("ln_mode") || "auto";
  const now = new Date();
  const theme = stored === "auto" ? (shouldUseNightMode(now) ? "night" : "day") : stored;
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === stored);
  });
}

function shouldUseNightMode(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const current = hours * 60 + minutes;
  const nightStart = 19 * 60 + 30;
  const nightEnd = 5 * 60 + 30;
  return current >= nightStart || current <= nightEnd;
}

function updateBrandShift() {
  const brand = document.querySelector(".brand");
  const brandTitle = document.querySelector(".brand-title");
  if (!brand || !brandTitle) return;
  const topbar = document.querySelector(".topbar");
  const limit = topbar ? topbar.querySelector(".controls") : null;
  const brandRect = brand.getBoundingClientRect();
  const limitRect = limit ? limit.getBoundingClientRect() : null;
  const containerRect = topbar ? topbar.getBoundingClientRect() : null;
  let maxShift = 0;
  const controlsShareRow =
    limitRect && Math.abs(limitRect.top - brandRect.top) < Math.max(brandRect.height, 40);
  if (limitRect && controlsShareRow) {
    maxShift = Math.max(0, Math.floor(limitRect.left - brandRect.right - 16));
  } else if (containerRect) {
    maxShift = Math.max(0, Math.floor(containerRect.right - brandRect.right - 16));
  }
  brand.style.setProperty("--brand-shift", `${maxShift}px`);
}

function bindControls() {
  if (elements.input) {
    elements.input.addEventListener("input", (event) => {
      scheduleSuggestions(event.target.value.trim());
    });
    elements.input.addEventListener("blur", () => {
      setTimeout(() => clearSuggestions(), 150);
    });
  }

  if (elements.setButton) {
    elements.setButton.addEventListener("click", () => {
      const value = elements.input.value.trim();
      if (!value) return;
      setPlace(buildManualPlace(value));
    });
  }

  if (elements.useLocation) {
    elements.useLocation.addEventListener("click", () => {
      if (!navigator.geolocation) {
        updateStatus("Geolocation unavailable.");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          findNearestPlace(latitude, longitude);
        },
        () => updateStatus("Location permission denied.")
      );
    });
  }

  if (elements.limitControl) {
    elements.limitControl.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const value = target.dataset.localLimit;
      if (!value) return;
      state.limit = value;
      setLimitUI(value);
      safeStorageSet("ln_local_limit", value);
      renderLocalFeed();
    });
  }

  if (elements.modeControl) {
    elements.modeControl.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const value = target.dataset.mode;
      if (!value) return;
      safeStorageSet("ln_mode", value);
      document.querySelectorAll("[data-mode]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === value);
      });
      const theme =
        value === "auto" ? (shouldUseNightMode(new Date()) ? "night" : "day") : value;
      document.documentElement.setAttribute("data-theme", theme);
    });
  }
}

function hydrateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const city = params.get("city");
  const stateCode = params.get("state") || "";
  if (city) {
    setPlace(buildManualPlace(city, stateCode));
  }
}

function hydrateFromStorage() {
  if (state.place) return;
  if (!personalizationAllowed()) return;
  const stored = safeStorageGet("ln_local_place");
  if (!stored) return;
  try {
    const place = JSON.parse(stored);
    if (place?.display || place?.name) {
      setPlace(place);
    }
  } catch {
    // ignore
  }
}

function personalizationAllowed() {
  try {
    if (navigator.globalPrivacyControl === true) return false;
    const raw = safeStorageGet("ln_consent");
    if (!raw) return false;
    const consent = JSON.parse(raw);
    return Boolean(consent?.personalization);
  } catch {
    return false;
  }
}

let suggestionTimer = null;

function scheduleSuggestions(query) {
  if (!elements.suggestions) return;
  if (suggestionTimer) clearTimeout(suggestionTimer);
  if (!query || query.length < 2) {
    clearSuggestions();
    return;
  }
  suggestionTimer = setTimeout(() => fetchSuggestions(query), 250);
}

async function fetchSuggestions(query) {
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    renderSuggestions(data.results || []);
  } catch {
    clearSuggestions();
  }
}

function renderSuggestions(results) {
  if (!elements.suggestions) return;
  elements.suggestions.innerHTML = "";
  if (!results.length) return;
  results.slice(0, 8).forEach((place) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "local-suggestion";
    button.innerHTML = `
      <strong>${place.name}, ${place.state}</strong>
      <span>${place.stateName || ""}</span>
    `;
    button.addEventListener("click", () => {
      setPlace(place);
      if (elements.input) {
        elements.input.value = place.display || `${place.name}, ${place.state}`;
      }
      clearSuggestions();
    });
    elements.suggestions.appendChild(button);
  });
}

function clearSuggestions() {
  if (!elements.suggestions) return;
  elements.suggestions.innerHTML = "";
}

function getPlaceLabel(place) {
  if (!place) return "not set";
  return place.display || place.name || "not set";
}

function buildManualPlace(value, stateValue = "") {
  const raw = String(value || "").trim();
  const explicitState = String(stateValue || "").trim().toUpperCase();
  if (explicitState) {
    const name = raw
      .replace(new RegExp(`\\s*,?\\s*${explicitState}$`, "i"), "")
      .replace(/\s*,\s*$/g, "")
      .trim();
    return {
      name,
      display: name ? `${name}, ${explicitState}` : explicitState,
      state: explicitState,
      stateName: "",
      geoid: "",
    };
  }
  const commaMatch = raw.match(/^(.*?),\s*([A-Za-z]{2})$/);
  if (commaMatch) {
    const name = commaMatch[1].trim();
    const state = commaMatch[2].toUpperCase();
    return {
      name,
      display: `${name}, ${state}`,
      state,
      stateName: "",
      geoid: "",
    };
  }
  return {
    name: raw,
    display: raw,
    state: "",
    stateName: "",
    geoid: "",
  };
}

function syncResolvedPlace(place) {
  if (!place?.name) return;
  const changed = !isSamePlace(place, state.place) ||
    String(place.display || "") !== String(state.place?.display || "");
  if (!changed) return;
  state.place = place;
  if (elements.display) {
    elements.display.textContent = `Selected city: ${getPlaceLabel(place)}`;
  }
  if (elements.input && place.display) {
    elements.input.value = place.display;
  }
  if (personalizationAllowed()) {
    safeStorageSet("ln_local_place", JSON.stringify(place));
  }
  history.replaceState(null, "", buildLocalPageHref(place));
  renderTopCities();
}

function buildLocalPageHref(place) {
  const city = place?.name || place?.display;
  if (!city) return "/local";
  const params = new URLSearchParams({ city });
  if (place?.state) {
    params.set("state", place.state);
  }
  return `/local?${params.toString()}`;
}

function isSamePlace(a, b) {
  if (!a || !b) return false;
  return String(a.name || "").toLowerCase() === String(b.name || "").toLowerCase() &&
    String(a.state || "").toLowerCase() === String(b.state || "").toLowerCase();
}

function renderTopCities() {
  if (!elements.topCityGrid) return;
  elements.topCityGrid.innerHTML = "";
  TOP_US_CITIES.forEach((place) => {
    const link = document.createElement("a");
    link.className = "local-city-link";
    if (isSamePlace(place, state.place)) {
      link.classList.add("active");
    }
    link.href = buildLocalPageHref(place);
    link.innerHTML = `
      <span class="local-city-name">${place.name}</span>
      <span class="local-city-state">${place.state}</span>
    `;
    link.addEventListener("click", () => {
      if (personalizationAllowed()) {
        safeStorageSet("ln_local_place", JSON.stringify(place));
      }
    });
    elements.topCityGrid.appendChild(link);
  });
}

function setPlace(place) {
  state.place = place;
  if (elements.display) {
    elements.display.textContent = `Selected city: ${getPlaceLabel(place)}`;
  }
  if (elements.input && place?.display) {
    elements.input.value = place.display;
  }
  if (personalizationAllowed()) {
    safeStorageSet("ln_local_place", JSON.stringify(place));
  }
  history.replaceState(null, "", buildLocalPageHref(place));
  renderTopCities();
  loadLocalFeed({ force: true });
}

function setLimitUI(value) {
  document.querySelectorAll("[data-local-limit]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.localLimit === value);
  });
}

async function findNearestPlace(lat, lon) {
  try {
    const response = await fetch(
      `/api/places/nearest?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    );
    const data = await response.json();
    if (data.place) {
      setPlace(data.place);
    } else {
      updateStatus("No nearby city found.");
    }
  } catch {
    updateStatus("Location lookup failed.");
  }
}

async function loadLocalFeed({ force = false } = {}) {
  if (!state.place || !state.place.name) {
    updateStatus("Choose a city to get started.");
    renderLocalFeed();
    return;
  }
  const now = Date.now();
  if (!force && now - state.lastFetched < 10 * 60 * 1000) {
    return;
  }
  if (state.loading) return;
  state.loading = true;
  updateStatus("Loading local stories...");
  try {
    const params = new URLSearchParams({
      city: state.place.name,
      state: state.place.state || "",
    });
    const response = await fetch(`/api/local?${params.toString()}`);
    const data = await response.json();
    syncResolvedPlace(data.place);
    state.feed = data.items || [];
    state.lastFetched = Date.now();
    renderLocalFeed();
  } catch {
    state.feed = [];
    updateStatus("Local stories unavailable.");
    renderLocalFeed();
  } finally {
    state.loading = false;
  }
}

function renderLocalFeed() {
  if (!elements.feedList) return;
  elements.feedList.innerHTML = "";
  const total = state.feed.length;
  const limit = Number(state.limit) || 25;
  const limited = state.feed.slice(0, limit);
  const placeLabel = getPlaceLabel(state.place);

  if (elements.feedTag) {
    elements.feedTag.textContent =
      total > 0 ? `Showing ${limited.length} of ${total}` : "No updates";
  }
  if (elements.feedTitle) {
    elements.feedTitle.textContent =
      placeLabel === "not set" ? "Local stories" : `Local stories for ${placeLabel}`;
  }

  if (!limited.length) {
    const empty = document.createElement("div");
    empty.className = "story-card local-story-card empty-card";
    empty.textContent = "No local stories in the last 7 days.";
    elements.feedList.appendChild(empty);
    return;
  }

  const priorSeenStoryIds = new Set(state.personalization.seenStoryIds || []);
  const groups = groupFeedByAge(limited);
  rememberSeenStories(limited);
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "feed-section";
    const header = document.createElement("div");
    header.className = "feed-section-title";
    header.innerHTML = `
      <span>${group.label}</span>
      <span class="feed-section-count">${group.items.length}</span>
    `;
    const list = document.createElement("div");
    list.className = "feed-section-list";
    group.items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "story-card local-story-card";
      if (priorSeenStoryIds.has(item.id || item.storyClusterId || item.link)) {
        card.classList.add("seen-local-story");
      }
      const published = item.publishedAt ? formatTime(item.publishedAt) : "";
      const dateBadge = getPublishedDateBadge(item);
      const summary = getDisplaySummary(item);
      card.innerHTML = `
        <div class="story-card-top local-story-card-top">
          <div class="story-eyebrow">
            <span>${escapeHtml(dateBadge)}</span>
            <span>${escapeHtml(item.category || "Local")}</span>
          </div>
        </div>
        <h3>${buildTitleLink(item, "story-card-title")}</h3>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
        ${buildLocalMeta(item, published)}
      `;
      list.appendChild(card);
    });
    section.appendChild(header);
    section.appendChild(list);
    elements.feedList.appendChild(section);
  });

  if (total > 0) {
    updateStatus(`Showing ${limited.length} of ${total} stories for ${placeLabel}.`);
  }
}

function updateStatus(message) {
  if (!elements.status) return;
  elements.status.textContent = message;
}

function groupFeedByAge(items) {
  const groups = [
    { label: "Just in (0–3h)", min: 0, max: 3, items: [] },
    { label: "Earlier today (3–12h)", min: 3, max: 12, items: [] },
    { label: "Last 24 hours", min: 12, max: 24, items: [] },
    { label: "Yesterday (24–48h)", min: 24, max: 48, items: [] },
    { label: "This week (2–7d)", min: 48, max: 168, items: [] },
  ];
  const undated = { label: "Undated", items: [] };

  items.forEach((item) => {
    const ageHours = getAgeHours(item.publishedAt);
    if (!Number.isFinite(ageHours)) {
      undated.items.push(item);
      return;
    }
    const group = groups.find((bucket) => ageHours >= bucket.min && ageHours < bucket.max);
    if (group) {
      group.items.push(item);
      return;
    }
    undated.items.push(item);
  });

  const result = groups.filter((group) => group.items.length > 0);
  if (undated.items.length > 0) result.push(undated);
  return result;
}

function getAgeHours(publishedAt) {
  if (!publishedAt) return Infinity;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 3600000;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function getPublishedDateBadge(item) {
  const date = new Date(item?.publishedAt || "");
  if (Number.isNaN(date.getTime())) return "Local";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDisplaySummary(item) {
  if (isEntertainmentLocalItem(item)) {
    return getEntertainmentLocalCard(item).summary;
  }
  if (window.LiveNewsPublicWriting?.getSafeDisplaySummary) {
    return window.LiveNewsPublicWriting.getSafeDisplaySummary(item, 210);
  }
  return item.liveNewsSummary || "";
}

function getDisplayTitle(item) {
  if (isEntertainmentLocalItem(item)) {
    return getEntertainmentLocalCard(item).title;
  }
  return window.LiveNewsPublicWriting?.getSafeDisplayTitle?.(item) || item.liveNewsHeadline || item.title || "Untitled story";
}

function getEntertainmentLocalCard(item) {
  return window.LiveNewsPublicWriting?.getSafeEntertainmentCard?.(item, 210) || {
    title: window.LiveNewsPublicWriting?.getSafeEntertainmentDisplayTitle?.(item) || item.liveNewsHeadline || item.title || "Untitled story",
    summary: window.LiveNewsPublicWriting?.getSafeEntertainmentDisplaySummary?.(item, 210) || "",
    status: "needs_review",
    displayMode: "minimal",
    reasons: ["safe_entertainment_card_helper_missing"],
  };
}

function isEntertainmentLocalItem(item) {
  return (
    item?.category === "Entertainment" ||
    item?.entertainmentClassification?.isEntertainment === true ||
    Boolean(item?.entertainmentSubbeat) ||
    Number(item?.entertainmentConfidence || 0) >= 45
  );
}

function buildTitleLink(item, className = "") {
  const title = escapeHtml(getDisplayTitle(item));
  const href = item.liveNewsUrl || item.approvedStoryUrl || item.link || "";
  if (!href) return title;
  const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
  const isSource = href === item.link;
  const target = isSource ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<a${classAttr} href="${escapeHtml(href)}"${target}>${title}</a>`;
}

function buildOriginalSourceLink(item) {
  const source = item.sourceName || item.sourceDomain || "Source";
  if (!item.link) return `<span>${escapeHtml(source)}</span>`;
  return `<a class="story-source-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>`;
}

function buildLocalMeta(item, published = "") {
  return `
    <div class="story-meta">
      ${buildOriginalSourceLink(item)} • ${escapeHtml(item.category || "Local")} • ${escapeHtml(published || "Time unavailable")}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

init();
