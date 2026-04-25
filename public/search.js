const state = {
  mode: "auto",
  query: "",
  previewTimer: null,
  previewController: null,
};

const elements = {
  modeControl: document.getElementById("modeControl"),
  siteSearchForm: document.getElementById("siteSearchForm"),
  siteSearch: document.getElementById("siteSearch"),
  searchDropdown: document.getElementById("searchDropdown"),
  searchTitle: document.getElementById("searchTitle"),
  searchSummary: document.getElementById("searchSummary"),
  searchResultsTitle: document.getElementById("searchResultsTitle"),
  searchCount: document.getElementById("searchCount"),
  searchResults: document.getElementById("searchResults"),
};

function init() {
  hydrateMode();
  bindControls();
  updateBrandShift();
  window.addEventListener("resize", updateBrandShift);
  const params = new URLSearchParams(window.location.search);
  state.query = String(params.get("q") || "").trim();
  if (elements.siteSearch) {
    elements.siteSearch.value = state.query;
  }
  runSearch(state.query);
}

function hydrateMode() {
  const stored = localStorage.getItem("ln_mode");
  if (stored) {
    state.mode = stored;
  }
  applyTheme();
}

function shouldUseNightMode(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 19 * 60 + 30 || minutes <= 5 * 60 + 30;
}

function applyTheme() {
  const autoNight = shouldUseNightMode(new Date());
  let theme = "day";
  if (state.mode === "night") theme = "night";
  if (state.mode === "auto") theme = autoNight ? "night" : "day";
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
}

function updateBrandShift() {
  const brand = document.querySelector(".brand");
  if (!brand) return;
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

function bindControls() {
  elements.modeControl?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-mode]");
    if (!target) return;
    state.mode = target.dataset.mode;
    localStorage.setItem("ln_mode", state.mode);
    applyTheme();
  });

  elements.siteSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    navigateToSearch(elements.siteSearch.value);
  });

  elements.siteSearch?.addEventListener("input", (event) => {
    scheduleSearchPreview(event.target.value);
  });

  elements.siteSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSearchDropdown();
    }
  });

  document.addEventListener("click", (event) => {
    if (!elements.siteSearchForm?.contains(event.target)) {
      hideSearchDropdown();
    }
  });
}

function navigateToSearch(value) {
  const query = String(value || "").trim();
  if (!query) return;
  window.location.href = `/search.html?q=${encodeURIComponent(query)}`;
}

function scheduleSearchPreview(value) {
  const query = String(value || "").trim();
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
  }
  if (!query) {
    hideSearchDropdown();
    return;
  }
  state.previewTimer = setTimeout(() => fetchSearchPreview(query), 180);
}

async function fetchSearchPreview(query) {
  if (state.previewController) {
    state.previewController.abort();
  }
  state.previewController = new AbortController();
  try {
    const params = new URLSearchParams({ q: query, limit: "5" });
    const response = await fetch(`/api/search?${params.toString()}`, {
      signal: state.previewController.signal,
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
  const resultHtml = items.map((item) => renderPreviewItem(item, cleanQuery)).join("");
  const more =
    total > items.length
      ? `<a class="search-preview-more" href="/search.html?q=${encodeURIComponent(cleanQuery)}">and more</a>`
      : `<a class="search-preview-more" href="/search.html?q=${encodeURIComponent(cleanQuery)}">and more</a>`;
  elements.searchDropdown.innerHTML = `${resultHtml}${more}`;
}

function renderPreviewItem(item, query) {
  const href = item.liveNewsUrl || item.link || `/search.html?q=${encodeURIComponent(query)}`;
  const target = item.liveNewsUrl ? "" : ` target="_blank" rel="noopener noreferrer"`;
  const time = item.publishedAt ? formatTime(item.publishedAt) : "";
  return `
    <a class="search-preview-item" href="${escapeHtml(href)}"${target} role="option">
      <span class="search-preview-title">${escapeHtml(item.title || "Untitled story")}</span>
      <span class="search-preview-meta">${escapeHtml(item.sourceName || "Source")} • ${escapeHtml(item.category || "Top")} • ${escapeHtml(time)}</span>
    </a>
  `;
}

function hideSearchDropdown() {
  if (!elements.searchDropdown) return;
  elements.searchDropdown.hidden = true;
  elements.searchDropdown.innerHTML = "";
  elements.searchDropdown.closest(".site-search-box")?.classList.remove("search-open");
  elements.siteSearch?.setAttribute("aria-expanded", "false");
}

async function runSearch(query) {
  if (!query) {
    elements.searchTitle.textContent = "Search Live News";
    elements.searchSummary.textContent =
      "Enter a topic, source, category, or phrase to search recent Live News coverage.";
    elements.searchCount.textContent = "Waiting";
    elements.searchResults.innerHTML = `
      <div class="search-empty-card">
        Type a search above to find recent source-linked coverage.
      </div>
    `;
    return;
  }

  elements.searchTitle.textContent = `Search results for “${query}”`;
  elements.searchSummary.textContent =
    "Results come from current Live News story coverage and recent source-linked feeds.";
  elements.searchCount.textContent = "Searching";
  elements.searchResults.innerHTML = `<div class="search-empty-card">Searching Live News...</div>`;

  try {
    const params = new URLSearchParams({ q: query, limit: "60" });
    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();
    renderSearchResults(data.items || [], query, Number(data.count || 0));
  } catch {
    elements.searchCount.textContent = "Unavailable";
    elements.searchResults.innerHTML = `
      <div class="search-empty-card">
        Search is unavailable right now. Please try again in a moment.
      </div>
    `;
  }
}

function renderSearchResults(items, query, total) {
  elements.searchResultsTitle.textContent = "Results";
  elements.searchCount.textContent = total === 1 ? "1 match" : `${total} matches`;
  if (!items.length) {
    elements.searchResults.innerHTML = `
      <div class="search-empty-card">
        <strong>No results for “${escapeHtml(query)}”.</strong>
        <span>Try a shorter phrase, a source name like BBC or ABC, or a category like Tech, Sports, Business, National, or International.</span>
      </div>
    `;
    return;
  }
  elements.searchResults.innerHTML = items.map(renderResultCard).join("");
}

function renderResultCard(item) {
  const href = item.liveNewsUrl || item.link || "#";
  const target = item.liveNewsUrl ? "" : ` target="_blank" rel="noopener noreferrer"`;
  const time = item.publishedAt ? formatTime(item.publishedAt) : "";
  const liveAction = item.liveNewsUrl
    ? `<div class="story-actions"><a class="story-action" href="${escapeHtml(item.liveNewsUrl)}">Open Live News page</a></div>`
    : "";
  return `
    <article class="search-result-card">
      ${buildSearchVisual(item)}
      <div class="search-result-copy">
        <div class="story-eyebrow">
          <span>${escapeHtml(item.category || "Top")}</span>
        </div>
        <h2><a href="${escapeHtml(href)}"${target}>${escapeHtml(item.title || "Untitled story")}</a></h2>
        <p>${escapeHtml(getResultSummary(item))}</p>
        ${buildResultMeta(item, time)}
        ${liveAction}
      </div>
    </article>
  `;
}

function getResultSummary(item) {
  if (item.liveNewsSummary) return item.liveNewsSummary;
  if (item.summaryAgent?.version && item.summary) return item.summary;
  return "Read the original source for the full report.";
}

function buildOriginalSourceLink(item) {
  const source = item.sourceName || item.sourceDomain || "Source";
  if (!item.link) return `<span>${escapeHtml(source)}</span>`;
  return `<a class="story-source-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>`;
}

function buildResultMeta(item, time = "") {
  return `
    <div class="story-meta">
      ${buildOriginalSourceLink(item)} • ${escapeHtml(item.category || "Top")} • ${escapeHtml(time || "Time unavailable")}
    </div>
  `;
}

function buildSearchVisual(item) {
  const imageUrl = item.imageUrl || "";
  const source = item.sourceName || item.sourceDomain || "Source";
  const category = item.category || "Top";
  const initial = getSourceInitials(item);
  const usesPublicResearch = item.imageSource === "public_media_research";
  const credit =
    item.imageCredit || (usesPublicResearch ? "Related public media" : "");
  const fallback = `
    <figcaption class="search-result-fallback">
      <span>${escapeHtml(initial)}</span>
      <strong>${escapeHtml(source)}</strong>
      <small>${escapeHtml(category)} coverage</small>
    </figcaption>
  `;
  if (imageUrl) {
    return `
      <figure class="search-result-visual has-photo">
        <img src="${escapeHtml(imageUrl)}" alt="${usesPublicResearch ? escapeHtml(item.imageAlt || "") : ""}" loading="lazy" referrerpolicy="no-referrer" onload="validateSearchImage(this)" onerror="rejectSearchImage(this)" />
        ${credit ? `<figcaption class="search-result-credit">${escapeHtml(credit)}</figcaption>` : ""}
        ${fallback}
      </figure>
    `;
  }
  return `
    <figure class="search-result-visual image-failed">
      ${fallback}
    </figure>
  `;
}

function getSourceInitials(item) {
  const label = item.sourceName || item.sourceDomain || item.category || "Live News";
  return (
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "LN"
  );
}

function isWeakLoadedArticleImage(image) {
  const src = decodeURIComponent(image.currentSrc || image.src || "").toLowerCase();
  const logoLike = /favicon|apple-touch-icon|\/logo|[-_]logo|\/icon|[-_]icon|brandmark|publisher/.test(src);
  const width = Number(image.naturalWidth || 0);
  const height = Number(image.naturalHeight || 0);
  const tooSmall = width > 0 && height > 0 && (width < 260 || height < 140 || width * height < 70000);
  return logoLike || tooSmall;
}

function rejectSearchImage(image) {
  const visual = image.closest(".search-result-visual");
  if (!visual) return;
  visual.classList.remove("has-photo");
  visual.classList.add("image-failed");
  image.remove();
}

function validateSearchImage(image) {
  if (isWeakLoadedArticleImage(image)) {
    rejectSearchImage(image);
  }
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
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
