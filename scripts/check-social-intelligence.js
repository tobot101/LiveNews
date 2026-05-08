const { buildSocialPublisherRun, evaluateSocialDraft } = require("../lib/social-publisher");
const {
  SOCIAL_STYLE_MEMORY_SCHEMA_VERSION,
  SOCIAL_TEACHER_STACK,
  readSocialStyleMemory,
} = require("../lib/social-intelligence");

const fixturePayload = {
  topStoryOfDay: {
    id: "social-intel-fixture-top",
    title: "City officials approve overnight transit safety plan",
    liveNewsSummary:
      "Council members approved overnight station safety changes after public review. Riders and station workers are expected to see updated reporting procedures.",
    sourceName: "Live News Test Source",
    link: "https://example.com/transit-safety-plan",
    category: "Local",
    publishedAt: "2026-05-08T12:00:00.000Z",
    hasLiveNewsStory: true,
    approvedStoryUrl: "/stories/transit-safety-plan-test",
  },
  topStories: [
    {
      id: "social-intel-fixture-business",
      title: "Retail chain warns higher shipping costs could reach shoppers",
      liveNewsSummary:
        "The company said rising shipping costs may affect prices later this year. Consumers could see changes if transport expenses continue climbing.",
      sourceName: "Live News Test Source",
      link: "https://example.com/shipping-costs",
      category: "Business",
      publishedAt: "2026-05-08T13:00:00.000Z",
    },
  ],
  feed: [],
};

function fail(message, failures) {
  failures.push(message);
}

const failures = [];
const memory = readSocialStyleMemory();
const result = buildSocialPublisherRun(fixturePayload, {
  origin: "https://newsmorenow.com",
  limit: 6,
  socialMemory: memory,
});

if (memory.schemaVersion !== SOCIAL_STYLE_MEMORY_SCHEMA_VERSION) {
  fail("Social style memory schema is not current.", failures);
}

if (memory.autoPostAllowed !== false) {
  fail("Social style memory must not allow auto-posting.", failures);
}

if (!memory.approvedLearningSignals?.includes("link_clicks")) {
  fail("Social style memory must learn from exact article link clicks.", failures);
}

if (memory.blockedLearningSignals?.some((signal) => /username|profile|private/i.test(signal)) !== true) {
  fail("Social style memory should explicitly block personal/private data learning.", failures);
}

if (result.autoPost !== false || result.mode !== "private_review_only") {
  fail("Social intelligence run must stay private review-only.", failures);
}

for (const teacher of SOCIAL_TEACHER_STACK) {
  if (!result.run.teacherStack.includes(teacher.name)) {
    fail(`Missing teacher stack entry: ${teacher.name}`, failures);
  }
}

if (!result.learningPlan?.teacherStack?.includes("Growth Memory Teacher")) {
  fail("Run learning plan should include the Growth Memory Teacher.", failures);
}

for (const draft of result.drafts) {
  const evaluation = evaluateSocialDraft(draft);
  if (!draft.audiencePlan?.primaryHumanAngle) {
    fail(`${draft.socialDraftId} is missing an audience plan.`, failures);
  }
  if (!draft.learningHooks || draft.learningHooks.personalDataRequired !== false) {
    fail(`${draft.socialDraftId} learning hooks must avoid personal data.`, failures);
  }
  if (draft.learningHooks?.learningScope !== "aggregate_patterns_only") {
    fail(`${draft.socialDraftId} learning scope must stay aggregate only.`, failures);
  }
  if (!draft.learningHooks?.metricsToCapture?.includes("link_clicks")) {
    fail(`${draft.socialDraftId} must capture exact article link clicks.`, failures);
  }
  if ((draft.platforms?.instagram?.variants || []).length < 3) {
    fail(`${draft.socialDraftId} needs at least three Instagram caption variants.`, failures);
  }
  if ((draft.platforms?.facebook?.variants || []).length < 3) {
    fail(`${draft.socialDraftId} needs at least three Facebook caption variants.`, failures);
  }
  if (!draft.teacherReport?.checks?.length) {
    fail(`${draft.socialDraftId} is missing teacher report checks.`, failures);
  }
  if (!evaluation.teacherReport?.checks?.some((check) => check.id === "human_approval_teacher")) {
    fail(`${draft.socialDraftId} must be checked by the Human Approval Teacher.`, failures);
  }
  if (draft.autoPostAllowed !== false || draft.publicVisible !== false) {
    fail(`${draft.socialDraftId} must remain private and unable to auto-post.`, failures);
  }
  if (/newsmorenow\.com\/?$/i.test(draft.platforms?.facebook?.link || "")) {
    fail(`${draft.socialDraftId} must not point Facebook traffic to the homepage.`, failures);
  }
}

if (failures.length) {
  console.error("Live News social intelligence check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News social intelligence check passed.");
console.log(`Teacher layers: ${SOCIAL_TEACHER_STACK.length}`);
console.log(`Drafts checked: ${result.drafts.length}`);
