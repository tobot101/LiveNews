const {
  buildArticleWritingContext,
  detectCopyRisk,
  detectFallbackRisk,
  detectWeakWritingPhrases,
  evaluateWritingCandidate,
  generateDescriptionCandidates,
  getBlockedWritingPhrases,
  getPreferredWritingShapes,
  getWritingRulesForField,
  getWritingQualityGateResult,
  loadWritingCurriculum,
  loadWritingStyleGuide,
  selectBestWritingCandidate,
} = require("../lib/article-agents/writing-quality");
const {
  buildSourceFactMap,
  compareCandidateToFactMap,
  extractConfirmedFacts,
  extractDoNotCopyPhrases,
  extractEntities,
  extractReaderAngleCandidates,
  extractTimeline,
  summarizeFactMapForWriter,
  validateFactMap,
} = require("../lib/article-agents/source-fact-map");

const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const approvedStory = {
  storyId: "ln-writing-approved-1",
  liveNewsUrl: "/stories/city-transit-safety-plan-abc123",
  canonicalUrl: "/stories/city-transit-safety-plan-abc123",
  headline: "City transit safety plan advances after overnight review",
  originalPublisherTitle: "City leaders approve overnight transit safety plan after public review",
  primarySourceName: "Metro Daily",
  originalSourceUrl: "https://example.com/transit-safety-plan",
  category: "Local",
  tags: ["transit", "city council", "late-night service"],
  location: "San Diego, CA",
  people: ["Maria Lopez"],
  organizations: ["City Council", "Metro Transit"],
  summary: [
    "City leaders approved an overnight transit safety plan after public review.",
    "The plan adds late-night station staffing and new lighting at several transit stops.",
  ],
  keyPoints: [
    "City leaders approved the plan after public review.",
    "The plan adds late-night station staffing.",
    "New lighting is planned at several transit stops.",
  ],
  whyItMatters: "The changes could affect late-night riders and transit workers.",
  prohibitedPhrasesFromSources: [
    "City leaders approve overnight transit safety plan after public review",
  ],
  publishedAt: "2026-05-10T08:00:00.000Z",
};

const context = buildArticleWritingContext(approvedStory);

const factMapStory = {
  ...approvedStory,
  sourceSummary:
    "City leaders approved an overnight transit safety plan after public review. The plan adds late-night station staffing and new lighting.",
  comments: [
    "A commenter claimed the mayor promised free concert tickets, but this is not source-backed.",
  ],
  publicComments: [
    "Fans are saying the plan secretly changes fares.",
  ],
};
const factMap = buildSourceFactMap(factMapStory);
const factMapValidation = validateFactMap(factMap);

const styleGuide = loadWritingStyleGuide();
expect(styleGuide.schemaVersion === "live-news-writing-style-v1", "Style guide should load with schema version.");
expect(styleGuide.voice.attributes.includes("story-focused"), "Style guide should include Live News voice rules.");
expect(styleGuide.fieldRules.title.rules.length > 0, "Style guide should include title rules.");

const curriculum = loadWritingCurriculum();
expect(curriculum.schemaVersion === "live-news-writing-curriculum-v1", "Writing curriculum should load with schema version.");
expect(
  curriculum.rubrics.some((rubric) => rubric.id === "rhetorical_situation"),
  "Curriculum should include rhetorical situation rubric."
);

const blockedPhrases = getBlockedWritingPhrases();
expect(
  blockedPhrases.some((phrase) => phrase.toLowerCase().includes("this article discusses")),
  "Blocked writing phrases should be available."
);
expect(
  blockedPhrases.some((phrase) => phrase.toLowerCase().startsWith("top story")),
  "Top Story should be available as a blocked default phrase."
);

const entertainmentShapes = getPreferredWritingShapes("entertainment");
expect(entertainmentShapes.length >= 3, "Preferred writing shapes should be available by category.");
expect(
  entertainmentShapes.some((shape) => shape.id === "person_or_group_plus_action"),
  "Entertainment should receive person/group writing shape guidance."
);

const localDescriptionRules = getWritingRulesForField("description", "local");
expect(localDescriptionRules.fieldName === "description", "Field writing rules should resolve by field name.");
expect(
  localDescriptionRules.categoryGuidance.focus.includes("residents"),
  "Category-specific writing guidance should be available."
);
expect(
  localDescriptionRules.blockedPhrases.some((phrase) => phrase.toLowerCase().startsWith("top story")),
  "Top Story should not be a default writing pattern."
);

expect(context.storyId === "ln-writing-approved-1", "ArticleWritingContext should preserve storyId.");
expect(context.exactArticleUrl === "/stories/city-transit-safety-plan-abc123", "ArticleWritingContext should preserve exact /stories/... URL.");
expect(context.sourceName === "Metro Daily", "ArticleWritingContext should preserve source name.");
expect(context.mainEvent.includes("City transit safety plan advances"), "ArticleWritingContext should create a main event.");
expect(context.confirmedFacts.length >= 3, "ArticleWritingContext should collect confirmed facts.");
expect(context.contextConfidence >= 0.8, "Complete approved story should have strong context confidence.");
expect(factMap.storyId === "ln-writing-approved-1", "SourceFactMap should preserve storyId.");
expect(factMap.exactArticleUrl === "/stories/city-transit-safety-plan-abc123", "SourceFactMap should preserve exact /stories/... URL.");
expect(factMap.sourceName === "Metro Daily", "SourceFactMap should preserve source name.");
expect(factMap.sourceUrl === "https://example.com/transit-safety-plan", "SourceFactMap should preserve source URL.");
expect(factMapValidation.ready, "Complete SourceFactMap should be ready for original writing.");
expect(factMap.confirmedFacts.length >= 4, "SourceFactMap should extract confirmed facts.");
expect(extractConfirmedFacts(factMapStory).length >= 4, "extractConfirmedFacts should return source-backed facts.");
expect(factMap.mainEvent.includes("City transit safety plan advances"), "SourceFactMap should extract the main event.");
const factEntities = extractEntities(factMapStory);
expect(factEntities.people.includes("Maria Lopez"), "SourceFactMap should extract people.");
expect(factEntities.organizations.includes("City Council"), "SourceFactMap should extract organizations.");
expect(factEntities.places.some((place) => place.includes("San Diego")), "SourceFactMap should extract places.");
expect(extractTimeline(factMapStory).some((entry) => entry.includes("2026-05-10")), "SourceFactMap should extract timeline dates.");
expect(extractReaderAngleCandidates(factMapStory).length > 0, "SourceFactMap should extract reader angle candidates.");
const doNotCopy = extractDoNotCopyPhrases(factMapStory);
expect(doNotCopy.length > 0, "SourceFactMap should extract do-not-copy source fragments.");
expect(
  doNotCopy.some((phrase) => phrase.toLowerCase().includes("overnight transit safety plan")),
  "Do-not-copy fragments should include distinctive publisher title/summary wording."
);
expect(factMap.doNotSay.some((phrase) => /this article discusses/i.test(phrase)), "SourceFactMap should include blocked do-not-say phrases.");
expect(
  !factMap.confirmedFacts.some((entry) => /free concert tickets|secretly changes fares/i.test(entry.fact)),
  "Comments should not be treated as confirmed facts."
);
const writerFactSummary = summarizeFactMapForWriter(factMap);
expect(!Object.prototype.hasOwnProperty.call(writerFactSummary, "doNotCopyPhrases"), "Writer fact summary should not expose source fragments as writing material.");
expect(
  !JSON.stringify(writerFactSummary).includes("City leaders approve overnight transit safety plan after public review"),
  "Writer fact summary should not carry full publisher wording as preferred style."
);
const copiedFactComparison = compareCandidateToFactMap(
  "City leaders approved an overnight transit safety plan after public review.",
  factMap
);
expect(copiedFactComparison.copyRisk.risk, "compareCandidateToFactMap should detect copied source wording.");
expect(copiedFactComparison.copyRisk.use === "copy_risk_detection_only", "Source fragments should be marked for copy-risk detection only.");
const originalFactComparison = compareCandidateToFactMap(
  "An overnight transit safety plan moved forward after public review, with late-night riders and station workers among the groups affected.",
  factMap
);
expect(originalFactComparison.storyFocusScore >= 70, "Original fact-map writing should remain story-focused.");
expect(!originalFactComparison.copyRisk.risk, "Original fact-map writing should avoid copy-risk flags.");

const missingMainEvent = buildArticleWritingContext({
  storyId: "missing-main",
  liveNewsUrl: "/stories/missing-main-abc123",
  primarySourceName: "Metro Daily",
  originalSourceUrl: "https://example.com/missing-main",
});
expect(missingMainEvent.missingContext.includes("main_event_missing"), "Missing mainEvent should be listed in missingContext.");
expect(missingMainEvent.missingContext.includes("confirmed_facts_missing"), "Missing confirmed facts should be listed in missingContext.");
const missingMainFactMap = buildSourceFactMap({
  storyId: "missing-fact-main",
  liveNewsUrl: "/stories/missing-fact-main-abc123",
  primarySourceName: "Metro Daily",
  originalSourceUrl: "https://example.com/missing-fact-main",
});
expect(missingMainFactMap.missingContext.includes("main_event_missing"), "SourceFactMap should flag missing main event.");
expect(missingMainFactMap.missingContext.includes("confirmed_facts_missing"), "SourceFactMap should flag missing confirmed facts.");

const missingExactContext = buildArticleWritingContext({
  ...approvedStory,
  liveNewsUrl: "",
  canonicalUrl: "",
});
const missingExactGate = getWritingQualityGateResult(
  "City transit safety plan advances after overnight review. The changes could affect late-night riders and transit workers.",
  missingExactContext,
  "description"
);
expect(!missingExactGate.ok, "Missing exact /stories/... URL should block public writing.");
expect(missingExactGate.blockingReasons.join(" ").includes("/stories"), "Missing exact URL block should mention /stories.");
const missingExactFactMap = buildSourceFactMap({
  ...factMapStory,
  liveNewsUrl: "",
  canonicalUrl: "",
});
const missingExactFactMapValidation = validateFactMap(missingExactFactMap);
expect(!missingExactFactMapValidation.ready, "Missing exact /stories/... URL should block fact-map writing readiness.");
expect(
  missingExactFactMapValidation.missingContext.includes("exact_article_url_missing"),
  "Missing exact URL should be listed in SourceFactMap missingContext."
);

const homepageContext = buildArticleWritingContext({
  ...approvedStory,
  liveNewsUrl: "https://newsmorenow.com/",
  canonicalUrl: "https://newsmorenow.com/",
});
const homepageGate = getWritingQualityGateResult(
  "City transit safety plan advances after overnight review. The changes could affect late-night riders and transit workers.",
  homepageContext,
  "description"
);
expect(!homepageGate.ok, "Homepage URL should be blocked.");
expect(homepageGate.blockingReasons.join(" ").toLowerCase().includes("homepage"), "Homepage block should be visible.");
const homepageFactMap = buildSourceFactMap({
  ...factMapStory,
  liveNewsUrl: "https://newsmorenow.com/",
  canonicalUrl: "https://newsmorenow.com/",
});
const homepageFactMapValidation = validateFactMap(homepageFactMap);
expect(!homepageFactMapValidation.ready, "Homepage URL should block SourceFactMap readiness.");
expect(homepageFactMapValidation.missingContext.includes("homepage_url_blocked"), "Homepage URL block should be listed in SourceFactMap.");

const fallback = "Read the original source for the full report.";
expect(detectFallbackRisk(fallback).risky, "Generic fallback description should be detected.");
expect(!getWritingQualityGateResult(fallback, context, "description").ok, "Generic fallback description should be blocked.");
expect(detectWeakWritingPhrases("This article discusses the transit plan.").length > 0, "This article discusses should be detected.");
expect(!getWritingQualityGateResult("This article discusses the transit plan.", context, "description").ok, "This article discusses should be blocked.");
expect(!getWritingQualityGateResult("In a recent development, the transit plan advanced.", context, "description").ok, "In a recent development should be blocked.");
expect(!getWritingQualityGateResult("Top Story: City transit safety plan advances.", context, "title").ok, "Top Story: should be blocked as a default.");
expect(!getWritingQualityGateResult("City transit safety plan advances after review. Stay safe while officials respond.", context, "caption").ok, "Stay safe should be blocked without public safety support.");

const weatherContext = buildArticleWritingContext({
  storyId: "weather-normal",
  liveNewsUrl: "/stories/weekend-rain-normal-abc123",
  title: "Weekend rain expected across Southern California",
  sourceName: "Weather Desk",
  sourceUrl: "https://example.com/weather",
  category: "Weather",
  keyPoints: ["Forecasts call for showers this weekend."],
  summary: "Forecasts call for showers with no active warning, closure, or advisory.",
});
const localContext = buildArticleWritingContext({
  storyId: "local-normal",
  liveNewsUrl: "/stories/city-park-budget-abc123",
  title: "City council reviews park budget plan",
  sourceName: "City Desk",
  sourceUrl: "https://example.com/local",
  category: "Local",
  keyPoints: ["Council members reviewed the park budget plan."],
});
const trafficContext = buildArticleWritingContext({
  storyId: "traffic-normal",
  liveNewsUrl: "/stories/downtown-traffic-delays-abc123",
  title: "Downtown traffic delays expected after morning event",
  sourceName: "Transit Wire",
  sourceUrl: "https://example.com/traffic",
  category: "Local",
  keyPoints: ["Traffic delays are expected after a morning event."],
});
expect(weatherContext.publicSafetyRelevant === false, "Normal weather should not automatically become public safety.");
expect(localContext.publicSafetyRelevant === false, "Normal local news should not automatically become public safety.");
expect(trafficContext.publicSafetyRelevant === false, "Normal traffic should not automatically become public safety.");

const safetyContext = buildArticleWritingContext({
  storyId: "safety-alert",
  liveNewsUrl: "/stories/county-evacuation-order-abc123",
  title: "County issues evacuation order near wildfire zone",
  sourceName: "County Emergency Office",
  sourceUrl: "https://example.com/evacuation",
  category: "Local",
  keyPoints: ["County officials issued an evacuation order near the wildfire zone."],
  summary: "The evacuation order affects residents near the wildfire zone.",
});
expect(safetyContext.publicSafetyRelevant === true, "Explicit evacuation order should activate public safety relevance.");
expect(
  getWritingQualityGateResult(
    "County officials issued an evacuation order near the wildfire zone. Stay safe and follow the evacuation order.",
    safetyContext,
    "caption"
  ).ok,
  "Stay safe should be allowed when public safety is explicitly supported."
);

const goodDescription = "City transit safety plan advances after overnight review. The changes could affect late-night riders and transit workers.";
const goodEvaluation = evaluateWritingCandidate(goodDescription, context, "description");
expect(goodEvaluation.passed, "Story-focused description should pass.");
expect(goodEvaluation.exam.total >= 85, "Story-focused description should pass the total writing gate.");

const outOfContext = "A celebrity tour update is bringing new music to fans this summer.";
const outEvaluation = evaluateWritingCandidate(outOfContext, context, "description");
expect(!outEvaluation.passed, "Out-of-context description should be blocked.");
expect(outEvaluation.exam.storyFocus < 85, "Out-of-context description should fail story focus.");

const unsupported = "The transit plan will cut taxes for every family and end city delays.";
const unsupportedEvaluation = evaluateWritingCandidate(unsupported, context, "description");
expect(!unsupportedEvaluation.passed, "Unsupported claim should be blocked.");
expect(unsupportedEvaluation.exam.factFaithfulness < 90, "Unsupported claim should fail fact faithfulness.");

const copied = "City leaders approve overnight transit safety plan after public review.";
const copyRisk = detectCopyRisk(copied, approvedStory.originalPublisherTitle);
const copiedEvaluation = evaluateWritingCandidate(copied, context, "description");
expect(copyRisk.risk, "Copied publisher wording should be detected.");
expect(!copiedEvaluation.passed, "Copied publisher wording should be blocked or fail approval.");

const generated = generateDescriptionCandidates(context);
expect(generated.status === "ready", "Strong context should generate description candidates.");
expect(generated.candidates.length >= 3, "At least 3 description candidates should be generated.");

const weakGenerated = generateDescriptionCandidates(missingMainEvent);
expect(weakGenerated.status === "needs_more_context", "Weak context should return needs_more_context instead of public filler.");
expect(weakGenerated.candidates.length === 0, "Weak context should not produce filler candidates.");

const mixedCandidates = [
  { id: "bad", text: outOfContext },
  { id: "fallback", text: fallback },
  { id: "good", text: goodDescription },
];
const selected = selectBestWritingCandidate(mixedCandidates, context, "description");
expect(selected.status === "selected", "Best candidate should be selected when one passes.");
expect(selected.selected?.id === "good", "Best candidate should be the teacher-approved description.");

if (failures.length) {
  console.error("Live News writing intelligence check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News writing intelligence check passed.");
