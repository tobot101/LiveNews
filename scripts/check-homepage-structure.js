const fs = require("fs");
const path = require("path");

const failures = [];
const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
const sourcesJson = fs.readFileSync(path.join(root, "data", "sources.json"), "utf8");

function fail(message) {
  failures.push(message);
}

const topStoriesPosition = indexHtml.indexOf('id="topStories"');
const entertainmentPosition = indexHtml.indexOf('id="entertainmentPanel"');
const categoryPosition = indexHtml.indexOf('id="categoryLanesPanel"');
const searchLocalPosition = indexHtml.indexOf("home-search-local-panel");

if (searchLocalPosition === -1) fail("Homepage must render a shared Search + Local News top module.");
if (!indexHtml.includes("home-search-local-grid")) fail("Search + Local module should use a two-column grid wrapper.");
if (!indexHtml.includes("home-search-column") || !indexHtml.includes("home-local-compact")) {
  fail("Search and Local News should render as two columns inside the same top module.");
}
if (indexHtml.includes("Search stories, sources, categories, and topics from current Live News coverage.")) {
  fail("Homepage Search helper text should be removed from the compact top module.");
}
if (indexHtml.includes('<label class="control-label" for="siteSearch">Search Live News</label>')) {
  fail("Homepage Search Live News label should not be visibly rendered above the input.");
}
if (!indexHtml.includes('id="siteSearch"')) fail("Homepage Search input should still render.");
if (!indexHtml.includes('type="submit">Search</button>')) fail("Homepage Search button should still render.");
if (!indexHtml.includes('aria-label="Search Live News"') || !indexHtml.includes('class="sr-only" for="siteSearch"')) {
  fail("Homepage Search input should keep an accessible label while hiding the visible label.");
}
if (!indexHtml.includes('aria-controls="searchDropdown"') || !indexHtml.includes('aria-expanded="false"')) {
  fail("Homepage Search input should expose dropdown accessibility attributes.");
}
if (!appJs.includes("renderSearchDropdown") || !appJs.includes("No matching stories found.")) {
  fail("Homepage Search should render a compact dropdown empty state.");
}
if (!appJs.includes("getDisplayTitle(item)") || !appJs.includes("getDisplaySummary(item, 105)")) {
  fail("Homepage Search dropdown should use approved Live News title and summary helpers.");
}
if (!appJs.includes("renderSearchMoreLink") || !appJs.includes(">See more</a>") || !appJs.includes("/search.html?q=")) {
  fail("Homepage Search dropdown should include a See more link to the full search route.");
}
if (!appJs.includes("isLiveNewsStoryUrl") || !appJs.includes("newsmorenow") || !appJs.includes("stories")) {
  fail("Homepage Search dropdown should prefer exact Live News story URLs when available.");
}
if (!indexHtml.includes('id="topCityGrid"') || !indexHtml.includes("home-local-city-chips")) {
  fail("Compact Local News city chips should render in the top module.");
}
if (!indexHtml.includes('data-compact-limit="16"')) {
  fail("Compact Local News city chips should show more top cities while staying intentionally limited on the homepage.");
}
if (!indexHtml.includes(">Share my location</button>")) {
  fail("Compact Local News should keep the Share my location action.");
}
if (!indexHtml.includes('id="localDeepDive" href="/local/cities"') || !indexHtml.includes(">See more</a>")) {
  fail("Compact Local News should keep a See more link to the full city directory page.");
}
if (indexHtml.includes("home-local-panel")) {
  fail("Old standalone homepage Local News panel should not render separately.");
}
if (indexHtml.includes('id="localFeed"') || indexHtml.includes("local-preview-card")) {
  fail("Compact homepage Local News should not render local story cards or preview feeds.");
}
if (entertainmentPosition === -1) fail("Homepage must include the Entertainment panel.");
if (topStoriesPosition === -1) fail("Homepage must include Top Stories.");
if (categoryPosition === -1) fail("Homepage must include Category Lanes.");
if (!appJs.includes('["Top Story of the Day", "Top Story of the Week"]')) {
  fail("Homepage should still render both Top Story of the Day and Top Story of the Week labels.");
}
if (!appJs.includes("Array.from(tools.children)") || !appJs.includes("limit.offsetLeft - brandRight - 24")) {
  fail("Homepage brand slide should stop before the first visible topbar control, including Log in.");
}
if (!appJs.includes("renderLeadStoryCard") || !appJs.includes("buildDisplaySummaryParagraph(item, 300)")) {
  fail("Homepage lead cards should still render readable summaries with a slightly tighter preview length.");
}
if (!(searchLocalPosition < topStoriesPosition)) {
  fail("Search + Local module should stay near the top before Top Stories.");
}
if (!(topStoriesPosition < entertainmentPosition && entertainmentPosition < categoryPosition)) {
  fail("Entertainment panel should sit below Top Stories and above Category Lanes.");
}
if (!indexHtml.includes("Choose a section to open its full page")) {
  fail("Category Lanes should be positioned as compact navigation, not article previews.");
}
if (!indexHtml.includes('href="/category/entertainment"')) {
  fail("Entertainment panel should link to the Entertainment category page.");
}
if (indexHtml.includes("and industry stories")) {
  fail("Entertainment panel should not label the section as industry stories.");
}
if (!indexHtml.includes("pop-culture stories")) {
  fail("Entertainment panel should describe celebrity and pop-culture coverage.");
}
if (!appJs.includes("renderEntertainmentSection")) {
  fail("Homepage JavaScript must render the Entertainment section.");
}
if (!appJs.includes("renderCategoryLaneOption") || !appJs.includes("category-option")) {
  fail("Homepage Category Lanes should render compact category option links.");
}
if (!appJs.includes("const compactLimit = Number(elements.topCityGrid.dataset.compactLimit || 0)")) {
  fail("Homepage city chips should support a compact city limit.");
}
if (!appJs.includes('document.createElement("a")') || !appJs.includes("link.href = buildLocalPageHref(place)")) {
  fail("Homepage city chips should navigate to crawlable city URLs.");
}
if (!appJs.includes("if (elements.localFeed && elements.localStatus)")) {
  fail("Homepage city chip selection should not fetch/render local story cards when the compact module has no preview feed.");
}
if (!stylesCss.includes(".home-search-local-panel") || !stylesCss.includes(".home-search-local-grid")) {
  fail("Homepage Search + Local split layout styles are missing.");
}
if (!stylesCss.includes("grid-template-columns: minmax(0, 1fr) minmax(360px, 0.86fr)")) {
  fail("Top Story spotlight row should give the week card a wider desktop column.");
}
if (!stylesCss.includes(".lead-card .story-visual-lead") || !stylesCss.includes("position: absolute") || !stylesCss.includes("inset: 0")) {
  fail("Top Story media should become the full image frame behind the story copy.");
}
if (!stylesCss.includes(".lead-copy") || !stylesCss.includes("max-width: min(520px, 72%)") || !stylesCss.includes("backdrop-filter: blur(2px)")) {
  fail("Top Story copy should sit inside a compact readable overlay within the image frame.");
}
if (!stylesCss.includes("font-size: clamp(22px, 2.05vw, 32px)") || !stylesCss.includes("font-size: clamp(26px, 3vw, 44px)")) {
  fail("Top Story headline font sizes should be reduced enough to fit the image-frame card.");
}
if (!appJs.includes("lead-media-${escapeHtml(mediaShape)}") || !appJs.includes("lead-media-fallback")) {
  fail("Top Story cards should carry adaptive media-shape classes on the card itself.");
}
if (!appJs.includes("getAdaptiveLeadMediaShape") || !appJs.includes("adaptLeadMediaShape")) {
  fail("Top Story media should adapt its shape after image dimensions are known.");
}
if (!appJs.includes('return "portrait"') || !appJs.includes('return "standard"') || !appJs.includes('return "square"')) {
  fail("Top Story media should be able to choose portrait, standard, or square shapes.");
}
if (!stylesCss.includes(".story-visual-lead .story-photo") || !stylesCss.includes("object-fit: cover")) {
  fail("Top Story lead images should fill the adaptive frame without distortion or blank filler space.");
}
if (!stylesCss.includes(".story-visual-lead.media-shape-portrait") || !stylesCss.includes("aspect-ratio: 4 / 5")) {
  fail("Top Story media should support a portrait shape for portrait-friendly images.");
}
if (!stylesCss.includes(".story-visual-lead.media-shape-square") || !stylesCss.includes("aspect-ratio: 1 / 1")) {
  fail("Top Story media should support a square fallback shape.");
}
if (!stylesCss.includes(".story-visual-lead.media-shape-standard") || !stylesCss.includes("aspect-ratio: 4 / 3")) {
  fail("Top Story media should support a standard non-tall shape for wide images.");
}
if (!stylesCss.includes(".sr-only") || !stylesCss.includes("clip: rect(0, 0, 0, 0)")) {
  fail("Hidden Search label should use an accessible screen-reader-only utility.");
}
if (!stylesCss.includes(".search-dropdown") || !stylesCss.includes("max-height: min(360px, calc(100vh - 220px))") || !stylesCss.includes("overflow-y: auto")) {
  fail("Search dropdown should be vertically bounded inside the search card.");
}
if (!stylesCss.includes("max-width: 100%") || !stylesCss.includes("overflow-x: hidden")) {
  fail("Search dropdown should not overflow horizontally past the search card.");
}
if (!stylesCss.includes(".search-preview-summary") || !stylesCss.includes(".search-preview-footer")) {
  fail("Search dropdown should show compact safe snippets and a bottom-right footer action.");
}
if (!stylesCss.includes(".home-local-city-chips") || !stylesCss.includes("grid-template-columns: repeat(5")) {
  fail("Homepage Local News city chips should be smaller and denser on desktop.");
}
if (!stylesCss.includes("@media (max-width: 720px)") || !stylesCss.includes(".home-search-local-grid")) {
  fail("Homepage Search + Local module needs mobile stacking styles.");
}
if (!stylesCss.includes(".lead-spotlights[data-count=\"1\"] .lead-card") || !stylesCss.includes("min-height: 390px") || !stylesCss.includes("max-width: 100%")) {
  fail("Top Story image-frame cards should stack cleanly with readable mobile overlays.");
}
if (appJs.includes("class=\"lane-story") || appJs.includes("lane-story-title")) {
  fail("Homepage Category Lanes should not render inline article cards anymore.");
}
if (!serverJs.includes("renderCrawlableCategoryLaneOptions") || !serverJs.includes("category-option")) {
  fail("Crawlable homepage should render compact Category Lane links.");
}
[
  "/category/national",
  "/category/world",
  "/category/business",
  "/category/technology",
  "/category/sports",
  "/category/entertainment",
].forEach((categoryHref) => {
  if (!serverJs.includes(categoryHref)) {
    fail(`Crawlable Category Lanes should link to ${categoryHref}.`);
  }
});
if (!appJs.includes("ENTERTAINMENT_FILTERS") || !appJs.includes("matchesEntertainmentFilter")) {
  fail("Entertainment panel should include left-side topic filters.");
}
if (!appJs.includes("entertainmentSearch") || !appJs.includes("matchesEntertainmentSearch")) {
  fail("Entertainment panel should include a dedicated search filter.");
}
if (!appJs.includes("isEntertainmentStory") || !appJs.includes("entertainmentClassification")) {
  fail("Entertainment renderer must use the shared server entertainment classification.");
}
if (!appJs.includes("getSafeEntertainmentTitle") || !appJs.includes("getSafeEntertainmentSummary") || !appJs.includes("getEntertainmentCardStatus")) {
  fail("Entertainment renderer should use dedicated safe title, summary, and card-status helpers.");
}
if (!appJs.includes("buildEntertainmentTitleLink") || !appJs.includes("buildEntertainmentSummaryParagraph")) {
  fail("Entertainment cards should render through safe Entertainment-specific title and summary helpers.");
}
if (appJs.includes("buildDisplaySummaryParagraph(item, 118)")) {
  fail("Entertainment cards should not render generic display summaries directly.");
}
if (!appJs.includes("data-card-status")) {
  fail("Entertainment cards should expose an internal writing status for safe title-only cards.");
}
if (!appJs.includes("Celebrity & culture")) {
  fail("Entertainment cards should be able to label celebrity and culture stories.");
}
if (appJs.includes('"people",')) {
  fail("Entertainment matching should not treat every mention of people as celebrity coverage.");
}
["Box Office", "What To Watch", "Entertainment Biz"].forEach((blockedSection) => {
  if (indexHtml.includes(blockedSection) || appJs.includes(blockedSection) || serverJs.includes(blockedSection)) {
    fail(`Entertainment should not expose a ${blockedSection} public section.`);
  }
});
if (/entertainment\s+biz/i.test(appJs) || /entertainment\s+biz/i.test(serverJs)) {
  fail("Entertainment should not expose an Entertainment biz public label.");
}
if (!stylesCss.includes(".entertainment-panel") || !stylesCss.includes(".entertainment-grid")) {
  fail("Entertainment section styles are missing.");
}
if (!stylesCss.includes(".entertainment-controls-card") || !stylesCss.includes(".entertainment-results")) {
  fail("Entertainment section should be split into left controls and right article results.");
}
if (!serverJs.includes("renderCrawlableEntertainmentSection")) {
  fail("Server crawlable homepage must render Entertainment content.");
}
if (!serverJs.includes("renderCrawlerEntertainmentControls")) {
  fail("Server crawlable homepage must include the Entertainment left controls.");
}
if (!serverJs.includes("isCrawlerEntertainmentStory")) {
  fail("Server crawlable homepage must use smart Entertainment matching.");
}
if (!serverJs.includes('require("./lib/entertainment-classifier")')) {
  fail("Server crawlable homepage must use the shared entertainment classifier module.");
}
if (!serverJs.includes("getSafeEntertainmentTitle") || !serverJs.includes("getSafeEntertainmentSummary") || !serverJs.includes("getEntertainmentCardStatus")) {
  fail("Server crawlable Entertainment rendering should use safe title, summary, and card-status helpers.");
}
if (!serverJs.includes("renderCrawlerEntertainmentTitleLink") || !serverJs.includes("data-card-status")) {
  fail("Server crawlable Entertainment cards should render with safe title links and card status.");
}
if (!serverJs.includes("ENTERTAINMENT_SECTION_LIMIT = 9")) {
  fail("Entertainment section should allow more than a small five-story set.");
}
[
  "variety-entertainment",
  "hollywood-reporter-entertainment",
  "page-six-celebrity",
  "fox-entertainment",
  "cbs-entertainment",
  "entertainment-tonight",
  "e-news-top",
  "tmz-celebrity",
  "deadline-entertainment",
  "thewrap-entertainment",
  "billboard-entertainment",
  "rolling-stone-music",
].forEach((sourceId) => {
  if (!sourcesJson.includes(`"id": "${sourceId}"`)) {
    fail(`Missing expanded Entertainment RSS source: ${sourceId}`);
  }
});

if (failures.length) {
  console.error("Live News homepage structure check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News homepage structure check passed.");
