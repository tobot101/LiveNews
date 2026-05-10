const fs = require("fs");
const path = require("path");
const {
  buildCoverageContext,
  applyCoverageContextsToPayload,
} = require("../lib/news-intelligence");

const root = path.join(__dirname, "..");
const failures = [];

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const richStory = {
  title: "City leaders approve overnight transit safety plan",
  sourceName: "Local Gazette",
  sourceCount: 4,
  relatedSources: ["Local Gazette", "Transit Wire", "Metro Desk", "City Hall Notes"],
  supportingLinks: [
    { sourceName: "Local Gazette" },
    { sourceName: "Transit Wire" },
    { sourceName: "Metro Desk" },
    { sourceName: "City Hall Notes" },
  ],
};
const thinStory = {
  title: "One outlet reports a new local update",
  sourceName: "Local Gazette",
  sourceCount: 1,
  relatedSources: ["Local Gazette"],
};

const context = buildCoverageContext(richStory);
expect(context.startsWith("Also covered by "), "Coverage context should be a natural reader sentence.");
expect(context.includes("Transit Wire"), "Coverage context should mention another outlet when available.");
expect(!context.includes("Local Gazette, Local Gazette"), "Coverage context should dedupe sources.");
expect(buildCoverageContext(thinStory) === "", "Thin one-source stories should not receive extra context.");

[
  "developing",
  "multiple sources",
  "source-linked",
  "intelligence",
  "radar",
  "score",
].forEach((term) => {
  expect(!context.toLowerCase().includes(term), `Coverage context should avoid robotic/system term: ${term}`);
});

const enrichedPayload = applyCoverageContextsToPayload({
  topStoryOfDay: richStory,
  topStoryOfWeek: thinStory,
  topStories: [richStory, thinStory],
  feed: [thinStory, richStory],
});
expect(enrichedPayload.topStoryOfDay.coverageContext === context, "Payload top story should receive quiet coverage context.");
expect(!enrichedPayload.topStoryOfWeek.coverageContext, "Payload should not force context onto weak stories.");
expect(enrichedPayload.feed[1].coverageContext === context, "Payload feed items should preserve useful coverage context.");

const appJs = read("public/app.js");
const serverJs = read("server.js");
const stylesCss = read("public/styles.css");

expect(appJs.includes("buildStoryContext"), "Frontend should render quiet story context when present.");
expect(serverJs.includes("renderCrawlerStoryContext"), "Server-rendered HTML should expose quiet story context for crawlers.");
expect(serverJs.includes("applyCoverageContextsToPayload"), "Server payload should apply coverage context before rendering.");
expect(stylesCss.includes(".story-context"), "Story context should have low-clutter styling.");

if (failures.length) {
  console.error("Live News intelligence-layer check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News intelligence-layer check passed.");
console.log(`Example context: ${context}`);
