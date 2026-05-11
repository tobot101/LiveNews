const { explainCopyRisk } = require("./copy-distance");
const {
  generateOriginalDekCandidates,
  generateOriginalDescriptionCandidates,
  generateOriginalSeoDescriptionCandidates,
  generateOriginalSocialContextCandidates,
  generateOriginalSummaryCandidates,
  generateOriginalTitleCandidates,
  generateOriginalWhyItMattersCandidates,
} = require("./original-writer");
const {
  buildSourceFactMap,
  compareCandidateToFactMap,
  summarizeFactMapForWriter,
  validateFactMap,
} = require("./source-fact-map");
const {
  buildRewritePlan,
  diagnoseWritingFailure,
  rewriteUntilPass,
} = require("./writing-rewriter");
const {
  detectFallbackRisk,
  evaluateWritingCandidate,
} = require("./writing-quality");
const { cleanText, clamp, stableHash, tokenize, uniqueBy } = require("./text-utils");

const SENSITIVE_FLAGS = new Set([
  "death",
  "legal",
  "health",
  "children",
  "public_safety",
]);

const SENSITIVE_HYPE_PATTERNS = [
  /\bshocking\b/i,
  /\bbombshell\b/i,
  /\byou won'?t believe\b/i,
  /\bfans are reacting\b/i,
  /\bdrama alert\b/i,
  /\bspills? tea\b/i,
  /\bsecret romance\b/i,
  /\blove triangle\b/i,
];

const OVERSTATEMENT_PATTERNS = [
  /\bguarantee(d|s)?\b/i,
  /\bprove(s|d)?\b/i,
  /\beveryone\b/i,
  /\ball readers\b/i,
  /\bsecretly\b/i,
  /\bcover[- ]?up\b/i,
  /\bwill definitely\b/i,
];

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

function candidateText(candidate) {
  return cleanText(typeof candidate === "string" ? candidate : candidate?.text || candidate?.description || candidate?.caption || "");
}

function sentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function tokenOverlap(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

function getSourceTexts(factMap = {}) {
  return uniqueClean([
    factMap.originalPublisherTitle,
    factMap.sourceSummary,
  ]);
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

function generatedOriginalByField(factMap, fieldName, options) {
  if (/title/i.test(fieldName)) return generateOriginalTitleCandidates(factMap, options);
  if (/dek/i.test(fieldName)) return generateOriginalDekCandidates(factMap, options);
  if (/summary/i.test(fieldName)) return generateOriginalSummaryCandidates(factMap, options);
  if (/why/i.test(fieldName)) return generateOriginalWhyItMattersCandidates(factMap, options);
  if (/seo|meta/i.test(fieldName)) return generateOriginalSeoDescriptionCandidates(factMap, options);
  if (/social|caption/i.test(fieldName)) return generateOriginalSocialContextCandidates(factMap, options);
  return generateOriginalDescriptionCandidates(factMap, options);
}

function scoreAverage(values) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function compactTeacherChecks(teachers = []) {
  return teachers.map((teacher) => ({
    name: teacher.name,
    passed: Boolean(teacher.passed),
    score: Number(teacher.score || 0),
    reason: cleanText(teacher.reason),
    blocking: Boolean(teacher.blocking),
  }));
}

function runSourceReaderAgent(story = {}) {
  const sourceContext = {
    storyId: cleanText(story.storyId || story.liveNewsStoryId || story.id || story.slug || stableHash(JSON.stringify(story).slice(0, 1000), 12)),
    title: cleanText(story.liveNewsHeadline || story.approvedTitle || story.headline || story.title || ""),
    originalPublisherTitle: cleanText(story.originalPublisherTitle || story.publisherTitle || story.sourceTitle || story.title || ""),
    sourceName: cleanText(story.primarySourceName || story.sourceName || story.source || story.publisher || ""),
    sourceUrl: cleanText(story.originalSourceUrl || story.sourceUrl || story.link || story.primarySourceUrl || ""),
    exactArticleUrl: cleanText(story.exactArticleUrl || story.liveNewsUrl || story.approvedStoryUrl || story.canonicalUrl || ""),
    category: cleanText(story.category || story.sourceCategory || "Top"),
    approvedFieldsAvailable: Boolean(story.liveNewsHeadline || story.approvedTitle || story.liveNewsSummary || story.approvedDescription),
    contextFieldsRead: [
      "title",
      "originalPublisherTitle",
      "summary",
      "dek",
      "keyPoints",
      "whyItMatters",
      "sourceName",
      "sourceUrl",
      "exactArticleUrl",
    ],
  };
  const missing = [
    sourceContext.title ? "" : "title_missing",
    sourceContext.sourceName ? "" : "source_name_missing",
    sourceContext.exactArticleUrl ? "" : "exact_article_url_missing",
  ].filter(Boolean);
  return {
    name: "SourceReaderAgent",
    status: missing.length ? "needs_more_context" : "ready",
    sourceContext,
    missingContext: missing,
    notes: [
      "Read approved story fields only.",
      "Ignored comments, usernames, profiles, private messages, and tokens.",
    ],
  };
}

function runFactMapperAgent(story = {}) {
  const factMap = buildSourceFactMap(story);
  const validation = validateFactMap(factMap);
  return {
    name: "FactMapperAgent",
    status: validation.ready ? "ready" : "needs_more_context",
    factMap,
    validation,
    notes: validation.ready
      ? ["Built SourceFactMap from source-backed story fields."]
      : [`Needs more context: ${validation.missingContext.join(", ")}.`],
  };
}

function runContextResearchAgent(factMap = {}, options = {}) {
  const validation = validateFactMap(factMap);
  const safeProvidedNotes = uniqueClean(options.authorizedResearchNotes || [])
    .filter((note) => !/\b(username|private message|profile|token|comment)\b/i.test(note))
    .slice(0, 5);
  return {
    name: "ContextResearchAgent",
    status: validation.ready ? "ready" : "needs_more_context",
    externalApisUsed: false,
    researchMode: "placeholder_authorized_hooks_only",
    addedFacts: [],
    safeContextNotes: safeProvidedNotes,
    notes: [
      "No external APIs used in this pass.",
      "No unsupported facts were added to the fact map.",
    ],
  };
}

function runOriginalVoiceWriterAgent(factMap = {}, fieldName = "description") {
  const generated = generatedOriginalByField(factMap, fieldName, { maxWords: 38 });
  return {
    name: "OriginalVoiceWriterAgent",
    status: generated.status === "needs_more_context" ? "needs_more_context" : generated.candidates?.length ? "ready" : "needs_review",
    candidates: generated.candidates || [],
    missingContext: generated.missingContext || [],
    notes: [
      "Generated candidates from SourceFactMap.",
      "Did not reuse publisher sentence structure as a writing source.",
    ],
  };
}

function runSmartnessCriticAgent(candidate, factMap = {}, fieldName = "description") {
  const text = candidateText(candidate);
  const validation = validateFactMap(factMap);
  const comparison = compareCandidateToFactMap(text, factMap);
  const fallback = detectFallbackRisk(text);
  const overstatementHits = OVERSTATEMENT_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  const summary = summarizeFactMapForWriter(factMap);
  const evidenceText = [
    summary.mainEvent,
    summary.confirmedFacts,
    summary.readerAngleCandidates,
    summary.whyItMattersCandidates,
    summary.people,
    summary.organizations,
    summary.places,
    summary.projects,
  ].flat().join(" ");
  const relevance = clamp(Math.max(comparison.storyFocusScore || 0, tokenOverlap(text, summary.mainEvent) * 100), 0, 100);
  const evidenceSupport = clamp(100 - (comparison.unsupportedTokens || []).length * 12, 0, 100);
  const pointClarity = clamp(62 + (/[.!?]/.test(text) ? 12 : 0) + (text.split(/\s+/).length >= 8 ? 14 : 0) - fallback.reasons.length * 20, 0, 100);
  const readerUsefulness = clamp(50 + Math.min(comparison.factHits || 0, 3) * 14 + (tokenOverlap(text, evidenceText) > 0.2 ? 12 : 0), 0, 100);
  const contextQuality = clamp(Number(factMap.contextConfidence || 0) * 100 + (validation.ready ? 10 : -20), 0, 100);
  const unsupportedClaimRisk = clamp((comparison.unsupportedTokens || []).length * 18 + overstatementHits.length * 35, 0, 100);
  const vagueWritingRisk = clamp(fallback.reasons.length * 35 + (/this story|this topic|latest update/i.test(text) ? 25 : 0), 0, 100);
  const overstatementRisk = clamp(overstatementHits.length * 35, 0, 100);
  const total = scoreAverage([
    relevance,
    evidenceSupport,
    pointClarity,
    readerUsefulness,
    contextQuality,
    100 - unsupportedClaimRisk,
    100 - vagueWritingRisk,
    100 - overstatementRisk,
  ]);
  const blockingWarnings = [
    validation.ready ? "" : `Fact map is not ready: ${validation.missingContext.join(", ")}.`,
    unsupportedClaimRisk >= 55 ? "Candidate may include unsupported claims." : "",
    vagueWritingRisk >= 50 ? "Candidate sounds vague or fallback-like." : "",
    overstatementRisk > 0 ? "Candidate may overstate what is confirmed." : "",
    relevance < 70 ? "Candidate is not relevant enough to the article situation." : "",
  ].filter(Boolean);
  return {
    name: "SmartnessCriticAgent",
    passed: validation.ready && total >= 75 && blockingWarnings.length === 0,
    score: {
      relevance: Math.round(relevance),
      evidenceSupport: Math.round(evidenceSupport),
      pointClarity: Math.round(pointClarity),
      readerUsefulness: Math.round(readerUsefulness),
      contextQuality: Math.round(contextQuality),
      unsupportedClaimRisk: Math.round(unsupportedClaimRisk),
      vagueWritingRisk: Math.round(vagueWritingRisk),
      overstatementRisk: Math.round(overstatementRisk),
      total,
    },
    blockingWarnings,
    notes: blockingWarnings.length
      ? blockingWarnings
      : ["Candidate proves a clear source-backed point for readers."],
    fieldName,
  };
}

function runCopyRiskEditorAgent(candidate, factMap = {}) {
  const text = candidateText(candidate);
  const copyRisk = explainCopyRisk(text, getSourceTexts(factMap), factMap);
  const blocking = copyRisk.risk === "high" || copyRisk.risk === "blocked";
  return {
    name: "CopyRiskEditorAgent",
    passed: !blocking,
    copyRisk,
    blockingWarnings: blocking ? copyRisk.reasons : [],
    notes: [
      blocking
        ? "Candidate must be rebuilt from the fact map."
        : "Candidate keeps acceptable copy distance from publisher wording.",
    ],
  };
}

function runClarityEditorAgent(candidate, factMap = {}, fieldName = "description") {
  const context = buildWritingContextFromFactMap(factMap);
  const evaluation = evaluateWritingCandidate(candidateText(candidate), context, fieldName);
  const relevantTeachers = evaluation.teachers.filter((teacher) =>
    ["HumanClarityTeacher", "DescriptionSpecificityTeacher", "RhythmCadenceTeacher", "DigitalMediaTeacher"].includes(teacher.name)
  );
  const blockingWarnings = relevantTeachers
    .filter((teacher) => teacher.blocking || teacher.passed === false)
    .map((teacher) => `${teacher.name}: ${teacher.reason}`);
  return {
    name: "ClarityEditorAgent",
    passed: blockingWarnings.length === 0,
    score: scoreAverage(relevantTeachers.map((teacher) => teacher.score)),
    teacherChecks: compactTeacherChecks(relevantTeachers),
    blockingWarnings,
    notes: blockingWarnings.length
      ? blockingWarnings
      : ["Candidate is readable, specific, and suitable for the requested field."],
  };
}

function runSensitiveToneEditorAgent(candidate, factMap = {}) {
  const text = candidateText(candidate);
  const flags = uniqueClean(factMap.sensitivityFlags || []);
  const sensitive = flags.some((flag) => SENSITIVE_FLAGS.has(flag));
  const hypeHits = sensitive
    ? SENSITIVE_HYPE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source)
    : [];
  const publicSafetyBlocked = /\bstay safe|official warning|public safety\b/i.test(text) && factMap.publicSafetyRelevant !== true;
  const blockingWarnings = [
    ...hypeHits.map((hit) => `Sensitive story cannot use hype phrase: ${hit}.`),
    publicSafetyBlocked ? "Public safety language needs explicit support." : "",
  ].filter(Boolean);
  return {
    name: "SensitiveToneEditorAgent",
    sensitive,
    flags,
    passed: blockingWarnings.length === 0,
    score: blockingWarnings.length ? 45 : 100,
    blockingWarnings,
    notes: blockingWarnings.length
      ? blockingWarnings
      : [sensitive ? "Sensitive story uses neutral tone." : "No special sensitivity tone issue found."],
  };
}

function runRewriteCoachAgent(candidate, factMap = {}, teacherChecks = [], fieldName = "description") {
  const diagnosis = diagnoseWritingFailure(candidate, factMap, fieldName, teacherChecks);
  const rewritePlan = buildRewritePlan(candidate, factMap, fieldName, diagnosis);
  const session = rewriteUntilPass(candidate, factMap, fieldName, {
    maxRounds: 3,
    maxCandidatesPerRound: 5,
  });
  return {
    name: "RewriteCoachAgent",
    status: session.status,
    diagnosis,
    rewritePlan,
    session,
    notes: [
      session.status === "passed"
        ? "Rewrite coach produced a passing candidate inside safe limits."
        : "Rewrite coach could not produce a passing candidate inside safe limits.",
    ],
  };
}

function normalizeCandidate(candidate, factMap = {}, fieldName = "description") {
  const text = sentence(candidateText(candidate));
  const context = buildWritingContextFromFactMap(factMap);
  const writing = evaluateWritingCandidate(text, context, fieldName);
  const smartness = runSmartnessCriticAgent(text, factMap, fieldName);
  const copyEditor = runCopyRiskEditorAgent(text, factMap);
  const clarityEditor = runClarityEditorAgent(text, factMap, fieldName);
  const toneEditor = runSensitiveToneEditorAgent(text, factMap);
  const passed = writing.passed && smartness.passed && copyEditor.passed && clarityEditor.passed && toneEditor.passed;
  return {
    id: cleanText(candidate?.id || `${fieldName}-${stableHash(text, 10)}`),
    fieldName,
    strategy: cleanText(candidate?.strategy || "writer_room_candidate"),
    text,
    status: passed ? "passed" : copyEditor.copyRisk.risk === "blocked" || copyEditor.copyRisk.risk === "high" ? "blocked" : "needs_review",
    teacherChecks: writing.teachers,
    writingExam: writing.exam,
    copyRisk: copyEditor.copyRisk,
    smartnessScore: smartness.score,
    editorReviews: {
      smartness,
      copyRisk: copyEditor,
      clarity: clarityEditor,
      sensitiveTone: toneEditor,
    },
  };
}

function runManagingEditorAgent(candidates = [], factMap = {}, fieldName = "description") {
  const validation = validateFactMap(factMap);
  const normalized = (Array.isArray(candidates) ? candidates : candidates?.candidates || [])
    .map((candidate) => normalizeCandidate(candidate, factMap, fieldName));
  if (!validation.ready) {
    return {
      name: "ManagingEditorAgent",
      status: "needs_more_context",
      selectedCandidate: null,
      candidates: normalized,
      reason: `Needs more context: ${validation.missingContext.join(", ")}.`,
    };
  }
  const sorted = [...normalized].sort((left, right) => {
    if (left.status !== right.status) return left.status === "passed" ? -1 : right.status === "passed" ? 1 : 0;
    const riskRank = { low: 0, medium: 1, high: 2, blocked: 3 };
    if ((left.copyRisk?.risk || "low") !== (right.copyRisk?.risk || "low")) {
      return (riskRank[left.copyRisk?.risk] ?? 3) - (riskRank[right.copyRisk?.risk] ?? 3);
    }
    return (right.smartnessScore?.total || 0) - (left.smartnessScore?.total || 0) ||
      (right.writingExam?.total || 0) - (left.writingExam?.total || 0);
  });
  const selected = sorted[0] || null;
  const status = selected?.status === "passed" ? "passed" : selected ? "needs_review" : "blocked";
  return {
    name: "ManagingEditorAgent",
    status,
    selectedCandidate: selected,
    candidates: sorted,
    reason: selected?.status === "passed"
      ? `Selected ${selected.strategy} because it passed writing, smartness, copy-risk, clarity, and sensitive-tone checks.`
      : selected
        ? "No candidate fully passed; editor review or stronger context is needed."
        : "No candidates were available for review.",
  };
}

function runWriterRoom(story = {}, fieldName = "description", options = {}) {
  const sourceReader = runSourceReaderAgent(story);
  const factMapper = runFactMapperAgent(story);
  const factMap = factMapper.factMap;
  const validation = factMapper.validation;
  const contextResearch = runContextResearchAgent(factMap, options);
  const agentNotes = [
    { agent: sourceReader.name, status: sourceReader.status, notes: sourceReader.notes },
    { agent: factMapper.name, status: factMapper.status, notes: factMapper.notes },
    { agent: contextResearch.name, status: contextResearch.status, notes: contextResearch.notes },
  ];
  if (!validation.ready) {
    return {
      storyId: cleanText(factMap.storyId),
      fieldName,
      status: "needs_more_context",
      factMap,
      candidates: [],
      selectedCandidate: null,
      agentNotes,
      teacherChecks: [],
      writingExam: {},
      copyRisk: {},
      smartnessScore: {},
      rewriteSession: {},
      managingEditorReason: `Needs more context: ${validation.missingContext.join(", ")}.`,
    };
  }

  const writer = runOriginalVoiceWriterAgent(factMap, fieldName);
  agentNotes.push({ agent: writer.name, status: writer.status, notes: writer.notes });
  let candidates = writer.candidates || [];
  let managingEditor = runManagingEditorAgent(candidates, factMap, fieldName);
  let rewriteCoach = null;

  if (managingEditor.status !== "passed" && managingEditor.selectedCandidate) {
    rewriteCoach = runRewriteCoachAgent(
      managingEditor.selectedCandidate,
      factMap,
      managingEditor.selectedCandidate.teacherChecks,
      fieldName
    );
    agentNotes.push({ agent: rewriteCoach.name, status: rewriteCoach.status, notes: rewriteCoach.notes });
    if (rewriteCoach.session?.finalCandidate) {
      candidates = [
        ...candidates,
        {
          id: `rewrite-${stableHash(rewriteCoach.session.finalCandidate, 10)}`,
          strategy: "writer_room_rewrite",
          text: rewriteCoach.session.finalCandidate,
        },
      ];
      managingEditor = runManagingEditorAgent(candidates, factMap, fieldName);
    }
  }

  const selected = managingEditor.selectedCandidate;
  return {
    storyId: cleanText(factMap.storyId),
    fieldName,
    status: managingEditor.status === "passed" ? "passed" : managingEditor.status === "needs_more_context" ? "needs_more_context" : "needs_review",
    factMap,
    candidates: managingEditor.candidates,
    selectedCandidate: selected,
    agentNotes,
    teacherChecks: selected?.teacherChecks || [],
    writingExam: selected?.writingExam || {},
    copyRisk: selected?.copyRisk || {},
    smartnessScore: selected?.smartnessScore || {},
    rewriteSession: rewriteCoach?.session || {},
    managingEditorReason: managingEditor.reason,
  };
}

module.exports = {
  runWriterRoom,
  runSourceReaderAgent,
  runFactMapperAgent,
  runContextResearchAgent,
  runOriginalVoiceWriterAgent,
  runSmartnessCriticAgent,
  runCopyRiskEditorAgent,
  runClarityEditorAgent,
  runSensitiveToneEditorAgent,
  runRewriteCoachAgent,
  runManagingEditorAgent,
};
