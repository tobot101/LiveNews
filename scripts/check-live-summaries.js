const fs = require("fs");
const path = require("path");
const {
  applyLiveNewsSummary,
  applyLiveNewsSummariesToItems,
  applyLiveNewsSummariesToPayload,
  buildLiveNewsSummary,
  evaluateLiveNewsSummary,
} = require("../lib/article-agents/summary-agent");
const {
  FALLBACK_SUMMARY,
  getFirstWords,
  wordCount,
} = require("../lib/article-agents/summary-quality");

const root = path.join(__dirname, "..");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const samples = [
  {
    id: "summary-national-test",
    title: "WATCH: Trump dispatching Witkoff and Kushner to Pakistan for new Iran talks, White House says",
    summary:
      "The White House said Steve Witkoff and Jared Kushner are being sent to Pakistan as officials pursue new talks involving Iran.",
    sourceName: "PBS NewsHour",
    category: "National",
    sourceCount: 2,
    publishedAt: "2026-04-24T18:52:00.000Z",
  },
  {
    id: "summary-business-test",
    title: "Norfolk Southern's profit fell 27% as it didn't collect big insurance payments for Ohio derailment",
    summary:
      "Norfolk Southern reported lower quarterly profit after insurance payments tied to the Ohio derailment were not collected in the period.",
    sourceName: "ABC News",
    category: "Business",
    sourceCount: 1,
    publishedAt: "2026-04-24T14:18:59.000Z",
  },
  {
    id: "summary-feed-test",
    title: "US imposes sanctions on a China-based oil refinery and 40 shippers over Iranian oil",
    summary:
      "The United States imposed sanctions on a refinery and shipping firms accused of helping move Iranian oil.",
    sourceName: "ABC News",
    category: "Business",
    sourceCount: 1,
    publishedAt: "2026-04-24T18:58:28.000Z",
  },
  {
    id: "summary-noisy-title-test",
    title: "NASCAR's Natalie Decker gets out of the pool & into her fire suit for big race, NFL Draft drama, plus MEAT!",
    summary:
      "NASCAR driver Natalie Decker returned to the track at Talladega for a high-profile racing weekend.",
    sourceName: "Fox News",
    category: "Sports",
    sourceCount: 1,
    publishedAt: "2026-04-24T13:08:17.000Z",
  },
];

for (const sample of samples) {
  const result = buildLiveNewsSummary(sample);
  const text = result.text;
  expect(result.evaluation.passed, `${sample.id} summary should pass quality gates.`);
  expect(!/Live News is tracking|It was updated|original source remains|source-linked coverage/i.test(text), `${sample.id} should not use old generic tracking copy.`);
  expect(!/^(Live News|This article discusses|The report says|According to|In a recent development|Officials announced|The story highlights|This update centers|The key development is)/i.test(text), `${sample.id} should not use a robotic opener.`);
  expect(text === FALLBACK_SUMMARY || (wordCount(text) >= 18 && wordCount(text) <= 38), `${sample.id} should keep an 18-38 word summary unless using the neutral fallback.`);
  expect(
    /Trump|Witkoff|Kushner|Pakistan|Iran|Norfolk|profit|insurance|derailment|sanctions|refinery|Iranian oil|Natalie|Decker|Talladega/i.test(text),
    `${sample.id} should include article-specific details.`
  );
  expect(text !== sample.summary, `${sample.id} should not copy the RSS description directly.`);
  const reevaluated = evaluateLiveNewsSummary(sample, text);
  expect(reevaluated.passed, `${sample.id} should pass reevaluation.`);
}

const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const categoryJs = fs.readFileSync(path.join(root, "public", "category.js"), "utf8");
const searchJs = fs.readFileSync(path.join(root, "public", "search.js"), "utf8");
const localJs = fs.readFileSync(path.join(root, "public", "local.js"), "utf8");
const localHtml = fs.readFileSync(path.join(root, "public", "local.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
expect(serverJs.includes("applyLiveNewsSummary"), "Server should apply summary agents before stories reach the UI.");
expect(appJs.includes("getDisplaySummary(item, 150)"), "Latest News Feed should render the shared Live News summary field.");
expect(appJs.includes("if (item.liveNewsSummary)"), "UI summary rendering should prefer Live News agent summaries.");
expect(!appJs.includes("Live News is tracking this"), "Latest News fallback should not return the old generic tracking sentence.");
expect(!appJs.includes("if (item.summary) return truncateText(item.summary"), "Homepage cards should not fall back to RSS summaries as final copy.");
expect(!categoryJs.includes("Live News found this result"), "Category results should not return the old generic result summary.");
expect(!searchJs.includes("Live News found this result"), "Search results should not return the old generic result summary.");
expect(!categoryJs.includes("Coverage centers on"), "Category results should not use generic database-style summary fallbacks.");
expect(!searchJs.includes("Coverage centers on"), "Search results should not use generic database-style summary fallbacks.");
expect(!localJs.includes("${item.summary ?"), "Local cards should not render raw RSS summaries directly.");
expect(localHtml.includes("Live News summarizes source-linked coverage with attribution. Full reporting"), "Local page should use the source-respectful disclaimer.");
expect(stylesCss.includes(".story-source-link"), "Article cards should style crawlable original-source links.");
expect(serverJs.includes("applyLiveNewsSummariesToPayload"), "Server should apply summary agents across page sections so nearby cards can be checked for repetition.");
expect(serverJs.includes("renderCrawlableHomepage"), "Homepage should render crawlable article cards before client hydration when possible.");
expect(serverJs.includes("renderCrawlerSourceLink"), "Crawlable article cards should include original source links.");

const payload = {
  topStories: [samples[0]],
  feed: [samples[2], samples[3]],
};
const shapedPayload = applyLiveNewsSummariesToPayload(payload);
expect(shapedPayload.feed.every((item) => item.liveNewsSummary), "Latest News Feed items should receive Live News summaries.");
expect(
  shapedPayload.feed.every((item) => !/Live News is tracking|It was updated|original source remains/i.test(item.liveNewsSummary)),
  "Latest News Feed summaries should not use old generic tracking copy."
);
expect(
  shapedPayload.feed.every((item) => item.liveNewsSummary === FALLBACK_SUMMARY || (wordCount(item.liveNewsSummary) >= 18 && wordCount(item.liveNewsSummary) <= 38)),
  "Latest News Feed summaries should stay compact."
);

const repetitionSamples = [
  {
    id: "repeat-local-1",
    title: "Local transit upgrades approved for downtown corridor",
    summary: "Local transit upgrades were approved for the downtown corridor after a city review.",
    sourceName: "City Desk",
    category: "Local",
    sourceCount: 1,
  },
  {
    id: "repeat-local-2",
    title: "Local transit upgrades delayed near airport station",
    summary: "Local transit upgrades near the airport station were delayed as scheduling questions continued.",
    sourceName: "City Desk",
    category: "Local",
    sourceCount: 1,
  },
];
const repetitionChecked = applyLiveNewsSummariesToItems(repetitionSamples);
const firstOpeners = repetitionChecked.map((item) => getFirstWords(item.liveNewsSummary));
expect(new Set(firstOpeners).size === firstOpeners.length, "Nearby cards should not reuse the same first four words.");
const firstThreeOpeners = repetitionChecked.map((item) => getFirstWords(item.liveNewsSummary, 3));
expect(new Set(firstThreeOpeners).size === firstThreeOpeners.length, "Nearby cards should not reuse the same first three words.");
expect(
  repetitionChecked.every((item) => item.summaryAgent.passed),
  "Nearby-card repetition checks should still produce passing summaries."
);

const styleMemoryChecked = buildLiveNewsSummary(samples[0], {
  styleMemory: { avoidPhrases: ["This story matters because"] },
});
expect(
  styleMemoryChecked.evaluation.passed,
  "Summary generation should honor editable style-memory avoid phrases without failing safe candidates."
);

if (failures.length) {
  console.error("Live News summary-agent check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News summary-agent check passed.");
console.log(`Samples checked: ${samples.length}`);
