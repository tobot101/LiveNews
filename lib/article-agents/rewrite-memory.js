const { STORE_PATHS, readJson, writeJson } = require("./store");
const { cleanText, stableHash, tokenize, uniqueBy } = require("./text-utils");
const { detectCopyRisk } = require("./writing-quality");

const REWRITE_MEMORY_SCHEMA_VERSION = "live-news-rewrite-quality-memory-v1";

const ALLOWED_FIELD_NAMES = new Set([
  "title",
  "description",
  "dek",
  "summary",
  "whyItMatters",
  "seoTitle",
  "metaDescription",
  "facebookCaption",
  "instagramCaption",
  "homepageCard",
]);

const FIELD_ALIASES = {
  caption: "facebookCaption",
  card: "homepageCard",
  deck: "dek",
  facebook: "facebookCaption",
  headline: "title",
  homepage: "homepageCard",
  instagram: "instagramCaption",
  meta_description: "metaDescription",
  metadescription: "metaDescription",
  metatitle: "seoTitle",
  seo: "metaDescription",
  seodescription: "metaDescription",
  seotitle: "seoTitle",
  subheadline: "dek",
};

const UNSAFE_KEY_PATTERNS = [
  /^(user(name)?|handle|profile|profileUrl|personalProfile)$/i,
  /^(privateMessage|directMessage|dm|inboxMessage)$/i,
  /^(commentText|publicComment|publicComments|comments|copiedComment|creatorLanguage)$/i,
  /^(fullSourceArticleText|sourceArticleText|fullArticleText|sourceBody|bodyHtml|rawArticleText)$/i,
  /^(token|accessToken|adminToken|railwayToken|metaToken|clientSecret|privateSecret)$/i,
];

const UNSAFE_TEXT_PATTERNS = [
  { id: "private_message", pattern: /\b(private message|direct message|dm\b|inbox message|messaged me|texted me)\b/i },
  { id: "personal_profile", pattern: /\b(user profile|personal profile|profile link|personal account|username|handle)\b/i },
  { id: "copied_comment_text", pattern: /\b(commenter said|comment said|comments said|a user said|reddit user said|facebook user said|instagram user said|fans are saying|internet reacts)\b/i },
  { id: "copied_creator_language", pattern: /\b(copied creator|creator caption|influencer caption|viral caption|use their wording)\b/i },
  { id: "unsupported_comment_fact", pattern: /\b(from comments|based on comments|people in the comments|comment section claims)\b/i },
  { id: "private_admin_url", pattern: /\b\/admin\/|\btoken=|\baccess_token=|\badmin_token\b/i },
  { id: "real_secret_or_token", pattern: /\b(bearer\s+[a-z0-9._-]+|railway[_ -]?token|meta[_ -]?token|access[_ -]?token|private[_ -]?secret|client[_ -]?secret)\b/i },
];

const USERNAME_PATTERN = /(^|\s)@[a-z0-9_.-]{2,}/gi;

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

function normalizeFieldName(fieldName) {
  const raw = cleanText(fieldName);
  if (ALLOWED_FIELD_NAMES.has(raw)) return raw;
  const compact = raw.replace(/[^a-z0-9_]+/gi, "").toLowerCase();
  return FIELD_ALIASES[compact] || "description";
}

function normalizeCategory(category) {
  return cleanText(category || "Top") || "Top";
}

function normalizeTeacherNames(value) {
  return uniqueClean(value)
    .map((teacherName) => teacherName.replace(/[^a-z0-9_ -]/gi, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeShape(value, fallback = "confirmed_event_plain_language") {
  const text = cleanText(value)
    .replace(/[^a-z0-9_ -]/gi, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
  return text || fallback;
}

function redactUnsafeText(value) {
  return cleanText(value)
    .replace(USERNAME_PATTERN, " [redacted-handle]")
    .replace(/\bhttps?:\/\/[^\s]*\/admin\/[^\s]*/gi, "[redacted-admin-url]")
    .replace(/\b(access_token|token|admin_token)=\S+/gi, "$1=[redacted]");
}

function truncate(value, maxLength = 360) {
  const text = redactUnsafeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
}

function getRecordStorePath(options = {}) {
  return options.storePath || STORE_PATHS.rewriteQualityMemory;
}

function readRewriteMemoryStore(options = {}) {
  const store = readJson(getRecordStorePath(options), {
    schemaVersion: REWRITE_MEMORY_SCHEMA_VERSION,
    updatedAt: null,
    records: [],
  });
  return {
    schemaVersion: REWRITE_MEMORY_SCHEMA_VERSION,
    updatedAt: store.updatedAt || null,
    records: Array.isArray(store.records) ? store.records : [],
  };
}

function writeRewriteMemoryStore(store, options = {}) {
  writeJson(getRecordStorePath(options), {
    schemaVersion: REWRITE_MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    records: Array.isArray(store.records) ? store.records : [],
  });
}

function objectEntriesDeep(value, prefix = "") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return [[path, entry], ...objectEntriesDeep(entry, path)];
    }
    return [[path, entry]];
  });
}

function unsafeKeys(input = {}) {
  return objectEntriesDeep(input)
    .map(([key]) => key)
    .filter((key) => UNSAFE_KEY_PATTERNS.some((pattern) => pattern.test(key.split(".").pop() || key)));
}

function unsafeTextReasons(fieldName, value) {
  const text = cleanText(Array.isArray(value) ? value.join(" ") : value);
  if (!text) return [];
  return UNSAFE_TEXT_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => `${fieldName}:${entry.id}`);
}

function sourceTextIsLikelyFullArticle(input = {}) {
  const sourceLikeEntries = objectEntriesDeep(input)
    .filter(([key]) => /(full.*article|source.*article|article.*text|source.*body|bodyhtml|rawarticle)/i.test(key))
    .map(([key, value]) => [key, cleanText(value)]);
  return sourceLikeEntries
    .filter(([, value]) => value.length >= 280 || value.split(/\n\s*\n/).length >= 2)
    .map(([key]) => `${key}:full_source_article_text_blocked`);
}

function publisherTextCandidates(input = {}) {
  return uniqueClean([
    input.publisherText,
    input.originalPublisherTitle,
    input.sourceText,
    input.sourceSummary,
    input.originalSourceText,
  ]);
}

function rejectUnsafeRewriteMemory(input = {}) {
  const reasons = [];
  for (const key of unsafeKeys(input)) {
    reasons.push(`${key}:unsafe_field`);
  }
  const inspectTextFields = new Set([
    "weakOutput",
    "approvedOutput",
    "weakOutputShape",
    "approvedOutputShape",
    "editorReason",
    "lesson",
    "rewriteStrategyUsed",
  ]);
  for (const [key, value] of objectEntriesDeep(input)) {
    const leafKey = key.split(".").pop();
    if (!inspectTextFields.has(leafKey)) continue;
    if (typeof value === "string" || Array.isArray(value)) {
      reasons.push(...unsafeTextReasons(key, value));
    }
  }
  reasons.push(...sourceTextIsLikelyFullArticle(input));

  const approvedOutput = cleanText(input.approvedOutput || input.finalCandidate || "");
  for (const publisherText of publisherTextCandidates(input)) {
    if (!approvedOutput || !publisherText) continue;
    const copyRisk = detectCopyRisk(approvedOutput, publisherText);
    if (copyRisk.blocking) {
      reasons.push("approvedOutput:publisher_wording_too_close");
      break;
    }
  }
  if (!cleanText(input.storyId)) reasons.push("storyId:missing");
  if (!normalizeTeacherNames(input.failedTeacherNames).length) reasons.push("failedTeacherNames:missing");

  return {
    rejected: reasons.length > 0,
    reasons: uniqueClean(reasons),
  };
}

function inferWeakOutputShape(input = {}) {
  const provided = normalizeShape(input.weakOutputShape, "");
  if (provided) return provided;
  const failedTeachers = normalizeTeacherNames(input.failedTeacherNames).join(" ").toLowerCase();
  const weakOutput = cleanText(input.weakOutput || input.originalCandidate || "").toLowerCase();
  if (failedTeachers.includes("copyrisk") || /source|publisher|copied/.test(weakOutput)) return "source_like_copy_risk";
  if (failedTeachers.includes("fallback") || /this article discusses|latest update|full report/.test(weakOutput)) return "fallback_template";
  if (failedTeachers.includes("storyfocus")) return "unfocused_article_situation";
  if (failedTeachers.includes("descriptionspecificity")) return "generic_low_specificity";
  if (failedTeachers.includes("humanclarity")) return "unclear_or_robotic_sentence";
  return "failed_public_writing_candidate";
}

function inferApprovedOutputShape(input = {}) {
  const provided = normalizeShape(input.approvedOutputShape, "");
  if (provided) return provided;
  const fieldName = normalizeFieldName(input.fieldName);
  const strategy = normalizeShape(input.rewriteStrategyUsed, "");
  const category = normalizeCategory(input.category).toLowerCase();
  if (strategy.includes("fact_map")) return "fact_map_event_plus_context";
  if (fieldName === "facebookCaption" || fieldName === "instagramCaption") return "source_safe_caption_with_exact_link";
  if (fieldName === "whyItMatters") return "specific_reader_impact";
  if (fieldName === "seoTitle" || fieldName === "metaDescription") return "search_intent_plus_story_context";
  if (category.includes("sport")) return "specific_matchup_or_event_context";
  if (category.includes("entertain")) return "confirmed_person_project_event";
  if (category.includes("local")) return "location_plus_resident_context";
  return "specific_event_plus_context";
}

function copyRiskNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (value && typeof value === "object") {
    if (typeof value.severity === "number" && Number.isFinite(value.severity)) return Math.round(value.severity);
    if (typeof value.score === "number" && Number.isFinite(value.score)) {
      return Math.round(100 - value.score);
    }
    const risk = cleanText(value.risk).toLowerCase();
    if (risk === "blocked") return 100;
    if (risk === "high") return 80;
    if (risk === "medium") return 45;
    if (risk === "low") return 10;
  }
  const risk = cleanText(value).toLowerCase();
  if (risk === "blocked") return 100;
  if (risk === "high") return 80;
  if (risk === "medium") return 45;
  if (risk === "low") return 10;
  return 0;
}

function summarizeRewriteLesson(input = {}) {
  const fieldName = normalizeFieldName(input.fieldName);
  const teachers = normalizeTeacherNames(input.failedTeacherNames).join(" ");
  const strategy = normalizeShape(input.rewriteStrategyUsed, "");
  const reason = cleanText(input.editorReason).toLowerCase();

  if (/CopyRiskTeacher/.test(teachers) || strategy.includes("fact_map")) {
    return "When CopyRiskTeacher fails, rebuild from confirmed facts instead of rearranging the source sentence.";
  }
  if (/StoryFocusTeacher/.test(teachers)) {
    return "When StoryFocusTeacher fails, name the subject and the source-backed event in the first sentence.";
  }
  if (/FallbackDependencyTeacher|DescriptionSpecificityTeacher/.test(teachers) || reason.includes("generic")) {
    return "When description sounds generic, use a concrete event-plus-context shape.";
  }
  if (fieldName === "facebookCaption" || fieldName === "instagramCaption") {
    return "When social caption is blocked, keep exact URL and source attribution while changing structure.";
  }
  if (/HumanClarityTeacher|RhythmCadenceTeacher/.test(teachers)) {
    return "When clarity or rhythm fails, use shorter plain-English sentences with one source-backed detail per sentence.";
  }
  if (/ContextFaithfulnessTeacher/.test(teachers)) {
    return "When faithfulness fails, remove unsupported claims and write only from confirmed facts.";
  }
  return "When a rewrite fails, use the fact map, change structure, and keep only confirmed source-backed details.";
}

function sanitizeRewriteMemoryRecord(input = {}) {
  const rejection = rejectUnsafeRewriteMemory(input);
  if (rejection.rejected) {
    return {
      ok: false,
      rejected: true,
      reasons: rejection.reasons,
      record: null,
    };
  }

  const storyId = cleanText(input.storyId);
  const category = normalizeCategory(input.category);
  const fieldName = normalizeFieldName(input.fieldName);
  const failedTeacherNames = normalizeTeacherNames(input.failedTeacherNames);
  const weakOutputShape = inferWeakOutputShape(input);
  const approvedOutputShape = inferApprovedOutputShape(input);
  const rewriteStrategyUsed = normalizeShape(input.rewriteStrategyUsed, "fact_map_rewrite");
  const lesson = truncate(input.lesson || summarizeRewriteLesson({ ...input, fieldName, category }), 320);
  const editorReason = truncate(input.editorReason || "Editor approved a safer, more original rewrite.", 320);
  const beforeScore = Math.round(Number(input.beforeScore || input.writingScoreBefore || 0));
  const afterScore = Math.round(Number(input.afterScore || input.writingScoreAfter || 0));
  const copyRiskBefore = copyRiskNumber(input.copyRiskBefore);
  const copyRiskAfter = copyRiskNumber(input.copyRiskAfter);
  const createdAt = cleanText(input.createdAt || new Date().toISOString());
  const id = cleanText(input.id) ||
    `rewrite-memory-${stableHash([storyId, fieldName, failedTeacherNames.join(","), rewriteStrategyUsed, createdAt].join("|"), 16)}`;

  return {
    ok: true,
    rejected: false,
    reasons: [],
    record: {
      id,
      storyId,
      category,
      fieldName,
      failedTeacherNames,
      weakOutputShape,
      approvedOutputShape,
      editorReason,
      lesson,
      rewriteStrategyUsed,
      beforeScore,
      afterScore,
      copyRiskBefore,
      copyRiskAfter,
      createdAt,
    },
  };
}

function recordApprovedRewriteLesson(input = {}, options = {}) {
  const sanitized = sanitizeRewriteMemoryRecord(input);
  if (!sanitized.ok) return sanitized;

  const store = readRewriteMemoryStore(options);
  const records = [
    sanitized.record,
    ...(store.records || []).filter((record) => record.id !== sanitized.record.id),
  ].slice(0, Number(options.limit || 500));
  writeRewriteMemoryStore({ ...store, records }, options);
  return {
    ok: true,
    rejected: false,
    reasons: [],
    record: sanitized.record,
    store: {
      schemaVersion: REWRITE_MEMORY_SCHEMA_VERSION,
      count: records.length,
    },
  };
}

function latest(records, options = {}) {
  return records
    .slice()
    .sort((left, right) => cleanText(right.createdAt).localeCompare(cleanText(left.createdAt)))
    .slice(0, Number(options.limit || 20));
}

function getRewriteLessonsForCategory(category, options = {}) {
  const requested = normalizeCategory(category).toLowerCase();
  return latest(
    readRewriteMemoryStore(options).records.filter((record) => cleanText(record.category).toLowerCase() === requested),
    options
  );
}

function getRewriteLessonsForField(fieldName, options = {}) {
  const requested = normalizeFieldName(fieldName);
  return latest(
    readRewriteMemoryStore(options).records.filter((record) => record.fieldName === requested),
    options
  );
}

function getRewriteLessonsForTeacherFailure(failedTeacherNames, options = {}) {
  const requested = new Set(normalizeTeacherNames(failedTeacherNames));
  if (!requested.size) return [];
  return latest(
    readRewriteMemoryStore(options).records.filter((record) =>
      (record.failedTeacherNames || []).some((teacherName) => requested.has(teacherName))
    ),
    options
  );
}

function getRewriteLessonsForCopyRisk(copyRiskType = "copy_risk", options = {}) {
  const requested = cleanText(copyRiskType).toLowerCase();
  return latest(
    readRewriteMemoryStore(options).records.filter((record) => {
      const teacherMatch = (record.failedTeacherNames || []).includes("CopyRiskTeacher");
      const riskImproved = Number(record.copyRiskBefore || 0) > Number(record.copyRiskAfter || 0);
      const strategyMatch = cleanText(record.rewriteStrategyUsed).toLowerCase().includes("fact_map");
      if (requested === "copy_risk") return teacherMatch || riskImproved || strategyMatch;
      if (["blocked", "high", "medium", "low"].includes(requested)) {
        const thresholds = { blocked: 90, high: 65, medium: 35, low: 0 };
        return teacherMatch && Number(record.copyRiskBefore || 0) >= thresholds[requested];
      }
      return teacherMatch || cleanText(record.lesson).toLowerCase().includes(requested);
    }),
    options
  );
}

function lessonFingerprints(records = []) {
  return new Set(records.map((record) => cleanText(record.id || record.lesson).toLowerCase()).filter(Boolean));
}

function collectRewriteLessons({ category, fieldName, failedTeacherNames, copyRiskType } = {}, options = {}) {
  const collected = [
    ...getRewriteLessonsForCategory(category, options),
    ...getRewriteLessonsForField(fieldName, options),
    ...getRewriteLessonsForTeacherFailure(failedTeacherNames, options),
    ...(copyRiskType ? getRewriteLessonsForCopyRisk(copyRiskType, options) : []),
  ];
  const seen = lessonFingerprints([]);
  return collected.filter((record) => {
    const key = cleanText(record.id || record.lesson).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Number(options.limit || 12));
}

module.exports = {
  REWRITE_MEMORY_SCHEMA_VERSION,
  collectRewriteLessons,
  getRewriteLessonsForCategory,
  getRewriteLessonsForCopyRisk,
  getRewriteLessonsForField,
  getRewriteLessonsForTeacherFailure,
  readRewriteMemoryStore,
  recordApprovedRewriteLesson,
  rejectUnsafeRewriteMemory,
  sanitizeRewriteMemoryRecord,
  summarizeRewriteLesson,
};
