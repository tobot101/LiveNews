const LOCAL_LIMIT_DEFAULT = "25";

const state = {
  limit: LOCAL_LIMIT_DEFAULT,
  place: null,
  feed: [],
  loading: false,
  lastFetched: 0,
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
};

function init() {
  applyTheme();
  bindControls();
  hydrateLimit();
  hydrateFromQuery();
  hydrateFromStorage();
  updateBrandShift();
  window.addEventListener("resize", updateBrandShift);
  if (state.place) {
    loadLocalFeed({ force: true });
  }
}

function hydrateLimit() {
  const stored = localStorage.getItem("ln_local_limit");
  if (stored) {
    state.limit = stored;
  }
  setLimitUI(state.limit);
}

function applyTheme() {
  const stored = localStorage.getItem("ln_mode") || "auto";
  const now = new Date();
  const theme = stored === "auto" ? (shouldUseNightMode(now) ? "night" : "day") : stored;
  document.documentElement.setAttribute("data-theme", theme);
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
  const brandTitle = document.querySelector(".brand-title");
  if (!brandTitle) return;
  const nav = document.querySelector(".sections") || document.querySelector(".controls");
  const topbar = document.querySelector(".topbar");
  const brandRect = brandTitle.getBoundingClientRect();
  const limitRect = nav ? nav.getBoundingClientRect() : null;
  const containerRect = topbar ? topbar.getBoundingClientRect() : null;
  let maxShift = 0;
  if (limitRect) {
    maxShift = Math.max(0, Math.floor(limitRect.left - brandRect.right - 16));
  } else if (containerRect) {
    maxShift = Math.max(0, Math.floor(containerRect.right - brandRect.right - 16));
  }
  brandTitle.style.setProperty("--brand-shift", `${maxShift}px`);
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
      setPlace({
        name: value,
        display: value,
        state: "",
        stateName: "",
        geoid: "",
      });
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
      localStorage.setItem("ln_local_limit", value);
      renderLocalFeed();
    });
  }
}

function hydrateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const city = params.get("city");
  const stateCode = params.get("state") || "";
  if (city) {
    setPlace({
      name: city,
      display: stateCode ? `${city}, ${stateCode}` : city,
      state: stateCode,
      stateName: "",
      geoid: "",
    });
  }
}

function hydrateFromStorage() {
  if (state.place) return;
  if (!personalizationAllowed()) return;
  const stored = localStorage.getItem("ln_local_place");
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
    const raw = localStorage.getItem("ln_consent");
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

function setPlace(place) {
  state.place = place;
  if (elements.display) {
    const label = place?.display || place?.name || "not set";
    elements.display.textContent = `Local hub: ${label}`;
  }
  if (elements.input && place?.display) {
    elements.input.value = place.display;
  }
  if (personalizationAllowed()) {
    localStorage.setItem("ln_local_place", JSON.stringify(place));
  }
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

  if (elements.feedTag) {
    elements.feedTag.textContent =
      total > 0 ? `Showing ${limited.length} of ${total}` : "No updates";
  }

  if (!limited.length) {
    const empty = document.createElement("div");
    empty.className = "feed-item";
    empty.textContent = "No local stories in the last 48 hours.";
    elements.feedList.appendChild(empty);
    return;
  }

  const groups = groupFeedByAge(limited);
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
      const card = document.createElement("div");
      card.className = "feed-item";
      const published = item.publishedAt ? formatTime(item.publishedAt) : "";
      const titleHtml = item.link
        ? `<a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>`
        : item.title;
      card.innerHTML = `
        <div class="feed-title">${titleHtml}</div>
        <div class="feed-meta">${item.sourceName || item.sourceDomain || "Source"} • ${published}</div>
        ${item.summary ? `<div class="local-summary">${item.summary}</div>` : ""}
      `;
      list.appendChild(card);
    });
    section.appendChild(header);
    section.appendChild(list);
    elements.feedList.appendChild(section);
  });

  if (total > 0) {
    updateStatus(`Showing ${limited.length} of ${total} stories.`);
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

init();
