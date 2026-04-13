const CONSENT_DEFAULT = {
  functional: true,
  personalization: false,
  analytics: false,
  marketing: false,
};
const ANON_ID_DAYS = 90;
const PROFILE_TTL_DAYS = 30;
const ANALYTICS_TTL_DAYS = 30;

const state = {
  consent: { ...CONSENT_DEFAULT },
  consentSaved: false,
  mode: "auto",
  refresh: "10",
  refreshTimer: null,
  feedLimit: "50",
  isLoggedIn: false,
  gpcDetected: false,
  maxAgeHours: 48,
  category: "Top",
  currentTopStories: [],
  currentFeed: [],
  currentItems: [],
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
  lastUpdated: document.getElementById("lastUpdated"),
  timeZoneLabel: document.getElementById("timeZoneLabel"),
  topStories: document.getElementById("topStories"),
  topStoriesTitle: document.getElementById("topStoriesTitle"),
  topStoriesTag: document.getElementById("topStoriesTag"),
  newsFeed: document.getElementById("newsFeed"),
  feedTitle: document.getElementById("feedTitle"),
  feedTag: document.getElementById("feedTag"),
  updateNotice: document.getElementById("updateNotice"),
  updateNoticeText: document.getElementById("updateNoticeText"),
  applyUpdates: document.getElementById("applyUpdates"),
  useLocation: document.getElementById("useLocation"),
  manualLocation: document.getElementById("manualLocation"),
  setLocation: document.getElementById("setLocation"),
  localDisplay: document.getElementById("localDisplay"),
  localNote: document.getElementById("localNote"),
  loginBtn: document.getElementById("loginBtn"),
  signupBtn: document.getElementById("signupBtn"),
  communityPreview: document.getElementById("communityPreview"),
};

function init() {
  hydrateConsent();
  hydrateMode();
  hydrateRefresh();
  hydrateFeedLimit();
  hydrateSeen();
  hydrateProfile();
  hydrateAnalytics();
  bindControls();
  updateTimeZoneLabel();
  updateLocalControls();
  updateLoginState();
  loadNews({ force: true });
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
  if (stored) {
    state.feedLimit = stored;
  }
  setFeedLimitUI(state.feedLimit);
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

  if (elements.feedLimitControl) {
    elements.feedLimitControl.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const value = target.dataset.feedLimit;
      if (!value) return;
      state.feedLimit = value;
      localStorage.setItem("ln_feed_limit", value);
      setFeedLimitUI(value);
      renderCurrent();
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

  elements.sectionNav.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-category]");
    if (!target) return;
    const category = target.dataset.category;
    setCategory(category);
  });

  elements.useLocation.addEventListener("click", () => {
    if (!state.consent.personalization) return;
    if (!navigator.geolocation) {
      elements.localDisplay.textContent = "Local hub: geolocation unavailable";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        elements.localDisplay.textContent =
          `Local hub: ${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
      },
      () => {
        elements.localDisplay.textContent = "Local hub: location denied";
      }
    );
  });

  elements.setLocation.addEventListener("click", () => {
    const value = elements.manualLocation.value.trim();
    if (!value) return;
    elements.localDisplay.textContent = `Local hub: ${value}`;
  });

  elements.loginBtn.addEventListener("click", () => {
    state.isLoggedIn = !state.isLoggedIn;
    updateLoginState();
  });

  elements.signupBtn.addEventListener("click", () => {
    state.isLoggedIn = true;
    updateLoginState();
  });

  elements.applyUpdates.addEventListener("click", () => {
    if (state.pendingData) {
      applyNewsData(state.pendingData);
      state.pendingData = null;
      setUpdateNotice(false);
    }
  });
}

function updateLoginState() {
  if (state.isLoggedIn) {
    elements.loginBtn.textContent = "Log out";
    elements.communityPreview.textContent =
      "You are logged in. Off refresh is now available.";
    elements.refreshOff.disabled = false;
  } else {
    elements.loginBtn.textContent = "Log in";
    elements.communityPreview.textContent =
      "Join local and global discussions with verified moderation.";
    elements.refreshOff.disabled = true;
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
      "Use my location when personalization is enabled, or enter your county/city.";
  } else {
    elements.useLocation.disabled = true;
    elements.localNote.textContent =
      "Enable personalization to use automatic location, or enter your county/city.";
  }
}

function updateTimeZoneLabel() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  elements.timeZoneLabel.textContent = `Time zone: ${tz}`;
}

function setRefreshUI(value) {
  document.querySelectorAll("[data-refresh]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.refresh === value);
  });
}

function setFeedLimitUI(value) {
  document.querySelectorAll("[data-feed-limit]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.feedLimit === value);
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
      localStorage.removeItem("ln_seen");
      localStorage.removeItem("ln_profile");
    }
  }

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
    [...(incoming.topStories || []), ...(incoming.feed || [])]
      .map((item) => item.id)
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
  if (category === "Top") {
    elements.topStoriesTitle.textContent = "Top Stories + Trending + Most Clicked";
    elements.topStoriesTag.textContent = "Primary Focus";
    elements.feedTitle.textContent = "Latest News Feed";
    elements.feedTag.textContent = `After Top Stories • ${feedNote}`;
    return;
  }
  elements.topStoriesTitle.textContent = `${category} Top Stories`;
  elements.topStoriesTag.textContent = `${topCount} stories`;
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
      elements.lastUpdated.textContent =
        `Last updated: ${updated.toLocaleTimeString()}`;
      return;
    }
    if (refreshAllowed()) {
      applyNewsData(data);
    } else {
      state.pendingData = data;
      setUpdateNotice(true);
    }
    const updated = new Date(data.updatedAt || Date.now());
    elements.lastUpdated.textContent =
      `Last updated: ${updated.toLocaleTimeString()}`;
  } catch (error) {
    elements.lastUpdated.textContent = "Last updated: offline";
  }
}

function applyNewsData(data) {
  state.currentTopStories = data.topStories || [];
  state.currentFeed = data.feed || [];
  renderCurrent();
}

function filterByCategory(items) {
  if (state.category === "Top") return items;
  return items.filter((item) => item.category === state.category);
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

function renderCurrent() {
  const filteredTop = filterByCategory(state.currentTopStories);
  let filteredFeed = filterByCategory(state.currentFeed);
  if (state.consent.personalization) {
    filteredFeed = personalizeFeed(filteredFeed);
  }
  const feedTotal = filteredFeed.length;
  const feedLimit = Number(state.feedLimit) || 50;
  const limitedFeed = filteredFeed.slice(0, feedLimit);
  renderTopStories(filteredTop);
  renderFeed(limitedFeed);
  const combined = [...filteredTop, ...limitedFeed];
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

function renderTopStories(items) {
  elements.topStories.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "story-item";
    empty.innerHTML = `<div>No ${state.category} stories available yet.</div>`;
    elements.topStories.appendChild(empty);
    return;
  }
  const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
  sorted.forEach((item, index) => {
    const published = item.publishedAt ? formatTime(item.publishedAt) : "";
    const sourceLabel = item.sourceName || item.source || "Source";
    const titleHtml = item.link
      ? `<a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>`
      : item.title;
    const li = document.createElement("li");
    li.className = "story-item";
    li.dataset.articleId = item.id;
    li.innerHTML = `
      <div class="story-rank">${index + 1}</div>
      <div>
        <div class="feed-title">${titleHtml}</div>
        <div class="story-meta">${sourceLabel} • ${item.category} • ${published}</div>
      </div>
      <div class="score-pill">Score ${item.score}</div>
    `;
    elements.topStories.appendChild(li);
    li.addEventListener("click", () => markSeenById(item.id));
  });
  observeSeen();
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
      const sourceLabel = item.sourceName || item.source || "Source";
      const titleHtml = item.link
        ? `<a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>`
        : item.title;
      const card = document.createElement("div");
      card.className = "feed-item";
      card.dataset.articleId = item.id;
      card.innerHTML = `
        <div class="feed-title">${titleHtml}</div>
        <div class="feed-meta">${sourceLabel} • ${item.category} • ${published}</div>
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
