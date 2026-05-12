const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const failures = [];
const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const searchHtml = fs.readFileSync(path.join(root, "public", "search.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const searchJs = fs.readFileSync(path.join(root, "public", "search.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

function fail(message) {
  failures.push(message);
}

if (!indexHtml.includes('aria-label="Search Live News"')) {
  fail("Homepage search input should keep an accessible aria-label.");
}
if (!indexHtml.includes('aria-controls="searchDropdown"') || !indexHtml.includes('aria-expanded="false"')) {
  fail("Homepage search input should control the dropdown and expose collapsed state.");
}
if (!appJs.includes('elements.siteSearch.addEventListener("input"') || !appJs.includes("scheduleSearchPreview(event.target.value)")) {
  fail("Homepage search should update the dropdown on input while typing.");
}
if (!appJs.includes('elements.siteSearch.addEventListener("keyup"') || !appJs.includes('elements.siteSearch.addEventListener("focus"')) {
  fail("Homepage search should also refresh previews on keyup and focus for resilient live behavior.");
}
if (!appJs.includes("getLocalSearchPreviewItems(query)") || !appJs.includes("renderSearchDropdown(localItems, query")) {
  fail("Homepage search should render current in-page data before waiting for the API.");
}
if (!appJs.includes("refreshSearchPreviewFromCurrentInput") || !appJs.includes("scheduleSearchPreview(query)")) {
  fail("Homepage search should refresh a typed query after news data finishes loading.");
}
if (!appJs.includes("getSearchPreviewPool") || !appJs.includes("state.currentFeed") || !appJs.includes("state.approvedStories")) {
  fail("Homepage search should search current feed, top stories, visible items, and approved stories.");
}
if (!appJs.includes("getSearchPreviewText") || !appJs.includes("originalPublisherTitle") || !appJs.includes("sourceName") || !appJs.includes("tags")) {
  fail("Homepage search should match titles, source names, categories, summaries, tags, and topic-like fields.");
}
if (!appJs.includes("SEARCH_PREVIEW_LIMIT = 5") || !searchJs.includes("SEARCH_PREVIEW_LIMIT = 5")) {
  fail("Search dropdown should limit compact previews to five results.");
}
if (!appJs.includes("No matching stories found.") || !searchJs.includes("No matching stories found.")) {
  fail("Search dropdown should show the compact empty state.");
}
if (!appJs.includes("renderSearchMoreLink") || !searchJs.includes("renderSearchMoreLink")) {
  fail("Search dropdown should keep a See more footer link.");
}
if (!appJs.includes("/search.html?q=") || !searchJs.includes("/search.html?q=")) {
  fail("See more and Search button should use the existing full search page route.");
}
if (!appJs.includes("getDisplayTitle(item)") || !appJs.includes("getDisplaySummary(item, 105)")) {
  fail("Homepage dropdown should use safe approved Live News title and summary helpers.");
}
if (appJs.includes("This article discusses") || appJs.includes("In a recent development") || appJs.includes("Read more about this story")) {
  fail("Homepage dropdown should not contain generic fallback summary phrases.");
}
if (!appJs.includes("hideSearchDropdown()") || !appJs.includes('event.key === "Escape"')) {
  fail("Search dropdown should close on Escape and empty input.");
}
if (!stylesCss.includes(".search-dropdown") || !stylesCss.includes("max-width: 100%") || !stylesCss.includes("overflow-x: hidden")) {
  fail("Search dropdown should be horizontally bounded inside the search card.");
}
if (!stylesCss.includes("max-height: min(360px, calc(100vh - 220px))") || !stylesCss.includes("overflow-y: auto")) {
  fail("Search dropdown should have an internal vertical scroll limit.");
}
if (!searchHtml.includes('id="siteSearch"') || !searchJs.includes("runSearch(state.query)")) {
  fail("Full search page should still render and run the search route.");
}

if (failures.length) {
  console.error("Live News search check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News search check passed.");
