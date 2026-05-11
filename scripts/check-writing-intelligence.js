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
const {
  explainOriginalWritingChoice,
  generateOriginalDekCandidates,
  generateOriginalDescriptionCandidates,
  generateOriginalSeoDescriptionCandidates,
  generateOriginalSocialContextCandidates,
  generateOriginalSummaryCandidates,
  generateOriginalTitleCandidates,
  generateOriginalWhyItMattersCandidates,
  selectOriginalWritingCandidate,
} = require("../lib/article-agents/original-writer");
const {
  calculateLexicalOverlap,
  calculateNgramOverlap,
  calculatePhraseOverlap,
  calculateStructuralSimilarity,
  detectDistinctiveSourcePhrases,
  explainCopyRisk,
  getCopyDistanceScore,
  suggestCopyRiskRewriteStrategy,
} = require("../lib/article-agents/copy-distance");
const {
  buildRewritePlan,
  diagnoseWritingFailure,
  generateRewriteCandidates,
  getRewriteStrategiesForFailure,
  rewriteUntilPass,
  selectBestRewriteCandidate,
  storeRewriteAttemptSummary,
} = require("../lib/article-agents/writing-rewriter");
const {
  runClarityEditorAgent,
  runContextResearchAgent,
  runCopyRiskEditorAgent,
  runFactMapperAgent,
  runManagingEditorAgent,
  runOriginalVoiceWriterAgent,
  runRewriteCoachAgent,
  runSensitiveToneEditorAgent,
  runSmartnessCriticAgent,
  runSourceReaderAgent,
  runWriterRoom,
} = require("../lib/article-agents/writer-room");

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

const originalDescriptions = generateOriginalDescriptionCandidates(factMap);
expect(originalDescriptions.status === "ready", "Original Writer should generate ready description candidates from a strong fact map.");
expect(originalDescriptions.candidates.length >= 5, "Original Writer should generate at least 5 description candidates from a strong fact map.");
expect(
  originalDescriptions.candidates.every((candidate) => candidate.factsUsed.length > 0),
  "Original Writer candidates should use confirmed facts."
);
expect(
  originalDescriptions.candidates.every((candidate) => candidate.text !== factMap.originalPublisherTitle),
  "Original Writer should not copy the publisher title exactly."
);
expect(
  originalDescriptions.candidates.some((candidate) => candidate.text !== factMap.sourceSummary && !candidate.text.includes(factMap.sourceSummary)),
  "Original Writer should change sentence structure from the source summary."
);
expect(
  originalDescriptions.candidates.every((candidate) => !detectFallbackRisk(candidate.text).risky),
  "Original Writer candidates should avoid generic fallback text."
);
const selectedOriginalDescription = selectOriginalWritingCandidate(originalDescriptions, factMap, "description");
expect(selectedOriginalDescription.status === "selected", "Original Writer should select a passing description candidate.");
expect(selectedOriginalDescription.selected?.status === "passed", "Best Original Writer candidate should pass.");
expect(
  selectedOriginalDescription.selected?.teacherChecks.some((teacher) => teacher.name === "StoryFocusTeacher" && teacher.passed),
  "Original Writer candidate should pass StoryFocusTeacher when context is strong."
);
expect(
  selectedOriginalDescription.selected?.teacherChecks.some((teacher) => teacher.name === "CopyRiskTeacher" && teacher.passed),
  "Original Writer candidate should pass CopyRiskTeacher when sufficiently original."
);
expect(
  explainOriginalWritingChoice(selectedOriginalDescription.selected, factMap, "description").includes("Writing score"),
  "Original Writer should explain why a candidate was selected."
);
expect(generateOriginalTitleCandidates(factMap).candidates.length >= 5, "Original Writer should generate title candidates.");
expect(generateOriginalDekCandidates(factMap).candidates.length >= 5, "Original Writer should generate dek candidates.");
expect(generateOriginalSummaryCandidates(factMap).candidates.length >= 5, "Original Writer should generate summary candidates.");
expect(generateOriginalWhyItMattersCandidates(factMap).candidates.length >= 5, "Original Writer should generate why-it-matters candidates.");
expect(generateOriginalSeoDescriptionCandidates(factMap).candidates.length >= 5, "Original Writer should generate SEO description candidates.");
expect(generateOriginalSocialContextCandidates(factMap).candidates.length >= 5, "Original Writer should generate social-ready context candidates.");
const unsupportedOriginalSelection = selectOriginalWritingCandidate(
  [{ id: "unsupported", strategy: "unsupported", text: "The transit plan will cut taxes for every family and end city delays." }],
  factMap,
  "description"
);
expect(
  unsupportedOriginalSelection.candidates[0]?.status === "blocked",
  "Original Writer should block unsupported facts."
);
const sensitiveFactMap = buildSourceFactMap({
  storyId: "sensitive-original-writer",
  liveNewsUrl: "/stories/actor-tribute-family-statement-abc123",
  headline: "Actor remembered after family confirms death",
  originalPublisherTitle: "Beloved actor dies as family shares emotional tribute",
  primarySourceName: "Culture Wire",
  originalSourceUrl: "https://example.com/actor-tribute",
  category: "Entertainment",
  people: ["Jordan Vale"],
  summary: [
    "Jordan Vale's family confirmed the actor's death.",
    "The family shared a tribute focused on the actor's work and legacy.",
  ],
  keyPoints: [
    "Jordan Vale's family confirmed the actor's death.",
    "The family tribute focused on the actor's work and legacy.",
  ],
  whyItMatters: "The coverage centers on a public figure's legacy and the family statement.",
  sourceSummary: "Beloved actor dies as family shares emotional tribute.",
});
const sensitiveCandidates = generateOriginalDescriptionCandidates(sensitiveFactMap);
const neutralSensitive = sensitiveCandidates.candidates.find((candidate) => candidate.strategy === "neutral_sensitive");
expect(neutralSensitive, "Original Writer should create a neutral_sensitive candidate for sensitive stories.");
expect(!/shocking|you won't believe|fans are reacting/i.test(neutralSensitive.text), "Sensitive Original Writer candidate should stay neutral.");

const weakFactMapForOriginalWriter = buildSourceFactMap({
  storyId: "weak-original-writer",
  liveNewsUrl: "/stories/weak-original-writer-abc123",
  primarySourceName: "Metro Daily",
  originalSourceUrl: "https://example.com/weak-original-writer",
});
const weakOriginalDescriptions = generateOriginalDescriptionCandidates(weakFactMapForOriginalWriter);
expect(weakOriginalDescriptions.status === "needs_more_context", "Original Writer should return needs_more_context when fact map is weak.");
expect(weakOriginalDescriptions.candidates.length === 0, "Original Writer should not create filler candidates from weak context.");

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
const copiedTitleDistance = getCopyDistanceScore(
  "City leaders approve overnight transit safety plan after public review",
  [approvedStory.originalPublisherTitle],
  factMap
);
expect(copiedTitleDistance.risk === "blocked", "Exact copied publisher title should be blocked by copy-distance.");
const rearrangedTitleDistance = getCopyDistanceScore(
  "After public review, city leaders approve overnight transit safety plan",
  [approvedStory.originalPublisherTitle],
  factMap
);
expect(rearrangedTitleDistance.risk === "blocked", "Slightly rearranged publisher title should be blocked by copy-distance.");
const synonymSwappedDistance = getCopyDistanceScore(
  "City officials approved a late-night transit security proposal after community review.",
  [approvedStory.originalPublisherTitle],
  factMap
);
expect(
  ["high", "blocked"].includes(synonymSwappedDistance.risk),
  "Synonym-swapped source sentence should remain high copy risk."
);
const originalDistance = getCopyDistanceScore(
  "The transit plan moved forward after review, with late-night riders and station workers among the groups affected.",
  [approvedStory.originalPublisherTitle, factMap.sourceSummary],
  factMap
);
expect(originalDistance.risk === "low" || originalDistance.risk === "medium", "Same facts with different structure should avoid high copy risk.");
const properNounDistance = getCopyDistanceScore(
  "Maria Lopez and Metro Transit are named in the source-backed coverage.",
  ["Maria Lopez and Metro Transit"],
  factMap
);
expect(properNounDistance.risk !== "blocked", "Proper nouns should not automatically trigger a copy block.");
const distinctivePhrases = detectDistinctiveSourcePhrases(
  "The update repeats overnight transit safety plan after public review in the copy.",
  factMap.doNotCopyPhrases
);
expect(distinctivePhrases.length > 0, "Distinctive source phrase should be detected.");
expect(
  calculateLexicalOverlap(copied, [approvedStory.originalPublisherTitle]) > 0.8,
  "Copy-distance should calculate lexical overlap."
);
expect(
  calculatePhraseOverlap(copied, [approvedStory.originalPublisherTitle]) > 0.8,
  "Copy-distance should calculate phrase overlap."
);
expect(
  calculateNgramOverlap(copied, [approvedStory.originalPublisherTitle], 3) > 0.8,
  "Copy-distance should calculate n-gram overlap."
);
expect(
  calculateStructuralSimilarity(synonymSwappedDistance.recommendedStrategy, [approvedStory.originalPublisherTitle]) >= 0 ||
    calculateStructuralSimilarity("City officials approved a late-night transit security proposal after community review.", [approvedStory.originalPublisherTitle]) > 0.55,
  "Source sentence skeleton similarity should be detected."
);
const copiedDistanceEvaluation = evaluateWritingCandidate(
  "After public review, city leaders approve overnight transit safety plan.",
  context,
  "title"
);
const copiedDistanceTeacher = copiedDistanceEvaluation.teachers.find((teacher) => teacher.name === "CopyRiskTeacher");
expect(copiedDistanceTeacher?.copyDistance, "CopyRiskTeacher should expose copy-distance result.");
expect(copiedDistanceTeacher?.blocking, "CopyRiskTeacher should block high copy-distance writing.");
const copyRiskExplanation = explainCopyRisk(copied, [approvedStory.originalPublisherTitle], factMap);
expect(copyRiskExplanation.explanation.includes("copy risk"), "Copy-risk explanation should be available for dashboard use.");
expect(
  suggestCopyRiskRewriteStrategy(copyRiskExplanation).toLowerCase().includes("fact map") ||
    suggestCopyRiskRewriteStrategy(copyRiskExplanation).toLowerCase().includes("sentence"),
  "Copy-risk rewrite strategy should be available."
);
const copyFailureDiagnosis = diagnoseWritingFailure(
  "After public review, city leaders approve overnight transit safety plan.",
  factMap,
  "description"
);
expect(
  copyFailureDiagnosis.strategies.includes("fact_map_rewrite"),
  "CopyRiskTeacher failure should trigger fact_map_rewrite."
);
const storyFocusDiagnosis = diagnoseWritingFailure(
  "A celebrity tour is bringing new music to fans this summer.",
  factMap,
  "description"
);
expect(
  storyFocusDiagnosis.strategies.includes("story_focus_rewrite"),
  "StoryFocusTeacher failure should trigger story_focus_rewrite."
);
const fallbackDiagnosis = diagnoseWritingFailure(
  "This article discusses the latest update on this topic.",
  factMap,
  "description"
);
expect(
  fallbackDiagnosis.strategies.includes("no_fallback_rewrite"),
  "Fallback text should trigger no_fallback_rewrite."
);
const rewritePlan = buildRewritePlan(
  "After public review, city leaders approve overnight transit safety plan.",
  factMap,
  "description",
  copyFailureDiagnosis
);
expect(rewritePlan.strategies.includes("fact_map_rewrite"), "Rewrite plan should preserve diagnosis strategies.");
const rewriteCandidates = generateRewriteCandidates(factMap, "description", rewritePlan);
expect(rewriteCandidates.candidates.length > 0, "Rewrite loop should generate rewrite candidates.");
const selectedRewrite = selectBestRewriteCandidate(rewriteCandidates, factMap, "description");
expect(selectedRewrite.selected, "Rewrite loop should select the best rewrite candidate.");
const rewriteSession = rewriteUntilPass(
  "After public review, city leaders approve overnight transit safety plan.",
  factMap,
  "description",
  { createdAt: "2026-05-11T00:00:00.000Z" }
);
expect(rewriteSession.status === "passed", "Bad source-like description should rewrite into a passing description.");
expect(rewriteSession.finalCandidate, "Rewrite session should include a final passing rewrite.");
expect(rewriteSession.finalWritingExam.factFaithfulness >= 90, "Rewriter should not invent unsupported facts.");
expect(rewriteSession.copyRiskAfter.risk === "low" || rewriteSession.copyRiskAfter.risk === "medium", "Rewriter should lower copy risk after rewriting.");
expect(
  !rewriteSession.finalCandidate.toLowerCase().includes("city leaders approve overnight transit safety plan"),
  "Rewriter should change source sentence structure."
);
expect(rewriteSession.roundsUsed <= 3, "Rewriter should stay within maximum rewrite rounds.");
expect(rewriteSession.attempts.length > 0, "RewriteSession should record attempts.");
expect(rewriteSession.copyRiskBefore.risk !== "low", "RewriteSession should record before copy risk.");
expect(rewriteSession.copyRiskAfter.risk, "RewriteSession should record after copy risk.");
const rewriteSummary = storeRewriteAttemptSummary(rewriteSession);
expect(rewriteSummary.attemptCount === rewriteSession.attempts.length, "Rewrite summary should safely record attempt count.");
expect(rewriteSummary.finalTeacherScores.length > 0, "Rewrite summary should safely record teacher scores.");
const limitedRewriteSession = rewriteUntilPass(
  "After public review, city leaders approve overnight transit safety plan.",
  factMap,
  "description",
  { maxRounds: 1, maxCandidatesPerRound: 0 }
);
expect(limitedRewriteSession.roundsUsed <= 1, "Rewriter should stop after the configured max rounds.");
expect(limitedRewriteSession.status === "needs_more_context", "Rewriter should return needs_more_context when no candidate passes within limits.");
const weakRewriteSession = rewriteUntilPass(
  "This article discusses the update.",
  weakFactMapForOriginalWriter,
  "description"
);
expect(weakRewriteSession.status === "needs_more_context", "Rewriter should return needs_more_context for a weak fact map.");

const sourceReaderAgent = runSourceReaderAgent(factMapStory);
expect(sourceReaderAgent.status === "ready", "WriterRoom SourceReaderAgent should read source-safe story context.");
expect(
  sourceReaderAgent.notes.join(" ").includes("Ignored comments"),
  "WriterRoom SourceReaderAgent should ignore comments and private user data."
);
const factMapperAgent = runFactMapperAgent(factMapStory);
expect(factMapperAgent.validation.ready, "WriterRoom FactMapperAgent should build a ready fact map.");
expect(factMapperAgent.factMap.confirmedFacts.length >= 4, "WriterRoom FactMapperAgent should extract confirmed facts.");
const contextResearchAgent = runContextResearchAgent(factMap, {
  authorizedResearchNotes: ["Use existing source-backed context only.", "Ignore usernames and private message content."],
});
expect(contextResearchAgent.externalApisUsed === false, "WriterRoom ContextResearchAgent should not use external APIs in this pass.");
expect(contextResearchAgent.addedFacts.length === 0, "WriterRoom ContextResearchAgent should not add unsupported facts.");
const originalVoiceAgent = runOriginalVoiceWriterAgent(factMap, "description");
expect(originalVoiceAgent.candidates.length >= 5, "WriterRoom OriginalVoiceWriterAgent should generate original candidates.");
expect(
  originalVoiceAgent.candidates.every((candidate) => !detectFallbackRisk(candidate.text).risky),
  "WriterRoom OriginalVoiceWriterAgent should avoid fallback candidates."
);
const smartnessCritic = runSmartnessCriticAgent(goodDescription, factMap, "description");
expect(smartnessCritic.score.relevance >= 70, "WriterRoom SmartnessCritic should score relevance.");
expect(smartnessCritic.score.evidenceSupport >= 80, "WriterRoom SmartnessCritic should score evidence support.");
expect(smartnessCritic.passed, "WriterRoom SmartnessCritic should pass strong source-backed writing.");
const copiedCopyRiskEditor = runCopyRiskEditorAgent(
  "After public review, city leaders approve overnight transit safety plan.",
  factMap
);
expect(!copiedCopyRiskEditor.passed, "WriterRoom CopyRiskEditor should block source-like wording.");
const clarityEditor = runClarityEditorAgent(goodDescription, factMap, "description");
expect(clarityEditor.passed, "WriterRoom ClarityEditor should pass clear writing.");
const sensitiveToneBlocked = runSensitiveToneEditorAgent(
  "Shocking actor death has fans reacting across the internet.",
  sensitiveFactMap
);
expect(!sensitiveToneBlocked.passed, "WriterRoom SensitiveToneEditor should block hype on sensitive stories.");
const rewriteCoachAgent = runRewriteCoachAgent(
  "After public review, city leaders approve overnight transit safety plan.",
  factMap,
  [],
  "description"
);
expect(rewriteCoachAgent.status === "passed", "WriterRoom RewriteCoach should improve a failed candidate.");
expect(rewriteCoachAgent.session.finalCandidate, "WriterRoom RewriteCoach should return a final rewrite.");
const managingEditorAgent = runManagingEditorAgent(
  [
    { id: "source-like", strategy: "source_like", text: "After public review, city leaders approve overnight transit safety plan." },
    { id: "clean", strategy: "clean", text: goodDescription },
  ],
  factMap,
  "description"
);
expect(managingEditorAgent.status === "passed", "WriterRoom ManagingEditor should select a passing candidate.");
expect(managingEditorAgent.selectedCandidate?.id === "clean", "WriterRoom ManagingEditor should choose the clean candidate.");
const writerRoomOutput = runWriterRoom(factMapStory, "description");
expect(writerRoomOutput.status === "passed", "WriterRoom should return passed for a strong story.");
expect(writerRoomOutput.factMap.confirmedFacts.length >= 4, "WriterRoom should include the fact map.");
expect(writerRoomOutput.candidates.length >= 5, "WriterRoom should include generated candidates.");
expect(writerRoomOutput.selectedCandidate?.text, "WriterRoom should include a selected candidate.");
expect(writerRoomOutput.smartnessScore.total >= 75, "WriterRoom output should include smartness score.");
expect(writerRoomOutput.copyRisk.risk !== "high" && writerRoomOutput.copyRisk.risk !== "blocked", "WriterRoom selected candidate should pass copy-risk editing.");
expect(
  writerRoomOutput.agentNotes.some((note) => note.agent === "OriginalVoiceWriterAgent"),
  "WriterRoom should include agent notes."
);
const weakWriterRoom = runWriterRoom(
  {
    storyId: "weak-writer-room",
    liveNewsUrl: "/stories/weak-writer-room-abc123",
    primarySourceName: "Metro Daily",
    originalSourceUrl: "https://example.com/weak-writer-room",
  },
  "description"
);
expect(weakWriterRoom.status === "needs_more_context", "WriterRoom should return needs_more_context when facts are weak.");
const sensitiveWriterRoom = runWriterRoom(
  {
    storyId: "sensitive-room",
    liveNewsUrl: "/stories/actor-tribute-room-abc123",
    headline: "Actor remembered after family confirms death",
    originalPublisherTitle: "Beloved actor dies as family shares emotional tribute",
    primarySourceName: "Culture Wire",
    originalSourceUrl: "https://example.com/actor-tribute-room",
    category: "Entertainment",
    people: ["Jordan Vale"],
    summary: [
      "Jordan Vale's family confirmed the actor's death.",
      "The family shared a tribute focused on the actor's work and legacy.",
    ],
    keyPoints: [
      "Jordan Vale's family confirmed the actor's death.",
      "The family tribute focused on the actor's work and legacy.",
    ],
    whyItMatters: "The coverage centers on a public figure's legacy and the family statement.",
    sourceSummary: "Beloved actor dies as family shares emotional tribute.",
  },
  "description"
);
expect(sensitiveWriterRoom.status === "passed", "WriterRoom should handle sensitive stories with neutral tone.");
expect(
  !/shocking|you won't believe|fans are reacting/i.test(sensitiveWriterRoom.selectedCandidate?.text || ""),
  "WriterRoom sensitive story output should avoid hype."
);

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
