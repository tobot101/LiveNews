const {
  addManualPostPerformance,
  addPublicInterestSignal,
  createEmptySocialPerformanceMemory,
  summarizePerformanceMemory,
  syncSocialStyleMemoryWithPerformance,
  validateManualPerformanceInput,
  validatePublicInterestSignal,
} = require("../lib/social-performance-memory");
const { DEFAULT_SOCIAL_STYLE_MEMORY, buildSocialLearningHooks } = require("../lib/social-intelligence");

const failures = [];
let store = createEmptySocialPerformanceMemory();

const manualResult = addManualPostPerformance(store, {
  platform: "instagram",
  exactArticleUrl: "https://newsmorenow.com/stories/city-council-transit-safety-test",
  articleId: "city-council-transit-safety-test",
  postingTime: "2026-05-08T18:00:00.000Z",
  selectedVariant: "readerImpact",
  category: "local",
  captionShape: "context_first",
  mediaShape: "square_card",
  editorNotes: "Good aggregate exact-click result. Do not store @privatehandle or quoted comment text.",
  metrics: {
    reach: 1000,
    views: 1400,
    likes: 45,
    commentsCount: 8,
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

if (
  manualResult.record.articleId !== "city-council-transit-safety-test" ||
  manualResult.record.selectedVariant !== "readerImpact" ||
  manualResult.record.commentsCount !== 8 ||
  manualResult.record.metrics.commentsCount !== 8
) {
  failures.push("Manual performance should store article ID, selected variant, and aggregate metrics.");
}

if (/@privatehandle|quoted comment text/i.test(manualResult.record.editorNotes)) {
  failures.push("Editor notes should strip usernames and exact comment-style text.");
}

const sportsMatchup = addManualPostPerformance(store, {
  platform: "facebook",
  exactArticleUrl: "https://newsmorenow.com/stories/player-rivalry-final-test",
  articleId: "player-rivalry-final-test",
  postingTime: "2026-05-08T19:00:00.000Z",
  selectedVariant: "readerImpact",
  category: "sports",
  captionShape: "clear_player_matchup_first_sentence",
  mediaShape: "link_preview",
  metrics: {
    reach: 2200,
    views: 2300,
    likes: 95,
    commentsCount: 14,
    shares: 42,
    saves: 30,
    linkClicks: 120,
    profileVisits: 12,
    follows: 5,
    hides: 0,
    reports: 0,
  },
});
store = sportsMatchup.store;

const sportsGeneric = addManualPostPerformance(store, {
  platform: "facebook",
  exactArticleUrl: "https://newsmorenow.com/stories/generic-sports-title-test",
  articleId: "generic-sports-title-test",
  postingTime: "2026-05-08T20:00:00.000Z",
  selectedVariant: "sourceFirst",
  category: "sports",
  captionShape: "generic_title_based",
  mediaShape: "link_preview",
  metrics: {
    reach: 2100,
    views: 2150,
    likes: 32,
    commentsCount: 3,
    shares: 4,
    saves: 5,
    linkClicks: 15,
    profileVisits: 2,
    follows: 0,
    hides: 2,
    reports: 0,
  },
});
store = sportsGeneric.store;

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
if (summary.postCount !== 3 || summary.publicSignalCount !== 1) {
  failures.push("Performance summary should include manual posts and public-interest signals.");
}

const sportsLesson = summary.strongestLessons.find((lesson) =>
  /player matchup in the first sentence performed better than generic title-based captions/i.test(lesson.lesson)
);
if (!sportsLesson) {
  failures.push("Performance memory should produce safe comparison lessons from aggregate metrics.");
}

if (sportsLesson && sportsLesson.confidence !== "tentative") {
  failures.push("Lessons from a small sample should be marked tentative.");
}

if (!summary.strongestLessons.some((lesson) => /exact Live News article|public interest|article traffic/i.test(lesson.lesson))) {
  failures.push("Performance memory should produce useful teacher lessons.");
}

const styleMemory = syncSocialStyleMemoryWithPerformance(store, DEFAULT_SOCIAL_STYLE_MEMORY);
if (!styleMemory.performanceLessons?.length) {
  failures.push("Performance lessons should sync into Social Style Memory.");
}

const futureHooks = buildSocialLearningHooks({ category: "sports" }, styleMemory);
if (!futureHooks.safePerformanceLessons?.length) {
  failures.push("Future caption context should be able to read safe performance lessons.");
}

if (/username|private message|copied comment|@\w/i.test(JSON.stringify(styleMemory.performanceLessons))) {
  failures.push("Synced performance lessons must not contain usernames, private messages, or copied comments.");
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

const unsafeUsername = validateManualPerformanceInput({
  platform: "facebook",
  exactArticleUrl: "https://newsmorenow.com/stories/test",
  usernames: ["not-allowed"],
});
if (unsafeUsername.ok) {
  failures.push("Manual performance must reject usernames.");
}

const unsafePrivateMessage = validateManualPerformanceInput({
  platform: "facebook",
  exactArticleUrl: "https://newsmorenow.com/stories/test",
  privateMessages: ["not-allowed"],
});
if (unsafePrivateMessage.ok) {
  failures.push("Manual performance must reject private messages.");
}

const unsafeExactComment = validateManualPerformanceInput({
  platform: "facebook",
  exactArticleUrl: "https://newsmorenow.com/stories/test",
  publicCommentText: "Exact comment text should not be saved.",
});
if (unsafeExactComment.ok) {
  failures.push("Manual performance must reject exact public comment text.");
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
if (sportsLesson) console.log(`Example safe lesson: ${sportsLesson.lesson}`);
