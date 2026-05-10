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

const OPERATIONAL_DRAFT_PHRASES = [
  "review-only",
  "source packet",
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
  { tag: "#PublicSafety", pattern: /\bpolice|fire|crash|storm|tornado|flood|evacuation|injured|killed\b/i },
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

function buildSocialHeadline(core) {
  const liveTitle = normalizeSocialTitle(core.title);
  const originalTitle = normalizeSocialTitle(core.originalTitle);
  if (isGenericLiveNewsHeadline(core.title) && originalTitle) {
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
    core.summary,
    core.dek,
    ...(Array.isArray(core.keyPoints) ? core.keyPoints : []),
    core.whyItMatters,
    core.rawSummary,
  ];
  return candidates.map(cleanText).find((candidate) => isUsefulSocialDetail(candidate, socialHeadline)) || "";
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

function buildTitleBackedContext(core, socialHeadline, audiencePlan = {}) {
  const text = [core.originalTitle, core.title, core.summary, core.rawSummary].map(cleanText).join(" ");
  const source = cleanText(core.source || "the original source");
  const category = normalizeCategory(core.category);
  if (category === "sports" && /\bwnba\b|caitlin clark|paige bueckers|wings|fever/i.test(text)) {
    return "The WNBA matchup brings Paige Bueckers, Caitlin Clark, the Wings, and the Fever into the same conversation.";
  }
  if (category === "sports") {
    return `${sentence(socialHeadline)} Live News is tracking the player, team, or season stakes from source-linked coverage led by ${source}.`;
  }
  if (audiencePlan.primaryHumanAngle && audiencePlan.primaryHumanAngle !== "reader clarity") {
    return `${sentence(socialHeadline)} The public angle is ${audiencePlan.primaryHumanAngle}, based on source-linked coverage led by ${source}.`;
  }
  return `${sentence(socialHeadline)} Live News is tracking the source-linked coverage led by ${source}.`;
}

function buildHashtag(value) {
  const words = titleWords(value).slice(0, 3);
  if (!words.length) return "";
  const tag = words.map((word) => titleCaseWord(word).replace(/[^A-Za-z0-9]/g, "")).join("");
  return tag.length >= 3 && tag.length <= 28 ? `#${tag}` : "";
}

function buildTopicHashtags(core, audiencePlan = {}, limit = 5) {
  const text = [core.originalTitle, core.title, core.summary, core.rawSummary, core.category]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const category = normalizeCategory(core.category);
  const tags = ["#LiveNews", ...(CATEGORY_HASHTAGS[category] || CATEGORY_HASHTAGS.top)];
  for (const entry of KEYWORD_HASHTAGS) {
    if (entry.pattern.test(text)) tags.push(entry.tag);
  }
  for (const pattern of audiencePlan.matchedPatterns || []) {
    if (pattern.id === "reader_clarity") continue;
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
  const socialHeadline = truncateWords(buildSocialHeadline(core), 22);
  const title = sentence(socialHeadline);
  const usefulDetail = pickUsefulDetail(core, socialHeadline);
  const summary = usefulDetail ? sentence(truncateWords(usefulDetail, 38)) : "";
  const context = summary || sentence(truncateWords(buildTitleBackedContext(core, socialHeadline, audiencePlan), 34));
  const titleAddsContext = shouldAddTitleAfterContext(context, title);
  const source = cleanText(core.source || "the original source");
  const sourceLine = `Source-linked coverage from ${source}.`;
  const igLinkLine = instagramLinkLine(core.linkState);
  const fbLinkLine = facebookLinkLine(core.linkState);
  const label = cleanText(core.placementLabel || "Live News Coverage");
  const categoryLine = `${cleanText(core.source || "Original source")} • ${cleanText(core.category || "Top")} • ${cleanText(core.publishedDate || "Date unavailable")}`;
  const approvedMemory = memory?.protectedRules?.length ? memory : DEFAULT_SOCIAL_STYLE_MEMORY;
  const hashtags = buildTopicHashtags(core, audiencePlan, 5).join(" ");
  const facebookHashtags = buildTopicHashtags(core, audiencePlan, 4).join(" ");

  const instagram = uniqueVariantList([
    {
      id: "ig_context_hook",
      shape: "context_hook",
      text: [
        "LIVE NEWS",
        label,
        "",
        context,
        titleAddsContext ? title : "",
        "",
        `Source: ${source}.`,
        igLinkLine,
        hashtags,
      ].filter(Boolean).join("\n"),
    },
    {
      id: "ig_context_first",
      shape: "context_first",
      text: [
        context,
        titleAddsContext ? title : "",
        "",
        `LIVE NEWS • ${audiencePlan.postShape || label}`,
        categoryLine,
        igLinkLine,
        hashtags,
      ].filter(Boolean).join("\n"),
    },
    {
      id: "ig_source_link",
      shape: "source_link",
      text: [
        title,
        titleAddsContext ? context : "",
        "",
        `LIVE NEWS • ${label}`,
        sourceLine,
        igLinkLine,
        hashtags,
      ].filter(Boolean).join("\n"),
    },
  ]);

  const facebook = uniqueVariantList([
    {
      id: "fb_context_hook",
      shape: "context_hook",
      text: [
        context,
        titleAddsContext ? title : "",
        sourceLine,
        fbLinkLine,
        facebookHashtags,
      ].filter(Boolean).join("\n\n"),
    },
    {
      id: "fb_context_first",
      shape: "context_first",
      text: [
        title,
        titleAddsContext ? context : "",
        `${categoryLine}.`,
        fbLinkLine,
        facebookHashtags,
      ].filter(Boolean).join("\n\n"),
    },
    {
      id: "fb_source_first",
      shape: "source_first",
      text: [
        `${sourceLine} ${title}`,
        titleAddsContext ? context : "",
        fbLinkLine,
        facebookHashtags,
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
    for (const phrase of OPERATIONAL_DRAFT_PHRASES) {
      if (lowered.includes(phrase)) failures.push(`${variant.id || "caption"} exposes internal draft language: ${phrase}.`);
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
