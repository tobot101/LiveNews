const fs = require("fs");
const path = require("path");

const {
  detectPublicWritingRisk,
  getPublicCardWritingStatus,
  getSafeDisplaySummary,
  getSafeDisplayTitle,
} = require("../lib/public-card-writing");

const root = path.join(__dirname, "..");
const failures = [];

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const approvedItem = {
  id: "public-card-approved",
  title: "Publisher headline should not win",
  liveNewsHeadline: "Live News title should win",
  summary: "Read the original source for the full report.",
  liveNewsSummary: "A source-backed Live News summary explains the confirmed update without generic filler.",
  category: "National",
  hasLiveNewsStory: true,
};

const fallbackItem = {
  id: "public-card-fallback",
  title: "Safe title only",
  summary: "This article discusses the latest update on this topic.",
  liveNewsSummary: "Read the original source for the full report.",
  category: "Local",
};

const publicSafetyBlocked = {
  id: "public-card-safety",
  title: "City council reviews a budget proposal",
  summary: "City council reviewed a budget proposal. Stay safe while officials respond.",
  category: "Local",
};

expect(
  getSafeDisplayTitle(approvedItem) === "Live News title should win",
  "Homepage card should prefer liveNewsHeadline over raw publisher title."
);
expect(
  getSafeDisplaySummary(fallbackItem) === "",
  "Homepage card should block generic fallback summary."
);
expect(
  getPublicCardWritingStatus(fallbackItem).status === "title_only",
  "Cards with no safe summary should become title-only instead of public filler."
);
expect(
  detectPublicWritingRisk("This article discusses the latest update.", {}).safe === false,
  "Public card should not show robotic article-discusses wording."
);
expect(
  detectPublicWritingRisk(publicSafetyBlocked.summary, publicSafetyBlocked).safe === false,
  "Public card should not force public safety language."
);

const appJs = read("public/app.js");
const categoryJs = read("public/category.js");
const searchJs = read("public/search.js");
const localJs = read("public/local.js");
const serverJs = read("server.js");
const indexHtml = read("public/index.html");
const categoryHtml = read("public/category.html");
const searchHtml = read("public/search.html");
const localHtml = read("public/local.html");

expect(appJs.includes("getSafeDisplayTitle") && appJs.includes("getSafeDisplaySummary"), "Homepage cards should use safe public-writing helpers.");
expect(appJs.includes("buildDisplaySummaryParagraph"), "Homepage should allow title-only cards when summary is not safe.");
expect(categoryJs.includes("getResultTitle") && categoryJs.includes("getSafeDisplayTitle"), "Category page should prefer approved Live News title.");
expect(searchJs.includes("getResultTitle") && searchJs.includes("getSafeDisplayTitle"), "Search page should prefer approved Live News title.");
expect(localJs.includes("getDisplayTitle") && localJs.includes("getSafeDisplayTitle"), "Local page should prefer approved Live News title.");
expect(localJs.includes("item.liveNewsUrl || item.approvedStoryUrl || item.link"), "Local page should prefer exact Live News article links.");
expect(serverJs.includes("getSafeDisplayTitle") && serverJs.includes("getSafeDisplaySummary"), "Crawlable HTML should use safe title and summary helpers.");
expect(serverJs.includes("getPublicCardWritingStatus"), "API results should expose internal public-card writing status.");
expect(indexHtml.includes("public-writing.js"), "Homepage should load public writing protection.");
expect(categoryHtml.includes("public-writing.js"), "Category page should load public writing protection.");
expect(searchHtml.includes("public-writing.js"), "Search page should load public writing protection.");
expect(localHtml.includes("public-writing.js"), "Local page should load public writing protection.");

if (failures.length) {
  console.error("Live News public-card writing check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News public-card writing check passed.");
console.log(`Example before/after: ${approvedItem.title} -> ${getSafeDisplayTitle(approvedItem)}`);
console.log(`Fallback summary result: ${getPublicCardWritingStatus(fallbackItem).status}`);
