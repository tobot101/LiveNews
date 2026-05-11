const {
  compareCandidateToFactMap,
  summarizeFactMapForWriter,
  validateFactMap,
} = require("./source-fact-map");
const {
  evaluateWritingCandidate,
  getWritingQualityGateResult,
} = require("./writing-quality");
const { cleanText, clamp, splitSentences, stableHash, tokenize, uniqueBy } = require("./text-utils");

const FIELD_LIMITS = {
  title: { min: 4, max: 16 },
  description: { min: 12, max: 42 },
  dek: { min: 10, max: 34 },
  summary: { min: 16, max: 48 },
  whyItMatters: { min: 10, max: 34 },
  seoDescription: { min: 14, max: 34 },
  socialContext: { min: 10, max: 42 },
};

const BRIDGE_WORDS = new Set([
  "after",
  "adds",
  "around",
  "because",
  "brings",
  "context",
  "coverage",
  "focus",
  "focused",
  "gives",
  "helps",
  "keeps",
  "latest",
  "matters",
  "new",
  "now",
  "readers",
  "report",
  "source",
  "story",
  "update",
  "with",
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function uniqueClean(values) {
  return uniqueBy(
    asArray(values)
      .flatMap((value) => asArray(value))
      .map(cleanText)
      .filter(Boolean),
    (value) => value.toLowerCase()
  );
}

function sentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function wordCount(value) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function truncateWords(value, maxWords) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function removeLeadingSourceLanguage(value) {
  return cleanText(value)
    .replace(/^(breaking|watch|live updates?|exclusive|top story):\s*/i, "")
    .replace(/\baccording to\b/gi, "")
    .replace(/\bthis article discusses\b/gi, "")
    .replace(/\bin a recent development\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedFactStrings(factMap = {}) {
  return uniqueClean((factMap.confirmedFacts || []).map((entry) => entry.fact || entry))
    .map(removeLeadingSourceLanguage)
    .filter(Boolean);
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

function firstDistinctFact(factMap = {}, exclude = "") {
  const excluded = cleanText(exclude);
  return normalizedFactStrings(factMap)
    .find((fact) => fact && tokenSimilarity(fact, excluded) < 0.65 && wordCount(fact) >= 5) || "";
}

function pickMainEvent(factMap = {}) {
  return removeLeadingSourceLanguage(factMap.mainEvent || normalizedFactStrings(factMap)[0] || "");
}

function pickReaderAngle(factMap = {}) {
  const candidates = uniqueClean([
    factMap.whyItMattersCandidates,
    factMap.readerAngleCandidates,
  ]).filter((candidate) => {
    const lower = candidate.toLowerCase();
    return !lower.includes("readers may need") && !lower.includes("source-linked coverage");
  });
  return removeLeadingSourceLanguage(candidates[0] || firstDistinctFact(factMap, pickMainEvent(factMap)) || "");
}

function pickWhyItMatters(factMap = {}) {
  return pickReaderAngle(factMap);
}

function pickSubject(factMap = {}) {
  return cleanText(
    factMap.people?.[0] ||
      factMap.organizations?.[0] ||
      factMap.projects?.[0] ||
      factMap.places?.[0] ||
      pickMainEvent(factMap).split(/\s+/).slice(0, 5).join(" ")
  );
}

function pickTopic(factMap = {}) {
  return cleanText(
    factMap.projects?.[0] ||
      factMap.organizations?.[0] ||
      factMap.places?.[0] ||
      pickSubject(factMap)
  );
}

function isSensitive(factMap = {}) {
  return uniqueClean(factMap.sensitivityFlags).some((flag) =>
    ["death", "legal", "health", "children", "public_safety"].includes(flag)
  );
}

function compactTitle(value) {
  return truncateWords(removeLeadingSourceLanguage(value), FIELD_LIMITS.title.max)
    .replace(/[.!?]$/, "");
}

function makeQuestionFromEvent(factMap = {}) {
  const subject = pickSubject(factMap);
  const topic = pickTopic(factMap);
  if (subject && topic && subject !== topic) return `${subject}'s role in ${topic}`;
  return pickMainEvent(factMap);
}

function buildWritingContextFromFactMap(factMap = {}) {
  const summary = summarizeFactMapForWriter(factMap);
  return {
    storyId: summary.storyId,
    exactArticleUrl: summary.exactArticleUrl,
    canonicalUrl: summary.exactArticleUrl,
    title: summary.mainEvent,
    originalPublisherTitle: cleanText(factMap.originalPublisherTitle),
    sourceName: summary.sourceName,
    sourceUrl: summary.sourceUrl,
    category: cleanText(factMap.sourceCategory || "Top"),
    tags: [],
    location: summary.places[0] || null,
    people: summary.people,
    organizations: summary.organizations,
    places: summary.places,
    mainEvent: summary.mainEvent,
    confirmedFacts: summary.confirmedFacts,
    unclearFacts: summary.unclearFacts,
    timeline: summary.timeline,
    readerAngle: summary.readerAngleCandidates[0] || "",
    whyItMatters: summary.whyItMattersCandidates[0] || summary.readerAngleCandidates[0] || "",
    doNotSay: uniqueClean([
      factMap.originalPublisherTitle,
      factMap.sourceSummary,
      factMap.doNotSay,
    ]),
    missingContext: summary.missingContext,
    publicSafetyRelevant: Boolean(factMap.publicSafetyRelevant),
    contextConfidence: summary.contextConfidence,
  };
}

function isWeakFactMap(factMap = {}) {
  const validation = validateFactMap(factMap);
  return !validation.ready || validation.contextConfidence < 0.62;
}

function getFactsUsed(text, factMap = {}) {
  return normalizedFactStrings(factMap)
    .filter((fact) => tokenSimilarity(text, fact) >= 0.16)
    .slice(0, 5);
}

function originalNotes(candidateText, factMap = {}, strategy = "") {
  const comparison = compareCandidateToFactMap(candidateText, factMap);
  const notes = [
    "Built from SourceFactMap confirmed facts.",
    strategy ? `Uses ${strategy} writing shape.` : "",
    comparison.copyRisk.risk
      ? "Needs rewrite because copy-risk was detected."
      : "Publisher sentence structure was avoided.",
  ].filter(Boolean);
  return notes;
}

function statusFromEvaluation(evaluation, comparison, validation) {
  if (!validation.ready) return "needs_review";
  if (evaluation.passed && comparison.readyForPublicWriting) return "passed";
  if (comparison.copyRisk.risk || !comparison.withinFactMap || evaluation.exam.storyFocus < 70) return "blocked";
  return "needs_review";
}

function evaluateOriginalCandidate(input, factMap = {}, fieldName = "description") {
  const text = sentence(input.text || input);
  const context = buildWritingContextFromFactMap(factMap);
  const validation = validateFactMap(factMap);
  const writingEvaluation = evaluateWritingCandidate(text, context, fieldName);
  const gate = getWritingQualityGateResult(text, context, fieldName);
  const factMapComparison = compareCandidateToFactMap(text, factMap);
  const status = statusFromEvaluation(writingEvaluation, factMapComparison, validation);

  return {
    id: cleanText(input.id || `${fieldName}-${stableHash(`${input.strategy || ""}-${text}`, 10)}`),
    fieldName,
    strategy: cleanText(input.strategy || input.id || "original"),
    text,
    factsUsed: getFactsUsed(text, factMap),
    sourceAttribution: factMap.sourceName ? `Source: ${factMap.sourceName}` : "",
    originalityNotes: originalNotes(text, factMap, input.strategy),
    writingShape: cleanText(input.writingShape || input.strategy || "original"),
    teacherChecks: writingEvaluation.teachers,
    writingExam: writingEvaluation.exam,
    copyRisk: {
      ...factMapComparison.copyRisk,
      writingQualityGate: gate.ok ? "passed" : "blocked",
    },
    status,
  };
}

function buildBaseTexts(factMap = {}) {
  const mainEvent = sentence(pickMainEvent(factMap));
  const mainEventPlain = mainEvent.replace(/[.!?]$/, "");
  const secondaryFact = sentence(firstDistinctFact(factMap, mainEventPlain));
  const readerAngle = sentence(pickReaderAngle(factMap));
  const why = sentence(pickWhyItMatters(factMap));
  const subject = pickSubject(factMap);
  const topic = pickTopic(factMap);
  const sourceName = cleanText(factMap.sourceName);
  const question = makeQuestionFromEvent(factMap);
  return {
    mainEvent,
    mainEventPlain,
    secondaryFact,
    readerAngle,
    why,
    subject,
    topic,
    sourceName,
    question,
  };
}

function baseCandidateInputs(factMap = {}, fieldName = "description") {
  const parts = buildBaseTexts(factMap);
  const sensitive = isSensitive(factMap);
  const candidates = [
    {
      id: "eventPlusContext",
      strategy: "event_plus_context",
      writingShape: "event_plus_context",
      text: `${parts.mainEvent} ${parts.readerAngle || parts.secondaryFact}`,
    },
    {
      id: "subjectActionReason",
      strategy: "subject_action_reason",
      writingShape: "subject_action_reason",
      text: `${parts.subject} is connected to ${parts.mainEventPlain}. ${parts.why || parts.secondaryFact}`,
    },
    {
      id: "latestDevelopment",
      strategy: "latest_development",
      writingShape: "latest_development",
      text: `${parts.secondaryFact || parts.mainEvent} ${parts.mainEventPlain} remains the central update.`,
    },
    {
      id: "sourceBackedExplainer",
      strategy: "source_backed_explainer",
      writingShape: "source_backed_explainer",
      text: `${parts.sourceName ? `${parts.sourceName} reports on` : "Coverage explains"} ${parts.question}. ${parts.secondaryFact || parts.readerAngle}`,
    },
    {
      id: "peopleProjectContext",
      strategy: "people_project_context",
      writingShape: "people_project_context",
      text: `${parts.subject} is at the center of ${parts.mainEventPlain}. ${parts.readerAngle || parts.why || parts.secondaryFact}`,
    },
    {
      id: "neutralSensitive",
      strategy: "neutral_sensitive",
      writingShape: "neutral_sensitive",
      text: sensitive
        ? `${parts.mainEvent} ${parts.secondaryFact || parts.readerAngle}`
        : `${parts.mainEvent} ${parts.why || parts.secondaryFact}`,
    },
    {
      id: "conciseWebCard",
      strategy: "concise_web_card",
      writingShape: "concise_web_card",
      text: `${parts.mainEventPlain} gives readers context on ${parts.topic}. ${parts.secondaryFact || parts.readerAngle}`,
    },
  ];

  if (/title/i.test(fieldName)) {
    const secondaryTitle = (parts.secondaryFact || "").replace(/[.!?]$/, "");
    return [
      {
        id: "eventPlusContext",
        strategy: "event_plus_context",
        writingShape: "event_plus_context",
        text: compactTitle(parts.mainEventPlain),
      },
      {
        id: "subjectActionReason",
        strategy: "subject_action_reason",
        writingShape: "subject_action_reason",
        text: compactTitle(`${parts.subject} linked to ${parts.mainEventPlain}`),
      },
      {
        id: "latestDevelopment",
        strategy: "latest_development",
        writingShape: "latest_development",
        text: compactTitle(secondaryTitle || parts.mainEventPlain),
      },
      {
        id: "sourceBackedExplainer",
        strategy: "source_backed_explainer",
        writingShape: "source_backed_explainer",
        text: compactTitle(`${parts.topic} update from ${parts.sourceName || "source report"}`),
      },
      {
        id: "peopleProjectContext",
        strategy: "people_project_context",
        writingShape: "people_project_context",
        text: compactTitle(`${parts.subject} at center of ${parts.topic}`),
      },
      {
        id: "neutralSensitive",
        strategy: "neutral_sensitive",
        writingShape: "neutral_sensitive",
        text: compactTitle(isSensitive(factMap) ? `${parts.mainEventPlain} reported with confirmed context` : `${parts.mainEventPlain} explained`),
      },
      {
        id: "conciseWebCard",
        strategy: "concise_web_card",
        writingShape: "concise_web_card",
        text: compactTitle(`${parts.topic} gives context to readers`),
      },
    ];
  }

  if (/seo/i.test(fieldName)) {
    return candidates.map((candidate) => ({
      ...candidate,
      text: truncateWords(`${candidate.text} Read the Live News page at ${factMap.exactArticleUrl}.`, FIELD_LIMITS.seoDescription.max),
    }));
  }

  if (/social/i.test(fieldName)) {
    return candidates.map((candidate) => ({
      ...candidate,
      text: `${candidate.text} Read the Live News page: ${factMap.exactArticleUrl}`,
    }));
  }

  return candidates;
}

function generateOriginalCandidates(factMap = {}, fieldName = "description", options = {}) {
  const validation = validateFactMap(factMap);
  if (isWeakFactMap(factMap)) {
    return {
      status: "needs_more_context",
      fieldName,
      missingContext: validation.missingContext,
      blockingReasons: validation.blockingReasons,
      candidates: [],
    };
  }
  const limits = FIELD_LIMITS[fieldName] || FIELD_LIMITS.description;
  const inputs = baseCandidateInputs(factMap, fieldName)
    .map((candidate) => ({
      ...candidate,
      text: /title/i.test(fieldName)
        ? candidate.text
        : sentence(truncateWords(candidate.text, options.maxWords || limits.max)),
    }))
    .filter((candidate) => wordCount(candidate.text) >= limits.min || /title/i.test(fieldName));
  const candidates = uniqueBy(inputs, (candidate) => candidate.text.toLowerCase())
    .map((candidate) => evaluateOriginalCandidate(candidate, factMap, fieldName));
  return {
    status: candidates.some((candidate) => candidate.status === "passed") ? "ready" : "needs_review",
    fieldName,
    missingContext: validation.missingContext,
    candidates,
  };
}

function normalizeCandidates(candidates) {
  if (Array.isArray(candidates)) return candidates;
  if (Array.isArray(candidates?.candidates)) return candidates.candidates;
  return [];
}

function selectOriginalWritingCandidate(candidates, factMap = {}, fieldName = "description") {
  const validation = validateFactMap(factMap);
  const list = normalizeCandidates(candidates).map((candidate) =>
    candidate.teacherChecks && candidate.writingExam
      ? candidate
      : evaluateOriginalCandidate(candidate, factMap, fieldName)
  );
  if (!validation.ready) {
    return {
      status: "needs_more_context",
      selected: null,
      missingContext: validation.missingContext,
      candidates: list,
    };
  }
  const sorted = [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === "passed" ? -1 : b.status === "passed" ? 1 : 0;
    return (b.writingExam?.total || 0) - (a.writingExam?.total || 0);
  });
  const selected = sorted[0] || null;
  return {
    status: selected?.status === "passed" ? "selected" : selected ? "needs_review" : "blocked",
    selected,
    candidates: list,
    explanation: selected ? explainOriginalWritingChoice(selected, factMap, fieldName) : "",
  };
}

function explainOriginalWritingChoice(candidate = {}, factMap = {}, fieldName = "description") {
  const validation = validateFactMap(factMap);
  if (!validation.ready) {
    return `Needs more context before ${fieldName} can be selected: ${validation.missingContext.join(", ")}.`;
  }
  const passedTeachers = (candidate.teacherChecks || []).filter((teacher) => teacher.passed).length;
  const totalTeachers = (candidate.teacherChecks || []).length;
  return [
    `${candidate.strategy || "Selected candidate"} was chosen for ${fieldName}.`,
    `Writing score: ${candidate.writingExam?.total ?? 0}.`,
    `Teacher checks passed: ${passedTeachers}/${totalTeachers}.`,
    candidate.copyRisk?.risk ? "Copy-risk still needs review." : "Copy-risk is low.",
    candidate.factsUsed?.length ? `Facts used: ${candidate.factsUsed.slice(0, 2).join(" | ")}` : "",
  ].filter(Boolean).join(" ");
}

function generateOriginalTitleCandidates(factMap, options) {
  return generateOriginalCandidates(factMap, "title", options);
}

function generateOriginalDescriptionCandidates(factMap, options) {
  return generateOriginalCandidates(factMap, "description", options);
}

function generateOriginalDekCandidates(factMap, options) {
  return generateOriginalCandidates(factMap, "dek", options);
}

function generateOriginalSummaryCandidates(factMap, options) {
  return generateOriginalCandidates(factMap, "summary", options);
}

function generateOriginalWhyItMattersCandidates(factMap, options) {
  return generateOriginalCandidates(factMap, "whyItMatters", options);
}

function generateOriginalSeoDescriptionCandidates(factMap, options) {
  return generateOriginalCandidates(factMap, "seoDescription", options);
}

function generateOriginalSocialContextCandidates(factMap, options) {
  return generateOriginalCandidates(factMap, "socialContext", options);
}

module.exports = {
  generateOriginalTitleCandidates,
  generateOriginalDescriptionCandidates,
  generateOriginalDekCandidates,
  generateOriginalSummaryCandidates,
  generateOriginalWhyItMattersCandidates,
  generateOriginalSeoDescriptionCandidates,
  generateOriginalSocialContextCandidates,
  selectOriginalWritingCandidate,
  explainOriginalWritingChoice,
};
