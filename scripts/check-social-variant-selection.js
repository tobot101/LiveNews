const fs = require("fs");
const path = require("path");
const { buildSocialPublisherRun } = require("../lib/social-publisher");
const { buildFacebookPublishPlan } = require("../lib/meta-publisher");
const { renderSocialVariantReviewHtml } = require("../lib/social-dashboard-renderer");
const {
  applySocialVariantSelectionsToRun,
  createEmptySocialVariantSelectionStore,
  recordSocialVariantSelectionInStore,
  validateSocialVariantSelection,
} = require("../lib/social-variant-selections");

const failures = [];
const env = {
  META_APP_ID: "123456",
  META_PAGE_ID: "987654",
  META_PAGE_ACCESS_TOKEN: "mock-private-page-token",
  META_APP_REVIEW_APPROVED: "true",
  LIVE_NEWS_META_POSTING_ENABLED: "true",
};

function fail(message) {
  failures.push(message);
}

const run = buildSocialPublisherRun(
  {
    topStoryOfDay: {
      id: "ab-caption-review-test",
      title: "City council approves overnight transit safety plan",
      liveNewsHeadline: "City Council Approves Overnight Transit Safety Plan",
      liveNewsSummary:
        "Council members approved overnight transit changes after public review. Riders and station workers are expected to see updated reporting procedures.",
      sourceName: "Live News Test Source",
      link: "https://example.com/transit-safety",
      category: "Local",
      publishedAt: "2026-05-08T12:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/city-council-transit-safety-test",
      generatedCardUrl: "https://newsmorenow.com/social-cards/city-council-transit-safety-test.png",
    },
    topStories: [],
    feed: [],
  },
  {
    origin: "https://newsmorenow.com",
    limit: 1,
  }
);

const draft = run.drafts[0];
const facebookVariants = draft.platforms?.facebook?.variants || [];
const instagramVariants = draft.platforms?.instagram?.variants || [];

if (facebookVariants.length < 3) fail("Facebook must display at least 3 variants.");
if (instagramVariants.length < 3) fail("Instagram must display at least 3 variants.");

const facebookHtml = renderSocialVariantReviewHtml({
  draft,
  platform: "facebook",
  actionUrl: "/admin/social/select-variant?token=YOUR_ADMIN_TOKEN",
});
const instagramHtml = renderSocialVariantReviewHtml({
  draft,
  platform: "instagram",
  actionUrl: "/admin/social/select-variant?token=YOUR_ADMIN_TOKEN",
});

if ((facebookHtml.match(/class="variant-card/g) || []).length < 3) {
  fail("Dashboard HTML should show at least 3 Facebook variant cards.");
}
if ((instagramHtml.match(/class="variant-card/g) || []).length < 3) {
  fail("Dashboard HTML should show at least 3 Instagram variant cards.");
}
if (!facebookHtml.includes("Quality status") || !instagramHtml.includes("Quality status")) {
  fail("Dashboard variants should show editor-friendly quality status.");
}
if (!facebookHtml.includes("Readiness notes") || !instagramHtml.includes("Readiness notes")) {
  fail("Dashboard variants should show readiness notes.");
}
if (/Teacher checks|Teacher scores/i.test(facebookHtml + instagramHtml)) {
  fail("Dashboard variants should not expose teacher-check wording.");
}
if (!facebookHtml.includes("https://newsmorenow.com/stories/city-council-transit-safety-test")) {
  fail("Dashboard variants should show the exact article URL.");
}

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
if (!serverSource.includes("/admin/meta/publish-selected") || !serverSource.includes("bulk-social-post-form")) {
  fail("Social dashboard should support selecting multiple Facebook/Instagram drafts before posting.");
}

const noSelectionPlan = buildFacebookPublishPlan(draft, {}, env);
if (noSelectionPlan.ready || !noSelectionPlan.failures.some((failure) => /select a facebook caption variant/i.test(failure))) {
  fail("Facebook API plan must stay blocked until an editor selects a variant.");
}

let store = createEmptySocialVariantSelectionStore();
const selectedFacebookVariantId = facebookVariants[1].id;
const selectedInstagramVariantId = instagramVariants[2].id;
const facebookSelection = recordSocialVariantSelectionInStore(
  store,
  draft,
  "facebook",
  selectedFacebookVariantId,
  { selectedAt: "2026-05-08T18:00:00.000Z", selectedBy: "Live News editor" }
);
store = facebookSelection.store;
const instagramSelection = recordSocialVariantSelectionInStore(
  store,
  draft,
  "instagram",
  selectedInstagramVariantId,
  { selectedAt: "2026-05-08T18:05:00.000Z", selectedBy: "Live News editor" }
);
store = instagramSelection.store;

const selectedRun = applySocialVariantSelectionsToRun(run, store);
const selectedDraft = selectedRun.drafts[0];
const selectedFacebook = selectedDraft.platforms.facebook.selectedVariant;
const selectedInstagram = selectedDraft.platforms.instagram.selectedVariant;

if (selectedDraft.platforms.facebook.selectedVariantId !== selectedFacebookVariantId) {
  fail("Selected Facebook variant should be recorded and applied.");
}
if (selectedDraft.platforms.instagram.selectedVariantId !== selectedInstagramVariantId) {
  fail("Selected Instagram variant should be recorded and applied.");
}
if ((selectedDraft.platforms.facebook.variants || []).filter((variant) => variant.selected).length !== 1) {
  fail("Exactly one Facebook variant should be marked selected.");
}
if ((selectedDraft.platforms.instagram.variants || []).filter((variant) => variant.selected).length !== 1) {
  fail("Exactly one Instagram variant should be marked selected.");
}
if ((selectedDraft.platforms.facebook.variants || []).some((variant) => variant.id !== selectedFacebookVariantId && variant.selected)) {
  fail("Non-selected Facebook variants must not be marked selected.");
}
if (selectedDraft.autoPostAllowed !== false || selectedDraft.publishStatus !== "private_review_only") {
  fail("Selecting a variant must not enable auto-publishing.");
}

const selectedPlan = buildFacebookPublishPlan(selectedDraft, {}, env);
if (!selectedPlan.ready) {
  fail(`Selected Facebook variant should be ready when Meta env is configured: ${selectedPlan.failures.join("; ")}`);
}
if (selectedPlan.payload.message !== selectedFacebook.message) {
  fail("Facebook API plan must use the selected variant message, not the first generated caption.");
}
if (selectedDraft.platforms.facebook.caption === facebookVariants[0].message && selectedFacebookVariantId !== facebookVariants[0].id) {
  fail("Non-selected first Facebook variant must not become the posting caption.");
}
if (!selectedInstagram?.caption) {
  fail("Selected Instagram variant should remain available for review.");
}

const blockedInstagramDraft = JSON.parse(JSON.stringify(draft));
blockedInstagramDraft.platforms.instagram.variants = blockedInstagramDraft.platforms.instagram.variants.map((variant) => ({
  ...variant,
  publishable: false,
  imagePlan: {},
}));
const blockedInstagramHtml = renderSocialVariantReviewHtml({
  draft: blockedInstagramDraft,
  platform: "instagram",
});
if (!blockedInstagramHtml.includes("Instagram image or generated card is not ready")) {
  fail("Dashboard should show Instagram image/card readiness blocking warnings.");
}

const homepageDraft = JSON.parse(JSON.stringify(draft));
homepageDraft.linkState.exactArticleUrl = "https://newsmorenow.com/";
homepageDraft.platforms.facebook.variants = homepageDraft.platforms.facebook.variants.map((variant) => ({
  ...variant,
  exactArticleUrl: "https://newsmorenow.com/",
}));
const homepageValidation = validateSocialVariantSelection(
  homepageDraft,
  "facebook",
  homepageDraft.platforms.facebook.variants[0].id
);
if (homepageValidation.ok) {
  fail("Homepage-only links must be blocked during variant selection.");
}

if (failures.length) {
  console.error("Live News social variant selection check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News social variant selection check passed.");
console.log(`Facebook variants checked: ${facebookVariants.length}`);
console.log(`Instagram variants checked: ${instagramVariants.length}`);
