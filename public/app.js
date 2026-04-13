const state = {
  cookiesEnabled: false,
  mode: "auto",
  refresh: "10",
  refreshTimer: null,
  isLoggedIn: false,
  gpcDetected: false,
  maxAgeHours: 48,
  category: "Top",
  currentTopStories: [],
  currentFeed: [],
  currentItems: [],
  pendingData: null,
  seenMap: {},
};

const elements = {
  consentModal: document.getElementById("consentModal"),
  consentAccept: document.getElementById("consentAccept"),
  consentDecline: document.getElementById("consentDecline"),
  refreshControl: document.getElementById("refreshControl"),
  refreshOff: document.getElementById("refreshOff"),
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
  hydrateSeen();
  bindControls();
  updateTimeZoneLabel();
  updateLocalControls();
  updateLoginState();
  loadNews({ force: true });
  startRefreshTimer();
}

function hydrateConsent() {
  state.gpcDetected = navigator.globalPrivacyControl === true;
  if (state.gpcDetected) {
    state.cookiesEnabled = false;
    elements.consentModal.classList.remove("visible");
    elements.consentModal.setAttribute("aria-hidden", "true");
    elements.localNote.textContent =
      "Global Privacy Control detected. Location and personalization remain off by default.";
    return;
  }

  const stored = localStorage.getItem("ln_consent");
  if (stored === "accepted") {
    state.cookiesEnabled = true;
    elements.consentModal.classList.remove("visible");
    elements.consentModal.setAttribute("aria-hidden", "true");
    return;
  }

  elements.consentModal.classList.add("visible");
  elements.consentModal.setAttribute("aria-hidden", "false");
}

function hydrateMode() {
  const stored = localStorage.getItem("ln_mode");
  if (stored && state.cookiesEnabled) {
    state.mode = stored;
  }
  applyTheme();
}

function hydrateRefresh() {
  if (state.cookiesEnabled) {
    const stored = localStorage.getItem("ln_refresh");
    if (stored) {
      state.refresh = stored;
    }
  }
  setRefreshUI(state.refresh);
}

function bindControls() {
  elements.consentAccept.addEventListener("click", () => {
    state.cookiesEnabled = true;
    localStorage.setItem("ln_consent", "accepted");
    elements.consentModal.classList.remove("visible");
    elements.consentModal.setAttribute("aria-hidden", "true");
    hydrateSeen();
    applyTheme();
    updateLocalControls();
  });

  elements.consentDecline.addEventListener("click", () => {
    state.cookiesEnabled = false;
    localStorage.removeItem("ln_consent");
    localStorage.removeItem("ln_mode");
    localStorage.removeItem("ln_refresh");
    localStorage.removeItem("ln_seen");
    elements.consentModal.classList.remove("visible");
    elements.consentModal.setAttribute("aria-hidden", "true");
    state.seenMap = {};
    applyTheme();
    updateLocalControls();
  });

  elements.refreshControl.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const value = target.dataset.refresh;
    if (value === "off" && !state.isLoggedIn) return;
    setRefreshUI(value);
    state.refresh = value;
    if (state.cookiesEnabled) {
      localStorage.setItem("ln_refresh", value);
    }
    startRefreshTimer();
  });

  elements.modeControl.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const value = target.dataset.mode;
    state.mode = value;
    if (state.cookiesEnabled) {
      localStorage.setItem("ln_mode", value);
    }
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
    if (!state.cookiesEnabled) return;
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
  if (state.cookiesEnabled) {
    elements.useLocation.disabled = false;
    elements.localNote.textContent =
      "Use my location when cookies are enabled, or enter your county/city.";
  } else {
    elements.useLocation.disabled = true;
    elements.localNote.textContent =
      "Enable cookies to use automatic location, or enter your county/city.";
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

function hydrateSeen() {
  if (!state.cookiesEnabled) {
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
}

function saveSeen() {
  if (!state.cookiesEnabled) return;
  localStorage.setItem("ln_seen", JSON.stringify(state.seenMap));
}

function pruneSeen() {
  const cutoff = Date.now() - state.maxAgeHours * 60 * 60 * 1000;
  Object.entries(state.seenMap).forEach(([id, timestamp]) => {
    if (timestamp < cutoff) {
      delete state.seenMap[id];
    }
  });
}

function markSeen(id) {
  if (!id) return;
  state.seenMap[id] = Date.now();
  pruneSeen();
  saveSeen();
  maybeApplyPending();
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

function updateSectionHeaders(category, topCount, feedCount) {
  if (!elements.topStoriesTitle || !elements.feedTitle) return;
  if (category === "Top") {
    elements.topStoriesTitle.textContent = "Top Stories + Trending + Most Clicked";
    elements.topStoriesTag.textContent = "Primary Focus";
    elements.feedTitle.textContent = "Latest News Feed";
    elements.feedTag.textContent = "After Top Stories";
    return;
  }
  elements.topStoriesTitle.textContent = `${category} Top Stories`;
  elements.topStoriesTag.textContent = `${topCount} stories`;
  elements.feedTitle.textContent = `${category} News Feed`;
  elements.feedTag.textContent = `${feedCount} stories`;
}

function shouldUseNightMode(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const current = hours * 60 + minutes;
  const nightStart = 19 * 60 + 30; // 7:30 PM
  const nightEnd = 5 * 60 + 30; // 5:30 AM

  if (!state.cookiesEnabled) {
    return current >= nightStart || current <= nightEnd;
  }

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

function renderCurrent() {
  const filteredTop = filterByCategory(state.currentTopStories);
  const filteredFeed = filterByCategory(state.currentFeed);
  renderTopStories(filteredTop);
  renderFeed(filteredFeed);
  const combined = [...filteredTop, ...filteredFeed];
  const deduped = new Map();
  combined.forEach((item) => {
    if (item && item.id && !deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  });
  state.currentItems = Array.from(deduped.values());
  setUpdateNotice(false);
  updateSectionHeaders(state.category, filteredTop.length, filteredFeed.length);
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
    li.addEventListener("click", () => markSeen(item.id));
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
  items.forEach((item) => {
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
    elements.newsFeed.appendChild(card);
    card.addEventListener("click", () => markSeen(item.id));
  });
  observeSeen();
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
        markSeen(id);
      });
    },
    { threshold: 0.6 }
  );
  document.querySelectorAll("[data-article-id]").forEach((el) => {
    seenObserver.observe(el);
  });
}

init();
