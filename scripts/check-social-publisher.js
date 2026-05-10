const fs = require("fs");
const path = require("path");
const {
  buildSocialPublisherRun,
  evaluateSocialDraft,
} = require("../lib/social-publisher");

const newsPath = path.join(__dirname, "..", "data", "news.json");
const fallbackPayload = JSON.parse(fs.readFileSync(newsPath, "utf8"));
const fixturePayload = {
  topStoryOfDay: {
    id: "social-fixture-top",
    title: "Live News expands private social publisher testing",
    liveNewsSummary:
      "Live News is testing a private social workflow that prepares captions and exact story links before any post reaches Instagram or Facebook.",
    sourceName: "Live News Test Source",
    link: "https://example.com/live-news-social-workflow",
    category: "Tech",
    publishedAt: "2026-05-08T12:00:00.000Z",
  },
  topStories: [
    {
      id: "social-fixture-business",
      title: "Media startup builds review queue before social publishing",
      liveNewsSummary:
        "The test workflow keeps social captions private until a human reviews attribution, source links, and whether the exact Live News article page is ready.",
      sourceName: "Live News Test Source",
      link: "https://example.com/review-queue-social-publishing",
      category: "Business",
      publishedAt: "2026-05-08T13:00:00.000Z",
    },
  ],
  feed: [],
};
const result = buildSocialPublisherRun(fixturePayload, {
  origin: "https://newsmorenow.com",
  limit: 12,
});
const fallbackResult = buildSocialPublisherRun(fallbackPayload, {
  origin: "https://newsmorenow.com",
  limit: 12,
});
const approvedResult = buildSocialPublisherRun(
  {
    topStoryOfDay: {
      id: "approved-social-test",
      title: "City council approves overnight transit safety plan",
      liveNewsHeadline: "City Council Approves Overnight Transit Safety Plan",
      liveNewsSummary:
        "Council members approved overnight safety changes for transit stations after public review. Riders and station workers are expected to see updated reporting procedures.",
      sourceName: "Live News Test Source",
      link: "https://example.com/transit-safety",
      category: "Local",
      publishedAt: "2026-05-08T12:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/city-council-transit-safety-test",
    },
    topStories: [],
    feed: [],
  },
  {
    origin: "https://newsmorenow.com",
    limit: 1,
  }
);

const failures = [];

if (result.autoPost !== false || result.mode !== "private_review_only") {
  failures.push("Social publisher run must stay private review-only with auto-post disabled.");
}

if (!result.run?.agentSequence?.includes("Human Approval Gate")) {
  failures.push("Social publisher must include the human approval gate.");
}

if (!result.drafts.length) {
  failures.push("Social publisher should generate at least one draft from the news payload.");
}

if (fallbackResult.drafts.some((draft) => !draft.originalSourceUrl)) {
  failures.push("Fallback data without source links must not produce unsafe social drafts.");
}

for (const draft of result.drafts) {
  const evaluation = evaluateSocialDraft(draft);
  if (!evaluation.passed) {
    failures.push(`${draft.socialDraftId} failed supervisor checks: ${evaluation.failures.join("; ")}`);
  }
  if (draft.autoPostAllowed !== false) {
    failures.push(`${draft.socialDraftId} allows auto-posting.`);
  }
  if (draft.publicVisible !== false) {
    failures.push(`${draft.socialDraftId} is marked public-visible.`);
  }
  if (draft.publishStatus !== "private_review_only") {
    failures.push(`${draft.socialDraftId} is not private review-only.`);
  }
  if (!draft.originalSourceUrl) {
    failures.push(`${draft.socialDraftId} is missing original source attribution URL.`);
  }
  if (/newsmorenow\.com\/?$/i.test(draft.platforms?.facebook?.link || "")) {
    failures.push(`${draft.socialDraftId} points a Facebook post to the homepage.`);
  }
  if (draft.linkState?.shareableNow && !/\/stories\//.test(draft.linkState.exactArticleUrl || "")) {
    failures.push(`${draft.socialDraftId} is shareable without an exact story URL.`);
  }
}

const approvedDraft = approvedResult.drafts[0];
if (!approvedDraft?.supervisor?.shareableNow) {
  failures.push("Approved social test should be ready for manual review.");
}

if (approvedDraft?.platforms?.facebook?.caption?.startsWith("Top Story:")) {
  failures.push("Facebook captions should not default to stiff placement-first wording.");
}

if (!/#LiveNews\b/.test(approvedDraft?.platforms?.facebook?.caption || "")) {
  failures.push("Facebook captions should include a small relevant hashtag set.");
}

  if (/review-only|source packet|draft packet|teacher layer|private dashboard|api test|held for editor review|posting stays paused/i.test(approvedDraft?.platforms?.facebook?.caption || "")) {
    failures.push("Facebook captions must not expose internal review workflow language.");
  }

if (!/Read the Live News page:/i.test(approvedDraft?.platforms?.facebook?.caption || "")) {
  failures.push("Facebook captions should use a clear exact-article call to action.");
}

if (approvedDraft?.platforms?.facebook?.link !== "https://newsmorenow.com/stories/city-council-transit-safety-test") {
  failures.push("Approved social test must use the exact Live News article link.");
}

if (!approvedDraft?.platforms?.instagram?.caption.includes("https://newsmorenow.com/stories/city-council-transit-safety-test")) {
  failures.push("Instagram caption must include the exact Live News article link.");
}

if (/source-linked coverage|#SourceLinkedCoverage/i.test([
  approvedDraft?.platforms?.facebook?.caption,
  approvedDraft?.platforms?.instagram?.caption,
].join(" "))) {
  failures.push("Social captions should not use stiff source-linked coverage wording.");
}

if (failures.length) {
  console.error("Live News social-publisher check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News social-publisher check passed.");
console.log(`Drafts checked: ${result.drafts.length}`);
console.log(`Ready with exact links: ${result.run.readyForManualReview}`);
console.log(`Blocked until article pages: ${result.run.blockedUntilArticlePage}`);
