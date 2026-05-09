const { cleanText, stableHash, tokenize } = require("./article-agents/text-utils");
const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");

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
  ],
  approvedLearningSignals: [
    "reach",
    "views",
    "likes",
    "comments",
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
    "public_interest_score",
    "trusted_public_source",
    "exact_article_clicks",
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
  let score = Number(pattern.priority || 0);
  if (patternCategories.includes(category)) score += 24;
  const tokenSet = new Set(tokenize(text));
  for (const keyword of pattern.keywords || []) {
    const cleanKeyword = cleanText(keyword).toLowerCase();
    if (!cleanKeyword) continue;
    if (cleanKeyword.includes(" ")) {
      if (text.includes(cleanKeyword)) score += 14;
    } else if (tokenSet.has(cleanKeyword)) {
      score += 10;
    }
  }
  return score;
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
  const primary = patterns[0] || {
    id: "reader_clarity",
    label: "reader clarity",
    humanQuestions: profile.primaryQuestions,
    score: 50,
  };
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
    primaryHumanAngle: primary.label,
    matchedPatterns: patterns,
    readerQuestions,
    communicationRules: [
      "Lead with what is known.",
      "Use source-linked language.",
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

function buildLinkLine(linkState) {
  return linkState?.shareableNow
    ? `Read: ${linkState.exactArticleUrl}`
    : "Article page: pending editor approval";
}

function uniqueVariantList(variants) {
  const seen = new Set();
  return variants.filter((variant) => {
    const signature = firstWords(variant.text, 6) || stableHash(variant.text, 8);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function buildSocialCaptionVariants(core, audiencePlan = {}, memory = DEFAULT_SOCIAL_STYLE_MEMORY) {
  const title = sentence(truncateWords(core.title, 20));
  const summary = cleanText(core.summary) && cleanText(core.summary).toLowerCase() !== cleanText(core.title).toLowerCase()
    ? sentence(truncateWords(core.summary, 36))
    : "";
  const sourceLine = `Source-linked coverage from ${cleanText(core.source || "the original source")}.`;
  const linkLine = buildLinkLine(core.linkState);
  const label = cleanText(core.placementLabel || "Live News Coverage");
  const categoryLine = `${cleanText(core.source || "Original source")} • ${cleanText(core.category || "Top")} • ${cleanText(core.publishedDate || "Date unavailable")}`;
  const approvedMemory = memory?.protectedRules?.length ? memory : DEFAULT_SOCIAL_STYLE_MEMORY;

  const instagram = uniqueVariantList([
    {
      id: "ig_title_first",
      shape: "title_first",
      text: [
        "LIVE NEWS",
        label,
        "",
        title,
        summary,
        "",
        sourceLine,
        linkLine,
        "#LiveNews #News #SourceLinkedCoverage",
      ].filter(Boolean).join("\n"),
    },
    {
      id: "ig_context_first",
      shape: "context_first",
      text: [
        summary || title,
        summary ? title : "",
        "",
        `LIVE NEWS • ${audiencePlan.postShape || label}`,
        categoryLine,
        linkLine,
      ].filter(Boolean).join("\n"),
    },
    {
      id: "ig_reader_clarity",
      shape: "reader_clarity",
      text: [
        sourceLine,
        title,
        summary || "Live News is holding this post until the exact story page is approved.",
        "",
        `LIVE NEWS • ${label}`,
        linkLine,
      ].filter(Boolean).join("\n"),
    },
  ]);

  const facebook = uniqueVariantList([
    {
      id: "fb_title_first",
      shape: "title_first",
      text: [
        `${label}: ${title}`,
        summary,
        sourceLine,
        core.linkState?.shareableNow ? core.linkState.exactArticleUrl : "",
      ].filter(Boolean).join("\n\n"),
    },
    {
      id: "fb_context_first",
      shape: "context_first",
      text: [
        summary || title,
        summary ? title : "",
        `${categoryLine}.`,
        core.linkState?.shareableNow ? core.linkState.exactArticleUrl : "Exact Live News article page is pending editor approval.",
      ].filter(Boolean).join("\n\n"),
    },
    {
      id: "fb_source_first",
      shape: "source_first",
      text: [
        `${sourceLine} ${title}`,
        summary,
        core.linkState?.shareableNow ? core.linkState.exactArticleUrl : "",
      ].filter(Boolean).join("\n\n"),
    },
  ]);

  return {
    schemaVersion: "live-news-social-caption-variants-v1",
    generatedFrom: "source_safe_core_fields",
    memoryMode: approvedMemory.mode,
    instagram: {
      primaryVariantId: instagram[0]?.id || "",
      variants: instagram,
      caption: instagram[0]?.text || "",
    },
    facebook: {
      primaryVariantId: facebook[0]?.id || "",
      variants: facebook,
      caption: facebook[0]?.text || "",
    },
  };
}

function buildSocialLearningHooks(audiencePlan = {}) {
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
    memoryUpdateRules: [
      "Store approved lessons as aggregate patterns only.",
      "Do not store usernames, private profile data, or copied comments.",
      "Treat comments as signals to review, not verified facts.",
      "Prefer exact article clicks, saves, shares, and clean comments over likes alone.",
    ],
    nextTeacherPrompt: `Improve future ${audiencePlan.category || "news"} drafts by checking whether the ${audiencePlan.primaryHumanAngle || "reader clarity"} angle helped users reach the exact article page.`,
  };
}

function evaluateCaptionSet(variants) {
  const warnings = [];
  const failures = [];
  const signatures = [];
  for (const variant of variants || []) {
    const text = cleanText(variant.text);
    if (!text) failures.push(`${variant.id || "caption"} is empty.`);
    const lowered = text.toLowerCase();
    for (const phrase of VAGUE_OR_MANIPULATIVE_PHRASES) {
      if (lowered.includes(phrase)) failures.push(`${variant.id || "caption"} uses blocked social phrasing: ${phrase}.`);
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
  readSocialStyleMemory,
  saveSocialStyleMemory,
};
