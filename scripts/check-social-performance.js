const {
  addManualPostPerformance,
  addPublicInterestSignal,
  createEmptySocialPerformanceMemory,
  summarizePerformanceMemory,
  syncSocialStyleMemoryWithPerformance,
  validateManualPerformanceInput,
  validatePublicInterestSignal,
} = require("../lib/social-performance-memory");
const { DEFAULT_SOCIAL_STYLE_MEMORY } = require("../lib/social-intelligence");

const failures = [];
let store = createEmptySocialPerformanceMemory();

const manualResult = addManualPostPerformance(store, {
  platform: "instagram",
  exactArticleUrl: "https://newsmorenow.com/stories/city-council-transit-safety-test",
  postedAt: "2026-05-08T18:00:00.000Z",
  category: "local",
  captionShape: "context_first",
  mediaShape: "square_card",
  metrics: {
    reach: 1000,
    views: 1400,
    likes: 45,
    comments: 8,
    shares: 18,
    saves: 24,
    linkClicks: 52,
    profileVisits: 6,
    follows: 3,
    hides: 0,
    reports: 0,
  },
});
store = manualResult.store;

if (!manualResult.record.privacy.aggregateOnly || manualResult.record.privacy.storesPersonalData) {
  failures.push("Manual performance records must stay aggregate-only and non-personal.");
}

if (manualResult.record.scores.clickThroughRate <= 0) {
  failures.push("Manual performance should calculate click-through rate.");
}

const signalResult = addPublicInterestSignal(store, {
  sourceType: "google_trends",
  sourceName: "Google Trends",
  sourceUrl: "https://trends.google.com/trends/explore?geo=US&q=transit%20safety",
  topic: "transit safety",
  category: "local",
  geo: "US",
  publicInterestScore: 82,
  relatedQueries: ["city transit safety", "overnight transit"],
});
store = signalResult.store;

if (!signalResult.signal.privacy.aggregatePublicSignal || signalResult.signal.privacy.storesCookies) {
  failures.push("Public-interest signals must stay aggregate and must not store cookies.");
}

const summary = summarizePerformanceMemory(store);
if (summary.postCount !== 1 || summary.publicSignalCount !== 1) {
  failures.push("Performance summary should include manual posts and public-interest signals.");
}

if (!summary.strongestLessons.some((lesson) => /exact Live News articles|public interest|article traffic/i.test(lesson.lesson))) {
  failures.push("Performance memory should produce useful teacher lessons.");
}

const styleMemory = syncSocialStyleMemoryWithPerformance(store, DEFAULT_SOCIAL_STYLE_MEMORY);
if (!styleMemory.performanceLessons?.length) {
  failures.push("Performance lessons should sync into Social Style Memory.");
}

const unsafeManual = validateManualPerformanceInput({
  platform: "instagram",
  exactArticleUrl: "https://newsmorenow.com/stories/test",
  accessToken: "should-not-save",
  commentsText: "copying comments is not allowed",
});
if (unsafeManual.ok) {
  failures.push("Manual performance must reject tokens and copied comment text.");
}

const unsafeSignal = validatePublicInterestSignal({
  sourceType: "google_trends",
  topic: "private user trend",
  sourceUrl: "https://trends.google.com/trends/explore?q=news",
  cookie: "not allowed",
});
if (unsafeSignal.ok) {
  failures.push("Public-interest signals must reject cookies or private data.");
}

const badLink = validateManualPerformanceInput({
  platform: "facebook",
  exactArticleUrl: "https://newsmorenow.com/",
});
if (badLink.ok) {
  failures.push("Manual performance must reject homepage-only links.");
}

if (failures.length) {
  console.error("Live News social performance check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News social performance check passed.");
console.log(`Manual posts checked: ${summary.postCount}`);
console.log(`Public signals checked: ${summary.publicSignalCount}`);
console.log(`Lessons checked: ${summary.lessonCount}`);
