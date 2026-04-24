const fs = require("fs");
const path = require("path");
const {
  enrichNewsItemsWithApprovedStories,
  toApprovedStory,
  validateDraftForApproval,
} = require("../lib/article-agents/approved-stories");
const { runArticleAgents } = require("../lib/article-agents/pipeline");

const newsPath = path.join(__dirname, "..", "data", "news.json");
const payload = JSON.parse(fs.readFileSync(newsPath, "utf8"));
const result = runArticleAgents(payload, { limit: 8 });
const sourceLinkedResult = runArticleAgents(
  {
    topStories: [
      {
        id: "source-linked-test",
        title: "City leaders approve transit safety plan after public review",
        sourceName: "Live News Test Source",
        sourceUrl: "https://example.com",
        link: "https://example.com/transit-safety-plan",
        category: "Local",
        score: 92,
        publishedAt: new Date().toISOString(),
        summary:
          "City leaders approved a transit safety plan after public review. The plan includes station upgrades and public reporting measures.",
        sourceCount: 2,
        supportingLinks: [
          {
            sourceName: "City Records",
            link: "https://example.org/city-records/transit-safety",
            publishedAt: new Date().toISOString(),
            category: "Local"
          }
        ]
      }
    ],
    feed: []
  },
  {
    limit: 1,
    styleMemory: {
      recentFingerprints: [],
      avoidPhrases: [],
      editorLessons: []
    }
  }
);

const failures = [];

if (result.run.autoPublish !== false) {
  failures.push("Auto-publish must be disabled.");
}

if (!result.packets.length) {
  failures.push("At least one story packet should be generated.");
}

if (result.drafts.length !== result.packets.length) {
  failures.push("Every story packet should receive a draft.");
}

for (const draft of result.drafts) {
  if (!draft.requiredHumanReview) {
    failures.push(`${draft.storyId} does not require human review.`);
  }
  if (draft.publishStatus !== "private_review_only") {
    failures.push(`${draft.storyId} is not private review-only.`);
  }
  if (draft.autoPublishAllowed !== false) {
    failures.push(`${draft.storyId} allows auto-publish.`);
  }
  if (!draft.sourceBlock?.originalSourceUrl && !draft.sourceAttribution) {
    failures.push(`${draft.storyId} is missing source attribution.`);
  }
  if (!draft.evaluation || draft.evaluation.scores.safety < 90) {
    failures.push(`${draft.storyId} failed the safety gate.`);
  }
  if (
    draft.originalPublisherTitle &&
    draft.headline.trim().toLowerCase() === draft.originalPublisherTitle.trim().toLowerCase()
  ) {
    failures.push(`${draft.storyId} copied the publisher headline exactly.`);
  }
}

const sourceLinkedDraft = sourceLinkedResult.drafts[0];
if (!sourceLinkedDraft?.evaluation?.passed) {
  failures.push("A source-linked test story should pass the quality gates.");
}

if (sourceLinkedDraft?.sourceBlock?.originalSourceUrl !== "https://example.com/transit-safety-plan") {
  failures.push("The source-linked test story did not preserve the original source URL.");
}

const approvalCheck = validateDraftForApproval(sourceLinkedDraft);
if (!approvalCheck.ok) {
  failures.push(`A source-linked test story should be approvable: ${approvalCheck.failures.join("; ")}`);
}

if (approvalCheck.ok) {
  const approvedStory = toApprovedStory(sourceLinkedDraft, {
    approvedAt: "2026-04-23T00:00:00.000Z",
    approvedBy: "Automated check",
  });
  if (approvedStory.status !== "approved" || approvedStory.public !== true) {
    failures.push("Approved stories must be public and marked approved.");
  }
  if (!approvedStory.liveNewsUrl.startsWith("/stories/")) {
    failures.push("Approved stories must receive a Live News story URL.");
  }
  if (!approvedStory.originalSourceUrl) {
    failures.push("Approved stories must preserve the original source URL.");
  }
  const enriched = enrichNewsItemsWithApprovedStories(
    [
      {
        id: "source-linked-test",
        link: "https://example.com/transit-safety-plan",
        title: "Source-linked test",
      },
    ],
    [approvedStory]
  );
  if (!enriched[0].hasLiveNewsStory || !enriched[0].approvedStoryUrl) {
    failures.push("Approved stories must enrich matching homepage news items.");
  }
}

const blockedApproval = validateDraftForApproval({ ...sourceLinkedDraft, sourceBlock: {} });
if (blockedApproval.ok) {
  failures.push("Drafts without original source links must not be approved.");
}

if (failures.length) {
  console.error("Live News article-agent check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News article-agent check passed.");
console.log(`Packets: ${result.packets.length}`);
console.log(`Drafts: ${result.drafts.length}`);
console.log(`Review-only mode: ${result.run.mode}`);
console.log(`Source-linked gate pass: ${sourceLinkedDraft.evaluation.overall}`);
