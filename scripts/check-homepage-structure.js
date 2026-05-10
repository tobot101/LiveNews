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
if (!appJs.includes("isEntertainmentStory") || !appJs.includes("ENTERTAINMENT_STORY_PATTERN")) {
  fail("Entertainment renderer must include smart celebrity/pop-culture matching.");
}
if (!appJs.includes('return "Celebrity"')) {
  fail("Entertainment cards should be able to label celebrity stories.");
}
if (appJs.includes('"people",')) {
  fail("Entertainment matching should not treat every mention of people as celebrity coverage.");
}
if (!stylesCss.includes(".entertainment-panel") || !stylesCss.includes(".entertainment-grid")) {
  fail("Entertainment section styles are missing.");
}
if (!serverJs.includes("renderCrawlableEntertainmentSection")) {
  fail("Server crawlable homepage must render Entertainment content.");
}
if (!serverJs.includes("isCrawlerEntertainmentStory")) {
  fail("Server crawlable homepage must use smart Entertainment matching.");
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
