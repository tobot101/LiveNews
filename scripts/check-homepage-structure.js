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

if (entertainmentPosition === -1) fail("Homepage must include the Entertainment panel.");
if (topStoriesPosition === -1) fail("Homepage must include Top Stories.");
if (categoryPosition === -1) fail("Homepage must include Category Lanes.");
if (!(topStoriesPosition < entertainmentPosition && entertainmentPosition < categoryPosition)) {
  fail("Entertainment panel should sit below Top Stories and above Category Lanes.");
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
