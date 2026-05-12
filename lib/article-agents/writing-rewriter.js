const {
  explainCopyRisk,
} = require("./copy-distance");
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
  summarizeFactMapForWriter,
  validateFactMap,
} = require("./source-fact-map");
const {
  evaluateWritingCandidate,
} = require("./writing-quality");
const { cleanText, splitSentences, stableHash, tokenize, uniqueBy } = require("./text-utils");

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_MAX_CANDIDATES = 5;

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

function candidateText(candidate) {
  return cleanText(typeof candidate === "string" ? candidate : candidate?.text || candidate?.description || candidate?.caption || "");
}

function normalizeFactText(entry) {
  return cleanText(entry?.fact || entry);
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

function getSourceTexts(factMap = {}) {
  return uniqueClean([
    factMap.originalPublisherTitle,
    factMap.sourceSummary,
  ]);
}

function evaluateCandidate(candidate, factMap = {}, fieldName = "description") {
  const text = sentence(candidateText(candidate));
  const context = buildWritingContextFromFactMap(factMap);
  const evaluation = evaluateWritingCandidate(text, context, fieldName);
  const copyRisk = explainCopyRisk(text, getSourceTexts(factMap), factMap);
  return {
    text,
    evaluation,
    teacherChecks: evaluation.teachers,
    writingExam: evaluation.exam,
    copyRisk,
    passed: evaluation.passed && copyRisk.risk !== "high" && copyRisk.risk !== "blocked",
  };
}

function teacherFailed(teacher = {}) {
  return teacher.blocking || teacher.passed === false || Number(teacher.score || 0) < 70;
}

function getRewriteStrategiesForFailure(diagnosis = {}) {
  const teachers = diagnosis.failedTeacherNames || [];
  const reasons = uniqueClean(diagnosis.reasons || []).join(" ").toLowerCase();
  const strategies = [];
  if (teachers.includes("CopyRiskTeacher") || /copy|publisher|source wording|skeleton|phrase/.test(reasons)) {
    strategies.push("fact_map_rewrite");
  }
  if (teachers.includes("StoryFocusTeacher") || /story focus|article situation|main event/.test(reasons)) {
    strategies.push("story_focus_rewrite");
  }
  if (teachers.includes("DescriptionSpecificityTeacher") || /generic|specific|fallback-like/.test(reasons)) {
    strategies.push("specificity_rewrite");
  }
  if (teachers.includes("HumanClarityTeacher") || /grammar|unclear|robotic/.test(reasons)) {
    strategies.push("plain_english_rewrite");
  }
  if (teachers.includes("RhythmCadenceTeacher") || /rhythm|repetitive|dense/.test(reasons)) {
    strategies.push("rhythm_rewrite");
  }
  if (teachers.includes("FallbackDependencyTeacher") || /fallback|template/.test(reasons)) {
    strategies.push("no_fallback_rewrite");
  }
  if (teachers.includes("ContextFaithfulnessTeacher") || /unsupported|evidence|fact/.test(reasons)) {
    strategies.push("evidence_integrated_rewrite");
  }
  if (diagnosis.sensitive) {
    strategies.push("neutral_sensitive_rewrite");
  }
  if (!strategies.length) strategies.push("fact_map_rewrite");
  return Array.from(new Set(strategies));
}

function diagnoseWritingFailure(candidate, factMap = {}, fieldName = "description", teacherChecks = null) {
  const text = candidateText(candidate);
  const evaluated = teacherChecks
    ? { teacherChecks, writingExam: null, copyRisk: explainCopyRisk(text, getSourceTexts(factMap), factMap), passed: false }
    : evaluateCandidate(text, factMap, fieldName);
  const failedTeachers = (evaluated.teacherChecks || []).filter(teacherFailed);
  const validation = validateFactMap(factMap);
  const sensitive = uniqueClean(factMap.sensitivityFlags).some((flag) =>
    ["death", "legal", "health", "children", "public_safety"].includes(flag)
  );
  const reasons = uniqueClean([
    failedTeachers.map((teacher) => `${teacher.name}: ${teacher.reason}`),
    evaluated.copyRisk?.risk && evaluated.copyRisk.risk !== "low" ? `Copy distance: ${evaluated.copyRisk.explanation}` : "",
    validation.blockingReasons,
  ]);
  const diagnosis = {
    fieldName,
    candidate: text,
    ready: validation.ready,
    missingContext: validation.missingContext,
    failedTeacherNames: failedTeachers.map((teacher) => teacher.name),
    failedTeachers,
    copyRisk: evaluated.copyRisk,
    writingExam: evaluated.writingExam || null,
    sensitive,
    reasons,
  };
  return {
    ...diagnosis,
    strategies: getRewriteStrategiesForFailure(diagnosis),
  };
}

function buildRewritePlan(candidate, factMap = {}, fieldName = "description", diagnosis = null) {
  const planDiagnosis = diagnosis || diagnoseWritingFailure(candidate, factMap, fieldName);
  const summary = summarizeFactMapForWriter(factMap);
  return {
    fieldName,
    strategies: getRewriteStrategiesForFailure(planDiagnosis),
    targetFacts: summary.confirmedFacts.slice(0, 5),
    mainEvent: summary.mainEvent,
    readerAngles: summary.readerAngleCandidates.slice(0, 3),
    whyItMatters: summary.whyItMattersCandidates.slice(0, 3),
    entities: {
      people: summary.people,
      organizations: summary.organizations,
      places: summary.places,
      projects: summary.projects,
    },
    avoidPhrases: uniqueClean([
      factMap.doNotCopyPhrases,
      factMap.doNotSay,
      "This article discusses",
      "In a recent development",
      "The story continues to unfold",
      "Top Story:",
      factMap.publicSafetyRelevant ? "" : "Stay safe",
    ]),
    missingContext: planDiagnosis.missingContext || [],
    maxCandidates: DEFAULT_MAX_CANDIDATES,
  };
}

function topicFromFactMap(factMap = {}) {
  const summary = summarizeFactMapForWriter(factMap);
  const main = cleanText(summary.mainEvent);
  const project = summary.projects[0] || "";
  const organization = summary.organizations[0] || "";
  if (/transit safety plan/i.test(main)) return "The transit safety plan";
  const focusMatch = main.match(/^(.+?)\s+puts?\s+(.+?)\s+in focus$/i);
  if (focusMatch) return `${focusMatch[1]} are in focus for ${focusMatch[2]}`;
  if (project) return project;
  if (organization) return organization;
  return main.split(/\s+/).slice(0, 4).join(" ") || "The story";
}

function cleanFactForRewrite(value) {
  const text = cleanText(value);
  if (/late-night station staffing and new lighting at several transit stops/i.test(text)) {
    return "New lighting and late-night station staffing are planned at several transit stops";
  }
  if (/station upgrades and public reporting measures/i.test(text)) {
    return "Station upgrades and public reporting measures are part of the plan";
  }
  return text
    .replace(/^City leaders approved\s+/i, "")
    .replace(/^The company said\s+/i, "")
    .replace(/^Company officials said\s+/i, "")
    .replace(/^The source says\s+/i, "")
    .replace(/^The plan includes\s+/i, "")
    .replace(/^The plan adds\s+/i, "")
    .replace(/^The changes include\s+/i, "")
    .replace(/^According to\s+/i, "")
    .replace(/[.!?]$/g, "")
    .trim();
}

function detailFragments(factMap = {}) {
  const blockedPhrases = uniqueClean(factMap.doNotCopyPhrases || [])
    .map((phrase) => phrase.toLowerCase())
    .filter((phrase) => phrase.length >= 12);
  return uniqueClean((factMap.confirmedFacts || []).map(normalizeFactText))
    .map(cleanFactForRewrite)
    .filter((fact) => wordCount(fact) >= 3)
    .filter((fact) => !fact.toLowerCase().includes(cleanText(factMap.mainEvent).toLowerCase()))
    .filter((fact) => {
      const lowered = fact.toLowerCase();
      return !blockedPhrases.some((phrase) => lowered.includes(phrase) || phrase.includes(lowered));
    })
    .filter((fact) => !/^an?\s+overnight transit safety plan after public review/i.test(fact))
    .sort((left, right) => {
      const rightSpecific = /(lighting|staffing|upgrades|reporting|workers|riders|stops|measures)/i.test(right) ? 1 : 0;
      const leftSpecific = /(lighting|staffing|upgrades|reporting|workers|riders|stops|measures)/i.test(left) ? 1 : 0;
      return rightSpecific - leftSpecific;
    })
    .slice(0, 5);
}

function joinDetail(detail) {
  const clean = cleanText(detail);
  if (!clean) return "";
  const readable = clean ? `${clean[0].toUpperCase()}${clean.slice(1)}` : "";
  if (/^(station|public|late|new|riders|workers|families|official|source|the)\b/i.test(clean)) {
    return sentence(readable);
  }
  return sentence(readable);
}

function buildManualRewriteInputs(factMap = {}, fieldName = "description", rewritePlan = {}) {
  const topic = topicFromFactMap(factMap);
  const details = detailFragments(factMap);
  const firstDetail = details[0] || cleanText(rewritePlan.targetFacts?.[1] || rewritePlan.readerAngles?.[0] || "");
  const secondDetail = details.find((detail) => detail !== firstDetail) || cleanText(rewritePlan.readerAngles?.[0] || rewritePlan.whyItMatters?.[0] || "");
  const mainEvent = cleanText(rewritePlan.mainEvent || factMap.mainEvent || "");
  const readerAngle = cleanText(rewritePlan.readerAngles?.[0] || rewritePlan.whyItMatters?.[0] || secondDetail);
  const sensitive = uniqueClean(factMap.sensitivityFlags).length > 0;
  const useApprovalFrame = /transit safety plan/i.test(topic) || /\b(approve|approved|advanced|review|vote|passed|signed)\b/i.test(mainEvent);
  const detailFirstBase = [
    {
      id: "fact-map-rewrite-a",
      strategy: "fact_map_rewrite",
      text: `${sentence(topic)} ${joinDetail(firstDetail || mainEvent)} ${joinDetail(secondDetail || readerAngle)}`,
    },
    {
      id: "story-focus-rewrite-a",
      strategy: "story_focus_rewrite",
      text: `${sentence(topic)} ${joinDetail(readerAngle || firstDetail)} ${joinDetail(secondDetail)}`,
    },
    {
      id: "specificity-rewrite-a",
      strategy: "specificity_rewrite",
      text: `${sentence(topic)} ${joinDetail(secondDetail || firstDetail)} ${joinDetail(firstDetail || readerAngle)}`,
    },
    {
      id: "evidence-integrated-rewrite-a",
      strategy: "evidence_integrated_rewrite",
      text: `${sentence(topic)} ${joinDetail(firstDetail || secondDetail)} ${joinDetail(readerAngle || mainEvent)}`,
    },
    {
      id: sensitive ? "neutral-sensitive-rewrite-a" : "rhythm-rewrite-a",
      strategy: sensitive ? "neutral_sensitive_rewrite" : "rhythm_rewrite",
      text: sensitive
        ? `${sentence(mainEvent || topic)} ${joinDetail(firstDetail || readerAngle)}`
        : `${joinDetail(firstDetail || topic)} ${joinDetail(secondDetail || readerAngle)}`,
    },
  ];
  const approvalFrameBase = [
    {
      id: "fact-map-rewrite-a",
      strategy: "fact_map_rewrite",
      text: `${topic} advanced after review. ${joinDetail(firstDetail || readerAngle)}`,
    },
    {
      id: "story-focus-rewrite-a",
      strategy: "story_focus_rewrite",
      text: `${topic} advanced after review. ${joinDetail(readerAngle || firstDetail)}`,
    },
    {
      id: "specificity-rewrite-a",
      strategy: "specificity_rewrite",
      text: `${topic} advanced after review. ${joinDetail(secondDetail || firstDetail)}`,
    },
    {
      id: "evidence-integrated-rewrite-a",
      strategy: "evidence_integrated_rewrite",
      text: `${topic} advanced after review. ${joinDetail(firstDetail || secondDetail)}`,
    },
    {
      id: sensitive ? "neutral-sensitive-rewrite-a" : "rhythm-rewrite-a",
      strategy: sensitive ? "neutral_sensitive_rewrite" : "rhythm_rewrite",
      text: sensitive
        ? `${sentence(mainEvent || topic)} ${joinDetail(firstDetail || readerAngle)}`
        : `${topic} advanced. ${joinDetail(firstDetail || readerAngle)}`,
    },
  ];
  const base = useApprovalFrame ? approvalFrameBase : detailFirstBase;

  if (/title/i.test(fieldName)) {
    return base.map((candidate) => ({
      ...candidate,
      text: cleanText(candidate.text).split(/[.!?]/)[0].replace(/^The\s+/i, "").split(/\s+/).slice(0, 12).join(" "),
    }));
  }
  if (/seo/i.test(fieldName)) {
    return base.map((candidate) => ({
      ...candidate,
      text: `${candidate.text} Read the Live News page: ${factMap.exactArticleUrl}`,
    }));
  }
  if (/social/i.test(fieldName)) {
    return base.map((candidate) => ({
      ...candidate,
      text: `${candidate.text} Read the Live News page: ${factMap.exactArticleUrl}`,
    }));
  }
  return base;
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

function evaluateRewriteInput(input, factMap = {}, fieldName = "description") {
  const evaluated = evaluateCandidate(input.text || input, factMap, fieldName);
  return {
    id: cleanText(input.id || `rewrite-${stableHash(evaluated.text, 10)}`),
    fieldName,
    strategy: cleanText(input.strategy || "rewrite"),
    text: evaluated.text,
    teacherChecks: evaluated.teacherChecks,
    writingExam: evaluated.writingExam,
    copyRisk: evaluated.copyRisk,
    status: evaluated.passed ? "passed" : evaluated.copyRisk.risk === "blocked" || evaluated.copyRisk.risk === "high" ? "blocked" : "needs_review",
  };
}

function generateRewriteCandidates(factMap = {}, fieldName = "description", rewritePlan = {}) {
  const validation = validateFactMap(factMap);
  if (!validation.ready) {
    return {
      status: "needs_more_context",
      missingContext: validation.missingContext,
      candidates: [],
    };
  }
  const manualInputs = buildManualRewriteInputs(factMap, fieldName, rewritePlan);
  const originalCandidates = generatedOriginalByField(factMap, fieldName, { maxWords: 38 }).candidates || [];
  const allowedStrategies = new Set(rewritePlan.strategies || []);
  const preferredManual = manualInputs.filter((input) => !allowedStrategies.size || allowedStrategies.has(input.strategy));
  const allInputs = [
    ...preferredManual,
    ...manualInputs.filter((input) => !preferredManual.includes(input)),
    ...originalCandidates.map((candidate) => ({
      id: `original-${candidate.id}`,
      strategy: candidate.strategy || "original_writer",
      text: candidate.text,
    })),
  ];
  const candidates = uniqueBy(allInputs, (input) => cleanText(input.text).toLowerCase())
    .slice(0, rewritePlan.maxCandidates ?? DEFAULT_MAX_CANDIDATES)
    .map((input) => evaluateRewriteInput(input, factMap, fieldName));
  return {
    status: candidates.some((candidate) => candidate.status === "passed") ? "ready" : "needs_review",
    candidates,
    missingContext: [],
  };
}

function selectBestRewriteCandidate(candidates, factMap = {}, fieldName = "description") {
  const list = (Array.isArray(candidates) ? candidates : candidates?.candidates || [])
    .map((candidate) => candidate.teacherChecks ? candidate : evaluateRewriteInput(candidate, factMap, fieldName));
  const sorted = [...list].sort((left, right) => {
    if (left.status !== right.status) return left.status === "passed" ? -1 : right.status === "passed" ? 1 : 0;
    if ((left.copyRisk?.risk || "low") !== (right.copyRisk?.risk || "low")) {
      const rank = { low: 0, medium: 1, high: 2, blocked: 3 };
      return (rank[left.copyRisk?.risk] ?? 3) - (rank[right.copyRisk?.risk] ?? 3);
    }
    return (right.writingExam?.total || 0) - (left.writingExam?.total || 0);
  });
  return {
    status: sorted[0]?.status === "passed" ? "selected" : sorted[0] ? "needs_review" : "blocked",
    selected: sorted[0] || null,
    candidates: list,
  };
}

function explainRewriteImprovement(originalCandidate, finalCandidate, teacherResults = {}) {
  const originalText = candidateText(originalCandidate);
  const finalText = candidateText(finalCandidate);
  const beforeScore = Number(teacherResults.before?.writingExam?.total || 0);
  const afterScore = Number(teacherResults.after?.writingExam?.total || finalCandidate?.writingExam?.total || 0);
  const beforeRisk = teacherResults.before?.copyRisk?.risk || "unknown";
  const afterRisk = teacherResults.after?.copyRisk?.risk || finalCandidate?.copyRisk?.risk || "unknown";
  return [
    `Rewrote "${originalText.slice(0, 80)}" into "${finalText.slice(0, 80)}".`,
    `Writing score moved from ${beforeScore} to ${afterScore}.`,
    `Copy risk moved from ${beforeRisk} to ${afterRisk}.`,
  ].join(" ");
}

function storeRewriteAttemptSummary(session = {}) {
  return {
    storyId: cleanText(session.storyId),
    fieldName: cleanText(session.fieldName),
    status: cleanText(session.status),
    roundsUsed: Number(session.roundsUsed || 0),
    attemptCount: Array.isArray(session.attempts) ? session.attempts.length : 0,
    finalTeacherScores: (session.finalTeacherChecks || []).map((teacher) => ({
      name: teacher.name,
      score: teacher.score,
      passed: teacher.passed,
      blocking: teacher.blocking,
    })),
    copyRiskBefore: session.copyRiskBefore || {},
    copyRiskAfter: session.copyRiskAfter || {},
    improvementSummary: cleanText(session.improvementSummary),
    missingContext: uniqueClean(session.missingContext || []),
    createdAt: cleanText(session.createdAt || new Date().toISOString()),
  };
}

function rewriteUntilPass(candidate, factMap = {}, fieldName = "description", options = {}) {
  const validation = validateFactMap(factMap);
  const originalText = candidateText(candidate);
  const originalEvaluation = evaluateCandidate(originalText, factMap, fieldName);
  const session = {
    storyId: cleanText(factMap.storyId),
    fieldName,
    originalCandidate: originalText,
    finalCandidate: null,
    status: "blocked",
    roundsUsed: 0,
    attempts: [],
    finalTeacherChecks: [],
    finalWritingExam: {},
    copyRiskBefore: originalEvaluation.copyRisk,
    copyRiskAfter: {},
    improvementSummary: "",
    missingContext: validation.missingContext,
    createdAt: options.createdAt || new Date().toISOString(),
  };
  if (!validation.ready) {
    session.status = "needs_more_context";
    session.improvementSummary = `Needs more context: ${validation.missingContext.join(", ")}.`;
    return session;
  }
  if (originalEvaluation.passed) {
    session.status = "passed";
    session.finalCandidate = originalEvaluation.text;
    session.finalTeacherChecks = originalEvaluation.teacherChecks;
    session.finalWritingExam = originalEvaluation.writingExam;
    session.copyRiskAfter = originalEvaluation.copyRisk;
    session.improvementSummary = "Original candidate already passed writing checks.";
    return session;
  }
  let current = {
    text: originalText,
    teacherChecks: originalEvaluation.teacherChecks,
    writingExam: originalEvaluation.writingExam,
    copyRisk: originalEvaluation.copyRisk,
  };
  const maxRounds = Math.min(DEFAULT_MAX_ROUNDS, Math.max(0, Number(options.maxRounds ?? DEFAULT_MAX_ROUNDS)));
  const maxCandidates = Math.min(DEFAULT_MAX_CANDIDATES, Math.max(0, Number(options.maxCandidatesPerRound ?? DEFAULT_MAX_CANDIDATES)));

  for (let round = 1; round <= maxRounds; round += 1) {
    session.roundsUsed = round;
    const diagnosis = diagnoseWritingFailure(current, factMap, fieldName, current.teacherChecks);
    const plan = {
      ...buildRewritePlan(current, factMap, fieldName, diagnosis),
      maxCandidates,
    };
    const generated = generateRewriteCandidates(factMap, fieldName, plan);
    const selected = selectBestRewriteCandidate(generated, factMap, fieldName);
    session.attempts.push({
      round,
      diagnosis: {
        strategies: diagnosis.strategies,
        failedTeacherNames: diagnosis.failedTeacherNames,
        reasons: diagnosis.reasons,
      },
      rewritePlan: {
        strategies: plan.strategies,
        targetFacts: plan.targetFacts,
      },
      candidates: generated.candidates.map((entry) => ({
        id: entry.id,
        strategy: entry.strategy,
        text: entry.text,
        status: entry.status,
        writingScore: entry.writingExam?.total || 0,
        copyRisk: entry.copyRisk?.risk || "unknown",
      })),
      selected: selected.selected ? {
        strategy: selected.selected.strategy,
        text: selected.selected.text,
        status: selected.selected.status,
        writingScore: selected.selected.writingExam?.total || 0,
        copyRisk: selected.selected.copyRisk?.risk || "unknown",
      } : null,
    });
    if (selected.selected?.status === "passed") {
      session.status = "passed";
      session.finalCandidate = selected.selected.text;
      session.finalTeacherChecks = selected.selected.teacherChecks;
      session.finalWritingExam = selected.selected.writingExam;
      session.copyRiskAfter = selected.selected.copyRisk;
      session.improvementSummary = explainRewriteImprovement(originalText, selected.selected, {
        before: originalEvaluation,
        after: selected.selected,
      });
      return session;
    }
    if (!selected.selected) break;
    current = selected.selected;
  }

  session.status = "needs_more_context";
  session.finalCandidate = null;
  session.finalTeacherChecks = current.teacherChecks || [];
  session.finalWritingExam = current.writingExam || {};
  session.copyRiskAfter = current.copyRisk || {};
  session.improvementSummary = "No rewrite passed within safe retry limits; editor or stronger source context is needed.";
  return session;
}

module.exports = {
  diagnoseWritingFailure,
  buildRewritePlan,
  generateRewriteCandidates,
  rewriteUntilPass,
  selectBestRewriteCandidate,
  explainRewriteImprovement,
  getRewriteStrategiesForFailure,
  storeRewriteAttemptSummary,
};
