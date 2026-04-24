const fs = require("fs");
const path = require("path");
const {
  applyLiveNewsSummary,
  buildLiveNewsSummary,
  evaluateLiveNewsSummary,
} = require("../lib/article-agents/summary-agent");

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
  expect(!/Live News is tracking|It was updated|original source remains/i.test(text), `${sample.id} should not use old generic tracking copy.`);
  expect(!/^Live News/i.test(text), `${sample.id} should not start every summary with the brand name.`);
  expect(text.length >= 70 && text.length <= 340, `${sample.id} should keep a compact summary length.`);
  expect(
    /Trump|Witkoff|Kushner|Pakistan|Iran|Norfolk|profit|insurance|derailment|sanctions|refinery|Iranian oil|Natalie|Decker|Talladega/i.test(text),
    `${sample.id} should include article-specific details.`
  );
  const reevaluated = evaluateLiveNewsSummary(sample, text);
  expect(reevaluated.passed, `${sample.id} should pass reevaluation.`);
}

const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const categoryJs = fs.readFileSync(path.join(root, "public", "category.js"), "utf8");
const searchJs = fs.readFileSync(path.join(root, "public", "search.js"), "utf8");
expect(serverJs.includes("applyLiveNewsSummary"), "Server should apply summary agents before stories reach the UI.");
expect(appJs.includes("getDisplaySummary(item, 150)"), "Latest News Feed should render the shared Live News summary field.");
expect(appJs.includes("if (item.liveNewsSummary)"), "UI summary rendering should prefer Live News agent summaries.");
expect(!appJs.includes("Live News is tracking this"), "Latest News fallback should not return the old generic tracking sentence.");
expect(!categoryJs.includes("Live News found this result"), "Category results should not return the old generic result summary.");
expect(!searchJs.includes("Live News found this result"), "Search results should not return the old generic result summary.");

const payload = {
  topStories: [samples[0]],
  feed: [samples[2], samples[3]],
};
const shapedPayload = {
  topStories: payload.topStories.map(applyLiveNewsSummary),
  feed: payload.feed.map(applyLiveNewsSummary),
};
expect(shapedPayload.feed.every((item) => item.liveNewsSummary), "Latest News Feed items should receive Live News summaries.");
expect(
  shapedPayload.feed.every((item) => !/Live News is tracking|It was updated|original source remains/i.test(item.liveNewsSummary)),
  "Latest News Feed summaries should not use old generic tracking copy."
);

if (failures.length) {
  console.error("Live News summary-agent check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News summary-agent check passed.");
console.log(`Samples checked: ${samples.length}`);
