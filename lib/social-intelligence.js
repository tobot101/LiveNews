const { cleanText, stableHash, tokenize, uniqueBy } = require("./article-agents/text-utils");
const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const { buildInstagramCardPlan } = require("./social-card-generator");
const {
  buildArticleWritingContext,
  detectFallbackRisk,
  evaluateWritingCandidate,
  getWritingRulesForField,
  loadWritingStyleGuide,
} = require("./article-agents/writing-quality");
const {
  getWritingLessonsForCategory,
  getWritingLessonsForField,
} = require("./article-agents/writing-memory");

const SOCIAL_STYLE_MEMORY_SCHEMA_VERSION = "live-news-social-style-memory-v1";
const AUDIENCE_PATTERNS_SCHEMA_VERSION = "live-news-audience-patterns-v1";

const SOCIAL_TEACHER_STACK = [
  {
    id: "source_safety_teacher",
    name: "Source Safety Teacher",
    purpose: "Keeps captions tied to source-linked Live News data and blocks homepage-only links.",
  },
  {
    id: "human_relevance_teacher",
    name: "Human Relevance Teacher",
    purpose: "Checks that each draft has a clear audience angle without inventing emotion or facts.",
  },
  {
    id: "sensitive_news_teacher",
    name: "Sensitive News Teacher",
    purpose: "Requires review for sensitive topics without treating ordinary stories as public safety.",
  },
  {
    id: "rhythm_variety_teacher",
    name: "Rhythm Variety Teacher",
    purpose: "Prevents every social post from starting or sounding the same.",
  },
  {
    id: "platform_fit_teacher",
    name: "Platform Fit Teacher",
    purpose: "Checks that social cards and captions are shaped for Instagram and Facebook review.",
  },
  {
    id: "visual_readiness_teacher",
    name: "Visual Readiness Teacher",
    purpose: "Blocks Instagram publishing until a durable image or rendered social card exists.",
  },
  {
    id: "growth_memory_teacher",
    name: "Growth Memory Teacher",
    purpose: "Makes sure future learning uses aggregate performance patterns, not personal data.",
  },
  {
    id: "human_approval_teacher",
    name: "Human Approval Teacher",
    purpose: "Blocks automatic publishing until the editor approves the story and social package.",
  },
];

const DEFAULT_SOCIAL_STYLE_MEMORY = {
  schemaVersion: SOCIAL_STYLE_MEMORY_SCHEMA_VERSION,
  mode: "aggregate_safe_learning_only",
  updatedAt: null,
  autoPostAllowed: false,
  protectedRules: [
    "Never publish without a human-approved exact Live News article URL.",
    "Never copy publisher wording, random comments, or private user information.",
    "Never add facts that are missing from Live News story data, source metadata, or approved source research.",
    "Never optimize for anger, panic, jealousy, or cheap engagement.",
    "Use social patterns as structure only; never copy another creator, publisher, commenter, or account voice.",
  ],
  publicPatternPrinciples: [
    "Lead with one clear reason the story matters before adding the link.",
    "Use a small number of relevant topic hashtags instead of broad tag stuffing.",
    "Prefer exact article clicks, shares, saves, and clean discussion over likes alone.",
    "Keep captions source-linked, factual, and human-readable before trying a stronger hook.",
    "Treat public comments as aggregate confusion or interest signals only, never as source facts.",
  ],
  approvedLearningSignals: [
    "reach",
    "views",
    "likes",
    "comments_count",
    "shares",
    "saves",
    "link_clicks",
    "profile_visits",
    "follows",
    "hides",
    "reports",
    "posting_time",
    "category",
    "caption_shape",
    "media_shape",
    "writing_shape",
    "public_interest_score",
    "trusted_public_source",
    "exact_article_clicks",
    "selected_variant",
  ],
  blockedLearningSignals: [
    "private messages",
    "personal profiles",
    "individual user identities",
    "private contact details",
    "copied public comments",
  ],
  captionShapeMemory: [],
  recentCaptionSignatures: [],
  performanceLessons: [],
  editorLessons: [],
};

const CATEGORY_PROFILES = {
  local: {
    style: "place-first and resident-focused",
    primaryQuestions: ["Which place is affected?", "What should residents know first?"],
    preferredShapes: ["Local Impact", "Breaking Clarity"],
  },
  national: {
    style: "public-impact and accountability-focused",
    primaryQuestions: ["What changed?", "Who is affected nationally?"],
    preferredShapes: ["Breaking Clarity", "Explainer Hook"],
  },
  international: {
    style: "country, conflict, policy, and global-impact focused",
    primaryQuestions: ["Which country or group is affected?", "Could the impact widen?"],
    preferredShapes: ["Breaking Clarity", "Watchlist"],
  },
  world: {
    style: "country, conflict, policy, and global-impact focused",
    primaryQuestions: ["Which country or group is affected?", "Could the impact widen?"],
    preferredShapes: ["Breaking Clarity", "Watchlist"],
  },
  business: {
    style: "company, market, workers, consumers, and money focused",
    primaryQuestions: ["Which company or market is affected?", "Who pays, gains, or loses?"],
    preferredShapes: ["Explainer Hook", "Human Stakes"],
  },
  tech: {
    style: "product, platform, users, privacy, and tools focused",
    primaryQuestions: ["What changes for users?", "Is privacy, access, or tooling affected?"],
    preferredShapes: ["Explainer Hook", "Watchlist"],
  },
  technology: {
    style: "product, platform, users, privacy, and tools focused",
    primaryQuestions: ["What changes for users?", "Is privacy, access, or tooling affected?"],
    preferredShapes: ["Explainer Hook", "Watchlist"],
  },
  sports: {
    style: "team, result, player, injury, and next-game focused",
    primaryQuestions: ["Which player or team is affected?", "What changes for the season or next game?"],
    preferredShapes: ["Human Stakes", "Breaking Clarity"],
  },
  entertainment: {
    style: "release, person, audience, and event focused",
    primaryQuestions: ["Who is involved?", "What changed for fans or audiences?"],
    preferredShapes: ["Human Stakes", "Explainer Hook"],
  },
  top: {
    style: "fast clarity with clear public relevance",
    primaryQuestions: ["What happened?", "Why does this matter now?"],
    preferredShapes: ["Breaking Clarity", "Human Stakes"],
  },
};

const HIGH_RISK_PATTERN_IDS = new Set([
  "public_safety",
  "health_and_care",
  "rights_and_law",
  "global_conflict",
  "family_and_children",
  "trust_and_misinformation",
]);

const PUBLIC_SAFETY_EXPLICIT_CATEGORIES = [
  "public_safety",
  "emergency",
  "alert",
  "weather_alert",
  "evacuation",
  "road_closure",
  "missing_person",
  "recall",
  "health_warning",
  "disaster",
  "official_advisory",
];

const PUBLIC_SAFETY_EXPLICIT_TERMS = [
  "evacuation order",
  "shelter in place",
  "boil water notice",
  "road closure",
  "public advisory",
  "emergency alert",
  "officials warned",
  "official warning",
  "recall notice",
  "safety advisory",
  "missing person",
  "active alert",
];

const SENSITIVE_REVIEW_RULES = [
  { id: "crime", label: "crime", pattern: /\b(crime|shooting|stabbing|assault|arrested|police|suspect)\b/i },
  { id: "death", label: "death", pattern: /\b(dead|death|died|killed|fatal|dies)\b/i },
  { id: "injury", label: "injury", pattern: /\b(injured|injury|hospitalized|wounded)\b/i },
  { id: "lawsuit", label: "lawsuit", pattern: /\b(lawsuit|sued|settlement|legal claim)\b/i },
  { id: "minors", label: "children or minors", pattern: /\b(child|children|minor|student|school)\b/i },
  { id: "legal_allegation", label: "legal allegation", pattern: /\b(alleged|allegation|charged|indicted|trial|court|judge|sentence)\b/i },
  { id: "politics", label: "politics", pattern: /\b(president|white house|congress|senate|governor|mayor|election|campaign)\b/i },
  { id: "health_claim", label: "medical or health claim", pattern: /\b(health|medical|doctor|patient|disease|cancer|medicine|vaccine|drug)\b/i },
  { id: "disaster", label: "disaster", pattern: /\b(disaster|wildfire|earthquake|hurricane|flood|tornado)\b/i },
  { id: "active_advisory", label: "active alert or advisory", pattern: /\b(emergency alert|public advisory|official warning|officials warned|active alert|evacuation order)\b/i },
];

const VAGUE_OR_MANIPULATIVE_PHRASES = [
  "you won't believe",
  "shocking truth",
  "must see",
  "the internet is furious",
  "everyone is talking about",
  "readers may want",
  "the wider value is",
  "what comes next depends",
  "the core question is",
  "the focus stays on",
];

const OPERATIONAL_DRAFT_PHRASES = [
  "review-only",
  "source packet",
  "draft packet",
  "teacher layer",
  "private dashboard",
  "api test",
  "held for editor review",
  "before publication",
  "posting stays paused",
  "public posting",
  "final page can stay accurate",
  "the key reader value is clarity",
  "where the sourcing comes from",
  "what remains unconfirmed",
  "draft is built",
];

const SOCIAL_TITLE_PREFIXES = [
  /^why\s+/i,
  /^what to know about\s+/i,
  /^latest context on\s+/i,
  /^new details around\s+/i,
  /^live news tracks\s+/i,
];

const SOCIAL_TITLE_SUFFIXES = [
  /\s+matters now$/i,
];

const SOCIAL_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "amid",
  "among",
  "and",
  "are",
  "because",
  "before",
  "being",
  "from",
  "have",
  "into",
  "latest",
  "live",
  "news",
  "over",
  "says",
  "that",
  "the",
  "their",
  "this",
  "through",
  "under",
  "update",
  "updates",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
]);

const CATEGORY_HASHTAGS = {
  local: ["#LocalNews"],
  national: ["#USNews"],
  international: ["#WorldNews"],
  world: ["#WorldNews"],
  business: ["#BusinessNews"],
  tech: ["#TechNews"],
  technology: ["#TechNews"],
  sports: ["#SportsNews"],
  entertainment: ["#EntertainmentNews"],
  top: ["#TopStories"],
};

const KEYWORD_HASHTAGS = [
  { tag: "#WNBA", pattern: /\bwnba\b|caitlin clark|paige bueckers|wings|fever/i },
  { tag: "#NBA", pattern: /\bnba\b/i },
  { tag: "#NFL", pattern: /\bnfl\b/i },
  { tag: "#MLB", pattern: /\bmlb\b|braves|baseball/i },
  { tag: "#Tennis", pattern: /\btennis\b|french open|alcaraz|wimbledon/i },
  { tag: "#AI", pattern: /\bai\b|artificial intelligence|openai|chatgpt/i },
  { tag: "#Cybersecurity", pattern: /\bcyber|hack|breach|spyware|security\b/i },
  {
    tag: "#PublicSafety",
    pattern: /\bpublic advisory|emergency alert|official warning|officials warned|evacuation order|road closure|recall notice|missing person|active alert\b/i,
    requiresPublicSafety: true,
  },
  { tag: "#Politics", pattern: /\bpresident|white house|congress|senate|governor|mayor|election\b/i },
  { tag: "#Courts", pattern: /\bcourt|judge|lawsuit|trial|ruling|charged|sentence\b/i },
  { tag: "#Health", pattern: /\bhealth|hospital|doctor|patient|disease|cancer|medicine\b/i },
  { tag: "#Markets", pattern: /\bmarket|stock|shares|profit|inflation|tariff|prices\b/i },
  { tag: "#Climate", pattern: /\bclimate|weather|wildfire|emissions|pollution|environment\b/i },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCategory(category) {
  const normalized = cleanText(category).toLowerCase();
  if (normalized === "technology") return "tech";
  if (normalized === "international") return "international";
  if (normalized === "world") return "world";
  return normalized || "top";
}

function sentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function truncateWords(value, maxWords) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function firstWords(value, count = 5) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function contextTags(context = {}) {
  return [
    ...(Array.isArray(context.tags) ? context.tags : []),
    ...(Array.isArray(context.topicTags) ? context.topicTags : []),
    ...(Array.isArray(context.labels) ? context.labels : []),
  ].map((tag) => cleanText(tag).toLowerCase()).filter(Boolean);
}

function contextBodyText(context = {}) {
  return [
    context.title,
    context.originalTitle,
    context.dek,
    context.summary,
    context.rawSummary,
    context.whyItMatters,
    ...(Array.isArray(context.keyPoints) ? context.keyPoints : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isPublicSafetyRelevant(context = {}) {
  if (context.publicSafetyRelevant === true) return true;

  const category = String(context.category || "").toLowerCase();
  const tags = contextTags(context);
  const text = contextBodyText(context);

  if (PUBLIC_SAFETY_EXPLICIT_CATEGORIES.includes(category)) return true;
  if (tags.some((tag) => PUBLIC_SAFETY_EXPLICIT_CATEGORIES.includes(tag))) return true;
  if (hasSupportedExplicitPublicSafetyTerm(text)) return true;

  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSupportedExplicitPublicSafetyTerm(text) {
  return PUBLIC_SAFETY_EXPLICIT_TERMS.some((term) => {
    if (!text.includes(term)) return false;
    const negated = new RegExp(`\\b(no|not|without|does not include|no active|no official)\\b[^.]{0,60}${escapeRegExp(term)}`, "i");
    return !negated.test(text);
  });
}

function hasActivePublicSafetyAlert(context = {}) {
  const text = contextBodyText(context);
  return hasSupportedExplicitPublicSafetyTerm(text);
}

function buildSensitiveReview(context = {}) {
  const text = contextBodyText(context);
  const matched = SENSITIVE_REVIEW_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => ({ id: rule.id, label: rule.label }));
  const publicSafetyRelevant = isPublicSafetyRelevant(context);
  const activePublicSafetyAlert = publicSafetyRelevant && hasActivePublicSafetyAlert(context);
  if (activePublicSafetyAlert && !matched.some((rule) => rule.id === "active_advisory")) {
    matched.push({ id: "active_advisory", label: "active alert or advisory" });
  }
  return {
    requiresReview: matched.length > 0 || activePublicSafetyAlert,
    matchedRules: matched,
    publicSafetyRelevant,
    activePublicSafetyAlert,
  };
}

function hasOperationalDraftLanguage(value) {
  const lowered = cleanText(value).toLowerCase();
  return OPERATIONAL_DRAFT_PHRASES.some((phrase) => lowered.includes(phrase));
}

function normalizeSocialTitle(value) {
  let title = cleanText(value);
  for (const prefix of SOCIAL_TITLE_PREFIXES) title = title.replace(prefix, "");
  for (const suffix of SOCIAL_TITLE_SUFFIXES) title = title.replace(suffix, "");
  return cleanText(title);
}

function titleWords(value) {
  return cleanText(value)
    .match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g)
    ?.filter((word) => {
      const normalized = word.toLowerCase().replace(/[’']/g, "");
      return word.length > 2 && !SOCIAL_STOPWORDS.has(normalized);
    }) || [];
}

function titleCaseWord(word) {
  if (/^[A-Z0-9]{2,}$/.test(word)) return word;
  if (/^[a-z]{1,3}$/i.test(word)) return word.toLowerCase();
  return `${word[0].toUpperCase()}${word.slice(1)}`;
}

function buildReadableFocus(value) {
  const words = titleWords(value).slice(0, 10);
  return cleanText(words.map(titleCaseWord).join(" "));
}

function isGenericLiveNewsHeadline(value) {
  const title = cleanText(value);
  return SOCIAL_TITLE_PREFIXES.some((prefix) => prefix.test(title)) ||
    SOCIAL_TITLE_SUFFIXES.some((suffix) => suffix.test(title));
}

function hasApprovedLiveNewsWriting(core = {}) {
  return Boolean(
    cleanText(core.approvedDescription) ||
      cleanText(core.whyItMatters) ||
      cleanText(core.writingQualityStatus) === "ready" ||
      core.writingExam?.passed === true
  );
}

function buildSocialHeadline(core) {
  const liveTitle = normalizeSocialTitle(core.title);
  const originalTitle = normalizeSocialTitle(core.originalTitle);
  if (!hasApprovedLiveNewsWriting(core) && isGenericLiveNewsHeadline(core.title) && originalTitle) {
    return buildReadableFocus(originalTitle) || liveTitle || originalTitle;
  }
  return liveTitle || buildReadableFocus(originalTitle) || "Live News story";
}

function isUsefulSocialDetail(value, title = "") {
  const detail = cleanText(value);
  if (!detail || detail.length < 32) return false;
  if (hasOperationalDraftLanguage(detail)) return false;
  const normalizedDetail = firstWords(detail, 10);
  const normalizedTitle = firstWords(title, 10);
  if (normalizedDetail && normalizedTitle && normalizedDetail === normalizedTitle) return false;
  if (/read the original source for the full report/i.test(detail)) return false;
  return true;
}

function pickUsefulDetail(core, socialHeadline) {
  const candidates = [
    core.approvedDescription,
    core.summary,
    core.dek,
    ...(Array.isArray(core.keyPoints) ? core.keyPoints : []),
    core.whyItMatters,
    core.rawSummary,
  ];
  return candidates.map(cleanText).find((candidate) => isUsefulSocialDetail(candidate, socialHeadline)) || "";
}

function getSocialWritingLessons(core = {}) {
  const provided = Array.isArray(core.writingMemoryLessonsUsed) ? core.writingMemoryLessonsUsed : [];
  const categoryLessons = safeGetWritingLessons(() => getWritingLessonsForCategory(core.category, { limit: 4 }));
  const facebookLessons = safeGetWritingLessons(() => getWritingLessonsForField("facebookCaption", { limit: 3 }));
  const instagramLessons = safeGetWritingLessons(() => getWritingLessonsForField("instagramCaption", { limit: 3 }));
  return uniqueBy(
    [...provided, ...categoryLessons, ...facebookLessons, ...instagramLessons]
      .map((lesson) => typeof lesson === "string" ? { lesson } : lesson)
      .filter((lesson) => cleanText(lesson.lesson || lesson.guidance || lesson.approvedOutput)),
    (lesson) => cleanText(lesson.id || lesson.lesson || lesson.guidance || lesson.approvedOutput).toLowerCase()
  ).slice(0, 8);
}

function safeGetWritingLessons(reader) {
  try {
    return reader() || [];
  } catch {
    return [];
  }
}

function buildSocialWritingStory(core = {}) {
  const exactArticleUrl = cleanText(core.linkState?.exactArticleUrl || core.exactArticleUrl || "");
  return {
    storyId: cleanText(core.storyId || core.id || ""),
    liveNewsStoryId: cleanText(core.storyId || core.id || ""),
    exactArticleUrl,
    approvedStoryUrl: exactArticleUrl,
    liveNewsUrl: exactArticleUrl,
    canonicalUrl: exactArticleUrl,
    title: cleanText(core.title),
    headline: cleanText(core.title),
    liveNewsHeadline: cleanText(core.title),
    originalPublisherTitle: cleanText(core.originalTitle),
    sourceName: cleanText(core.source),
    sourceUrl: cleanText(core.sourceUrl),
    link: cleanText(core.sourceUrl),
    category: cleanText(core.category),
    tags: Array.isArray(core.tags) ? core.tags : [],
    liveNewsSummary: cleanText(core.summary),
    summaryShort: cleanText(core.summary),
    summary: cleanText(core.rawSummary || core.summary),
    sourceSummary: cleanText(core.rawSummary),
    liveNewsDek: cleanText(core.dek),
    dek: cleanText(core.dek),
    liveNewsWhyItMatters: cleanText(core.whyItMatters),
    whyItMatters: cleanText(core.whyItMatters),
    keyPoints: Array.isArray(core.keyPoints) ? core.keyPoints : [],
    liveNewsKeyPoints: Array.isArray(core.keyPoints) ? core.keyPoints : [],
    publicSafetyRelevant: core.publicSafetyRelevant === true,
    writingExam: core.writingExam || null,
    writingQualityStatus: cleanText(core.writingQualityStatus),
  };
}

function buildSocialWritingContext(core = {}) {
  const context = buildArticleWritingContext(buildSocialWritingStory(core));
  const styleGuide = loadWritingStyleGuide();
  const rules = getWritingRulesForField("socialCaption", context.category);
  const writingLessons = getSocialWritingLessons(core);
  return {
    ...context,
    styleGuideVersion: styleGuide.schemaVersion || "live-news-writing-style-v1",
    socialWritingRules: rules,
    writingMemoryLessons: writingLessons.map((lesson) => ({
      id: cleanText(lesson.id || lesson.lessonId || ""),
      category: cleanText(lesson.category || ""),
      fieldName: cleanText(lesson.fieldName || ""),
      lesson: cleanText(lesson.lesson || lesson.guidance || ""),
      writingShape: cleanText(lesson.writingShape || lesson.captionShape || ""),
    })),
  };
}

function stripSocialBoilerplateForWriting(value, exactArticleUrl = "") {
  const exact = cleanText(exactArticleUrl);
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => !/^live news$/i.test(line))
    .filter((line) => !/^live news\s*[•-]/i.test(line))
    .filter((line) => !/^top story(?: of the day| of the week)?$/i.test(line))
    .filter((line) => !/^latest coverage$/i.test(line))
    .filter((line) => !/^[^•]+ • [^•]+ • [A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/i.test(line))
    .filter((line) => !/^source:/i.test(line))
    .filter((line) => !/^read(?: the live news page)?:/i.test(line))
    .filter((line) => !/^article page:/i.test(line))
    .filter((line) => !/^#/.test(line))
    .map((line) => exact ? line.replace(exact, "") : line)
    .map((line) => line.replace(/https?:\/\/\S+/gi, "").replace(/#[A-Za-z0-9_]+/g, " "))
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function normalizeTeacherId(name) {
  return cleanText(name)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function buildSocialWritingQuality({ text, context, fieldName, exactArticleUrl }) {
  const evaluationText = stripSocialBoilerplateForWriting(text, exactArticleUrl);
  const evaluation = evaluateWritingCandidate(evaluationText || text, context, fieldName);
  const publisherTitle = cleanText(context.originalPublisherTitle || "");
  const directPublisherTitleCopy = Boolean(
    publisherTitle &&
      publisherTitle.split(/\s+/).filter(Boolean).length >= 4 &&
      cleanText(evaluationText || text).toLowerCase().includes(publisherTitle.toLowerCase())
  );
  const writingExam = directPublisherTitleCopy
    ? {
        ...evaluation.exam,
        passed: false,
        blockingReasons: Array.from(new Set([
          ...(evaluation.exam.blockingReasons || []),
          "Copied publisher headline wording is blocked.",
        ])),
      }
    : evaluation.exam;
  const writingTeachers = evaluation.teachers.map((teacher) => {
    if (directPublisherTitleCopy && teacher.name === "CopyRiskTeacher") {
      return {
        ...teacher,
        passed: false,
        score: Math.min(teacher.score, 35),
        reason: "Candidate repeats the original publisher headline too closely.",
        blocking: true,
      };
    }
    return teacher;
  });
  const passed = evaluation.passed && !directPublisherTitleCopy;
  const teacherChecks = [
    {
      id: "writing_quality_gate",
      name: "Writing Quality Gate",
      passed,
      score: writingExam.total,
      message: passed
        ? `Writing quality passed with score ${writingExam.total}.`
        : `Writing quality blocked: ${writingExam.blockingReasons.slice(0, 2).join(" ")}`,
      blocking: !passed,
    },
    ...writingTeachers.map((teacher) => ({
      id: `writing_${normalizeTeacherId(teacher.name)}`,
      name: teacher.name,
      passed: teacher.passed,
      score: teacher.score,
      message: teacher.reason,
      blocking: teacher.blocking,
    })),
  ];
  return {
    writingExam,
    writingTeacherChecks: writingTeachers,
    writingQualityStatus: passed ? "ready" : "blocked",
    writingQualityText: evaluationText || cleanText(text),
    teacherChecks,
  };
}

function tokenOverlapRatio(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let hits = 0;
  for (const token of bTokens) {
    if (aTokens.has(token)) hits += 1;
  }
  return hits / bTokens.size;
}

function shouldAddTitleAfterContext(context, title) {
  if (!cleanText(context) || !cleanText(title)) return false;
  if (context === title) return false;
  return tokenOverlapRatio(context, title) < 0.45;
}

function buildTitleBackedContext(core, socialHeadline, audiencePlan = {}, writingContext = {}) {
  const text = [core.originalTitle, core.title, core.summary, core.rawSummary].map(cleanText).join(" ");
  const category = normalizeCategory(core.category);
  if (category === "sports" && /\bwnba\b|caitlin clark|paige bueckers|wings|fever/i.test(text)) {
    return "The WNBA matchup brings Paige Bueckers, Caitlin Clark, the Wings, and the Fever into the same conversation.";
  }
  const mainEvent = cleanText(writingContext.mainEvent || socialHeadline);
  const why = cleanText(core.whyItMatters || writingContext.whyItMatters || writingContext.readerAngle || "");
  if (why && isUsefulSocialDetail(why, socialHeadline)) {
    return `${sentence(mainEvent)} ${sentence(truncateWords(why, 20))}`;
  }
  return sentence(mainEvent || socialHeadline);
}

function buildHashtag(value) {
  const words = titleWords(value).slice(0, 3);
  if (!words.length) return "";
  const tag = words.map((word) => titleCaseWord(word).replace(/[^A-Za-z0-9]/g, "")).join("");
  return tag.length >= 3 && tag.length <= 28 ? `#${tag}` : "";
}

function buildTopicHashtags(core, audiencePlan = {}, limit = 5) {
  const publicSafetyRelevant = isPublicSafetyRelevant({
    ...core,
    publicSafetyRelevant: audiencePlan.publicSafetyRelevant || core.publicSafetyRelevant,
  });
  const text = [core.originalTitle, core.title, core.summary, core.rawSummary, core.category, ...(core.tags || [])]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const category = normalizeCategory(core.category);
  const tags = ["#LiveNews", ...(CATEGORY_HASHTAGS[category] || CATEGORY_HASHTAGS.top)];
  for (const entry of KEYWORD_HASHTAGS) {
    if (entry.requiresPublicSafety && !publicSafetyRelevant) continue;
    if (entry.pattern.test(text)) tags.push(entry.tag);
  }
  for (const pattern of audiencePlan.matchedPatterns || []) {
    if (pattern.id === "reader_clarity") continue;
    if (pattern.id === "public_safety" && !publicSafetyRelevant) continue;
    const tag = buildHashtag(pattern.label || pattern.id);
    if (tag) tags.push(tag);
  }
  return Array.from(new Set(tags)).slice(0, limit);
}

function facebookLinkLine(linkState) {
  return linkState?.shareableNow
    ? `Read the Live News page: ${linkState.exactArticleUrl}`
    : "Live News article page is pending editor approval.";
}

function instagramLinkLine(linkState) {
  return linkState?.shareableNow
    ? `Read the Live News page: ${linkState.exactArticleUrl}`
    : "Article page: pending editor approval";
}

function readSocialStyleMemory() {
  const memory = readJson(STORE_PATHS.socialStyleMemory, DEFAULT_SOCIAL_STYLE_MEMORY);
  return {
    ...clone(DEFAULT_SOCIAL_STYLE_MEMORY),
    ...memory,
    schemaVersion: SOCIAL_STYLE_MEMORY_SCHEMA_VERSION,
  };
}

function saveSocialStyleMemory(memory) {
  writeJson(STORE_PATHS.socialStyleMemory, {
    ...clone(DEFAULT_SOCIAL_STYLE_MEMORY),
    ...memory,
    schemaVersion: SOCIAL_STYLE_MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  });
}

function readAudiencePatternStore() {
  return readJson(STORE_PATHS.audiencePatterns, {
    schemaVersion: AUDIENCE_PATTERNS_SCHEMA_VERSION,
    patterns: [],
  });
}

function getCategoryProfile(category) {
  const normalized = normalizeCategory(category);
  return CATEGORY_PROFILES[normalized] || CATEGORY_PROFILES.top;
}

function getStoryText(item) {
  return [
    item?.liveNewsHeadline,
    item?.title,
    item?.liveNewsSummary,
    item?.summaryShort,
    item?.summary,
    item?.category,
    item?.sourceName,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function scoreAudiencePattern(pattern, item) {
  const text = getStoryText(item).toLowerCase();
  const category = normalizeCategory(item?.category);
  const patternCategories = (pattern.categories || []).map(normalizeCategory);
  let score = 0;
  let matched = false;
  if (pattern.id === "public_safety") {
    if (!isPublicSafetyRelevant(item)) return 0;
    score += Number(pattern.priority || 0) + 42;
    matched = true;
  }
  if (patternCategories.includes(category)) {
    score += Number(pattern.priority || 0) + 24;
    matched = true;
  }
  const tokenSet = new Set(tokenize(text));
  for (const keyword of pattern.keywords || []) {
    const cleanKeyword = cleanText(keyword).toLowerCase();
    if (!cleanKeyword) continue;
    if (cleanKeyword.includes(" ")) {
      if (text.includes(cleanKeyword)) {
        score += 14;
        matched = true;
      }
    } else if (tokenSet.has(cleanKeyword)) {
      score += 10;
      matched = true;
    }
  }
  return matched ? score : 0;
}

function hasAnyPattern(patterns, ids) {
  const idSet = new Set(ids);
  return (patterns || []).some((pattern) => idSet.has(pattern.id));
}

function textMatchesAny(context, patterns) {
  const text = contextBodyText(context);
  return patterns.some((pattern) => pattern.test(text));
}

function chooseReaderAngle(context = {}, patterns = []) {
  const category = normalizeCategory(context.category);
  if (isPublicSafetyRelevant(context)) {
    return {
      id: "public_safety_usefulness",
      label: "public safety usefulness",
      humanQuestions: ["What alert, advisory, closure, recall, or warning is active?", "Who needs the practical update?"],
      score: 100,
    };
  }
  if (
    hasAnyPattern(patterns, ["jobs_and_workers", "consumer_impact", "health_and_care", "family_and_children"]) ||
    textMatchesAny(context, [/\b(residents|workers|families|patients|students|customers|consumers|voters|drivers|fans)\b/i])
  ) {
    return {
      id: "human_impact",
      label: "human impact",
      humanQuestions: ["Who is affected?", "What changes for people directly involved?"],
      score: 88,
    };
  }
  if (category === "local" || hasAnyPattern(patterns, ["local_residents", "housing_and_cost_of_living"])) {
    return {
      id: "local_relevance",
      label: "local relevance",
      humanQuestions: ["Which place is affected?", "What should people nearby know?"],
      score: 84,
    };
  }
  if (
    category === "sports" ||
    hasAnyPattern(patterns, ["sports_result_stakes"]) ||
    textMatchesAny(context, [/\b(matchup|game|season|coach|player|team|title|draft|playoff|tournament)\b/i])
  ) {
    return {
      id: "matchup_significance",
      label: "matchup significance",
      humanQuestions: ["Which player or team is affected?", "What changes for the matchup or season?"],
      score: 82,
    };
  }
  if (textMatchesAny(context, [/\b(approved|announced|reported|released|launched|filed|voted|signed|agreed|confirmed|updated)\b/i])) {
    return {
      id: "new_development",
      label: "new development",
      humanQuestions: ["What changed?", "What happens next if the source data says so?"],
      score: 78,
    };
  }
  if (
    hasAnyPattern(patterns, ["money_and_prices", "rights_and_law", "government_accountability", "technology_users"]) ||
    textMatchesAny(context, [/\b(why|how|policy|rule|court|market|prices|users|platform|privacy|cost)\b/i])
  ) {
    return {
      id: "explainer_value",
      label: "explainer value",
      humanQuestions: ["What does the change mean?", "Who needs the plain-language context?"],
      score: 74,
    };
  }
  if (cleanText(context.source || context.sourceName || "")) {
    return {
      id: "source_backed_curiosity",
      label: "source-backed curiosity",
      humanQuestions: ["What is known from the source?", "Why is the story worth opening now?"],
      score: 70,
    };
  }
  return {
    id: "straight_summary",
    label: "straight summary",
    humanQuestions: ["What happened?", "What is the cleanest source-backed summary?"],
    score: 60,
  };
}

function selectAudiencePatterns(item, limit = 3) {
  const store = readAudiencePatternStore();
  return (store.patterns || [])
    .map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      priority: pattern.priority,
      humanQuestions: pattern.humanQuestions || [],
      score: scoreAudiencePattern(pattern, item),
    }))
    .filter((pattern) => pattern.score > 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function choosePostShape(category, placement, patterns) {
  const profile = getCategoryProfile(category);
  if (placement === "top_story_of_the_day" || placement === "top_story_of_the_week") return "Breaking Clarity";
  if (patterns.some((pattern) => pattern.id === "local_residents")) return "Local Impact";
  if (patterns.some((pattern) => HIGH_RISK_PATTERN_IDS.has(pattern.id))) return "Watchlist";
  return profile.preferredShapes[0] || "Breaking Clarity";
}

function chooseEmotionalRegister(patterns, category) {
  const ids = new Set(patterns.map((pattern) => pattern.id));
  if ([...ids].some((id) => HIGH_RISK_PATTERN_IDS.has(id))) return "calm, careful, source-first";
  if (ids.has("money_and_prices") || ids.has("consumer_impact")) return "practical and useful";
  if (ids.has("sports_result_stakes")) return "clear, energetic, not hype-driven";
  if (normalizeCategory(category) === "entertainment") return "curious and audience-aware";
  return "clear, steady, and low-clutter";
}

function buildSocialAudiencePlan(item, options = {}) {
  const category = normalizeCategory(item?.category);
  const patterns = selectAudiencePatterns(item, 4);
  const profile = getCategoryProfile(category);
  const context = {
    title: item?.liveNewsHeadline || item?.title,
    originalTitle: item?.originalPublisherTitle || item?.title,
    dek: item?.liveNewsDek || item?.dek,
    summary: item?.liveNewsSummary || item?.summaryShort || item?.summary,
    rawSummary: item?.sourceSummary || item?.description,
    whyItMatters: item?.liveNewsWhyItMatters || item?.whyItMatters,
    keyPoints: item?.liveNewsKeyPoints || item?.keyPoints || [],
    category,
    tags: item?.tags || item?.topicTags || item?.topicSuggestions || [],
    publicSafetyRelevant: item?.publicSafetyRelevant === true,
    source: item?.sourceName || item?.source || item?.primarySourceName,
    trendTopicName: item?.trendTopicName || item?.trendSelection?.topicName,
    trendWhySelected: item?.trendWhySelected || item?.trendSelection?.whySelected,
  };
  const publicSafetyRelevant = isPublicSafetyRelevant(context);
  const sensitiveReview = buildSensitiveReview({
    ...context,
    publicSafetyRelevant,
  });
  const primary = chooseReaderAngle({
    ...context,
    publicSafetyRelevant,
  }, patterns);
  const readerQuestions = [
    ...(primary.humanQuestions || []),
    ...(profile.primaryQuestions || []),
  ].filter(Boolean).slice(0, 4);
  return {
    schemaVersion: "live-news-social-audience-plan-v1",
    generatedFrom: "source_data_and_safe_aggregate_patterns",
    category,
    placement: options.placement || "social",
    categoryStyle: profile.style,
    postShape: choosePostShape(category, options.placement, patterns),
    emotionalRegister: chooseEmotionalRegister(patterns, category),
    readerAngle: primary,
    primaryHumanAngle: primary.label,
    publicSafetyRelevant,
    publicSafetyReviewRequired: Boolean(publicSafetyRelevant && sensitiveReview.activePublicSafetyAlert),
    sensitiveReview,
    matchedPatterns: patterns,
    readerQuestions,
    communicationRules: [
      "Lead with what is known.",
      "Use clear attribution language.",
      "Keep emotion proportional to verified facts.",
      "Invite the exact Live News article page, not the homepage.",
    ],
    forbiddenMoves: [
      "No copied publisher wording.",
      "No copied public comments.",
      "No invented public reaction.",
      "No engagement bait.",
    ],
  };
}

function uniqueVariantList(variants) {
  const seen = new Set();
  return variants.filter((variant) => {
    const text = variant.text || variant.message || variant.caption || "";
    const signature = firstWords(text, 6) || stableHash(text, 8);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function buildVariantTeacherChecks({ text, exactArticleUrl, source, safetyFlags, imagePlan, platform }) {
  const caption = cleanText(text);
  const publicSafetyRelevant = safetyFlags?.publicSafetyRelevant === true;
  const checks = [
    {
      id: "exact_story_link",
      passed: Boolean(exactArticleUrl && /\/stories\/[^/]+/i.test(exactArticleUrl)),
    },
    {
      id: "source_attribution",
      passed: Boolean(cleanText(source)),
    },
    {
      id: "internal_language",
      passed: !hasOperationalDraftLanguage(caption),
    },
    {
      id: "public_safety_conditional",
      passed: publicSafetyRelevant || !/(#PublicSafety|\bpublic safety\b|\bstay safe\b)/i.test(caption),
    },
  ];
  if (platform === "instagram") {
    checks.push({
      id: "instagram_media_ready",
      passed: imagePlan?.renderStatus === "ready",
      message: imagePlan?.renderStatus === "ready"
        ? "A durable image/card URL is ready for Instagram."
        : `Instagram needs ${cleanText((imagePlan?.missing || []).join(", ")) || "a rendered card image"}.`,
    });
  }
  return checks;
}

function checksPass(checks = []) {
  return checks.every((check) => check.passed);
}

function buildSocialCaptionVariants(core, audiencePlan = {}, memory = DEFAULT_SOCIAL_STYLE_MEMORY) {
  const publicSafetyRelevant = isPublicSafetyRelevant({
    ...core,
    publicSafetyRelevant: audiencePlan.publicSafetyRelevant || core.publicSafetyRelevant,
  });
  const writingContext = buildSocialWritingContext({
    ...core,
    publicSafetyRelevant,
  });
  const safetyFlags = {
    publicSafetyRelevant,
    activePublicSafetyAlert: publicSafetyRelevant && hasActivePublicSafetyAlert(core),
    publicSafetyReviewRequired: Boolean(audiencePlan.publicSafetyReviewRequired),
    sensitiveReviewRequired: Boolean(audiencePlan.sensitiveReview?.requiresReview),
  };
  const socialHeadline = truncateWords(buildSocialHeadline(core), 22);
  const title = sentence(socialHeadline);
  const usefulDetail = pickUsefulDetail(core, socialHeadline);
  const summary = usefulDetail ? sentence(truncateWords(usefulDetail, 38)) : "";
  const fallbackContext = sentence(truncateWords(buildTitleBackedContext(core, socialHeadline, audiencePlan, writingContext), 34));
  const context = detectFallbackRisk(summary).risky
    ? fallbackContext
    : summary || fallbackContext;
  const titleAddsContext = shouldAddTitleAfterContext(context, title);
  const source = cleanText(core.source || "the original source");
  const sourceLine = `Source: ${source}.`;
  const igLinkLine = instagramLinkLine(core.linkState);
  const fbLinkLine = facebookLinkLine(core.linkState);
  const label = cleanText(core.placementLabel || "Live News Coverage");
  const categoryLine = `${cleanText(core.source || "Original source")} • ${cleanText(core.category || "Top")} • ${cleanText(core.publishedDate || "Date unavailable")}`;
  const approvedMemory = memory?.protectedRules?.length ? memory : DEFAULT_SOCIAL_STYLE_MEMORY;
  const hashtagList = buildTopicHashtags({ ...core, publicSafetyRelevant }, audiencePlan, 5);
  const facebookHashtagList = buildTopicHashtags({ ...core, publicSafetyRelevant }, audiencePlan, 4);
  const hashtags = hashtagList.join(" ");
  const facebookHashtags = facebookHashtagList.join(" ");
  const exactArticleUrl = cleanText(core.linkState?.exactArticleUrl || "");
  const sourceAttribution = source;
  const writingMemoryLessonsUsed = writingContext.writingMemoryLessons || [];
  const baseCardPlan = buildInstagramCardPlan({
    title: socialHeadline,
    summary: context,
    sourceLabel: sourceAttribution,
    exactArticleUrl,
    imageUrl: core.imageUrl,
    thumbnailUrl: core.thumbnailUrl,
    generatedCardUrl: core.generatedCardUrl,
  });
  const basePublishable = Boolean(core.linkState?.shareableNow && exactArticleUrl);
  const facebookVariant = ({ id, label: variantLabel, captionShape, lead, body }) => {
    const lines = [lead, body, fbLinkLine, facebookHashtags].filter(Boolean);
    const message = lines.join("\n\n");
    const platformTeacherChecks = buildVariantTeacherChecks({
      text: message,
      exactArticleUrl,
      source: sourceAttribution,
      safetyFlags,
      platform: "facebook",
    });
    const writingQuality = buildSocialWritingQuality({
      text: [socialHeadline, lead, body].filter(Boolean).join(" "),
      context: writingContext,
      fieldName: "facebookCaption",
      exactArticleUrl,
    });
    const teacherChecks = [...platformTeacherChecks, ...writingQuality.teacherChecks];
    return {
      id,
      label: variantLabel,
      title,
      message,
      description: context,
      exactArticleUrl,
      sourceAttribution,
      hashtags: facebookHashtagList,
      captionShape,
      safetyFlags,
      teacherChecks,
      writingExam: writingQuality.writingExam,
      writingTeacherChecks: writingQuality.writingTeacherChecks,
      writingQualityStatus: writingQuality.writingQualityStatus,
      writingQualityText: writingQuality.writingQualityText,
      writingMemoryLessonsUsed,
      publishable: basePublishable && checksPass(teacherChecks),
      shape: captionShape,
      text: message,
    };
  };
  const instagramVariant = ({ id, label: variantLabel, captionShape, shortTitle, captionLines, cardTitle, cardSubtitle }) => {
    const caption = captionLines.filter(Boolean).join("\n");
    const imagePlan = buildInstagramCardPlan({
      ...baseCardPlan,
      cardTitle,
      shortTitle,
      cardSubtitle,
      sourceLabel: sourceAttribution,
      exactArticleUrl,
      imageUrl: core.imageUrl,
      thumbnailUrl: core.thumbnailUrl,
      generatedCardUrl: core.generatedCardUrl,
      altText: `${shortTitle}. Live News coverage with attribution to ${sourceAttribution}.`,
    });
    const platformTeacherChecks = buildVariantTeacherChecks({
      text: caption,
      exactArticleUrl,
      source: sourceAttribution,
      safetyFlags,
      imagePlan,
      platform: "instagram",
    });
    const writingQuality = buildSocialWritingQuality({
      text: [cardTitle, caption].filter(Boolean).join("\n"),
      context: writingContext,
      fieldName: "instagramCaption",
      exactArticleUrl,
    });
    const teacherChecks = [...platformTeacherChecks, ...writingQuality.teacherChecks];
    return {
      id,
      label: variantLabel,
      shortTitle,
      caption,
      cardTitle,
      cardSubtitle,
      altText: `${shortTitle}. Live News coverage with attribution to ${sourceAttribution}.`,
      storyText: `${shortTitle} ${cardSubtitle}`.trim(),
      renderStatus: imagePlan.renderStatus,
      carouselSlides: [
        { title: shortTitle, text: cardSubtitle },
        { title: "Source", text: `Coverage led by ${sourceAttribution}.` },
        { title: "Read more", text: exactArticleUrl ? "Open the exact Live News story page." : "Live News page pending editor approval." },
      ],
      hashtags: hashtagList,
      imagePlan,
      exactArticleUrl,
      sourceAttribution,
      captionShape,
      safetyFlags,
      teacherChecks,
      writingExam: writingQuality.writingExam,
      writingTeacherChecks: writingQuality.writingTeacherChecks,
      writingQualityStatus: writingQuality.writingQualityStatus,
      writingQualityText: writingQuality.writingQualityText,
      writingMemoryLessonsUsed,
      publishable: basePublishable && imagePlan.renderStatus === "ready" && checksPass(teacherChecks),
      shape: captionShape,
      text: caption,
    };
  };

  const instagram = uniqueVariantList([
    instagramVariant({
      id: "visualHook",
      label: "Visual hook",
      captionShape: "visual_hook",
      shortTitle: truncateWords(socialHeadline, 10),
      cardTitle: truncateWords(socialHeadline, 10),
      cardSubtitle: truncateWords(context, 16),
      captionLines: [
        "LIVE NEWS",
        label,
        "",
        context,
        titleAddsContext ? title : "",
        "",
        `Source: ${source}.`,
        igLinkLine,
        hashtags,
      ],
    }),
    instagramVariant({
      id: "readerImpact",
      label: "Reader impact",
      captionShape: "reader_impact",
      shortTitle: truncateWords(socialHeadline, 9),
      cardTitle: truncateWords(socialHeadline, 9),
      cardSubtitle: truncateWords(context, 15),
      captionLines: [
        context,
        titleAddsContext ? title : "",
        "",
        `LIVE NEWS • ${audiencePlan.postShape || label}`,
        categoryLine,
        igLinkLine,
        hashtags,
      ],
    }),
    instagramVariant({
      id: "shortNews",
      label: "Short news",
      captionShape: "short_news",
      shortTitle: truncateWords(socialHeadline, 8),
      cardTitle: truncateWords(socialHeadline, 8),
      cardSubtitle: truncateWords(sourceLine, 12),
      captionLines: [
        title,
        titleAddsContext ? context : "",
        "",
        `LIVE NEWS • ${label}`,
        sourceLine,
        igLinkLine,
        hashtags,
      ],
    }),
  ]);

  const facebook = uniqueVariantList([
    facebookVariant({
      id: "sourceFirst",
      label: "Source first",
      captionShape: "source_first",
      lead: `${sourceLine} ${title}`,
      body: cleanText(context).toLowerCase() !== cleanText(title).toLowerCase() ? context : "",
    }),
    facebookVariant({
      id: "readerImpact",
      label: "Reader impact",
      captionShape: "reader_impact",
      lead: context,
      body: titleAddsContext ? title : sourceLine,
    }),
    facebookVariant({
      id: "conciseNews",
      label: "Concise news",
      captionShape: "concise_news",
      lead: title,
      body: cleanText(context).toLowerCase() !== cleanText(title).toLowerCase() ? context : `${categoryLine}.`,
    }),
  ]);

  return {
    schemaVersion: "live-news-social-caption-variants-v1",
    generatedFrom: "approved_story_context_and_writing_quality",
    memoryMode: approvedMemory.mode,
    writingStyleGuideVersion: writingContext.styleGuideVersion,
    writingMemoryLessonsUsed,
    instagram: {
      primaryVariantId: instagram[0]?.id || "",
      variants: instagram,
      caption: instagram[0]?.caption || instagram[0]?.text || "",
      imagePlan: instagram[0]?.imagePlan || baseCardPlan,
    },
    facebook: {
      primaryVariantId: facebook[0]?.id || "",
      variants: facebook,
      caption: facebook[0]?.message || facebook[0]?.text || "",
    },
  };
}

function selectSafePerformanceLessons(styleMemory = DEFAULT_SOCIAL_STYLE_MEMORY, category = "") {
  const normalizedCategory = normalizeCategory(category);
  return (styleMemory.performanceLessons || [])
    .filter((lesson) => lesson.safeToUseInDrafting !== false)
    .filter((lesson) => lesson.usesOnlyAggregateMetrics !== false)
    .filter((lesson) => lesson.privateDataExcluded !== false)
    .filter((lesson) => !lesson.category || normalizeCategory(lesson.category) === normalizedCategory)
    .slice(0, 5)
    .map((lesson) => ({
      lessonId: cleanText(lesson.lessonId),
      type: cleanText(lesson.type),
      confidence: cleanText(lesson.confidence),
      category: cleanText(lesson.category),
      platform: cleanText(lesson.platform),
      captionShape: cleanText(lesson.captionShape),
      writingShape: cleanText(lesson.writingShape),
      guidance: cleanText(lesson.lesson),
      copyPolicy: "Use as strategy only. Do not copy lesson wording into public captions.",
    }));
}

function buildSocialLearningHooks(audiencePlan = {}, styleMemory = DEFAULT_SOCIAL_STYLE_MEMORY) {
  const safePerformanceLessons = selectSafePerformanceLessons(styleMemory, audiencePlan.category);
  return {
    schemaVersion: "live-news-social-learning-hooks-v1",
    status: "pending_manual_performance_data",
    personalDataRequired: false,
    learningScope: "aggregate_patterns_only",
    metricsToCapture: clone(DEFAULT_SOCIAL_STYLE_MEMORY.approvedLearningSignals),
    commentPatternCategories: [
      "confusion",
      "correction_request",
      "local_context",
      "usefulness",
      "tone_problem",
      "misinformation_risk",
      "repeated_question",
    ],
    safePerformanceLessons,
    performanceGuidanceMode: "aggregate_strategy_only_do_not_copy_lesson_text",
    memoryUpdateRules: [
      "Store approved lessons as aggregate patterns only.",
      "Do not store usernames, private profile data, or copied comments.",
      "Treat comment counts as aggregate signals only, never as quoted or verified facts.",
      "Prefer exact article clicks, saves, shares, and clean aggregate discussion over likes alone.",
    ],
    nextTeacherPrompt: `Improve future ${audiencePlan.category || "news"} drafts by checking whether the ${audiencePlan.primaryHumanAngle || "reader clarity"} angle helped users reach the exact article page.`,
  };
}

function evaluateCaptionSet(variants) {
  const warnings = [];
  const failures = [];
  const signatures = [];
  for (const variant of variants || []) {
    const text = cleanText(variant.text || variant.message || variant.caption);
    if (!text) failures.push(`${variant.id || "caption"} is empty.`);
    const lowered = text.toLowerCase();
    for (const phrase of VAGUE_OR_MANIPULATIVE_PHRASES) {
      if (lowered.includes(phrase)) failures.push(`${variant.id || "caption"} uses blocked social phrasing: ${phrase}.`);
    }
    for (const phrase of OPERATIONAL_DRAFT_PHRASES) {
      if (lowered.includes(phrase)) failures.push(`${variant.id || "caption"} exposes internal draft language: ${phrase}.`);
    }
    if (lowered.includes("stay safe") && variant.safetyFlags?.publicSafetyRelevant !== true) {
      failures.push(`${variant.id || "caption"} uses public-safety language without source support.`);
    }
    if (lowered.includes("officials urge") && variant.safetyFlags?.publicSafetyRelevant !== true) {
      failures.push(`${variant.id || "caption"} uses official-safety framing without source support.`);
    }
    signatures.push(firstWords(text, 5));
    if (text.length > 2200) warnings.push(`${variant.id || "caption"} may be too long for Instagram comfort.`);
  }
  const repeated = signatures.filter(Boolean).filter((signature, index, list) => list.indexOf(signature) !== index);
  if (repeated.length) failures.push("Caption variants repeat the same opening rhythm.");
  return { failures, warnings };
}

function evaluateSocialTeacherStack(draft) {
  const checks = SOCIAL_TEACHER_STACK.map((teacher) => ({
    ...teacher,
    passed: true,
    failures: [],
    warnings: [],
    strengths: [],
  }));
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));

  if (!draft.originalSourceUrl) byId.source_safety_teacher.failures.push("Original source URL is missing.");
  if (!draft.sourceAttribution) byId.source_safety_teacher.failures.push("Source attribution is missing.");
  if (draft.linkState?.exactArticleUrl && /newsmorenow\.com\/?$/i.test(draft.linkState.exactArticleUrl)) {
    byId.source_safety_teacher.failures.push("Exact article link points to the homepage.");
  }
  if (!draft.linkState?.shareableNow) {
    byId.source_safety_teacher.warnings.push("Exact Live News article page is still pending.");
  } else {
    byId.source_safety_teacher.strengths.push("Exact story URL is available.");
  }

  if (!draft.audiencePlan?.primaryHumanAngle) {
    byId.human_relevance_teacher.failures.push("No audience angle was selected.");
  } else {
    byId.human_relevance_teacher.strengths.push(`Primary angle: ${draft.audiencePlan.primaryHumanAngle}.`);
  }
  if (!draft.audiencePlan?.readerQuestions?.length) {
    byId.human_relevance_teacher.warnings.push("No reader questions were recorded for review.");
  }

  const combinedCaption = [
    draft.platforms?.instagram?.caption,
    draft.platforms?.facebook?.caption,
  ].join(" ");
  const publicSafetyRelevant = draft.audiencePlan?.publicSafetyRelevant === true;
  const sensitiveReview = draft.audiencePlan?.sensitiveReview || {};
  if (!publicSafetyRelevant && /#PublicSafety|\bpublic safety\b|\bstay safe\b/i.test(combinedCaption)) {
    byId.sensitive_news_teacher.failures.push("Public safety framing appeared without explicit source support.");
  }
  if (publicSafetyRelevant) {
    byId.sensitive_news_teacher.strengths.push("Public safety framing is supported by explicit source language.");
  } else {
    byId.sensitive_news_teacher.strengths.push("Public safety was not used as a default angle.");
  }
  if ((sensitiveReview.requiresReview || draft.audiencePlan?.publicSafetyReviewRequired) && draft.reviewStatus !== "needs_human_review") {
    byId.sensitive_news_teacher.failures.push("Sensitive story must remain in human review.");
  }
  if (sensitiveReview.requiresReview && draft.reviewStatus === "needs_human_review") {
    byId.sensitive_news_teacher.strengths.push("Sensitive topic remains held for human review.");
  }

  const instagramCheck = evaluateCaptionSet(draft.platforms?.instagram?.variants || []);
  const facebookCheck = evaluateCaptionSet(draft.platforms?.facebook?.variants || []);
  byId.rhythm_variety_teacher.failures.push(...instagramCheck.failures, ...facebookCheck.failures);
  byId.rhythm_variety_teacher.warnings.push(...instagramCheck.warnings, ...facebookCheck.warnings);
  const totalVariants = (draft.platforms?.instagram?.variants || []).length + (draft.platforms?.facebook?.variants || []).length;
  if (totalVariants < 4) {
    byId.rhythm_variety_teacher.failures.push("At least four caption variants should exist across platforms.");
  } else {
    byId.rhythm_variety_teacher.strengths.push(`${totalVariants} caption variants are available.`);
  }

  const card = draft.platforms?.instagram?.mediaCard || {};
  if (card.width !== 1080 || card.height !== 1080) {
    byId.platform_fit_teacher.warnings.push("Instagram media card is not the expected 1080x1080 square plan.");
  } else {
    byId.platform_fit_teacher.strengths.push("Square social card spec is ready for review.");
  }
  if (!card.title || !card.sourceLine) {
    byId.platform_fit_teacher.failures.push("Media card is missing title or source line.");
  }

  const instagramImagePlan = draft.platforms?.instagram?.imagePlan || {};
  if (instagramImagePlan.renderStatus === "ready") {
    byId.visual_readiness_teacher.strengths.push("Instagram has a durable image/card URL ready.");
  } else {
    byId.visual_readiness_teacher.warnings.push(
      `Instagram publishing stays blocked until ${cleanText((instagramImagePlan.missing || []).join(", ")) || "a durable image/card URL"} is ready.`
    );
  }
  const instagramVariants = draft.platforms?.instagram?.variants || [];
  if (instagramVariants.some((variant) => variant.publishable === true && variant.imagePlan?.renderStatus !== "ready")) {
    byId.visual_readiness_teacher.failures.push("An Instagram variant is marked publishable without a ready image/card.");
  }

  if (draft.learningHooks?.personalDataRequired !== false) {
    byId.growth_memory_teacher.failures.push("Learning loop must not require personal data.");
  }
  if (!draft.learningHooks?.metricsToCapture?.includes("link_clicks")) {
    byId.growth_memory_teacher.failures.push("Learning loop must track exact article link clicks.");
  }
  if (draft.learningHooks?.learningScope !== "aggregate_patterns_only") {
    byId.growth_memory_teacher.failures.push("Learning scope must stay aggregate-patterns-only.");
  } else {
    byId.growth_memory_teacher.strengths.push("Learning scope is aggregate and safe.");
  }
  const unsafeLesson = (draft.learningHooks?.safePerformanceLessons || []).find((lesson) =>
    /@\w|private message|direct message|copied comment|comment text|username|profile id|user id/i.test(
      [lesson.guidance, lesson.copyPolicy].join(" ")
    )
  );
  if (unsafeLesson) {
    byId.growth_memory_teacher.failures.push("Performance guidance contains private or copied-comment language.");
  } else if ((draft.learningHooks?.safePerformanceLessons || []).length) {
    byId.growth_memory_teacher.strengths.push("Safe aggregate performance lessons are available as strategy-only guidance.");
  }

  if (draft.autoPostAllowed !== false) byId.human_approval_teacher.failures.push("Auto-posting must stay disabled.");
  if (draft.publicVisible !== false) byId.human_approval_teacher.failures.push("Social drafts must not be public-visible.");
  if (draft.publishStatus !== "private_review_only") byId.human_approval_teacher.failures.push("Draft must remain private review-only.");
  if (draft.reviewStatus !== "needs_human_review") {
    byId.human_approval_teacher.warnings.push("Draft is not marked for human review.");
  } else {
    byId.human_approval_teacher.strengths.push("Human approval is required.");
  }

  for (const check of checks) {
    check.passed = check.failures.length === 0;
  }
  return {
    schemaVersion: "live-news-social-teacher-report-v1",
    passed: checks.every((check) => check.passed),
    failures: checks.flatMap((check) => check.failures),
    warnings: checks.flatMap((check) => check.warnings),
    checks,
  };
}

function buildSocialRunLearningPlan(drafts = []) {
  const categoryCounts = drafts.reduce((counts, draft) => {
    const category = normalizeCategory(draft.category);
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: "live-news-social-run-learning-plan-v1",
    status: "private_review_only",
    nextBuildFocus: [
      "Approve real Live News article pages so social posts can link to exact story URLs.",
      "Record human-selected caption variants before any API posting is connected.",
      "After manual posts, import aggregate performance metrics into social style memory.",
    ],
    categoryCounts,
    teacherStack: SOCIAL_TEACHER_STACK.map((teacher) => teacher.name),
  };
}

module.exports = {
  DEFAULT_SOCIAL_STYLE_MEMORY,
  SOCIAL_STYLE_MEMORY_SCHEMA_VERSION,
  SOCIAL_TEACHER_STACK,
  buildSocialAudiencePlan,
  buildSocialCaptionVariants,
  buildSocialLearningHooks,
  buildSocialRunLearningPlan,
  evaluateSocialTeacherStack,
  isPublicSafetyRelevant,
  readSocialStyleMemory,
  saveSocialStyleMemory,
};
