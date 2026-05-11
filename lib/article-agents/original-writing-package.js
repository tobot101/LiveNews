const { buildSourceFactMap, validateFactMap } = require("./source-fact-map");
const { runWriterRoom } = require("./writer-room");
const { buildArticleWritingContext, evaluateWritingCandidate } = require("./writing-quality");
const { rewriteUntilPass } = require("./writing-rewriter");
const { cleanText, splitSentences, uniqueBy } = require("./text-utils");

const ORIGINAL_WRITING_PACKAGE_SCHEMA_VERSION = "live-news-original-writing-package-v1";

const FIELD_ORDER = [
  "title",
  "description",
  "dek",
  "summary",
  "whyItMatters",
];

function uniqueClean(values) {
  return uniqueBy(
    (Array.isArray(values) ? values : [values])
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map(cleanText)
      .filter(Boolean),
    (value) => value.toLowerCase()
  );
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
}

function stripTerminalPeriod(value) {
  return cleanText(value).replace(/[.!?]$/, "");
}

function normalizeTitle(value) {
  return stripTerminalPeriod(value)
    .replace(/^Top Story:\s*/i, "")
    .trim();
}

function sentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function removeLiveNewsSuffix(value) {
  return cleanText(value).replace(/\s+\|\s+Live News$/i, "");
}

function buildContextFromFactMap(factMap = {}) {
  return buildArticleWritingContext({
    storyId: factMap.storyId,
    exactArticleUrl: factMap.exactArticleUrl,
    liveNewsUrl: factMap.exactArticleUrl,
    canonicalUrl: factMap.exactArticleUrl,
    title: factMap.mainEvent,
    headline: factMap.mainEvent,
    originalPublisherTitle: factMap.originalPublisherTitle,
    primarySourceName: factMap.sourceName,
    originalSourceUrl: factMap.sourceUrl,
    category: factMap.sourceCategory,
    summary: (factMap.confirmedFacts || []).map((entry) => entry.fact || entry),
    sourceSummary: factMap.sourceSummary,
    keyPoints: (factMap.confirmedFacts || []).map((entry) => entry.fact || entry),
    whyItMatters: (factMap.whyItMattersCandidates || [])[0] || (factMap.readerAngleCandidates || [])[0] || "",
    people: factMap.people || [],
    organizations: factMap.organizations || [],
    places: factMap.places || [],
    publicSafetyRelevant: Boolean(factMap.publicSafetyRelevant),
  });
}

function runRooms(story = {}, fields = FIELD_ORDER) {
  return fields.reduce((rooms, fieldName) => {
    rooms[fieldName] = runWriterRoom(story, fieldName);
    return rooms;
  }, {});
}

function getRoomText(room, fieldName) {
  const text = cleanText(room?.selectedCandidate?.text || "");
  if (!text) return "";
  return fieldName === "title" ? normalizeTitle(text) : sentence(text);
}

function fallbackFieldText(story = {}, fieldName) {
  if (fieldName === "title") return normalizeTitle(story.headline || story.title || story.liveNewsHeadline || "");
  if (fieldName === "description") return cleanText(story.description || story.metaDescription || story.dek || "");
  if (fieldName === "dek") return cleanText(story.dek || story.description || "");
  if (fieldName === "summary") {
    const summary = Array.isArray(story.summary) ? story.summary.join(" ") : story.summary;
    return cleanText(story.summaryText || story.summaryLong || summary || story.description || story.dek || "");
  }
  if (fieldName === "whyItMatters") return cleanText(story.whyItMatters || story.liveNewsWhyItMatters || "");
  return "";
}

function selectFieldText(story, rooms, fieldName) {
  const room = rooms[fieldName];
  if (room?.status === "passed" && room.selectedCandidate?.text) {
    return getRoomText(room, fieldName);
  }
  const fallback = fallbackFieldText(story, fieldName);
  if (!fallback) return "";
  const rewriteSession = room?.rewriteSession?.status ? room.rewriteSession : null;
  if (rewriteSession?.status === "passed" && rewriteSession.finalCandidate) {
    return fieldName === "title" ? normalizeTitle(rewriteSession.finalCandidate) : sentence(rewriteSession.finalCandidate);
  }
  return fallback;
}

function buildFieldGate(fieldName, text, context) {
  const clean = fieldName === "metaTitle" ? removeLiveNewsSuffix(text) : cleanText(text);
  if (!clean) {
    return {
      ok: false,
      status: "blocked",
      fieldName,
      text: "",
      total: 0,
      blockingReasons: [`${fieldName} is missing.`],
      teachers: [],
      evaluation: null,
    };
  }
  const evaluation = evaluateWritingCandidate(clean, context, fieldName);
  return {
    ok: evaluation.passed,
    status: evaluation.passed ? "public_ready" : "blocked",
    fieldName,
    text,
    total: evaluation.exam.total,
    blockingReasons: evaluation.exam.blockingReasons || [],
    teachers: evaluation.teachers || [],
    evaluation,
  };
}

function summarizeFieldGates(fieldGates) {
  const entries = Object.entries(fieldGates);
  const totals = entries.map(([, gate]) => Number(gate.total || 0));
  const blockingReasons = uniqueClean(entries.flatMap(([fieldName, gate]) =>
    (gate.blockingReasons || []).map((reason) => `${fieldName}: ${reason}`)
  ));
  return {
    schemaVersion: "live-news-original-writing-exam-summary-v1",
    total: totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : 0,
    lowestFieldScore: totals.length ? Math.min(...totals) : 0,
    passed: entries.every(([, gate]) => gate.ok),
    fields: entries.reduce((result, [fieldName, gate]) => {
      result[fieldName] = {
        total: Number(gate.total || 0),
        passed: Boolean(gate.ok),
        blockingReasons: gate.blockingReasons || [],
      };
      return result;
    }, {}),
    blockingReasons,
  };
}

function pickRewriteSession(rooms = {}) {
  return Object.values(rooms).find((room) => room?.rewriteSession?.status === "passed")?.rewriteSession || {};
}

function buildMetaTitle(title) {
  const clean = normalizeTitle(title);
  return clean ? truncate(`${clean} | Live News`, 68) : "";
}

function buildMetaDescription(description, summary) {
  return truncate(cleanText(description || summary), 158);
}

function getDescriptionCandidateLabel(candidate = {}, index = 0) {
  const labels = {
    event_plus_context: "Source faithful",
    subject_action_reason: "Reader context",
    concise_web_card: "Concise web",
    source_backed_explainer: "Source-backed explainer",
    people_project_context: "People/project context",
    neutral_sensitive: "Neutral sensitive",
    latest_development: "Latest development",
  };
  return labels[candidate.strategy] || candidate.label || candidate.strategy || `Candidate ${index + 1}`;
}

function getWritingQualityStatus(validation, writingExam, rooms) {
  const missing = validation.missingContext || [];
  if (missing.includes("homepage_url_blocked") || missing.includes("exact_article_url_missing")) return "blocked";
  if (!validation.ready) return "needs_more_context";
  if (writingExam.passed) return "ready";
  if (Object.values(rooms).some((room) => room.status === "needs_more_context")) return "needs_more_context";
  return "needs_review";
}

function normalizeSourceStoryForOriginalWriter(story = {}) {
  return {
    ...story,
    title: cleanText(story.title || story.headline || story.liveNewsHeadline || ""),
    headline: cleanText(story.headline || story.title || story.liveNewsHeadline || ""),
    sourceSummary: cleanText(story.sourceSummary || story.rawSummary || story.rssDescription || ""),
    originalPublisherTitle: cleanText(story.originalPublisherTitle || story.publisherTitle || story.sourceTitle || ""),
    primarySourceName: cleanText(story.primarySourceName || story.sourceName || story.source || story.publisher || ""),
    originalSourceUrl: cleanText(story.originalSourceUrl || story.sourceUrl || story.link || story.primarySourceUrl || story.sourceBlock?.originalSourceUrl || ""),
    liveNewsUrl: cleanText(story.liveNewsUrl || story.canonicalLiveNewsUrl || story.approvedStoryUrl || story.canonicalUrl || story.exactArticleUrl || ""),
    exactArticleUrl: cleanText(story.exactArticleUrl || story.liveNewsUrl || story.canonicalLiveNewsUrl || story.approvedStoryUrl || story.canonicalUrl || ""),
  };
}

function buildOriginalStoryWritingPackage(story = {}, options = {}) {
  const sourceStory = normalizeSourceStoryForOriginalWriter(story);
  const factMap = buildSourceFactMap(sourceStory);
  const validation = validateFactMap(factMap);
  const rooms = runRooms(sourceStory, options.fields || FIELD_ORDER);
  const title = selectFieldText(sourceStory, rooms, "title");
  const description = selectFieldText(sourceStory, rooms, "description");
  const dek = selectFieldText(sourceStory, rooms, "dek") || description;
  const summary = selectFieldText(sourceStory, rooms, "summary") || description;
  const whyItMatters = selectFieldText(sourceStory, rooms, "whyItMatters");
  const metaTitle = buildMetaTitle(title);
  const metaDescription = buildMetaDescription(description, summary);
  const context = buildContextFromFactMap(factMap);
  const fieldGates = {
    title: buildFieldGate("title", title, context),
    description: buildFieldGate("description", description, context),
    dek: buildFieldGate("dek", dek, context),
    summary: buildFieldGate("summary", summary, context),
    whyItMatters: buildFieldGate("whyItMatters", whyItMatters, context),
    metaTitle: buildFieldGate("metaTitle", metaTitle, context),
    metaDescription: buildFieldGate("metaDescription", metaDescription, context),
  };
  const writingExam = summarizeFieldGates(fieldGates);
  const writingQualityStatus = getWritingQualityStatus(validation, writingExam, rooms);
  const primaryRoom = rooms.description || rooms.title || {};
  const rewriteSession = pickRewriteSession(rooms) || rewriteUntilPass(description, factMap, "description", {
    maxRounds: 0,
    maxCandidatesPerRound: 0,
  });

  return {
    schemaVersion: ORIGINAL_WRITING_PACKAGE_SCHEMA_VERSION,
    title,
    description,
    dek,
    summary,
    whyItMatters,
    metaTitle,
    metaDescription,
    factMap,
    context,
    writerRoom: {
      fields: rooms,
      descriptionRoom: rooms.description,
      titleRoom: rooms.title,
    },
    writingExam,
    fieldGates,
    descriptionCandidates: (rooms.description?.candidates || []).map((candidate, index) => ({
      id: candidate.id,
      label: getDescriptionCandidateLabel(candidate, index),
      text: candidate.text,
      evaluation: {
        passed: candidate.status === "passed",
        exam: candidate.writingExam || {},
        teachers: candidate.teacherChecks || [],
      },
    })),
    teacherChecks: Object.entries(fieldGates).flatMap(([fieldName, gate]) =>
      (gate.teachers || []).map((teacher) => ({ ...teacher, fieldName }))
    ),
    copyRisk: primaryRoom.copyRisk || {},
    rewriteSession,
    writingQualityStatus,
    missingContext: uniqueClean([
      validation.missingContext || [],
      ...Object.values(rooms).flatMap((room) => room.missingContext || []),
    ]),
    blockingReasons: uniqueClean([
      validation.blockingReasons || [],
      writingExam.blockingReasons || [],
      ...Object.values(rooms).flatMap((room) =>
        room.status === "needs_more_context" ? [room.managingEditorReason] : []
      ),
    ]),
    writingMemoryLessonsUsed: [],
  };
}

function applyOriginalWritingPackageToDraft(draft = {}, packageInput = null) {
  const writingPackage = packageInput || buildOriginalStoryWritingPackage(draft);
  const summarySentences = splitSentences(writingPackage.summary || writingPackage.description).slice(0, 3);
  return {
    ...draft,
    headline: writingPackage.title || draft.headline,
    title: writingPackage.title || draft.title || draft.headline,
    description: writingPackage.description || draft.description,
    dek: writingPackage.dek || draft.dek,
    summary: summarySentences.length ? summarySentences : [writingPackage.summary || writingPackage.description].filter(Boolean),
    whyItMatters: writingPackage.whyItMatters || draft.whyItMatters,
    metaTitle: writingPackage.metaTitle || draft.metaTitle,
    metaDescription: writingPackage.metaDescription || draft.metaDescription,
    factMap: writingPackage.factMap,
    writerRoom: writingPackage.writerRoom,
    copyRisk: writingPackage.copyRisk,
    rewriteSession: writingPackage.rewriteSession,
    writingExam: writingPackage.writingExam,
    teacherChecks: writingPackage.teacherChecks,
    writingQualityStatus: writingPackage.writingQualityStatus,
    missingContext: writingPackage.missingContext,
    writingMemoryLessonsUsed: writingPackage.writingMemoryLessonsUsed,
    writingQuality: writingPackage,
  };
}

module.exports = {
  ORIGINAL_WRITING_PACKAGE_SCHEMA_VERSION,
  applyOriginalWritingPackageToDraft,
  buildOriginalStoryWritingPackage,
};
