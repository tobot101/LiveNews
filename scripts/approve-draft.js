const { approveDraft, validateDraftForApproval } = require("../lib/article-agents/approved-stories");
const { STORE_PATHS, readJson } = require("../lib/article-agents/store");

function printUsage() {
  console.log("Usage: npm run agent:approve -- <storyId-or-slug>");
  console.log("Approves one draft and creates a public Live News story page.");
}

const identifier = String(process.argv[2] || "").trim();
if (!identifier) {
  printUsage();
  process.exit(1);
}

const draftsStore = readJson(STORE_PATHS.drafts, {
  schemaVersion: "live-news-drafts-store-v1",
  drafts: [],
});

const draft = (draftsStore.drafts || []).find((item) => {
  return item.storyId === identifier || item.slug === identifier || item.canonicalLiveNewsUrl === identifier;
});

if (!draft) {
  console.error(`No draft found for "${identifier}".`);
  console.error("Run npm run agent:drafts first, then approve one of the saved draft story IDs.");
  process.exit(1);
}

const validation = validateDraftForApproval(draft);
if (!validation.ok) {
  console.error("Draft is not ready for public approval:");
  validation.failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

const story = approveDraft(draft, {
  approvedBy: process.env.LIVE_NEWS_APPROVER || "Live News editor",
});

console.log("Approved Live News story created.");
console.log(`Story ID: ${story.storyId}`);
console.log(`Headline: ${story.headline}`);
console.log(`Public URL: ${story.liveNewsUrl}`);
console.log(`Original source: ${story.originalSourceUrl}`);
