const CONSENT_DEFAULT = {
  functional: true,
  personalization: false,
  analytics: false,
  marketing: false,
};
const ANON_ID_DAYS = 90;
const PROFILE_TTL_DAYS = 30;
const ANALYTICS_TTL_DAYS = 30;
const LOCAL_PREVIEW_LIMIT = 3;
const ALLOWED_FEED_LIMITS = new Set(["30", "50", "100"]);
const CATEGORY_LANES = ["National", "International", "Business", "Tech", "Sports", "Entertainment"];
const CATEGORY_PAGE_SLUGS = {
  National: "national",
  International: "world",
  Business: "business",
  Tech: "technology",
  Sports: "sports",
  Entertainment: "entertainment",
};
const TOP_US_CITIES = Array.isArray(window.LIVE_NEWS_TOP_CITIES)
  ? window.LIVE_NEWS_TOP_CITIES
  : [];

const state = {
  consent: { ...CONSENT_DEFAULT },
  consentSaved: false,
  mode: "auto",
  refresh: "10",
  refreshTimer: null,
  feedLimit: "100",
  isLoggedIn: false,
  gpcDetected: false,
  maxAgeHours: 48,
  category: "Top",
  searchQuery: "",
  localPlace: null,
  localFeed: [],
  localLastFetched: 0,
  localLoading: false,
  topStoryOfDay: null,
  topStoryOfWeek: null,
  currentTopStories: [],
  currentFeed: [],
  approvedStories: [],
  currentItems: [],
  entertainmentFilter: "all",
  entertainmentQuery: "",
  pendingData: null,
  seenMap: {},
  profile: {
    scores: {},
    lastSeenByCategory: {},
    streak: { category: null, count: 0 },
    keywords: {},
    updatedAt: Date.now(),
  },
  analytics: {
    pageViews: 0,
    articleViews: 0,
    timeOnPageMs: 0,
    maxScroll: 0,
    lastStart: Date.now(),
    categoryViews: {},
    updatedAt: Date.now(),
  },
};

const elements = {
  consentModal: document.getElementById("consentModal"),
  consentAcceptAll: document.getElementById("consentAcceptAll"),
  consentRejectAll: document.getElementById("consentRejectAll"),
  consentSave: document.getElementById("consentSave"),
  personalizationToggle: document.getElementById("consentPersonalization"),
  analyticsToggle: document.getElementById("consentAnalytics"),
  marketingToggle: document.getElementById("consentMarketing"),
  cookieSettings: document.getElementById("cookieSettings"),
  gpcNotice: document.getElementById("gpcNotice"),
  refreshControl: document.getElementById("refreshControl"),
  refreshOff: document.getElementById("refreshOff"),
  feedLimitControl: document.getElementById("feedLimitControl"),
  modeControl: document.getElementById("modeControl"),
  sectionNav: document.getElementById("sectionNav"),
  siteSearchForm: document.getElementById("siteSearchForm"),
  siteSearch: document.getElementById("siteSearch"),
  searchDropdown: document.getElementById("searchDropdown"),
  lastUpdated: document.getElementById("lastUpdated"),
  timeZoneLabel: document.getElementById("timeZoneLabel"),
  leadStory: document.getElementById("leadStory"),
  topStories: document.getElementById("topStories"),
  topStoriesTitle: document.getElementById("topStoriesTitle"),
  topStoriesTag: document.getElementById("topStoriesTag"),
  entertainmentPanel: document.getElementById("entertainmentPanel"),
  entertainmentGrid: document.getElementById("entertainmentGrid"),
  categoryLanesPanel: document.getElementById("categoryLanesPanel"),
  categoryLanes: document.getElementById("categoryLanes"),
  newsFeed: document.getElementById("newsFeed"),
  feedTitle: document.getElementById("feedTitle"),
  feedTag: document.getElementById("feedTag"),
  updateNotice: document.getElementById("updateNotice"),
  updateNoticeText: document.getElementById("updateNoticeText"),
  applyUpdates: document.getElementById("applyUpdates"),
  useLocation: document.getElementById("useLocation"),
  manualLocation: document.getElementById("manualLocation"),
  setLocation: document.getElementById("setLocation"),
  localSuggestions: document.getElementById("localSuggestions"),
  localDisplay: document.getElementById("localDisplay"),
  topCityGrid: document.getElementById("topCityGrid"),
  localPreviewTitle: document.getElementById("localPreviewTitle"),
  localFeed: document.getElementById("localFeed"),
  localStatus: document.getElementById("localStatus"),
  localDeepDive: document.getElementById("localDeepDive"),
  localNote: document.getElementById("localNote"),
  loginBtn: document.getElementById("loginBtn"),
  signupBtn: document.getElementById("signupBtn"),
  communityPreview: document.getElementById("communityPreview"),
};

function getCategoryPageHref(category) {
  const slug = CATEGORY_PAGE_SLUGS[category] || String(category || "national").toLowerCase();
  return `/category/${encodeURIComponent(slug)}`;
}

function init() {
  hydrateConsent();
  hydrateMode();
  hydrateRefresh();
  hydrateFeedLimit();
  hydrateSeen();
  hydrateProfile();
  hydrateAnalytics();
  hydrateLocalPlace();
  bindControls();
  renderTopCities();
  updateTimeZoneLabel();
  updateLocalControls();
  updateLocalDeepLink();
  updateLoginState();
  updateBrandShift();
  window.addEventListener("resize", updateBrandShift);
  loadNews({ force: true });
  loadLocalNews({ force: true });
  startRefreshTimer();
  startAnalyticsTracking();
}

function hydrateConsent() {
  state.gpcDetected = navigator.globalPrivacyControl === true;
  const stored = localStorage.getItem("ln_consent");
  if (stored) {
    try {
      state.consent = { ...CONSENT_DEFAULT, ...JSON.parse(stored) };
      state.consentSaved = true;
    } catch {
      state.consent = { ...CONSENT_DEFAULT };
    }
  }

  if (state.gpcDetected) {
    state.consent = { ...CONSENT_DEFAULT };
  }

  syncConsentUI();
  applyConsentEffects();

  if (!state.consentSaved) {
    openConsentModal();
  } else {
    closeConsentModal();
  }
}

function hydrateMode() {
  const stored = localStorage.getItem("ln_mode");
  if (stored) {
    state.mode = stored;
  }
  applyTheme();
}

function hydrateRefresh() {
  const stored = localStorage.getItem("ln_refresh");
  if (stored) {
    state.refresh = stored;
  }
  setRefreshUI(state.refresh);
}

function hydrateFeedLimit() {
  const stored = localStorage.getItem("ln_feed_limit");
  if (stored && ALLOWED_FEED_LIMITS.has(stored)) {
    state.feedLimit = stored;
  } else if (stored) {
    localStorage.setItem("ln_feed_limit", state.feedLimit);
  }
  setFeedLimitUI(state.feedLimit);
}

function hydrateLocalPlace() {
  if (!state.consent.personalization) {
    state.localPlace = null;
    return;
  }
  const stored = localStorage.getItem("ln_local_place");
  if (!stored) return;
  try {
    state.localPlace = JSON.parse(stored);
    if (state.localPlace?.display && elements.manualLocation) {
      elements.manualLocation.value = state.localPlace.display;
    }
    syncLocalDisplay(state.localPlace);
    syncLocalPreviewTitle(state.localPlace);
  } catch {
    state.localPlace = null;
  }
  updateLocalDeepLink();
}

function bindControls() {
  elements.consentAcceptAll.addEventListener("click", () => {
    const consent = {
      functional: true,
      personalization: true,
      analytics: true,
      marketing: false,
    };
    applyConsent(consent, true);
  });

  elements.consentRejectAll.addEventListener("click", () => {
    applyConsent({ ...CONSENT_DEFAULT }, true);
  });

  elements.consentSave.addEventListener("click", () => {
    const consent = {
      functional: true,
      personalization: Boolean(elements.personalizationToggle.checked),
      analytics: Boolean(elements.analyticsToggle.checked),
      marketing: Boolean(elements.marketingToggle.checked),
    };
    applyConsent(consent, true);
  });

  elements.cookieSettings.addEventListener("click", () => {
    openConsentModal();
  });

  if (elements.refreshControl) {
    elements.refreshControl.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const value = target.dataset.refresh;
      if (value === "off" && !state.isLoggedIn) return;
      setRefreshUI(value);
      state.refresh = value;
      localStorage.setItem("ln_refresh", value);
      startRefreshTimer();
    });
  }

  if (elements.feedLimitControl) {
    elements.feedLimitControl.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const value = target.dataset.feedLimit;
      if (!value) return;
      if (!ALLOWED_FEED_LIMITS.has(value)) return;
      state.feedLimit = value;
      localStorage.setItem("ln_feed_limit", value);
      setFeedLimitUI(value);
      renderCurrent();
    });
  }

  if (elements.siteSearchForm && elements.siteSearch) {
    elements.siteSearchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      navigateToSearch(elements.siteSearch.value);
    });
    elements.siteSearch.addEventListener("input", (event) => {
      scheduleSearchPreview(event.target.value);
    });
    elements.siteSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideSearchDropdown();
      }
    });
    document.addEventListener("click", (event) => {
      if (!elements.siteSearchForm.contains(event.target)) {
        hideSearchDropdown();
      }
    });
  }

  elements.modeControl.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const value = target.dataset.mode;
    state.mode = value;
    localStorage.setItem("ln_mode", value);
    setModeUI(value);
    applyTheme();
  });

  if (elements.sectionNav) {
    elements.sectionNav.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-category]");
      if (!target) return;
      const category = target.dataset.category;
      setCategory(category);
    });
  }

  if (elements.entertainmentGrid) {
    elements.entertainmentGrid.addEventListener("click", (event) => {
      const source = event.target instanceof Element ? event.target : event.target?.parentElement;
      const target = source?.closest("[data-entertainment-filter]");
      if (!target) return;
      state.entertainmentFilter = target.getAttribute("data-entertainment-filter") || "all";
      renderEntertainmentSection();
    });
    elements.entertainmentGrid.addEventListener("input", (event) => {
      if (event.target?.id !== "entertainmentSearch") return;
      state.entertainmentQuery = event.target.value;
      renderEntertainmentSection({ focusSearch: true });
    });
  }

  elements.useLocation.addEventListener("click", () => {
    if (!state.consent.personalization) return;
    if (!navigator.geolocation) {
      elements.localDisplay.textContent = "Selected city: geolocation unavailable";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        findNearestPlace(latitude, longitude);
      },
      () => {
        elements.localDisplay.textContent = "Selected city: location denied";
      }
    );
  });

  elements.manualLocation.addEventListener("input", (event) => {
    const value = event.target.value.trim();
    schedulePlaceSearch(value);
  });

  elements.manualLocation.addEventListener("blur", () => {
    setTimeout(() => clearLocalSuggestions(), 150);
  });

  elements.setLocation.addEventListener("click", () => {
    const value = elements.manualLocation.value.trim();
    if (!value) return;
    setLocalPlace(buildManualPlace(value));
  });

  elements.manualLocation.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = elements.manualLocation.value.trim();
    if (!value) return;
    setLocalPlace(buildManualPlace(value));
  });

  if (elements.loginBtn) {
    elements.loginBtn.addEventListener("click", () => {
      state.isLoggedIn = !state.isLoggedIn;
      updateLoginState();
    });
  }

  if (elements.signupBtn) {
    elements.signupBtn.addEventListener("click", () => {
      state.isLoggedIn = true;
      updateLoginState();
    });
  }

  if (elements.applyUpdates) {
    elements.applyUpdates.addEventListener("click", () => {
      if (state.pendingData) {
        applyNewsData(state.pendingData);
        state.pendingData = null;
        setUpdateNotice(false);
      }
    });
  }
}

function updateLoginState() {
  if (state.isLoggedIn) {
    if (elements.loginBtn) elements.loginBtn.textContent = "Log out";
    if (elements.communityPreview) {
      elements.communityPreview.textContent =
        "You are logged in. Off refresh is now available.";
    }
    if (elements.refreshOff) elements.refreshOff.disabled = false;
  } else {
    if (elements.loginBtn) elements.loginBtn.textContent = "Log in";
    if (elements.communityPreview) {
      elements.communityPreview.textContent =
        "Join local and global discussions with verified moderation.";
    }
    if (elements.refreshOff) elements.refreshOff.disabled = true;
    if (state.refresh === "off") {
      state.refresh = "10";
      setRefreshUI("10");
      startRefreshTimer();
    }
  }
}

function updateLocalControls() {
  if (state.consent.personalization) {
    elements.useLocation.disabled = false;
    elements.localNote.textContent =
      "Pick one of the top cities, use my location, or search another city to preview local coverage before opening the full page.";
  } else {
    elements.useLocation.disabled = true;
    elements.localNote.textContent =
      "Pick one of the top cities or search another city to preview local coverage. Enable personalization only if you want automatic location.";
  }
}

function updateLocalDeepLink() {
  if (!elements.localDeepDive) return;
  if (state.localPlace && (state.localPlace.name || state.localPlace.display)) {
    elements.localDeepDive.href = buildLocalPageHref(state.localPlace);
    elements.localDeepDive.classList.remove("disabled");
  } else {
    elements.localDeepDive.href = "/local";
    elements.localDeepDive.classList.add("disabled");
  }
}

function updateBrandShift() {
  const brand = document.querySelector(".brand");
  const brandTitle = document.querySelector(".brand-title");
  if (!brand || !brandTitle) return;
  const topbar = document.querySelector(".topbar");
  const tools = topbar ? topbar.querySelector(".topbar-tools") : null;
  const limit = tools ? tools.querySelector(".site-search, .compact-local-link, .controls") : null;
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

let localSearchTimer = null;
let searchPreviewTimer = null;
let searchPreviewController = null;

function navigateToSearch(value) {
  const query = String(value || "").trim();
  if (!query) return;
  window.location.href = `/search.html?q=${encodeURIComponent(query)}`;
}

function scheduleSearchPreview(value) {
  const query = String(value || "").trim();
  if (searchPreviewTimer) {
    clearTimeout(searchPreviewTimer);
  }
  if (!query) {
    hideSearchDropdown();
    return;
  }
  searchPreviewTimer = setTimeout(() => fetchSearchPreview(query), 180);
}

async function fetchSearchPreview(query) {
  if (!elements.searchDropdown) return;
  if (searchPreviewController) {
    searchPreviewController.abort();
  }
  searchPreviewController = new AbortController();
  try {
    const params = new URLSearchParams({ q: query, limit: "5" });
    const response = await fetch(`/api/search?${params.toString()}`, {
      signal: searchPreviewController.signal,
    });
    const data = await response.json();
    renderSearchDropdown(data.items || [], query, "", Number(data.count || 0));
  } catch (error) {
    if (error.name === "AbortError") return;
    renderSearchDropdown([], query, "Search is unavailable right now.");
  }
}

function renderSearchDropdown(items, query, message = "", total = items.length) {
  if (!elements.searchDropdown) return;
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    hideSearchDropdown();
    return;
  }
  elements.searchDropdown.hidden = false;
  elements.searchDropdown.closest(".site-search-box")?.classList.add("search-open");
  elements.siteSearch?.setAttribute("aria-expanded", "true");
  if (message) {
    elements.searchDropdown.innerHTML = `<div class="search-empty">${escapeHtml(message)}</div>`;
    return;
  }
  if (!items.length) {
    elements.searchDropdown.innerHTML = `
      <div class="search-empty">
        No results for “${escapeHtml(cleanQuery)}”. Try a source, category, city, or shorter phrase.
      </div>
    `;
    return;
  }
  const resultHtml = items
    .map((item) => {
      const href = item.liveNewsUrl || item.link || `/search.html?q=${encodeURIComponent(cleanQuery)}`;
      const target = item.liveNewsUrl ? "" : ` target="_blank" rel="noopener noreferrer"`;
      const time = item.publishedAt ? formatTime(item.publishedAt) : "";
      return `
        <a class="search-preview-item" href="${escapeHtml(href)}"${target} role="option">
          <span class="search-preview-title">${escapeHtml(item.title || "Untitled story")}</span>
          <span class="search-preview-meta">${escapeHtml(item.sourceName || "Source")} • ${escapeHtml(item.category || "Top")} • ${escapeHtml(time)}</span>
        </a>
      `;
    })
    .join("");
  const more =
    total > items.length
      ? `<a class="search-preview-more" href="/search.html?q=${encodeURIComponent(cleanQuery)}">and more</a>`
      : `<a class="search-preview-more" href="/search.html?q=${encodeURIComponent(cleanQuery)}">and more</a>`;
  elements.searchDropdown.innerHTML = `${resultHtml}${more}`;
}

function hideSearchDropdown() {
  if (!elements.searchDropdown) return;
  elements.searchDropdown.hidden = true;
  elements.searchDropdown.innerHTML = "";
  elements.searchDropdown.closest(".site-search-box")?.classList.remove("search-open");
  elements.siteSearch?.setAttribute("aria-expanded", "false");
}

function schedulePlaceSearch(query) {
  if (!elements.localSuggestions) return;
  if (localSearchTimer) {
    clearTimeout(localSearchTimer);
  }
  if (!query || query.length < 2) {
    clearLocalSuggestions();
    return;
  }
  localSearchTimer = setTimeout(() => {
    fetchPlaceSuggestions(query);
  }, 250);
}

async function fetchPlaceSuggestions(query) {
  if (!elements.localSuggestions) return;
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    renderLocalSuggestions(data.results || []);
  } catch (error) {
    clearLocalSuggestions();
  }
}

function renderLocalSuggestions(results) {
  if (!elements.localSuggestions) return;
  elements.localSuggestions.innerHTML = "";
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
      setLocalPlace(place);
      elements.manualLocation.value = place.display || `${place.name}, ${place.state}`;
      clearLocalSuggestions();
    });
    elements.localSuggestions.appendChild(button);
  });
}

function clearLocalSuggestions() {
  if (!elements.localSuggestions) return;
  elements.localSuggestions.innerHTML = "";
}

function getLocalPlaceLabel(place) {
  if (!place) return "not set";
  return place.display || place.name || "not set";
}

function syncLocalDisplay(place) {
  if (!elements.localDisplay) return;
  elements.localDisplay.textContent = `Selected city: ${getLocalPlaceLabel(place)}`;
}

function syncLocalPreviewTitle(place) {
  if (!elements.localPreviewTitle) return;
  const label = getLocalPlaceLabel(place);
  elements.localPreviewTitle.textContent =
    label === "not set" ? "Quick preview" : `${label} preview`;
}

function buildManualPlace(value) {
  const raw = String(value || "").trim();
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

function syncResolvedLocalPlace(place) {
  if (!place?.name) return;
  const changed = !isSamePlace(place, state.localPlace) ||
    String(place.display || "") !== String(state.localPlace?.display || "");
  if (!changed) return;
  state.localPlace = place;
  syncLocalDisplay(place);
  syncLocalPreviewTitle(place);
  if (elements.manualLocation && place.display) {
    elements.manualLocation.value = place.display;
  }
  if (state.consent.personalization) {
    localStorage.setItem("ln_local_place", JSON.stringify(place));
  }
  updateLocalDeepLink();
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

function navigateToLocalPage(place) {
  const city = place?.name || place?.display;
  if (!city) return;
  window.location.href = buildLocalPageHref(place);
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
    const link = document.createElement("button");
    link.type = "button";
    link.className = "local-city-link";
    if (isSamePlace(place, state.localPlace)) {
      link.classList.add("active");
    }
    link.innerHTML = `
      <span class="local-city-name">${place.name}</span>
      <span class="local-city-state">${place.state}</span>
    `;
    link.addEventListener("click", () => setLocalPlace(place));
    elements.topCityGrid.appendChild(link);
  });
}

function setLocalPlace(place) {
  state.localPlace = place;
  syncLocalDisplay(place);
  syncLocalPreviewTitle(place);
  if (elements.manualLocation && place?.display) {
    elements.manualLocation.value = place.display;
  }
  if (state.consent.personalization) {
    localStorage.setItem("ln_local_place", JSON.stringify(place));
  } else {
    localStorage.removeItem("ln_local_place");
  }
  state.localLastFetched = 0;
  updateLocalDeepLink();
  renderTopCities();
  loadLocalNews({ force: true });
}

async function findNearestPlace(lat, lon) {
  try {
    const response = await fetch(
      `/api/places/nearest?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    );
    const data = await response.json();
    if (data.place) {
      setLocalPlace(data.place);
    } else {
      elements.localDisplay.textContent = "Selected city: no nearby city found";
    }
  } catch (error) {
    if (elements.localDisplay) {
      elements.localDisplay.textContent = "Selected city: location lookup failed";
    }
  }
}

function updateTimeZoneLabel() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  if (elements.timeZoneLabel) {
    elements.timeZoneLabel.textContent = `Time zone: ${tz}`;
  }
}

function setRefreshUI(value) {
  document.querySelectorAll("[data-refresh]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.refresh === value);
  });
}

function setFeedLimitUI(value) {
  const normalized = ALLOWED_FEED_LIMITS.has(String(value)) ? String(value) : "100";
  document.querySelectorAll("[data-feed-limit]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.feedLimit === normalized);
  });
}

function setModeUI(value) {
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === value);
  });
}

function setCategory(category) {
  state.category = category;
  document.querySelectorAll("[data-category]").forEach((btn) => {
    const isActive = btn.dataset.category === category;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  renderCurrent();
}

function applyTheme() {
  const now = new Date();
  const autoNight = shouldUseNightMode(now);
  let theme = "day";
  if (state.mode === "day") theme = "day";
  if (state.mode === "night") theme = "night";
  if (state.mode === "auto") theme = autoNight ? "night" : "day";
  document.documentElement.setAttribute("data-theme", theme);
  setModeUI(state.mode);
}

function openConsentModal() {
  elements.consentModal.classList.add("visible");
  elements.consentModal.setAttribute("aria-hidden", "false");
}

function closeConsentModal() {
  elements.consentModal.classList.remove("visible");
  elements.consentModal.setAttribute("aria-hidden", "true");
}

function syncConsentUI() {
  if (elements.personalizationToggle) {
    elements.personalizationToggle.checked = state.consent.personalization;
  }
  if (elements.analyticsToggle) {
    elements.analyticsToggle.checked = state.consent.analytics;
  }
  if (elements.marketingToggle) {
    elements.marketingToggle.checked = state.consent.marketing;
  }
  if (elements.gpcNotice) {
    elements.gpcNotice.hidden = !state.gpcDetected;
  }

  [elements.personalizationToggle, elements.analyticsToggle].forEach((toggle) => {
    if (!toggle) return;
    toggle.disabled = false;
  });

  if (elements.marketingToggle) {
    elements.marketingToggle.disabled = true;
  }

  if (state.gpcDetected) {
    [elements.personalizationToggle, elements.analyticsToggle, elements.marketingToggle].forEach(
      (toggle) => {
        if (!toggle) return;
        toggle.checked = false;
        toggle.disabled = true;
      }
    );
  }
}

function applyConsent(consent, save) {
  const nextConsent = { ...CONSENT_DEFAULT, ...consent };
  if (state.gpcDetected) {
    nextConsent.personalization = false;
    nextConsent.analytics = false;
    nextConsent.marketing = false;
  }
  const personalizationChanged =
    state.consent.personalization !== nextConsent.personalization;
  const analyticsChanged = state.consent.analytics !== nextConsent.analytics;

  state.consent = nextConsent;
  if (save) {
    localStorage.setItem("ln_consent", JSON.stringify(state.consent));
    state.consentSaved = true;
    closeConsentModal();
  }

  syncConsentUI();
  applyConsentEffects(personalizationChanged, analyticsChanged);
}

function applyConsentEffects(personalizationChanged = false, analyticsChanged = false) {
  updateLocalControls();

  if (state.consent.personalization) {
    ensureAnonymousId();
  }

  if (personalizationChanged) {
    if (state.consent.personalization) {
      ensureAnonymousId();
      hydrateSeen();
      hydrateProfile();
      hydrateLocalPlace();
    } else {
      clearAnonymousId();
      state.seenMap = {};
      state.profile = {
        scores: {},
        lastSeenByCategory: {},
        streak: { category: null, count: 0 },
        keywords: {},
        updatedAt: Date.now(),
      };
      state.localPlace = null;
      if (elements.manualLocation) {
        elements.manualLocation.value = "";
      }
      syncLocalDisplay(null);
      syncLocalPreviewTitle(null);
      state.localFeed = [];
      state.localLastFetched = 0;
      renderLocalFeed([]);
      updateLocalStatus("Select a city to preview local stories before opening the full page.");
      localStorage.removeItem("ln_seen");
      localStorage.removeItem("ln_profile");
      localStorage.removeItem("ln_local_place");
    }
  }

  updateLocalDeepLink();
  renderTopCities();

  if (analyticsChanged) {
    if (state.consent.analytics) {
      hydrateAnalytics();
      startAnalyticsTracking();
    } else {
      localStorage.removeItem("ln_analytics");
      state.analytics = {
        pageViews: 0,
        articleViews: 0,
        timeOnPageMs: 0,
        maxScroll: 0,
        lastStart: Date.now(),
        categoryViews: {},
        updatedAt: Date.now(),
      };
    }
  }
}

function ensureAnonymousId() {
  if (!state.consent.personalization) return null;
  let id = getCookie("ln_uid");
  if (!id) {
    id = generateId();
    setCookie("ln_uid", id, ANON_ID_DAYS);
  }
  return id;
}

function clearAnonymousId() {
  deleteCookie("ln_uid");
}

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `ln_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function setCookie(name, value, days) {
  const maxAge = days * 24 * 60 * 60;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function deleteCookie(name) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

function hydrateSeen() {
  if (!state.consent.personalization) {
    state.seenMap = {};
    return;
  }
  const raw = localStorage.getItem("ln_seen");
  if (!raw) {
    state.seenMap = {};
    return;
  }
  try {
    state.seenMap = JSON.parse(raw) || {};
  } catch {
    state.seenMap = {};
  }
  pruneSeen();
  saveSeen();
}

function saveSeen() {
  if (!state.consent.personalization) return;
  localStorage.setItem("ln_seen", JSON.stringify(state.seenMap));
}

function hydrateProfile() {
  if (!state.consent.personalization) {
    state.profile = {
      scores: {},
      lastSeenByCategory: {},
      streak: { category: null, count: 0 },
      keywords: {},
      updatedAt: Date.now(),
    };
    return;
  }
  const raw = localStorage.getItem("ln_profile");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const updatedAt = Number(parsed.updatedAt || Date.now());
    if (isExpired(updatedAt, PROFILE_TTL_DAYS)) {
      localStorage.removeItem("ln_profile");
      state.profile = {
        scores: {},
        lastSeenByCategory: {},
        streak: { category: null, count: 0 },
        keywords: {},
        updatedAt: Date.now(),
      };
      return;
    }
    state.profile = {
      scores: parsed.scores || {},
      lastSeenByCategory: parsed.lastSeenByCategory || {},
      streak: parsed.streak || { category: null, count: 0 },
      keywords: parsed.keywords || {},
      updatedAt,
    };
  } catch {
    state.profile = {
      scores: {},
      lastSeenByCategory: {},
      streak: { category: null, count: 0 },
      keywords: {},
      updatedAt: Date.now(),
    };
  }
}

function saveProfile() {
  if (!state.consent.personalization) return;
  state.profile.updatedAt = Date.now();
  localStorage.setItem("ln_profile", JSON.stringify(state.profile));
}

function updateProfileFromItem(item) {
  if (!state.consent.personalization) return;
  const category = item.category || "Top";
  const now = Date.now();

  decayProfile(now);

  state.profile.scores[category] = (state.profile.scores[category] || 0) + 1;
  state.profile.lastSeenByCategory[category] = now;

  if (state.profile.streak.category === category) {
    state.profile.streak.count += 1;
  } else {
    state.profile.streak = { category, count: 1 };
  }

  if (state.profile.streak.count === 3) {
    state.profile.scores[category] += 5;
  }

  const keywords = extractKeywords(item.title || "");
  if (!state.profile.keywords) state.profile.keywords = {};
  keywords.forEach((word) => {
    state.profile.keywords[word] = (state.profile.keywords[word] || 0) + 1;
  });

  saveProfile();
}

function decayProfile(now) {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  Object.entries(state.profile.lastSeenByCategory || {}).forEach(([category, ts]) => {
    if (now - ts > weekMs) {
      state.profile.scores[category] = Math.max(0, (state.profile.scores[category] || 0) * 0.7);
      state.profile.lastSeenByCategory[category] = now;
    }
  });
}

function extractKeywords(text) {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "from",
    "after",
    "before",
    "as",
    "at",
    "by",
    "is",
    "are",
    "was",
    "were",
    "be",
    "has",
    "have",
    "had",
    "will",
    "new",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, "")
    .split(/\\s+/)
    .filter((word) => word.length > 3 && !stopwords.has(word))
    .slice(0, 6);
}

function hydrateAnalytics() {
  if (!state.consent.analytics) return;
  const raw = localStorage.getItem("ln_analytics");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const updatedAt = Number(parsed.updatedAt || Date.now());
    if (isExpired(updatedAt, ANALYTICS_TTL_DAYS)) {
      localStorage.removeItem("ln_analytics");
      state.analytics = {
        pageViews: 0,
        articleViews: 0,
        timeOnPageMs: 0,
        maxScroll: 0,
        lastStart: Date.now(),
        categoryViews: {},
        updatedAt: Date.now(),
      };
      return;
    }
    state.analytics = {
      pageViews: parsed.pageViews || 0,
      articleViews: parsed.articleViews || 0,
      timeOnPageMs: parsed.timeOnPageMs || 0,
      maxScroll: parsed.maxScroll || 0,
      lastStart: Date.now(),
      categoryViews: parsed.categoryViews || {},
      updatedAt,
    };
  } catch {
    state.analytics = {
      pageViews: 0,
      articleViews: 0,
      timeOnPageMs: 0,
      maxScroll: 0,
      lastStart: Date.now(),
      categoryViews: {},
      updatedAt: Date.now(),
    };
  }
}

function saveAnalytics() {
  if (!state.consent.analytics) return;
  state.analytics.updatedAt = Date.now();
  localStorage.setItem("ln_analytics", JSON.stringify(state.analytics));
}

let analyticsBound = false;

function startAnalyticsTracking() {
  if (!state.consent.analytics) return;
  if (!analyticsBound) {
    analyticsBound = true;
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", flushAnalytics);
  }
  state.analytics.pageViews += 1;
  state.analytics.lastStart = Date.now();
  saveAnalytics();
}

function handleScroll() {
  if (!state.consent.analytics) return;
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const height = document.documentElement.scrollHeight - window.innerHeight;
  if (height <= 0) return;
  const depth = Math.min(100, Math.round((scrollTop / height) * 100));
  state.analytics.maxScroll = Math.max(state.analytics.maxScroll, depth);
}

function handleVisibility() {
  if (!state.consent.analytics) return;
  if (document.visibilityState === "hidden") {
    flushAnalytics();
  } else {
    state.analytics.lastStart = Date.now();
  }
}

function flushAnalytics() {
  if (!state.consent.analytics) return;
  const now = Date.now();
  const delta = now - state.analytics.lastStart;
  if (delta > 0) {
    state.analytics.timeOnPageMs += delta;
  }
  state.analytics.lastStart = now;
  saveAnalytics();
}

function recordAnalyticsEvent(item) {
  if (!state.consent.analytics) return;
  state.analytics.articleViews += 1;
  if (item?.category) {
    if (!state.analytics.categoryViews) state.analytics.categoryViews = {};
    state.analytics.categoryViews[item.category] =
      (state.analytics.categoryViews[item.category] || 0) + 1;
  }
  saveAnalytics();
}

function isExpired(updatedAt, maxDays) {
  if (!updatedAt || !Number.isFinite(updatedAt)) return false;
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  return Date.now() - updatedAt > maxMs;
}

function pruneSeen() {
  const cutoff = Date.now() - state.maxAgeHours * 60 * 60 * 1000;
  Object.entries(state.seenMap).forEach(([id, timestamp]) => {
    if (timestamp < cutoff) {
      delete state.seenMap[id];
    }
  });
}

function markSeenById(id) {
  if (!id) return;
  state.seenMap[id] = Date.now();
  pruneSeen();
  saveSeen();
  const item = getItemById(id);
  if (item) {
    updateProfileFromItem(item);
    recordAnalyticsEvent(item);
  }
  maybeApplyPending();
}

function getItemById(id) {
  return state.currentItems.find((item) => item.id === id);
}

function currentIds() {
  return state.currentItems.map((item) => item.id).filter(Boolean);
}

function allCurrentSeen() {
  const ids = currentIds();
  if (ids.length === 0) return true;
  return ids.every((id) => Boolean(state.seenMap[id]));
}

function oldestAgeHours() {
  const dates = state.currentItems
    .map((item) => new Date(item.publishedAt))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return 0;
  const oldest = Math.min(...dates.map((date) => date.getTime()));
  return (Date.now() - oldest) / 3600000;
}

function refreshAllowed() {
  return allCurrentSeen() || oldestAgeHours() >= state.maxAgeHours - 0.5;
}

function hasUpdates(incoming) {
  const incomingIds = new Set(
    [
      incoming.topStoryOfDay,
      incoming.topStoryOfWeek,
      ...(incoming.topStories || []),
      ...(incoming.feed || []),
    ]
      .map((item) => item?.id)
      .filter(Boolean)
  );
  const existingIds = new Set(currentIds());
  if (incomingIds.size !== existingIds.size) return true;
  for (const id of incomingIds) {
    if (!existingIds.has(id)) return true;
  }
  return false;
}

function setUpdateNotice(visible, message) {
  if (!elements.updateNotice) return;
  elements.updateNotice.hidden = !visible;
  if (message && elements.updateNoticeText) {
    elements.updateNoticeText.textContent = message;
  }
}

function maybeApplyPending() {
  if (!state.pendingData) return;
  if (!refreshAllowed()) return;
  applyNewsData(state.pendingData);
  state.pendingData = null;
  setUpdateNotice(false);
}

function updateSectionHeaders(category, topCount, feedCount, feedTotal = feedCount) {
  if (!elements.topStoriesTitle || !elements.feedTitle) return;
  const feedNote =
    feedTotal > feedCount ? `Showing ${feedCount} of ${feedTotal}` : `${feedCount} stories`;
  const searchNote = state.searchQuery ? ` • Search: ${state.searchQuery}` : "";
  if (category === "Top") {
    elements.topStoriesTitle.textContent = "Top Stories";
    if (elements.topStoriesTag) {
      elements.topStoriesTag.textContent = `Cross-source radar${searchNote}`;
    }
    elements.feedTitle.textContent = "Latest News Feed";
    elements.feedTag.textContent = `After Top Stories • ${feedNote}`;
    return;
  }
  elements.topStoriesTitle.textContent = `${category} Top Stories`;
  if (elements.topStoriesTag) {
    elements.topStoriesTag.textContent = `${topCount} selected${searchNote}`;
  }
  elements.feedTitle.textContent = `${category} News Feed`;
  elements.feedTag.textContent = feedNote;
}

function shouldUseNightMode(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const current = hours * 60 + minutes;
  const nightStart = 19 * 60 + 30; // 7:30 PM
  const nightEnd = 5 * 60 + 30; // 5:30 AM
  return current >= nightStart || current <= nightEnd;
}

function startRefreshTimer() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }

  if (state.refresh === "off") {
    return;
  }

  const minutes = Number(state.refresh);
  if (!Number.isFinite(minutes)) return;
  state.refreshTimer = setInterval(loadNews, minutes * 60 * 1000);
}

async function loadNews({ force = false } = {}) {
  try {
    const response = await fetch("/api/news");
    const data = await response.json();
    state.maxAgeHours = Number(data.maxAgeHours || state.maxAgeHours);
    if (force || state.currentItems.length === 0) {
      applyNewsData(data);
      return;
    }
    if (!hasUpdates(data)) {
      const updated = new Date(data.updatedAt || Date.now());
      if (elements.lastUpdated) {
        elements.lastUpdated.textContent =
          `Last updated: ${updated.toLocaleTimeString()}`;
      }
      return;
    }
    if (refreshAllowed()) {
      applyNewsData(data);
    } else {
      state.pendingData = data;
      setUpdateNotice(true);
    }
    const updated = new Date(data.updatedAt || Date.now());
    if (elements.lastUpdated) {
      elements.lastUpdated.textContent =
        `Last updated: ${updated.toLocaleTimeString()}`;
    }
  } catch (error) {
    if (elements.lastUpdated) {
      elements.lastUpdated.textContent = "Last updated: offline";
    }
  }
}

async function loadLocalNews({ force = false } = {}) {
  if (!elements.localFeed || !elements.localStatus) return;
  if (!state.localPlace || !state.localPlace.name) {
    syncLocalPreviewTitle(null);
    renderLocalFeed([]);
    updateLocalStatus("Select a city to preview local stories before opening the full page.");
    return;
  }
  syncLocalPreviewTitle(state.localPlace);
  const now = Date.now();
  const refreshMs = Number(state.refresh) * 60 * 1000 || 10 * 60 * 1000;
  if (!force && now - state.localLastFetched < refreshMs) {
    return;
  }
  if (state.localLoading) return;
  state.localLoading = true;
  updateLocalStatus("Loading local stories...");
  try {
    const params = new URLSearchParams({
      city: state.localPlace.name,
      state: state.localPlace.state || "",
    });
    const response = await fetch(`/api/local?${params.toString()}`);
    const data = await response.json();
    syncResolvedLocalPlace(data.place);
    state.localFeed = data.items || [];
    state.localLastFetched = Date.now();
    renderLocalFeed(state.localFeed);
    if (state.localFeed.length) {
      const sourceCount = Number(data.sourceCount || 0);
      updateLocalStatus(
        `Showing ${Math.min(state.localFeed.length, LOCAL_PREVIEW_LIMIT)} preview stories${sourceCount ? ` from ${sourceCount} sources` : ""}.`
      );
    } else {
      updateLocalStatus("No local updates in the last 48 hours. Try the full page for a broader view.");
    }
  } catch (error) {
    renderLocalFeed([]);
    updateLocalStatus("Local stories unavailable right now.");
  } finally {
    state.localLoading = false;
  }
}

function updateLocalStatus(message) {
  if (!elements.localStatus) return;
  elements.localStatus.textContent = message;
}

function renderLocalFeed(items) {
  if (!elements.localFeed) return;
  elements.localFeed.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "local-item";
    empty.textContent = state.localPlace
      ? "No preview stories available right now."
      : "Select a city to load a quick local preview.";
    elements.localFeed.appendChild(empty);
    return;
  }
  const limited = items.slice(0, LOCAL_PREVIEW_LIMIT);
  limited.forEach((item) => {
    const card = document.createElement("div");
    card.className = "local-item";
    const published = item.publishedAt ? formatTime(item.publishedAt) : "";
    card.innerHTML = `
      <div class="feed-title">${buildStoryTitleLink(item)}</div>
      <div class="local-summary">${escapeHtml(getDisplaySummary(item, 130))}</div>
      ${buildStoryMeta(item, published)}
    `;
    elements.localFeed.appendChild(card);
  });
}

function applyNewsData(data) {
  state.topStoryOfDay = data.topStoryOfDay || null;
  state.topStoryOfWeek = data.topStoryOfWeek || null;
  state.currentTopStories = data.topStories || [];
  state.currentFeed = data.feed || [];
  state.approvedStories = data.approvedStories || [];
  renderCurrent();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
}

function dedupeNewsItems(items) {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    const key = item.id || item.link || `${item.title}:${item.publishedAt}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function getAllNewsItems() {
  return dedupeNewsItems([...state.currentTopStories, ...state.currentFeed]);
}

function filterByCategory(items) {
  if (state.category === "Top") return items;
  return items.filter((item) => item.category === state.category);
}

function filterBySearch(items) {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => getSearchableText(item).includes(query));
}

function getSearchableText(item) {
  return [
    item.title,
    item.liveNewsHeadline,
    item.summary,
    item.liveNewsSummary,
    item.sourceName,
    item.category,
    item.sourceDomain,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyActiveFilters(items) {
  return filterBySearch(filterByCategory(items));
}

function sortStoryPool(items) {
  return [...items].sort((a, b) => {
    const sourceDiff = Number(b.sourceCount || 1) - Number(a.sourceCount || 1);
    if (sourceDiff !== 0) return sourceDiff;
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
}

function buildCategoryTopStories() {
  const basePool = state.searchQuery
    ? getAllNewsItems()
    : state.category === "Top"
      ? state.currentTopStories
      : state.currentFeed;
  const pool = sortStoryPool(applyActiveFilters(basePool));
  return pool.slice(0, 8);
}

function personalizeFeed(items) {
  if (!items.length) return items;
  return [...items].sort((a, b) => {
    const scoreDiff = getCategoryScore(b.category) - getCategoryScore(a.category);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
}

function getCategoryScore(category) {
  return state.profile.scores[category] || 0;
}

function getStoryKey(item) {
  if (!item) return "";
  return item.id || item.link || item.title || "";
}

function getUniqueStories(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getStoryKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderCurrent() {
  const filteredTop = buildCategoryTopStories();
  const isDefaultView = state.category === "Top" && !state.searchQuery;
  const spotlightStories = isDefaultView
    ? getUniqueStories([state.topStoryOfDay || filteredTop[0] || null, state.topStoryOfWeek || null])
    : getUniqueStories([filteredTop[0] || null]);
  const spotlightKeys = new Set(spotlightStories.map(getStoryKey).filter(Boolean));
  const visibleStoryBudget = Math.max(0, 8 - spotlightStories.length);
  const topCards = filteredTop
    .filter((item) => !spotlightKeys.has(getStoryKey(item)))
    .slice(0, visibleStoryBudget);
  const topIds = new Set([
    ...spotlightStories.map((item) => item.id).filter(Boolean),
    ...topCards.map((item) => item.id).filter(Boolean),
  ]);
  const feedPool = state.searchQuery ? getAllNewsItems() : state.currentFeed;
  let filteredFeed = applyActiveFilters(feedPool).filter((item) => !topIds.has(item.id));
  if (state.consent.personalization) {
    filteredFeed = personalizeFeed(filteredFeed);
  }
  const feedTotal = filteredFeed.length;
  const feedLimit = Number(state.feedLimit) || 50;
  const limitedFeed = filteredFeed.slice(0, feedLimit);
  renderLeadStories(spotlightStories, { splitSpotlight: isDefaultView });
  renderTopStories(topCards, { rankOffset: spotlightStories.length });
  renderEntertainmentSection();
  renderCategoryLanes();
  renderFeed(limitedFeed);
  const combined = [...spotlightStories, ...topCards, ...limitedFeed].filter(Boolean);
  const deduped = new Map();
  combined.forEach((item) => {
    if (item && item.id && !deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  });
  state.currentItems = Array.from(deduped.values());
  setUpdateNotice(false);
  updateSectionHeaders(state.category, filteredTop.length, limitedFeed.length, feedTotal);
}

function getLiveNewsUrl(item) {
  return item.approvedStoryUrl || item.liveNewsUrl || "";
}

function getDisplayTitle(item) {
  return item.liveNewsHeadline || item.title || "Untitled story";
}

function getDisplaySummary(item, maxLength = 210) {
  if (item.liveNewsSummary) return truncateText(item.liveNewsSummary, maxLength);
  if (item.summaryAgent?.version && item.summary) return truncateText(item.summary, maxLength);
  return "Read the original source for the full report.";
}

function getPublishedDateBadge(item) {
  if (!item?.publishedAt) return "Date unavailable";
  const date = new Date(item.publishedAt);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getSourceInitials(item) {
  const label = item.sourceName || item.sourceDomain || item.category || "Live News";
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "LN";
}

function buildStoryVisual(item, variant = "lead") {
  const imageUrl = item.imageUrl || item.thumbnailUrl || "";
  const source = item.sourceName || item.sourceDomain || "Source";
  const category = item.category || "Top";
  const usesPublicResearch = item.imageSource === "public_media_research";
  const fallbackLabel = escapeHtml(
    usesPublicResearch ? "Related public media" : `${source} • ${category}`
  );
  const credit = item.imageCredit
    ? `<small>${escapeHtml(item.imageCredit)}</small>`
    : usesPublicResearch
      ? "<small>Public-media research</small>"
      : "";
  const initial = escapeHtml(getSourceInitials(item));
  const imageAlt = usesPublicResearch ? escapeHtml(item.imageAlt || "") : "";
  const photoTag = imageUrl
    ? `<img class="story-photo" src="${escapeHtml(imageUrl)}" alt="${imageAlt}" loading="lazy" referrerpolicy="no-referrer" onload="validateStoryImage(this)" onerror="rejectStoryImage(this)" />`
    : "";
  return `
    <figure class="story-visual story-visual-${variant} ${imageUrl ? "has-photo" : "image-failed"}">
      ${photoTag}
      <figcaption>
        <span>${initial}</span>
        <strong>${fallbackLabel}</strong>
        ${credit}
      </figcaption>
    </figure>
  `;
}

function isWeakLoadedArticleImage(image) {
  const src = decodeURIComponent(image.currentSrc || image.src || "").toLowerCase();
  const logoLike = /favicon|apple-touch-icon|\/logo|[-_]logo|\/icon|[-_]icon|brandmark|publisher/.test(src);
  const width = Number(image.naturalWidth || 0);
  const height = Number(image.naturalHeight || 0);
  const tooSmall = width > 0 && height > 0 && (width < 260 || height < 140 || width * height < 70000);
  return logoLike || tooSmall;
}

function rejectStoryImage(image) {
  const visual = image.closest(".story-visual");
  if (!visual) return;
  visual.classList.remove("has-photo");
  visual.classList.add("image-failed");
  image.remove();
}

function validateStoryImage(image) {
  if (isWeakLoadedArticleImage(image)) {
    rejectStoryImage(image);
  }
}

function buildStoryTitleLink(item, className = "") {
  const liveUrl = getLiveNewsUrl(item);
  const title = escapeHtml(getDisplayTitle(item));
  if (liveUrl) {
    return `<a class="${className}" href="${escapeHtml(liveUrl)}">${title}</a>`;
  }
  if (item.link) {
    return `<a class="${className}" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
  }
  return `<span class="${className}">${title}</span>`;
}

function buildOriginalSourceLink(item) {
  const sourceLabel = formatSourceLabel(item);
  if (!item.link) return `<span>${escapeHtml(sourceLabel)}</span>`;
  return `<a class="story-source-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel)}</a>`;
}

function buildStoryMeta(item, published = "") {
  const category = item.category || "Top";
  const time = published || "Time unavailable";
  return `
    <div class="story-meta">
      ${buildOriginalSourceLink(item)} • ${escapeHtml(category)} • ${escapeHtml(time)}
    </div>
  `;
}

function buildStoryActions(item) {
  const liveUrl = getLiveNewsUrl(item);
  const liveAction = liveUrl
    ? `<a class="story-action" href="${escapeHtml(liveUrl)}">Open Live News page</a>`
    : `<span class="story-action disabled">Live News page pending</span>`;
  return `<div class="story-actions">${liveAction}</div>`;
}

function renderLeadStoryCard(item, { label = "Top Story", headingTag = "h1", variant = "day" } = {}) {
  const published = item.publishedAt ? formatTime(item.publishedAt) : "";
  const Heading = headingTag === "h2" ? "h2" : "h1";
  return `
    <article class="lead-card lead-card-${escapeHtml(variant)}" data-article-id="${escapeHtml(item.id || "")}">
      <div class="lead-copy">
        <div class="story-eyebrow">
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(getPublishedDateBadge(item))}</span>
        </div>
        <${Heading}>${buildStoryTitleLink(item, "lead-title")}</${Heading}>
        <p>${escapeHtml(getDisplaySummary(item, 340))}</p>
        ${buildStoryMeta(item, published)}
        ${buildStoryActions(item)}
      </div>
      ${buildStoryVisual(item, "lead")}
    </article>
  `;
}

function renderLeadStories(items, options = {}) {
  if (!elements.leadStory) return;
  const stories = getUniqueStories(items || []);
  if (!stories.length) {
    elements.leadStory.hidden = true;
    elements.leadStory.innerHTML = "";
    return;
  }
  elements.leadStory.hidden = false;
  const labels = options.splitSpotlight
    ? ["Top Story of the Day", "Top Story of the Week"]
    : ["Lead Story"];
  elements.leadStory.innerHTML = `
    <div class="lead-spotlights" data-count="${stories.length}">
      ${stories
        .map((item, index) =>
          renderLeadStoryCard(item, {
            label: labels[index] || "Top Story",
            headingTag: index === 0 ? "h1" : "h2",
            variant: index === 0 ? "day" : "week",
          })
        )
        .join("")}
    </div>
  `;
  elements.leadStory
    .querySelectorAll("[data-article-id]")
    .forEach((card) => card.addEventListener("click", () => markSeenById(card.dataset.articleId)));
}

function renderTopStories(items, options = {}) {
  elements.topStories.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "story-card empty-card";
    empty.innerHTML = `<div>No additional ${escapeHtml(state.category)} stories available yet.</div>`;
    elements.topStories.appendChild(empty);
    return;
  }
  const sorted = sortStoryPool(items);
  sorted.forEach((item, index) => {
    const published = item.publishedAt ? formatTime(item.publishedAt) : "";
    const li = document.createElement("li");
    li.className = "story-card";
    li.dataset.articleId = item.id;
    const rank = index + 1 + Number(options.rankOffset || 0);
    li.innerHTML = `
      <div class="story-card-top">
        <span class="story-rank">${rank}</span>
        <div class="story-eyebrow">
          <span>${escapeHtml(getPublishedDateBadge(item))}</span>
        </div>
      </div>
      <h3>${buildStoryTitleLink(item, "story-card-title")}</h3>
      <p>${escapeHtml(getDisplaySummary(item, 190))}</p>
      ${buildStoryMeta(item, published)}
      ${buildStoryVisual(item, "card")}
      ${buildStoryActions(item)}
    `;
    elements.topStories.appendChild(li);
    li.addEventListener("click", () => markSeenById(item.id));
  });
  observeSeen();
}

const ENTERTAINMENT_SECTION_LIMIT = 9;
const ENTERTAINMENT_FILTERS = [
  { id: "all", label: "All" },
  { id: "celebrities", label: "Celebrities" },
  { id: "movies", label: "Movies" },
  { id: "tv", label: "TV" },
  { id: "music", label: "Music" },
  { id: "awards", label: "Awards" },
  { id: "pop-culture", label: "Pop Culture" },
];
const ENTERTAINMENT_SOURCE_TERMS = [
  "e!",
  "entertainment tonight",
  "people.com",
  "people magazine",
  "variety",
  "hollywood reporter",
  "billboard",
  "rolling stone",
  "deadline",
  "thewrap",
  "vulture",
  "pitchfork",
  "tmz",
  "access hollywood",
  "page six",
  "us weekly",
  "vanity fair",
];
const ENTERTAINMENT_STORY_PATTERN = /\b(celebrity|celebrities|actor|actress|singer|rapper|musician|comedian|performer|movie|film|box office|hollywood|trailer|cinema|streaming|netflix|hulu|disney\+?|prime video|tv show|tv series|television series|television awards|bafta tv|episode premiere|season premiere|album|song|single|concert|grammy|oscars|emmys|bafta|cannes|sundance|award show|red carpet|pop culture|reality tv|late-night|broadway|theater|festival|eurovision|song contest|saturday night live|snl)\b/;

function getEntertainmentText(item) {
  return [
    item.category,
    item.sourceName,
    item.attribution,
    item.sourceUrl,
    item.domain,
    item.title,
    item.liveNewsHeadline,
    item.summary,
    item.liveNewsSummary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getEntertainmentSourceText(item) {
  return [
    item.sourceName,
    item.attribution,
    item.sourceUrl,
    item.domain,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasEntertainmentAudienceSignal(item) {
  const audience = item?.summaryAgent?.audience;
  const primaryText = [
    audience?.primaryPattern?.id,
    audience?.primaryPattern?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return primaryText.includes("entertainment");
}

function isEntertainmentStory(item) {
  if (!item) return false;
  if (item.category === "Entertainment") return true;
  const sourceText = getEntertainmentSourceText(item);
  const text = getEntertainmentText(item);
  if (ENTERTAINMENT_SOURCE_TERMS.some((term) => sourceText.includes(term))) return true;
  if (hasEntertainmentAudienceSignal(item)) return true;
  return ENTERTAINMENT_STORY_PATTERN.test(text);
}

function getEntertainmentItems() {
  const allItems = getAllNewsItems();
  return sortStoryPool(
    filterBySearch(allItems).filter((item) => isEntertainmentStory(item))
  );
}

function getEntertainmentLabel(item) {
  const text = getEntertainmentText(item);
  if (/\b(celebrity|celebrities|actor|actress|singer|rapper|musician|comedian|performer|red carpet|reality tv)\b/.test(text)) {
    return "Celebrity";
  }
  if (/\b(album|song|single|music|singer|artist|tour|concert|billboard|grammy|festival)\b/.test(text)) {
    return "Music";
  }
  if (/\b(movie|film|box office|actor|actress|director|trailer|cinema)\b/.test(text)) {
    return "Movies";
  }
  if (/\b(tv|television|streaming|netflix|hulu|disney|series|show|episode|season)\b/.test(text)) {
    return "TV & streaming";
  }
  if (/\b(award|oscars|emmys|grammys|red carpet|nomination|winner)\b/.test(text)) {
    return "Awards";
  }
  if (/\b(studio|deal|contract|rights|media company|industry|ratings)\b/.test(text)) {
    return "Entertainment biz";
  }
  return "Culture";
}

function getEntertainmentFilterLabel() {
  return ENTERTAINMENT_FILTERS.find((filter) => filter.id === state.entertainmentFilter)?.label || "All";
}

function matchesEntertainmentFilter(item, filterId) {
  if (!filterId || filterId === "all") return true;
  const text = getEntertainmentText(item);
  if (filterId === "celebrities") {
    return /\b(celebrity|celebrities|actor|actress|singer|rapper|musician|comedian|performer|public figure|red carpet|reality tv)\b/.test(text);
  }
  if (filterId === "movies") {
    return /\b(movie|film|box office|hollywood|trailer|cinema|director|cannes|sundance)\b/.test(text);
  }
  if (filterId === "tv") {
    return /\b(tv show|tv series|television|streaming|netflix|hulu|disney|prime video|episode|season|saturday night live|snl)\b/.test(text);
  }
  if (filterId === "music") {
    return /\b(album|song|single|music|singer|artist|rapper|tour|concert|billboard|grammy|festival)\b/.test(text);
  }
  if (filterId === "awards") {
    return /\b(award|oscars|emmys|grammys|bafta|red carpet|nomination|winner|gala)\b/.test(text);
  }
  if (filterId === "pop-culture") {
    return /\b(pop culture|celebrity|viral|fashion|style|met gala|reality tv|social media|late-night|broadway)\b/.test(text);
  }
  return true;
}

function matchesEntertainmentSearch(item, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return true;
  return getEntertainmentText(item).includes(normalized);
}

function getVisibleEntertainmentItems() {
  return getEntertainmentItems()
    .filter((item) => matchesEntertainmentFilter(item, state.entertainmentFilter))
    .filter((item) => matchesEntertainmentSearch(item, state.entertainmentQuery))
    .slice(0, ENTERTAINMENT_SECTION_LIMIT);
}

function renderEntertainmentControls(totalCount, visibleCount) {
  const filterButtons = ENTERTAINMENT_FILTERS.map((filter) => {
    const selected = state.entertainmentFilter === filter.id;
    return `
      <button
        type="button"
        class="entertainment-filter${selected ? " active" : ""}"
        data-entertainment-filter="${escapeHtml(filter.id)}"
        aria-pressed="${selected ? "true" : "false"}"
      >${escapeHtml(filter.label)}</button>
    `;
  }).join("");
  return `
    <aside class="entertainment-controls-card" aria-label="Entertainment filters">
      <label class="entertainment-search-label" for="entertainmentSearch">Search Entertainment</label>
      <input
        id="entertainmentSearch"
        class="entertainment-search"
        type="search"
        value="${escapeHtml(state.entertainmentQuery)}"
        placeholder="Search celebrities, movies, music..."
        autocomplete="off"
      />
      <div class="entertainment-filter-list" aria-label="Entertainment topics">
        ${filterButtons}
      </div>
      <p class="entertainment-count">
        ${visibleCount ? `${visibleCount} shown` : "No matches"} from ${totalCount} entertainment stories.
      </p>
    </aside>
  `;
}

function renderEntertainmentArticleCards(items) {
  if (!items.length) {
    return `
      <div class="entertainment-empty">
        <strong>No matching Entertainment stories yet.</strong>
        <span>Try All, Celebrities, Movies, TV, Music, Awards, or another search.</span>
      </div>
    `;
  }
  return items.map((item) => {
    const published = item.publishedAt ? formatTime(item.publishedAt) : "";
    return `
      <article class="entertainment-mini-card" data-article-id="${escapeHtml(item.id || "")}">
        <div class="story-eyebrow">
          <span>${escapeHtml(getEntertainmentLabel(item))}</span>
          <span>${escapeHtml(getPublishedDateBadge(item))}</span>
        </div>
        <h4>${buildStoryTitleLink(item, "entertainment-title")}</h4>
        <p>${escapeHtml(getDisplaySummary(item, 118))}</p>
        ${buildStoryMeta(item, published)}
      </article>
    `;
  }).join("");
}

function focusEntertainmentSearch(options = {}) {
  const search = elements.entertainmentGrid.querySelector("#entertainmentSearch");
  if (!search || !options.focusSearch) return;
  search.focus();
  search.setSelectionRange(search.value.length, search.value.length);
}

function renderEntertainmentSection(options = {}) {
  if (!elements.entertainmentPanel || !elements.entertainmentGrid) return;
  const allItems = getEntertainmentItems();
  const visibleItems = getVisibleEntertainmentItems();
  if (!allItems.length) {
    elements.entertainmentPanel.hidden = true;
    elements.entertainmentGrid.innerHTML = "";
    return;
  }

  elements.entertainmentPanel.hidden = false;
  const activeLabel = getEntertainmentFilterLabel();
  elements.entertainmentGrid.innerHTML = `
    ${renderEntertainmentControls(allItems.length, visibleItems.length)}
    <div class="entertainment-results" aria-live="polite">
      <div class="entertainment-results-head">
        <span>${escapeHtml(activeLabel)} articles</span>
        <small>${visibleItems.length} visible</small>
      </div>
      <div class="entertainment-list">
        ${renderEntertainmentArticleCards(visibleItems)}
      </div>
    </div>
  `;

  elements.entertainmentGrid.querySelectorAll("[data-article-id]").forEach((card) => {
    card.addEventListener("click", () => markSeenById(card.dataset.articleId));
  });
  focusEntertainmentSearch(options);
}

function renderCategoryLanes() {
  if (!elements.categoryLanes || !elements.categoryLanesPanel) return;
  const baseItems = filterBySearch(getAllNewsItems());
  const lanes = CATEGORY_LANES.map((category) => {
    const items = sortStoryPool(baseItems.filter((item) => item.category === category)).slice(0, 4);
    return { category, items };
  }).filter((lane) => lane.items.length);

  if (!lanes.length) {
    elements.categoryLanesPanel.hidden = true;
    elements.categoryLanes.innerHTML = "";
    return;
  }

  elements.categoryLanesPanel.hidden = false;
  elements.categoryLanes.innerHTML = lanes
    .map(
      (lane) => `
        <section class="category-lane">
          <div class="category-lane-head">
            <h3>${escapeHtml(lane.category)}</h3>
            <a class="lane-more" href="${getCategoryPageHref(lane.category)}">See more</a>
          </div>
          <div class="category-lane-list">
            ${lane.items
              .map(
                (item) => `
                  <article class="lane-story" data-article-id="${escapeHtml(item.id || "")}">
                    <div class="story-eyebrow"><span>${escapeHtml(getPublishedDateBadge(item))}</span></div>
                    <h4>${buildStoryTitleLink(item, "lane-story-title")}</h4>
                    <p>${escapeHtml(getDisplaySummary(item, 120))}</p>
                    ${buildStoryMeta(item, item.publishedAt ? formatTime(item.publishedAt) : "")}
                  </article>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");
  elements.categoryLanes.querySelectorAll("[data-article-id]").forEach((card) => {
    card.addEventListener("click", () => markSeenById(card.dataset.articleId));
  });
}

function renderFeed(items) {
  elements.newsFeed.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "feed-item";
    empty.textContent = `No ${state.category} articles available yet.`;
    elements.newsFeed.appendChild(empty);
    return;
  }
  const groups = groupFeedByAge(items);
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
      const published = item.publishedAt ? formatTime(item.publishedAt) : "";
      const card = document.createElement("div");
      card.className = "feed-item";
      card.dataset.articleId = item.id;
      card.innerHTML = `
        <div class="feed-item-main">
          <div class="story-eyebrow">
            <span>${escapeHtml(getPublishedDateBadge(item))}</span>
          </div>
          <div class="feed-title">${buildStoryTitleLink(item)}</div>
          <p>${escapeHtml(getDisplaySummary(item, 150))}</p>
          ${buildStoryMeta(item, published)}
        </div>
        ${buildStoryActions(item)}
      `;
      list.appendChild(card);
      card.addEventListener("click", () => markSeenById(item.id));
    });
    section.appendChild(header);
    section.appendChild(list);
    elements.newsFeed.appendChild(section);
  });
  observeSeen();
}

function groupFeedByAge(items) {
  const groups = [
    { id: "0-3", label: "Just in (0–3h)", min: 0, max: 3, items: [] },
    { id: "3-12", label: "Earlier today (3–12h)", min: 3, max: 12, items: [] },
    { id: "12-24", label: "Last 24 hours", min: 12, max: 24, items: [] },
    { id: "24-48", label: "Yesterday (24–48h)", min: 24, max: 48, items: [] },
  ];
  const undated = { id: "unknown", label: "Undated", items: [] };

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
  if (undated.items.length > 0) {
    result.push(undated);
  }
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

function formatSourceLabel(item) {
  const primary = item.sourceName || item.source || "Source";
  const count = Number(item.sourceCount || 1);
  if (count <= 1) return primary;
  return `${primary} + ${count - 1} more`;
}

let seenObserver = null;

function observeSeen() {
  if (!("IntersectionObserver" in window)) return;
  if (seenObserver) seenObserver.disconnect();
  seenObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.dataset.articleId;
        markSeenById(id);
      });
    },
    { threshold: 0.6 }
  );
  document.querySelectorAll("[data-article-id]").forEach((el) => {
    seenObserver.observe(el);
  });
}

init();
