const { STORE_PATHS, readJson, writeJson } = require("./store");
const { cleanText, stableHash, uniqueBy } = require("./text-utils");
const { detectCopyRisk } = require("./writing-quality");

const WRITING_MEMORY_SCHEMA_VERSION = "live-news-writing-quality-memory-v1";

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
  headline: "title",
  subheadline: "dek",
  deck: "dek",
  seotitle: "seoTitle",
  metatitle: "seoTitle",
  seo_title: "seoTitle",
  meta_description: "metaDescription",
  seodescription: "metaDescription",
  facebook: "facebookCaption",
  instagram: "instagramCaption",
  card: "homepageCard",
  homepage: "homepageCard",
};

const UNSAFE_PATTERNS = [
  { id: "username_or_handle", pattern: /(^|\s)@[a-z0-9_.-]{2,}/i, blocking: true },
  { id: "private_message", pattern: /\b(private message|direct message|dm\b|inbox message|messaged me|texted me)\b/i, blocking: true },
  { id: "personal_profile", pattern: /\b(user profile|personal profile|profile link|personal account|username|handle)\b/i, blocking: true },
  { id: "copied_comment_text", pattern: /\b(commenter said|comment said|comments said|a user said|reddit user said|facebook user said|instagram user said|fans are saying|internet reacts)\b/i, blocking: true },
  { id: "copied_creator_language", pattern: /\b(copied creator|creator caption|influencer caption|viral caption|use their wording)\b/i, blocking: true },
  { id: "unsupported_comment_fact", pattern: /\b(from comments|based on comments|people in the comments|comment section claims)\b/i, blocking: true },
  { id: "private_admin_url", pattern: /\b\/admin\/|\btoken=|\baccess_token=|\badmin_token\b/i, blocking: true },
  { id: "real_secret_or_token", pattern: /\b(bearer\s+[a-z0-9._-]+|railway[_ -]?token|meta[_ -]?token|access[_ -]?token|private[_ -]?secret|client[_ -]?secret)\b/i, blocking: true },
];

function normalizeFieldName(fieldName) {
  const raw = cleanText(fieldName);
  if (ALLOWED_FIELD_NAMES.has(raw)) return raw;
  const compact = raw.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return FIELD_ALIASES[compact] || "description";
}

function normalizeCategory(category) {
  return cleanText(category || "Top") || "Top";
}

function truncate(value, maxLength = 800) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
}

function uniqueClean(values) {
  return uniqueBy(
    (Array.isArray(values) ? values : [values])
      .map(cleanText)
      .filter(Boolean),
    (value) => value.toLowerCase()
  );
}

function getRecordStorePath(options = {}) {
  return options.storePath || STORE_PATHS.writingQualityMemory;
}

function readWritingMemoryStore(options = {}) {
  const store = readJson(getRecordStorePath(options), {
    schemaVersion: WRITING_MEMORY_SCHEMA_VERSION,
    updatedAt: null,
    records: [],
  });
  return {
    schemaVersion: WRITING_MEMORY_SCHEMA_VERSION,
    updatedAt: store.updatedAt || null,
    records: Array.isArray(store.records) ? store.records : [],
  };
}

function writeWritingMemoryStore(store, options = {}) {
  writeJson(getRecordStorePath(options), {
    schemaVersion: WRITING_MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    records: Array.isArray(store.records) ? store.records : [],
  });
}

function inspectUnsafeText(value) {
  const text = cleanText(value);
  if (!text) return [];
  return UNSAFE_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.id);
}

function rejectUnsafeWritingMemory(input = {}) {
  const reasons = [];
  const checkedFields = [
    "weakOutput",
    "approvedOutput",
    "editorReason",
    "lesson",
    "writingShape",
    "sourceSafetyNotes",
  ];

  for (const fieldName of checkedFields) {
    const value = Array.isArray(input[fieldName]) ? input[fieldName].join(" ") : input[fieldName];
    for (const reason of inspectUnsafeText(value)) {
      reasons.push(`${fieldName}:${reason}`);
    }
  }

  const publisherText = cleanText(
    input.publisherText || input.originalPublisherTitle || input.sourceText || input.originalSourceText || ""
  );
  if (publisherText && cleanText(input.approvedOutput)) {
    const copyRisk = detectCopyRisk(input.approvedOutput, publisherText);
    if (copyRisk.blocking) reasons.push("approvedOutput:publisher_wording_too_close");
  }

  if (!cleanText(input.storyId)) reasons.push("storyId:missing");
  if (!cleanText(input.approvedOutput)) reasons.push("approvedOutput:missing");
  if (!cleanText(input.weakOutput)) reasons.push("weakOutput:missing");

  return {
    rejected: reasons.length > 0,
    reasons: uniqueClean(reasons),
  };
}

function inferWritingShape(input = {}) {
  const provided = cleanText(input.writingShape);
  if (provided) return provided.replace(/[^a-z0-9_ -]/gi, "").replace(/\s+/g, "_").toLowerCase();

  const category = normalizeCategory(input.category).toLowerCase();
  const fieldName = normalizeFieldName(input.fieldName);
  const approved = cleanText(input.approvedOutput).toLowerCase();

  if (category.includes("sport")) return "matchup_or_event_significance";
  if (category.includes("entertain")) return "person_or_group_plus_action";
  if (category.includes("local")) return "specific_event_plus_place_context";
  if (category.includes("business")) return "company_action_plus_reader_impact";
  if (category.includes("tech") || category.includes("technology")) return "product_or_platform_plus_user_context";
  if (fieldName === "seoTitle" || fieldName === "metaDescription") return "search_intent_plus_source_safe_context";
  if (fieldName === "facebookCaption" || fieldName === "instagramCaption") return "platform_caption_plus_exact_story_link";
  if (/\b(after|over|amid|during)\b/.test(approved)) return "specific_event_plus_context";
  return "confirmed_event_plain_language";
}

function summarizeWritingLesson(input = {}) {
  const category = normalizeCategory(input.category).toLowerCase();
  const fieldName = normalizeFieldName(input.fieldName);
  const reason = cleanText(input.editorReason).toLowerCase();

  if (category.includes("sport")) {
    return "For sports matchups, name the teams or players and explain why the matchup mattered when that detail is source-backed.";
  }
  if (category.includes("legal") || category.includes("lawsuit") || reason.includes("legal") || reason.includes("lawsuit")) {
    return "For legal stories, avoid dramatic language and focus on the confirmed filing, ruling, charge, or court action.";
  }
  if (category.includes("entertain")) {
    return "For entertainment stories, lead with the confirmed event or person involved instead of vague reaction language.";
  }
  if (category.includes("local") || reason.includes("location") || reason.includes("place")) {
    return "For local stories, include the location when it is source-backed and explain the resident impact without guessing.";
  }
  if (category.includes("business")) {
    return "For business stories, connect the confirmed company action to workers, consumers, markets, or costs when source-backed.";
  }
  if (category.includes("tech") || category.includes("technology")) {
    return "For tech stories, name the product, platform, or tool and explain the confirmed user impact in plain language.";
  }
  if (fieldName === "title") {
    return "For titles, lead with the confirmed action and avoid generic labels or hype.";
  }
  if (fieldName === "whyItMatters") {
    return "For why-it-matters text, explain the specific reader impact only when the article gives enough support.";
  }
  if (fieldName === "facebookCaption" || fieldName === "instagramCaption") {
    return "For social captions, open with one confirmed human-readable detail and keep the source-safe angle clear.";
  }
  if (fieldName === "seoTitle" || fieldName === "metaDescription") {
    return "For SEO fields, match likely reader search intent while staying faithful to the confirmed article context.";
  }
  return "For descriptions and summaries, replace vague filler with one confirmed detail that explains what happened and why it matters.";
}

function sanitizeWritingMemoryRecord(input = {}) {
  const rejection = rejectUnsafeWritingMemory(input);
  if (rejection.rejected) {
    return {
      ok: false,
      rejected: true,
      reasons: rejection.reasons,
      record: null,
    };
  }

  const fieldName = normalizeFieldName(input.fieldName);
  const approvedOutput = truncate(input.approvedOutput);
  const weakOutput = truncate(input.weakOutput);
  const category = normalizeCategory(input.category);
  const lesson = truncate(input.lesson || summarizeWritingLesson({ ...input, fieldName, category }), 360);
  const writingShape = inferWritingShape({ ...input, fieldName, category });
  const sourceSafetyNotes = uniqueClean([
    input.sourceSafetyNotes || [],
    "Lesson is based on editor-approved writing only.",
    "Do not copy publisher wording or public comments.",
  ]).slice(0, 8);

  const createdAt = input.createdAt || new Date().toISOString();
  const storyId = cleanText(input.storyId);
  const id = cleanText(input.id) || `writing-memory-${stableHash([storyId, fieldName, approvedOutput, createdAt].join("|"), 16)}`;

  return {
    ok: true,
    rejected: false,
    reasons: [],
    record: {
      id,
      storyId,
      category,
      fieldName,
      weakOutput,
      approvedOutput,
      editorReason: truncate(input.editorReason || "Editor approved a stronger Live News wording.", 360),
      lesson,
      writingShape,
      sourceSafetyNotes,
      createdAt,
    },
  };
}

function recordApprovedWritingEdit(input = {}, options = {}) {
  const sanitized = sanitizeWritingMemoryRecord(input);
  if (!sanitized.ok) return sanitized;

  const store = readWritingMemoryStore(options);
  const existing = store.records || [];
  const records = [
    sanitized.record,
    ...existing.filter((record) => record.id !== sanitized.record.id),
  ].slice(0, Number(options.limit || 500));

  writeWritingMemoryStore({ ...store, records }, options);
  return {
    ok: true,
    rejected: false,
    reasons: [],
    record: sanitized.record,
    store: {
      schemaVersion: WRITING_MEMORY_SCHEMA_VERSION,
      count: records.length,
    },
  };
}

function getWritingLessonsForCategory(category, options = {}) {
  const requested = normalizeCategory(category).toLowerCase();
  const limit = Number(options.limit || 20);
  return readWritingMemoryStore(options)
    .records
    .filter((record) => record.category.toLowerCase() === requested)
    .slice(0, limit);
}

function getWritingLessonsForField(fieldName, options = {}) {
  const requested = normalizeFieldName(fieldName);
  const limit = Number(options.limit || 20);
  return readWritingMemoryStore(options)
    .records
    .filter((record) => record.fieldName === requested)
    .slice(0, limit);
}

module.exports = {
  WRITING_MEMORY_SCHEMA_VERSION,
  getWritingLessonsForCategory,
  getWritingLessonsForField,
  readWritingMemoryStore,
  recordApprovedWritingEdit,
  rejectUnsafeWritingMemory,
  sanitizeWritingMemoryRecord,
  summarizeWritingLesson,
};
