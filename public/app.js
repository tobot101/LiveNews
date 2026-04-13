const state = {
  cookiesEnabled: false,
  mode: "auto",
  refresh: "10",
  refreshTimer: null,
  isLoggedIn: false,
  gpcDetected: false,
};

const elements = {
  consentModal: document.getElementById("consentModal"),
  consentAccept: document.getElementById("consentAccept"),
  consentDecline: document.getElementById("consentDecline"),
  refreshControl: document.getElementById("refreshControl"),
  refreshOff: document.getElementById("refreshOff"),
  modeControl: document.getElementById("modeControl"),
  lastUpdated: document.getElementById("lastUpdated"),
  timeZoneLabel: document.getElementById("timeZoneLabel"),
  topStories: document.getElementById("topStories"),
  newsFeed: document.getElementById("newsFeed"),
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
  bindControls();
  updateTimeZoneLabel();
  updateLocalControls();
  updateLoginState();
  loadNews();
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
    applyTheme();
    updateLocalControls();
  });

  elements.consentDecline.addEventListener("click", () => {
    state.cookiesEnabled = false;
    localStorage.removeItem("ln_consent");
    localStorage.removeItem("ln_mode");
    localStorage.removeItem("ln_refresh");
    elements.consentModal.classList.remove("visible");
    elements.consentModal.setAttribute("aria-hidden", "true");
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

async function loadNews() {
  try {
    const response = await fetch("/api/news");
    const data = await response.json();
    renderTopStories(data.topStories || []);
    renderFeed(data.feed || []);
    const updated = new Date(data.updatedAt || Date.now());
    elements.lastUpdated.textContent =
      `Last updated: ${updated.toLocaleTimeString()}`;
  } catch (error) {
    elements.lastUpdated.textContent = "Last updated: offline";
  }
}

function renderTopStories(items) {
  elements.topStories.innerHTML = "";
  const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
  sorted.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "story-item";
    li.innerHTML = `
      <div class="story-rank">${index + 1}</div>
      <div>
        <div class="feed-title">${item.title}</div>
        <div class="story-meta">${item.source} • ${item.category}</div>
      </div>
      <div class="score-pill">Score ${item.score}</div>
    `;
    elements.topStories.appendChild(li);
  });
}

function renderFeed(items) {
  elements.newsFeed.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "feed-item";
    card.innerHTML = `
      <div class="feed-title">${item.title}</div>
      <div class="feed-meta">${item.source} • ${item.category}</div>
    `;
    elements.newsFeed.appendChild(card);
  });
}

init();
