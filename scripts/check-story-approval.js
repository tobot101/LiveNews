const {
  enrichNewsPayloadWithApprovedStories,
  toApprovedStory,
  validateDraftForApproval,
} = require("../lib/article-agents/approved-stories");
const { runArticleAgents } = require("../lib/article-agents/pipeline");
const { renderPublicStoryPage } = require("../lib/article-agents/story-renderer");
const {
  buildDraftWithEditorWritingEdits,
  renderStoryWritingQualityPanel,
} = require("../lib/article-agents/story-approval-dashboard");
const { buildStoryWritingPackage } = require("../lib/article-agents/writing-quality");
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

if (draft.writingQualityStatus !== "ready") {
  failures.push("Draft description should be evaluated by the writing-quality module before approval.");
}

if (!draft.factMap?.confirmedFacts?.length) {
  failures.push("Draft should include the Original Writer SourceFactMap before approval.");
}

if (!draft.writerRoom?.descriptionRoom?.selectedCandidate) {
  failures.push("Draft should include WriterRoom description output before approval.");
}

if (draft.headline?.toLowerCase() === draft.originalPublisherTitle?.toLowerCase()) {
  failures.push("Draft title should not copy the publisher title.");
}

if (draft.sourceSummary && draft.description?.toLowerCase() === draft.sourceSummary.toLowerCase()) {
  failures.push("Draft description should not copy the publisher summary.");
}

if (!draft.copyRisk || !draft.rewriteSession) {
  failures.push("Draft should include copy-distance and rewrite-session metadata.");
}

if (!draft.writingExam?.fields?.description?.passed) {
  failures.push("Draft description should pass the shared writing-quality description gate.");
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

if (approvedStory.writingQualityStatus !== "ready") {
  failures.push("Approved story description should be evaluated before public approval.");
}

if (!approvedStory.writingExam?.fields?.description?.passed) {
  failures.push("Approved story description should pass the writing exam.");
}

if (!approvedStory.factMap?.confirmedFacts?.length) {
  failures.push("Approved story should include the Original Writer SourceFactMap.");
}

if (!approvedStory.writerRoom?.descriptionRoom?.selectedCandidate) {
  failures.push("Approved story should include WriterRoom description output.");
}

if (!approvedStory.teacherChecks?.some((teacher) => teacher.fieldName === "description" && teacher.name === "StoryFocusTeacher" && teacher.passed)) {
  failures.push("Approved story description should pass StoryFocusTeacher.");
}

if (!approvedStory.teacherChecks?.some((teacher) => teacher.fieldName === "description" && teacher.name === "CopyRiskTeacher" && teacher.passed)) {
  failures.push("Approved story description should pass CopyRiskTeacher.");
}

if (!approvedStory.copyRisk || !approvedStory.rewriteSession) {
  failures.push("Approved story should preserve copy-risk and rewrite-session metadata.");
}

if (!approvedStory.description || /source-linked coverage|read the original source/i.test(approvedStory.description)) {
  failures.push("Approved story should have a story-focused description, not generic fallback wording.");
}

const weakDraft = {
  ...draft,
  originalPublisherTitle: "",
  primarySourceName: "",
  sourceAttribution: "",
  sourceBlock: {
    attribution: "",
    originalSourceUrl: "",
    supportingSourceUrls: [],
  },
  canonicalLiveNewsUrl: "",
  liveNewsUrl: "",
  canonicalUrl: "",
  headline: "",
  title: "",
  description: "",
  dek: "",
  summary: [],
  sourceSummary: "",
  sourceFacts: [],
  keyPoints: [],
  whyItMatters: "",
};
const weakCheck = validateDraftForApproval(weakDraft);
if (weakCheck.ok || !["needs_review", "needs_more_context", "blocked"].includes(weakCheck.writingPackage?.writingQualityStatus)) {
  failures.push("Weak approved-story context should be marked needs_review or blocked.");
}

const fallbackPackage = buildStoryWritingPackage({
  ...draft,
  description: "Read the original source for the full report.",
  dek: "Read the original source for the full report.",
  summary: ["Read the original source for the full report."],
  whyItMatters: "Read the original source for the full report.",
});
const fallbackDescriptionCandidate = fallbackPackage.descriptionCandidates.find((candidate) => candidate.id === "existingDescription");
if (fallbackDescriptionCandidate?.evaluation?.passed || fallbackPackage.fieldGates.whyItMatters.ok) {
  failures.push("Generic fallback description and why-it-matters text should be blocked.");
}

const unsupportedPackage = buildStoryWritingPackage({
  ...draft,
  description: "The transit safety plan will cut taxes for every family.",
  dek: "The transit safety plan will cut taxes for every family.",
  summary: ["The transit safety plan will cut taxes for every family."],
  whyItMatters: "The transit safety plan will cut taxes for every family.",
});
if (unsupportedPackage.writingQualityStatus === "ready") {
  failures.push("Unsupported claims should not pass approved-story writing quality.");
}

const copiedPackage = buildStoryWritingPackage({
  ...draft,
  description: "City leaders approve overnight transit safety plan after public review.",
  dek: "City leaders approve overnight transit safety plan after public review.",
  summary: ["City leaders approve overnight transit safety plan after public review."],
  whyItMatters: "City leaders approve overnight transit safety plan after public review.",
});
if (copiedPackage.writingQualityStatus === "ready") {
  failures.push("Copied publisher wording should be warned or blocked before approval.");
}

const broadWhyPackage = buildStoryWritingPackage({
  ...draft,
  whyItMatters: "City transit safety plan may affect daily life, public services, traffic, schools, or local planning.",
});
if (broadWhyPackage.fieldGates.whyItMatters.ok) {
  failures.push("Generic why-it-matters fallback should be blocked or marked needs_review.");
}

const missingUrlCheck = validateDraftForApproval({
  ...draft,
  canonicalLiveNewsUrl: "",
  liveNewsUrl: "",
  canonicalUrl: "",
});
if (missingUrlCheck.ok) {
  failures.push("Exact /stories/... URL should be required before approval.");
}

const homepageUrlCheck = validateDraftForApproval({
  ...draft,
  canonicalLiveNewsUrl: "https://newsmorenow.com/",
  liveNewsUrl: "https://newsmorenow.com/",
  canonicalUrl: "https://newsmorenow.com/",
});
if (homepageUrlCheck.ok) {
  failures.push("Homepage URLs should be blocked before approval.");
}

if (draft.writingQuality?.context?.publicSafetyRelevant !== false) {
  failures.push("Public safety should not be forced for a normal local approved-story draft.");
}

const writingPanelHtml = renderStoryWritingQualityPanel(draft, approvalCheck, { editable: true });
if (!/Writing review before approval/.test(writingPanelHtml) || !/Writing quality/.test(writingPanelHtml)) {
  failures.push("Admin story page should expose writing-quality results.");
}
if (!/Teacher score|Teacher scores/.test(writingPanelHtml)) {
  failures.push("Admin story page should expose teacher scores.");
}
if (!/Candidate descriptions/.test(writingPanelHtml) || !/Source faithful/.test(writingPanelHtml)) {
  failures.push("Candidate descriptions should be visible in the admin story page.");
}
if (!/Copy risk/i.test(writingPanelHtml)) {
  failures.push("Copy-risk warnings should be visible in the admin story page.");
}
if (!/Editor reason for manual writing changes/.test(writingPanelHtml)) {
  failures.push("Editor reason field should be visible when approval editing is supported.");
}
if (/YOUR_ADMIN_TOKEN|access_token=|token=/.test(writingPanelHtml)) {
  failures.push("Writing-quality panel should not render real or placeholder tokens.");
}

const rewriteVisibilityPanelHtml = renderStoryWritingQualityPanel(
  draft,
  {
    writingPackage: {
      ...approvalCheck.writingPackage,
      writerRoom: {
        fields: {
          description: {
            status: "passed",
            candidates: [
              {
                text: "After public review, city leaders approve overnight transit safety plan.",
                writingExam: { total: 62 },
              },
            ],
            selectedCandidate: {
              text: draft.description,
              strategy: "writer_room_rewrite",
              writingExam: { total: 94, blockingReasons: [] },
              teacherChecks: [
                { name: "StoryFocusTeacher", passed: true, score: 94 },
                { name: "CopyRiskTeacher", passed: true, score: 88 },
              ],
              copyRisk: { risk: "low", score: 86, explanation: "Copy risk is low after rewrite." },
            },
            rewriteSession: {
              status: "passed",
              originalCandidate: "After public review, city leaders approve overnight transit safety plan.",
              finalCandidate: draft.description,
              attempts: [
                {
                  diagnosis: {
                    failedTeacherNames: ["CopyRiskTeacher", "StoryFocusTeacher"],
                    strategies: ["fact_map_rewrite", "story_focus_rewrite"],
                    reasons: ["Candidate was too close to source wording."],
                  },
                  selected: { strategy: "fact_map_rewrite", writingScore: 62 },
                },
              ],
              finalWritingExam: { total: 94 },
              copyRiskBefore: {
                risk: "blocked",
                score: 0,
                explanation: "Distinctive source phrase appears in candidate.",
              },
              copyRiskAfter: {
                risk: "low",
                score: 86,
                explanation: "Copy risk is low after rewrite.",
              },
              improvementSummary: "Writing score moved from 62 to 94. Copy risk moved from blocked to low.",
            },
            rewriteLessonsUsed: [
              {
                lesson: "When CopyRiskTeacher fails, rebuild from confirmed facts instead of rearranging the source sentence.",
              },
            ],
            managingEditorReason: "Selected the rewritten description.",
          },
        },
      },
    },
  },
  { editable: false }
);
if (!/Rewrite visibility/.test(rewriteVisibilityPanelHtml) || !/Rewrite status/.test(rewriteVisibilityPanelHtml)) {
  failures.push("Story dashboard should show rewrite status.");
}
if (!/CopyRiskTeacher/.test(rewriteVisibilityPanelHtml) || !/StoryFocusTeacher/.test(rewriteVisibilityPanelHtml)) {
  failures.push("Story dashboard should show failed teacher names.");
}
if (!/Copy-risk explanation/.test(rewriteVisibilityPanelHtml) || !/Distinctive source phrase/.test(rewriteVisibilityPanelHtml)) {
  failures.push("Story dashboard should show copy-risk explanation.");
}
if (!/Before score/.test(rewriteVisibilityPanelHtml) || !/After score/.test(rewriteVisibilityPanelHtml)) {
  failures.push("Story dashboard should show before and after scores.");
}
if (!/Final selected rewrite/.test(rewriteVisibilityPanelHtml) || !/Writing score moved from 62 to 94/.test(rewriteVisibilityPanelHtml)) {
  failures.push("Story dashboard should show final rewrite and improvement summary.");
}
if (!/Approved rewrite lesson/.test(rewriteVisibilityPanelHtml) || !/rebuild from confirmed facts/.test(rewriteVisibilityPanelHtml)) {
  failures.push("Story dashboard should show approved rewrite lesson when available.");
}

const needsContextRewritePanelHtml = renderStoryWritingQualityPanel(
  weakDraft,
  {
    writingPackage: {
      ...weakCheck.writingPackage,
      writerRoom: {
        fields: {
          description: {
            status: "needs_more_context",
            selectedCandidate: null,
            candidates: [],
            rewriteSession: {
              status: "needs_more_context",
              originalCandidate: "This article discusses the update.",
              finalCandidate: null,
              attempts: [],
              copyRiskBefore: { risk: "medium", score: 58, explanation: "Generic source-like wording." },
              copyRiskAfter: {},
              improvementSummary: "More source-backed context is needed.",
            },
            managingEditorReason: "Needs more context: main_event_missing.",
          },
        },
      },
    },
  },
  { editable: false }
);
if (!/Needs more context/.test(needsContextRewritePanelHtml) || !/More source-backed context is needed/.test(needsContextRewritePanelHtml)) {
  failures.push("Story dashboard should show needs_more_context when no rewrite passed.");
}
if (/YOUR_ADMIN_TOKEN|access_token=|token=/.test(rewriteVisibilityPanelHtml + needsContextRewritePanelHtml)) {
  failures.push("Rewrite visibility panel should not render real or placeholder tokens.");
}

const weakPanelHtml = renderStoryWritingQualityPanel(weakDraft, weakCheck, { editable: false });
if (!/Missing context/.test(weakPanelHtml) || !/main_event_missing|confirmed_facts_missing/.test(weakPanelHtml)) {
  failures.push("Missing context should be visible for weak drafts.");
}

const fallbackPanelHtml = renderStoryWritingQualityPanel(
  {
    ...draft,
    description: "Read the original source for the full report.",
    dek: "Read the original source for the full report.",
    summary: ["Read the original source for the full report."],
  },
  { writingPackage: fallbackPackage, failures: fallbackPackage.blockingReasons || [] },
  { editable: false }
);
if (!/Fallback risk/i.test(fallbackPanelHtml)) {
  failures.push("Generic fallback warning should be visible in the admin story page.");
}

const editResult = buildDraftWithEditorWritingEdits(draft, {
  approvedTitle: "Transit safety plan advances after public review",
  approvedDescription: draft.description,
  approvedSummary: Array.isArray(draft.summary) ? draft.summary.join(" ") : draft.summary,
  approvedWhyItMatters: draft.whyItMatters,
  editorReason: "Removed publisher-style wording and made the title clearer.",
});
if (editResult.draft.headline !== "Transit safety plan advances after public review") {
  failures.push("Approved editor version should update the draft copy before approval.");
}
if (!editResult.writingEdits.length || editResult.writingEdits[0].editorReason !== "Removed publisher-style wording and made the title clearer.") {
  failures.push("Editor edit reason should be captured for approved writing memory.");
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
