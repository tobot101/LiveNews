const fs = require("fs");
const path = require("path");
const {
  NEWS_SITEMAP_WINDOW_HOURS,
  PUBLIC_WINDOW_DAYS,
  buildLocalIntakePlan,
  buildLocalIntelligenceRun,
  buildLocalSignal,
  classifyLocalSignal,
  clusterLocalSignals,
  filterCurrentPublicStories,
  getApprovedLocalSources,
  getCityPageSeoState,
  getExpiredStoryResponse,
  isWithinNewsSitemapWindow,
  isWithinPublicWindow,
  processCursorSource,
  readLocalSourceRegistry,
} = require("../lib/local-intelligence-engine");

const root = path.join(__dirname, "..");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const place = {
  name: "San Diego",
  state: "CA",
  stateName: "California",
  display: "San Diego, CA",
};

const registry = readLocalSourceRegistry();
const approvedSources = getApprovedLocalSources(registry);
expect(approvedSources.length >= 1, "Local source registry should expose at least one approved public source.");
expect(
  approvedSources.every((source) => source.approvedPublicSource === true && source.requiresCredentials !== true),
  "Approved local sources must be public and credential-free."
);

const intakePlan = buildLocalIntakePlan(place, ["San Diego CA local news", "San Diego California when:7d"], registry);
expect(intakePlan.requestCount === 2, "Local intake plan should create a request for each query variant.");
expect(intakePlan.fixedIntakeLimit === null, "Local source intake must not impose a fixed article intake limit.");
expect(intakePlan.requests.every((request) => request.approvedPublicSource === true), "Intake requests should only use approved public sources.");
expect(intakePlan.requests.some((request) => request.url.includes("news.google.com/rss/search")), "Current v1 intake should use the existing public RSS search adapter.");

const currentSignal = buildLocalSignal(
  {
    title: "San Diego council approves downtown transit safety plan",
    summary: "Residents and riders will see new overnight reporting procedures after a city vote.",
    link: "https://example.com/san-diego-transit-safety",
    sourceName: "Metro Desk",
    sourceDomain: "example.com",
    publishedAt: daysAgo(1),
    category: "Local",
  },
  { place }
);
const expiredSignal = buildLocalSignal(
  {
    title: "San Diego library plan from last month",
    summary: "Older civic item.",
    link: "https://example.com/old-library-plan",
    sourceName: "Archive Desk",
    publishedAt: daysAgo(9),
    category: "Local",
  },
  { place }
);

expect(isWithinPublicWindow(currentSignal), "Current local signal should be inside the 7-day public window.");
expect(!isWithinPublicWindow(expiredSignal), "Expired local signal should be outside the 7-day public window.");
expect(filterCurrentPublicStories([currentSignal, expiredSignal]).length === 1, "Public story filter should remove stories older than 7 days.");

const classified = classifyLocalSignal(currentSignal, place);
expect(classified.classification.localRelevanceScore >= 55, "Local classifier should recognize city relevance.");
expect(classified.topic === "public_safety" || classified.topic === "traffic_transit", "Local classifier should assign a useful local topic.");

const clusters = clusterLocalSignals(
  [
    classified,
    classifyLocalSignal(
      buildLocalSignal(
        {
          title: "Downtown transit safety plan approved in San Diego",
          summary: "The city update focuses on riders and overnight reporting.",
          link: "https://example.org/transit-plan",
          sourceName: "City Hall Notes",
          publishedAt: daysAgo(1.1),
          category: "Local",
        },
        { place }
      ),
      place
    ),
    classifyLocalSignal(expiredSignal, place),
  ],
  { place }
);
expect(clusters.length >= 1, "Local clustering should produce at least one current cluster.");
expect(clusters.every((cluster) => isWithinPublicWindow(cluster)), "Local clusters should all be within the 7-day public window.");
expect(clusters[0].supportingLinks.length >= 1, "Local clusters should retain attribution/supporting links.");

const run = buildLocalIntelligenceRun({
  place,
  signals: [currentSignal, expiredSignal],
  registry,
});
expect(run.publicWindowDays === PUBLIC_WINDOW_DAYS, "Local intelligence run should declare the 7-day public window.");
expect(run.expiredSignals.length === 1, "Local intelligence run should retain expired metadata privately.");
expect(run.publicStories.length === 1, "Local intelligence run should expose only current public stories.");
expect(run.health.expiredSignalCount === 1, "Coverage health should include expired signal count.");
expect(run.seo.robots === "noindex, follow", "Thin city pages should be noindex, follow.");

const healthySeo = getCityPageSeoState({
  place,
  clusters: [
    { relatedSources: ["A"] },
    { relatedSources: ["B"] },
    { relatedSources: ["A", "C"] },
  ],
});
expect(healthySeo.indexable === true, "City page SEO should allow indexing when coverage is not thin.");

expect(isWithinNewsSitemapWindow({ publishedAt: daysAgo(1) }), "News sitemap should allow stories inside 48 hours.");
expect(!isWithinNewsSitemapWindow({ publishedAt: daysAgo(3) }), "News sitemap should block stories older than 48 hours.");
expect(NEWS_SITEMAP_WINDOW_HOURS === 48, "News sitemap window should be 48 hours.");

const expiredResponse = getExpiredStoryResponse({ publishedAt: daysAgo(8), slug: "old-story" });
expect(expiredResponse.status === 410, "Expired public story URLs should be eligible for 410 Gone.");

let cursorCalls = 0;
processCursorSource(
  { sourceId: "fixture", cursor: "page-1" },
  async ({ cursor }) => {
    cursorCalls += 1;
    return {
      signals: [{ id: cursor }],
      nextCursor: cursor === "page-1" ? "page-2" : null,
    };
  }
).then((cursorResult) => {
  expect(cursorCalls === 2, "Cursor source processing should continue until no cursor remains.");
  expect(cursorResult.signals.length === 2, "Cursor source processing should collect all pages.");

  const docs = fs.readFileSync(path.join(root, "docs", "local-intelligence-engine.md"), "utf8");
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const localJs = fs.readFileSync(path.join(root, "public", "local.js"), "utf8");
  const localHtml = fs.readFileSync(path.join(root, "public", "local.html"), "utf8");

  expect(docs.includes("Seven-Day Public Expiration"), "Architecture doc should explain 7-day public expiration.");
  expect(docs.includes("localStorage"), "Architecture doc should explain anonymous localStorage personalization.");
  expect(serverJs.includes("buildLocalIntelligenceRun"), "Server local API should use the Local Intelligence Engine.");
  expect(serverJs.includes("isWithinNewsSitemapWindow"), "Server news sitemap should use the 48-hour news window.");
  expect(serverJs.includes("getExpiredStoryResponse"), "Server story route should support expired story responses.");
  expect(localJs.includes("safeStorageGet") && localJs.includes("safeStorageSet"), "Local page should gracefully handle blocked localStorage.");
  expect(localJs.includes("ln_followed_topics"), "Local page should reserve anonymous followed-topic storage.");
  expect(localJs.includes("ln_last_visit_at"), "Local page should store anonymous last visit time.");
  expect(localJs.includes("ln_seen_story_ids"), "Local page should store anonymous seen story IDs.");
  expect(localJs.includes("ln_dismissed_prompts"), "Local page should reserve anonymous dismissed prompt storage.");
  expect(localHtml.includes("last 7 days"), "Local page public copy should describe the 7-day public window.");

  if (failures.length) {
    console.error("Live News local-intelligence check failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log("Live News local-intelligence check passed.");
  console.log(`Approved local sources: ${approvedSources.length}`);
  console.log(`Public clusters checked: ${clusters.length}`);
  console.log(`Cursor pages checked: ${cursorCalls}`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
