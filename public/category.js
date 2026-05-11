const CATEGORY_SECTIONS = ["National", "International", "Business", "Tech", "Sports", "Entertainment"];
const CATEGORY_PAGE_SLUGS = {
  National: "national",
  International: "world",
  Business: "business",
  Tech: "technology",
  Sports: "sports",
  Entertainment: "entertainment",
};
const CATEGORY_SLUG_ALIASES = {
  national: "National",
  world: "International",
  international: "International",
  business: "Business",
  technology: "Tech",
  tech: "Tech",
  sports: "Sports",
  entertainment: "Entertainment",
};
const ENTERTAINMENT_SUBBEAT_FILTERS = [
  { id: "all", label: "All" },
  { id: "movies", label: "Movies" },
  { id: "tv_streaming", label: "TV & streaming" },
  { id: "music", label: "Music" },
  { id: "celebrity_culture", label: "Celebrity & culture" },
  { id: "awards", label: "Awards" },
  { id: "books_publishing", label: "Books & publishing" },
  { id: "theater_arts", label: "Theater & arts" },
  { id: "gaming_creator", label: "Gaming & creator culture" },
  { id: "trailers_releases", label: "Trailers & releases" },
  { id: "stars_we_lost", label: "Stars we lost" },
  { id: "general_entertainment", label: "General entertainment" },
];

const state = {
  mode: "auto",
  category: "",
  entertainmentSubbeat: "all",
};

const elements = {
  modeControl: document.getElementById("modeControl"),
  siteSearchForm: document.getElementById("siteSearchForm"),
  siteSearch: document.getElementById("siteSearch"),
  categoryTitle: document.getElementById("categoryTitle"),
  categorySummary: document.getElementById("categorySummary"),
  categoryTabs: document.getElementById("categoryTabs"),
  categoryResultsTitle: document.getElementById("categoryResultsTitle"),
  categoryCount: document.getElementById("categoryCount"),
  categoryResults: document.getElementById("categoryResults"),
};

function init() {
  hydrateMode();
  bindControls();
  updateBrandShift();
  window.addEventListener("resize", updateBrandShift);
  const params = new URLSearchParams(window.location.search);
  state.category = getCategoryFromPath() || normalizeCategory(params.get("category")) || "National";
  renderCategoryTabs();
  loadCategory(state.category);
}

function normalizeCategory(value) {
  const clean = String(value || "").trim().toLowerCase();
  return CATEGORY_SECTIONS.find((category) => category.toLowerCase() === clean) || "";
}

function getCategoryFromPath() {
  const match = window.location.pathname.match(/^\/category\/([^/]+)\/?$/);
  if (!match) return "";
  return CATEGORY_SLUG_ALIASES[decodeURIComponent(match[1]).toLowerCase()] || "";
}

function getCategoryPageHref(category) {
  const slug = CATEGORY_PAGE_SLUGS[category] || String(category || "national").toLowerCase();
  return `/category/${encodeURIComponent(slug)}`;
}

function hydrateMode() {
  const stored = localStorage.getItem("ln_mode");
  if (stored) state.mode = stored;
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
    const query = String(elements.siteSearch?.value || "").trim();
    if (query) window.location.href = `/search.html?q=${encodeURIComponent(query)}`;
  });

  elements.categoryResults?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-entertainment-subbeat]");
    if (!target) return;
    state.entertainmentSubbeat = target.dataset.entertainmentSubbeat || "all";
    const items = elements.categoryResults.__categoryItems || [];
    const total = Number(elements.categoryResults.__categoryTotal || items.length);
    renderCategoryResults(items, state.category, total);
  });
}

function renderCategoryTabs() {
  elements.categoryTabs.innerHTML = CATEGORY_SECTIONS.map((category) => {
    const active = category === state.category ? " active" : "";
    return `<a class="category-tab${active}" href="${getCategoryPageHref(category)}">${escapeHtml(category)}</a>`;
  }).join("");
}

async function loadCategory(category) {
  state.entertainmentSubbeat = "all";
  elements.categoryTitle.textContent = `${category} News`;
  elements.categoryResultsTitle.textContent = `${category} stories`;
  elements.categorySummary.textContent =
    `Browse recent ${category.toLowerCase()} coverage from Live News feeds with attribution and original source links.`;
  elements.categoryCount.textContent = "Loading";
  elements.categoryResults.innerHTML = `<div class="search-empty-card">Loading ${escapeHtml(category)} coverage...</div>`;
  document.title = `Live News ${category} | Source-Linked Coverage`;

  try {
    const params = new URLSearchParams({ category, limit: "75" });
    const response = await fetch(`/api/category?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Category unavailable");
    renderCategoryResults(data.items || [], data.category || category, Number(data.count || 0));
  } catch {
    elements.categoryCount.textContent = "Unavailable";
    elements.categoryResults.innerHTML = `
      <div class="search-empty-card">
        This category page is unavailable right now. Please try again in a moment.
      </div>
    `;
  }
}

function renderCategoryResults(items, category, total) {
  const isEntertainment = category === "Entertainment";
  const categoryItems = isEntertainment ? items.filter(isEntertainmentCategoryItem) : items;
  const visibleItems = isEntertainment
    ? categoryItems.filter((item) => matchesEntertainmentSubbeat(item, state.entertainmentSubbeat))
    : categoryItems;
  elements.categoryResults.__categoryItems = categoryItems;
  elements.categoryResults.__categoryTotal = total;
  elements.categoryCount.textContent = getCategoryCountLabel(category, visibleItems.length, total);
  const controls = isEntertainment ? renderEntertainmentCategoryFilters(categoryItems, visibleItems.length, total) : "";
  if (!visibleItems.length) {
    elements.categoryResults.innerHTML = `
      ${controls}
      <div class="search-empty-card">
        <strong>No ${escapeHtml(category)} stories are available yet.</strong>
        <span>Live News will fill this section as fresh source-linked coverage arrives.</span>
      </div>
    `;
    return;
  }
  elements.categoryResults.innerHTML = `${controls}${visibleItems.map(renderResultCard).join("")}`;
}

function renderResultCard(item) {
  const href = item.liveNewsUrl || item.link || "#";
  const target = item.liveNewsUrl ? "" : ` target="_blank" rel="noopener noreferrer"`;
  const time = item.publishedAt ? formatTime(item.publishedAt) : "";
  const summary = getResultSummary(item);
  const liveAction = item.liveNewsUrl
    ? `<div class="story-actions"><a class="story-action" href="${escapeHtml(item.liveNewsUrl)}">Open Live News page</a></div>`
    : "";
  return `
    <article class="search-result-card">
      ${buildCategoryVisual(item)}
      <div class="search-result-copy">
        <div class="story-eyebrow">
          <span>${escapeHtml(getResultCategoryLabel(item))}</span>
        </div>
        <h2><a href="${escapeHtml(href)}"${target}>${escapeHtml(getResultTitle(item))}</a></h2>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
        ${buildResultMeta(item, time)}
        ${liveAction}
      </div>
    </article>
  `;
}

function getResultTitle(item) {
  return window.LiveNewsPublicWriting?.getSafeDisplayTitle?.(item) || item.liveNewsHeadline || item.title || "Untitled story";
}

function getResultSummary(item) {
  if (window.LiveNewsPublicWriting?.getSafeDisplaySummary) {
    return window.LiveNewsPublicWriting.getSafeDisplaySummary(item, 210);
  }
  return item.liveNewsSummary || "";
}

function getResultCategoryLabel(item) {
  if (state.category === "Entertainment" && isEntertainmentCategoryItem(item)) {
    return getEntertainmentSubbeatLabel(getEntertainmentSubbeat(item));
  }
  return item.category || "Top";
}

function getEntertainmentSubbeat(item) {
  const subbeat = item.entertainmentSubbeat || item.entertainmentClassification?.subbeat || "";
  return ENTERTAINMENT_SUBBEAT_FILTERS.some((filter) => filter.id === subbeat)
    ? subbeat
    : "general_entertainment";
}

function getEntertainmentSubbeatLabel(subbeat) {
  return ENTERTAINMENT_SUBBEAT_FILTERS.find((filter) => filter.id === subbeat)?.label || "General entertainment";
}

function isEntertainmentCategoryItem(item) {
  if (!item) return false;
  return (
    item.category === "Entertainment" ||
    item.entertainmentClassification?.isEntertainment === true ||
    Boolean(item.entertainmentSubbeat) ||
    Number(item.entertainmentConfidence || 0) >= 45
  );
}

function matchesEntertainmentSubbeat(item, selectedSubbeat) {
  if (!selectedSubbeat || selectedSubbeat === "all") return true;
  return getEntertainmentSubbeat(item) === selectedSubbeat;
}

function getCategoryCountLabel(category, visibleCount, totalCount) {
  if (category === "Entertainment" && state.entertainmentSubbeat !== "all") {
    return `${visibleCount} shown • ${totalCount} stories`;
  }
  return totalCount === 1 ? "1 story" : `${totalCount} stories`;
}

function getEntertainmentSubbeatCounts(items) {
  return items.reduce((counts, item) => {
    const subbeat = getEntertainmentSubbeat(item);
    counts[subbeat] = (counts[subbeat] || 0) + 1;
    counts.all = (counts.all || 0) + 1;
    return counts;
  }, { all: 0 });
}

function renderEntertainmentCategoryFilters(items, visibleCount, totalCount) {
  const counts = getEntertainmentSubbeatCounts(items);
  const filters = ENTERTAINMENT_SUBBEAT_FILTERS.map((filter) => {
    const active = state.entertainmentSubbeat === filter.id;
    const count = Number(counts[filter.id] || 0);
    return `
      <button
        type="button"
        class="entertainment-filter${active ? " active" : ""}"
        data-entertainment-subbeat="${escapeHtml(filter.id)}"
        aria-pressed="${active ? "true" : "false"}"
      >${escapeHtml(filter.label)} <span>${escapeHtml(String(count))}</span></button>
    `;
  }).join("");
  return `
    <aside class="category-entertainment-controls" aria-label="Entertainment topic filters">
      <div>
        <strong>Entertainment topics</strong>
        <span>${escapeHtml(String(visibleCount))} shown from ${escapeHtml(String(totalCount))} source-linked stories</span>
      </div>
      <div class="entertainment-filter-list">
        ${filters}
      </div>
    </aside>
  `;
}

function buildOriginalSourceLink(item) {
  const source = item.sourceName || item.sourceDomain || "Source";
  if (!item.link) return `<span>${escapeHtml(source)}</span>`;
  return `<a class="story-source-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>`;
}

function buildResultMeta(item, time = "") {
  return `
    <div class="story-meta">
      ${buildOriginalSourceLink(item)} • ${escapeHtml(getResultCategoryLabel(item))} • ${escapeHtml(time || "Time unavailable")}
    </div>
  `;
}

function buildCategoryVisual(item) {
  const imageUrl = item.imageUrl || "";
  const source = item.sourceName || item.sourceDomain || "Source";
  const category = item.category || "Top";
  const initial = getSourceInitials(item);
  const usesPublicResearch = item.imageSource === "public_media_research";
  const credit = item.imageCredit || (usesPublicResearch ? "Related public media" : "");
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
        <img src="${escapeHtml(imageUrl)}" alt="${usesPublicResearch ? escapeHtml(item.imageAlt || "") : ""}" loading="lazy" referrerpolicy="no-referrer" onload="validateCategoryImage(this)" onerror="rejectCategoryImage(this)" />
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

function rejectCategoryImage(image) {
  const visual = image.closest(".search-result-visual");
  if (!visual) return;
  visual.classList.remove("has-photo");
  visual.classList.add("image-failed");
  image.remove();
}

function validateCategoryImage(image) {
  if (isWeakLoadedArticleImage(image)) rejectCategoryImage(image);
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
