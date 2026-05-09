const {
  enrichNewsPayloadWithApprovedStories,
  toApprovedStory,
  validateDraftForApproval,
} = require("../lib/article-agents/approved-stories");
const { runArticleAgents } = require("../lib/article-agents/pipeline");
const { renderPublicStoryPage } = require("../lib/article-agents/story-renderer");
const { buildSocialPublisherRun } = require("../lib/social-publisher");

const sourceUrl = "https://example.com/city-council-transit-safety";
const payload = {
  topStoryOfDay: {
    id: "approval-fixture-top-day",
    title: "City leaders approve overnight transit safety plan after public review",
    sourceName: "Live News Test Source",
    sourceUrl: "https://example.com",
    link: sourceUrl,
    category: "Local",
    score: 96,
    publishedAt: "2026-05-08T12:00:00.000Z",
    summary:
      "City leaders approved overnight transit station safety changes after public review. Riders and station workers are expected to see updated reporting procedures.",
    sourceCount: 2,
    supportingLinks: [
      {
        sourceName: "City Records",
        link: "https://example.org/city-records/transit-safety",
        publishedAt: "2026-05-08T11:00:00.000Z",
        category: "Local",
      },
    ],
  },
  topStoryOfWeek: null,
  topStories: [],
  feed: [],
};

const result = runArticleAgents(
  {
    topStories: [payload.topStoryOfDay],
    feed: [],
  },
  {
    limit: 1,
    generatedAt: "2026-05-08T13:00:00.000Z",
    styleMemory: {
      recentFingerprints: [],
      avoidPhrases: [],
      editorLessons: [],
    },
  }
);

const failures = [];
const draft = result.drafts[0];
const approvalCheck = validateDraftForApproval(draft);

if (!approvalCheck.ok) {
  failures.push(`Fixture draft should be approval-ready: ${approvalCheck.failures.join("; ")}`);
}

const approvedStory = toApprovedStory(draft, {
  approvedAt: "2026-05-08T14:00:00.000Z",
  approvedBy: "Automated approval check",
});

if (!approvedStory.liveNewsUrl.startsWith("/stories/")) {
  failures.push("Approved story must create an exact /stories/... Live News URL.");
}

if (approvedStory.originalSourceUrl !== sourceUrl) {
  failures.push("Approved story must preserve the exact original source URL.");
}

const enriched = enrichNewsPayloadWithApprovedStories(
  {
    ...payload,
    topStoryOfDay: payload.topStoryOfDay,
    topStoryOfWeek: payload.topStoryOfDay,
    topStories: [payload.topStoryOfDay],
    feed: [payload.topStoryOfDay],
  },
  [approvedStory]
);

for (const surface of ["topStoryOfDay", "topStoryOfWeek"]) {
  if (!enriched[surface]?.hasLiveNewsStory || !enriched[surface]?.approvedStoryUrl) {
    failures.push(`${surface} must be enriched with the approved exact story URL.`);
  }
}

if (!enriched.topStories[0]?.hasLiveNewsStory || !enriched.feed[0]?.hasLiveNewsStory) {
  failures.push("Approved stories must enrich top-story and latest-feed surfaces.");
}

const socialRun = buildSocialPublisherRun(enriched, {
  origin: "https://newsmorenow.com",
  limit: 2,
});
const readyDraft = socialRun.drafts.find((item) => item.linkState?.shareableNow);

if (!readyDraft) {
  failures.push("Social publisher should unlock at least one draft after story approval.");
}

if (readyDraft && readyDraft.platforms?.facebook?.link !== `https://newsmorenow.com${approvedStory.liveNewsUrl}`) {
  failures.push("Facebook social draft must point to the exact approved Live News story URL.");
}

if (readyDraft && !readyDraft.platforms?.instagram?.caption.includes(`https://newsmorenow.com${approvedStory.liveNewsUrl}`)) {
  failures.push("Instagram social draft must include the exact approved Live News story URL.");
}

const storyHtml = renderPublicStoryPage(approvedStory, {
  origin: "https://newsmorenow.com",
});

if (!storyHtml.includes(`<link rel="canonical" href="https://newsmorenow.com${approvedStory.liveNewsUrl}"`)) {
  failures.push("Public story page must include a self-referencing canonical URL.");
}

if (!storyHtml.includes('"@type":"NewsArticle"') && !storyHtml.includes('"@type": "NewsArticle"')) {
  failures.push("Public story page must include NewsArticle structured data.");
}

if (!storyHtml.includes(sourceUrl)) {
  failures.push("Public story page must show the original source link in crawlable HTML.");
}

if (!storyHtml.includes("og:url")) {
  failures.push("Public story page must include Open Graph URL metadata for social sharing.");
}

if (failures.length) {
  console.error("Live News story approval check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News story approval check passed.");
console.log(`Approved URL: ${approvedStory.liveNewsUrl}`);
console.log(`Social ready drafts: ${socialRun.run.readyForManualReview}`);
