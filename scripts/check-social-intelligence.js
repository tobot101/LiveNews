const { buildSocialPublisherRun, evaluateSocialDraft } = require("../lib/social-publisher");
const {
  SOCIAL_STYLE_MEMORY_SCHEMA_VERSION,
  SOCIAL_TEACHER_STACK,
  isPublicSafetyRelevant,
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

const safetyFixturePayload = {
  topStoryOfDay: {
    id: "normal-weather-test",
    title: "Weekend rain expected across parts of Southern California",
    liveNewsSummary:
      "Forecasts call for light rain and cooler temperatures this weekend. The story data includes no emergency instructions or active closures.",
    sourceName: "Live News Test Source",
    link: "https://example.com/weekend-rain",
    category: "Local",
    publishedAt: "2026-05-08T12:00:00.000Z",
    hasLiveNewsStory: true,
    approvedStoryUrl: "/stories/weekend-rain-test",
  },
  topStories: [
    {
      id: "normal-local-test",
      title: "San Diego council reviews park budget plan",
      liveNewsSummary:
        "Council members reviewed funding options for park maintenance. Residents may see future changes if the budget proposal moves forward.",
      sourceName: "Live News Test Source",
      link: "https://example.com/park-budget",
      category: "Local",
      publishedAt: "2026-05-08T13:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/park-budget-test",
    },
    {
      id: "sports-test",
      title: "Forward scores late winner as club advances in tournament",
      liveNewsSummary:
        "The late goal changed the matchup and moved the club into the next round. The result adds pressure before the next game.",
      sourceName: "Live News Test Source",
      link: "https://example.com/late-winner",
      category: "Sports",
      publishedAt: "2026-05-08T14:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/late-winner-test",
    },
    {
      id: "advisory-test",
      title: "County issues public advisory after boil water notice",
      liveNewsSummary:
        "A boil water notice remains in place after county officials warned residents to avoid drinking tap water until testing is complete.",
      sourceName: "Live News Test Source",
      link: "https://example.com/boil-water-notice",
      category: "Local",
      publishedAt: "2026-05-08T15:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/boil-water-notice-test",
    },
    {
      id: "evacuation-test",
      title: "Evacuation order issued near wildfire zone",
      liveNewsSummary:
        "An evacuation order is active for homes near the wildfire zone. Officials warned residents to leave the affected area while crews respond.",
      sourceName: "Live News Test Source",
      link: "https://example.com/evacuation-order",
      category: "Local",
      publishedAt: "2026-05-08T16:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/evacuation-order-test",
    },
  ],
  feed: [],
};

const safetyResult = buildSocialPublisherRun(safetyFixturePayload, {
  origin: "https://newsmorenow.com",
  limit: 8,
  socialMemory: memory,
});

const visualReadyResult = buildSocialPublisherRun(
  {
    topStoryOfDay: {
      id: "visual-ready-test",
      title: "Library expansion opens with new public study rooms",
      liveNewsSummary:
        "The city library opened new study rooms after a year of construction. Students and residents now have more public workspace downtown.",
      sourceName: "Live News Test Source",
      link: "https://example.com/library-expansion",
      category: "Local",
      publishedAt: "2026-05-08T17:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/library-expansion-test",
      imageUrl: "https://newsmorenow.com/social-cards/library-expansion-test.png",
    },
    topStories: [],
    feed: [],
  },
  {
    origin: "https://newsmorenow.com",
    limit: 1,
    socialMemory: memory,
  }
);

const noImageResult = buildSocialPublisherRun(
  {
    topStoryOfDay: {
      id: "visual-not-ready-test",
      title: "Community center opens with new evening classes",
      liveNewsSummary:
        "The community center opened new evening classes after a city review. Residents have more public program options this month.",
      sourceName: "Live News Test Source",
      link: "https://example.com/community-center",
      category: "Local",
      publishedAt: "2026-05-08T17:30:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/community-center-test",
    },
    topStories: [],
    feed: [],
  },
  {
    origin: "https://newsmorenow.com",
    limit: 1,
    socialMemory: memory,
  }
);

const approvedContextResult = buildSocialPublisherRun(
  {
    topStoryOfDay: {
      id: "approved-writing-context-test",
      title: "Publisher headline repeats raw wording",
      originalPublisherTitle: "Publisher headline repeats raw wording",
      liveNewsHeadline: "Council Vote Adds Overnight Transit Rules",
      description:
        "Council members approved overnight station rules after public review. Riders and station workers are expected to see updated reporting steps.",
      liveNewsSummary:
        "Council members approved overnight station rules after public review. Riders and station workers are expected to see updated reporting steps.",
      liveNewsWhyItMatters:
        "The change matters for riders and station workers who use overnight transit service.",
      sourceName: "Live News Test Source",
      link: "https://example.com/transit-rules",
      category: "Local",
      publishedAt: "2026-05-08T18:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/transit-rules-approved-test",
      writingQualityStatus: "ready",
      writingExam: { passed: true, total: 94 },
    },
    topStories: [],
    feed: [],
  },
  {
    origin: "https://newsmorenow.com",
    limit: 1,
    socialMemory: memory,
  }
);

const copiedPublisherResult = buildSocialPublisherRun(
  {
    topStoryOfDay: {
      id: "copied-publisher-caption-test",
      title: "Exact Publisher Headline Copied Here",
      originalPublisherTitle: "Exact Publisher Headline Copied Here",
      liveNewsHeadline: "Exact Publisher Headline Copied Here",
      liveNewsSummary:
        "Court records describe the confirmed filing and the next scheduled hearing. Live News keeps the wording neutral while linking back to the source.",
      sourceName: "Live News Test Source",
      link: "https://example.com/copied-publisher",
      category: "National",
      publishedAt: "2026-05-08T19:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/copied-publisher-caption-test",
    },
    topStories: [],
    feed: [],
  },
  {
    origin: "https://newsmorenow.com",
    limit: 1,
    socialMemory: memory,
  }
);

const unsupportedClaimResult = buildSocialPublisherRun(
  {
    topStoryOfDay: {
      id: "unsupported-claim-caption-test",
      title: "Company launches new planning tool",
      liveNewsHeadline: "Company Launches New Planning Tool",
      liveNewsSummary:
        "The company secretly guarantees every user will save money after using the new planning tool.",
      sourceName: "Live News Test Source",
      link: "https://example.com/planning-tool",
      category: "Technology",
      publishedAt: "2026-05-08T20:00:00.000Z",
      hasLiveNewsStory: true,
      approvedStoryUrl: "/stories/planning-tool-caption-test",
    },
    topStories: [],
    feed: [],
  },
  {
    origin: "https://newsmorenow.com",
    limit: 1,
    socialMemory: memory,
  }
);

if (memory.schemaVersion !== SOCIAL_STYLE_MEMORY_SCHEMA_VERSION) {
  fail("Social style memory schema is not current.", failures);
}

if (memory.autoPostAllowed !== false) {
  fail("Social style memory must not allow auto-posting.", failures);
}

if (!memory.approvedLearningSignals?.includes("link_clicks")) {
  fail("Social style memory must learn from exact article link clicks.", failures);
}

if (!memory.publicPatternPrinciples?.some((principle) => /hashtags|exact article clicks|comments as aggregate/i.test(principle))) {
  fail("Social style memory should include safe public-pattern principles.", failures);
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
  const combinedCaption = [
    draft.platforms?.facebook?.caption,
    draft.platforms?.instagram?.caption,
  ].join(" ");
  if (!/#LiveNews\b/.test(combinedCaption)) {
    fail(`${draft.socialDraftId} should include the Live News brand hashtag.`, failures);
  }
  if (/review-only|source packet|draft packet|teacher layer|private dashboard|api test|held for editor review|posting stays paused/i.test(combinedCaption)) {
    fail(`${draft.socialDraftId} exposes internal draft language in public social captions.`, failures);
  }
  if (!/Read the Live News page:/i.test(combinedCaption) && draft.linkState?.shareableNow) {
    fail(`${draft.socialDraftId} should use a clear exact-article call to action.`, failures);
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

function findDraft(run, id) {
  return (run.drafts || []).find((draft) => draft.storyId === id || draft.socialDraftId === id || draft.title.includes(id));
}

const normalWeather = findDraft(safetyResult, "normal-weather-test");
const normalLocal = findDraft(safetyResult, "normal-local-test");
const sports = findDraft(safetyResult, "sports-test");
const advisory = findDraft(safetyResult, "advisory-test");
const evacuation = findDraft(safetyResult, "evacuation-test");

if (isPublicSafetyRelevant(normalWeather) || normalWeather?.audiencePlan?.readerAngle?.id === "public_safety_usefulness") {
  fail("Normal weather coverage must not become public_safety_usefulness.", failures);
}

if (/#PublicSafety\b/i.test(JSON.stringify(normalLocal?.platforms || {}))) {
  fail("Normal local coverage must not receive public safety hashtags.", failures);
}

if (sports?.audiencePlan?.readerAngle?.id === "public_safety_usefulness" || /public safety|#PublicSafety/i.test(JSON.stringify(sports?.platforms || {}))) {
  fail("Sports coverage must not receive public safety framing.", failures);
}

if (!advisory?.audiencePlan?.publicSafetyRelevant || advisory?.audiencePlan?.readerAngle?.id !== "public_safety_usefulness") {
  fail("Explicit public advisory coverage should use public_safety_usefulness.", failures);
}

if (!/#PublicSafety\b/i.test(JSON.stringify(advisory?.platforms || {}))) {
  fail("Explicit public advisory coverage should allow the public safety hashtag.", failures);
}

if (!evacuation?.audiencePlan?.publicSafetyReviewRequired || evacuation?.reviewStatus !== "needs_human_review") {
  fail("Evacuation, road closure, or official alert coverage must require human review.", failures);
}

for (const draft of safetyResult.drafts) {
  const combinedCaption = [
    draft.platforms?.facebook?.caption,
    draft.platforms?.instagram?.caption,
  ].join(" ");
  if (/stay safe/i.test(combinedCaption) && draft.audiencePlan?.publicSafetyRelevant !== true) {
    fail(`${draft.socialDraftId} says stay safe without public-safety support.`, failures);
  }
  if (/review-only|source packet|draft packet|teacher layer|private dashboard|api test|held for editor review|posting stays paused/i.test(combinedCaption)) {
    fail(`${draft.socialDraftId} exposes internal workflow terms.`, failures);
  }
  if (draft.platforms?.facebook?.caption?.startsWith("Top Story:")) {
    fail(`${draft.socialDraftId} Facebook caption defaults to Top Story:.`, failures);
  }
  if (draft.linkState?.shareableNow && !draft.platforms?.facebook?.caption?.includes(draft.linkState.exactArticleUrl)) {
    fail(`${draft.socialDraftId} Facebook caption is missing the exact Live News story URL.`, failures);
  }
  if ((draft.platforms?.facebook?.variants || []).length < 3) {
    fail(`${draft.socialDraftId} needs at least three Facebook variants.`, failures);
  }
  if ((draft.platforms?.instagram?.variants || []).length < 3) {
    fail(`${draft.socialDraftId} needs at least three Instagram variants.`, failures);
  }
  for (const variant of draft.platforms?.facebook?.variants || []) {
    for (const field of ["id", "label", "title", "message", "description", "exactArticleUrl", "sourceAttribution", "hashtags", "captionShape", "safetyFlags", "teacherChecks", "publishable"]) {
      if (!(field in variant)) fail(`${draft.socialDraftId} Facebook variant ${variant.id || "unknown"} is missing ${field}.`, failures);
    }
  }
  for (const variant of draft.platforms?.instagram?.variants || []) {
    for (const field of ["id", "label", "shortTitle", "caption", "cardTitle", "cardSubtitle", "altText", "storyText", "carouselSlides", "hashtags", "imagePlan", "exactArticleUrl", "sourceAttribution", "captionShape", "safetyFlags", "teacherChecks", "publishable", "renderStatus"]) {
      if (!(field in variant)) fail(`${draft.socialDraftId} Instagram variant ${variant.id || "unknown"} is missing ${field}.`, failures);
    }
    if (!variant.cardTitle || !variant.altText) {
      fail(`${draft.socialDraftId} Instagram variant ${variant.id || "unknown"} needs card title and alt text.`, failures);
    }
  }
}

const visualReadyDraft = visualReadyResult.drafts[0];
if (visualReadyDraft?.platforms?.instagram?.imagePlan?.renderStatus !== "ready") {
  fail("Instagram package with durable public image URL should pass visual readiness.", failures);
}
if (!(visualReadyDraft?.platforms?.instagram?.variants || []).every((variant) => variant.imagePlan?.renderStatus === "ready")) {
  fail("Every Instagram variant should receive the ready visual plan when a durable image URL exists.", failures);
}
if (!(visualReadyDraft?.platforms?.instagram?.variants || []).some((variant) => variant.publishable === true)) {
  fail("Instagram variant with durable image URL and exact story link should be publishable after review gates.", failures);
}

const noImageDraft = noImageResult.drafts[0];
if (noImageDraft?.platforms?.instagram?.imagePlan?.renderStatus !== "needs_rendering") {
  fail("Instagram package with no image/card should need rendering.", failures);
}
if ((noImageDraft?.platforms?.instagram?.variants || []).some((variant) => variant.publishable === true)) {
  fail("Instagram package with no image/card should not be publishable.", failures);
}
if (!noImageDraft?.platforms?.instagram?.imagePlan?.plannedGeneratedCardUrl?.includes("/social-cards/community-center-test.png")) {
  fail("Instagram no-image draft should include a planned generated-card URL for rendering.", failures);
}

const approvedContextDraft = approvedContextResult.drafts[0];
const approvedFacebook = approvedContextDraft?.platforms?.facebook || {};
const approvedInstagram = approvedContextDraft?.platforms?.instagram || {};
const approvedCombinedText = [
  approvedFacebook.caption,
  approvedInstagram.caption,
  ...(approvedFacebook.variants || []).map((variant) => variant.message),
  ...(approvedInstagram.variants || []).map((variant) => variant.caption),
].join(" ");

if (!approvedCombinedText.includes("Council members approved overnight station rules after public review")) {
  fail("Social captions should use approved Live News story context.", failures);
}

if (/Publisher headline repeats raw wording/i.test(approvedCombinedText)) {
  fail("Social captions should prefer approved Live News wording over raw publisher wording.", failures);
}

if (/Read the original source for the full report|A clear look at the latest source-linked details/i.test(approvedCombinedText)) {
  fail("Social captions must not use generic fallback descriptions.", failures);
}

for (const variant of [
  ...(approvedFacebook.variants || []),
  ...(approvedInstagram.variants || []),
]) {
  if (!variant.writingExam || typeof variant.writingExam.total !== "number") {
    fail(`${variant.id || "variant"} is missing a writing exam score.`, failures);
  }
  if (!variant.writingQualityStatus) {
    fail(`${variant.id || "variant"} is missing writingQualityStatus.`, failures);
  }
  if (!(variant.teacherChecks || []).some((check) => check.id === "writing_quality_gate")) {
    fail(`${variant.id || "variant"} is missing the writing quality teacher gate.`, failures);
  }
}

if ((approvedFacebook.variants || []).length < 3 || (approvedInstagram.variants || []).length < 3) {
  fail("Approved context draft should keep at least three variants per platform.", failures);
}

if (!approvedFacebook.caption.includes("https://newsmorenow.com/stories/transit-rules-approved-test")) {
  fail("Facebook captions should include the exact /stories/... URL.", failures);
}

if (approvedFacebook.caption === approvedInstagram.caption) {
  fail("Instagram caption should not be direct Facebook copy.", failures);
}

const copiedPublisherDraft = copiedPublisherResult.drafts[0];
const copiedPublisherVariants = [
  ...(copiedPublisherDraft?.platforms?.facebook?.variants || []),
  ...(copiedPublisherDraft?.platforms?.instagram?.variants || []),
];
if (!copiedPublisherVariants.some((variant) =>
  (variant.teacherChecks || []).some((check) => check.id === "writing_copy_risk_teacher" && check.passed === false)
)) {
  fail("Social captions should block copied publisher wording.", failures);
}

const unsupportedClaimDraft = unsupportedClaimResult.drafts[0];
const unsupportedVariants = [
  ...(unsupportedClaimDraft?.platforms?.facebook?.variants || []),
  ...(unsupportedClaimDraft?.platforms?.instagram?.variants || []),
];
if (!unsupportedVariants.some((variant) =>
  (variant.teacherChecks || []).some((check) => check.id === "writing_context_faithfulness_teacher" && check.passed === false)
)) {
  fail("Social captions should block unsupported or forced claims.", failures);
}

if (failures.length) {
  console.error("Live News social intelligence check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News social intelligence check passed.");
console.log(`Teacher layers: ${SOCIAL_TEACHER_STACK.length}`);
console.log(`Drafts checked: ${result.drafts.length}`);
