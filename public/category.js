const CATEGORY_SECTIONS = ["National", "International", "Business", "Tech", "Sports", "Entertainment"];

const state = {
  mode: "auto",
  category: "",
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
  state.category = normalizeCategory(params.get("category")) || "National";
  renderCategoryTabs();
  loadCategory(state.category);
}

function normalizeCategory(value) {
  const clean = String(value || "").trim().toLowerCase();
  return CATEGORY_SECTIONS.find((category) => category.toLowerCase() === clean) || "";
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
}

function renderCategoryTabs() {
  elements.categoryTabs.innerHTML = CATEGORY_SECTIONS.map((category) => {
    const active = category === state.category ? " active" : "";
    return `<a class="category-tab${active}" href="/category.html?category=${encodeURIComponent(category)}">${escapeHtml(category)}</a>`;
  }).join("");
}

async function loadCategory(category) {
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
  elements.categoryCount.textContent = total === 1 ? "1 story" : `${total} stories`;
  if (!items.length) {
    elements.categoryResults.innerHTML = `
      <div class="search-empty-card">
        <strong>No ${escapeHtml(category)} stories are available yet.</strong>
        <span>Live News will fill this section as fresh source-linked coverage arrives.</span>
      </div>
    `;
    return;
  }
  elements.categoryResults.innerHTML = items.map(renderResultCard).join("");
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
      ${buildCategoryVisual(item)}
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
