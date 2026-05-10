const fs = require("fs");
const path = require("path");
const { cleanText, clamp, splitSentences, stableHash, tokenize, uniqueBy } = require("./text-utils");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const WRITING_STYLE_GUIDE_PATH = path.join(DATA_DIR, "live-news-writing-style.json");
const WRITING_CURRICULUM_PATH = path.join(DATA_DIR, "live-news-writing-curriculum.json");

const WEAK_WRITING_PATTERNS = [
  { id: "this_article_discusses", pattern: /\bthis article discusses\b/i, phrase: "This article discusses" },
  { id: "recent_development", pattern: /\bin a recent development\b/i, phrase: "In a recent development" },
  { id: "continues_to_unfold", pattern: /\bthe story continues to unfold\b/i, phrase: "The story continues to unfold" },
  { id: "read_more_story", pattern: /\bread more about this story\b/i, phrase: "Read more about this story" },
  { id: "latest_update_topic", pattern: /\blatest update on this topic\b/i, phrase: "Latest update on this topic" },
  { id: "what_you_need", pattern: /\bwhat you need to know\b/i, phrase: "What you need to know" },
  { id: "major_update_emerged", pattern: /\ba major update has emerged\b/i, phrase: "A major update has emerged" },
  { id: "readers_reacting", pattern: /\breaders are reacting\b/i, phrase: "Readers are reacting" },
  { id: "shocking", pattern: /\bshocking\b/i, phrase: "Shocking" },
  { id: "you_wont_believe", pattern: /\byou won'?t believe\b/i, phrase: "You won't believe" },
  { id: "top_story_prefix", pattern: /^top story:\s*/i, phrase: "Top Story:" },
  { id: "stay_safe", pattern: /\bstay safe\b/i, phrase: "Stay safe" },
];

const FALLBACK_PATTERNS = [
  { id: "original_source_full_report", pattern: /\bread the original source for the full report\b/i },
  { id: "source_linked_filler", pattern: /\bsource-linked coverage\b/i },
  { id: "live_news_tracking", pattern: /\blive news is tracking\b/i },
  { id: "generic_topic", pattern: /\bthis topic\b/i },
  { id: "generic_story", pattern: /\bthis story\b/i },
  { id: "generic_article", pattern: /\bthis article\b/i },
  { id: "database_description", pattern: /\b(category|metadata|source entries|draft packet|review-only)\b/i },
];

const PUBLIC_SAFETY_CATEGORIES = new Set([
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
]);

const PUBLIC_SAFETY_TERMS = [
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
  "weather warning",
  "health warning",
];

const RESPECT_RISK_PATTERNS = [
  /\billegal alien\b/i,
  /\bthird world\b/i,
  /\bthug(s)?\b/i,
  /\bcrazy people\b/i,
  /\ball (immigrants|muslims|christians|jews|republicans|democrats|black people|white people|asians|latinos)\b/i,
];

const UNSUPPORTED_FORCE_PATTERNS = [
  /\bguarantee(d|s)?\b/i,
  /\bprove(s|d)?\b/i,
  /\bsecretly\b/i,
  /\bcover[- ]?up\b/i,
  /\beveryone is\b/i,
  /\ball readers\b/i,
  /\bofficials urge\b/i,
];

const ALLOWED_BRIDGE_TOKENS = new Set([
  "article",
  "coverage",
  "details",
  "live",
  "news",
  "original",
  "page",
  "read",
  "reader",
  "readers",
  "report",
  "reported",
  "reporting",
  "source",
  "sources",
  "story",
  "update",
  "updates",
  "context",
  "public",
  "safety",
  "safe",
  "attribution",
  "linked",
  "latest",
  "shows",
  "says",
  "said",
  "adds",
  "added",
  "plans",
  "planned",
  "could",
  "would",
  "may",
  "might",
  "affect",
  "matters",
  "people",
  "residents",
  "workers",
  "users",
  "fans",
  "audiences",
  "official",
  "officials",
]);

const EMPTY_STYLE_GUIDE = {
  schemaVersion: "live-news-writing-style-v1",
  voice: { attributes: [] },
  fieldRules: {},
  blockedPublicWritingExamples: [],
  weakFallbackPatterns: [],
  preferredWritingShapes: [],
  categoryGuidance: {},
};

const EMPTY_CURRICULUM = {
  schemaVersion: "live-news-writing-curriculum-v1",
  rubrics: [],
  lessonSequence: [],
};

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function loadWritingStyleGuide() {
  return {
    ...EMPTY_STYLE_GUIDE,
    ...readJsonFile(WRITING_STYLE_GUIDE_PATH, EMPTY_STYLE_GUIDE),
  };
}

function loadWritingCurriculum() {
  return {
    ...EMPTY_CURRICULUM,
    ...readJsonFile(WRITING_CURRICULUM_PATH, EMPTY_CURRICULUM),
  };
}

function normalizeFieldName(value) {
  const normalized = cleanText(value).replace(/[^a-z0-9]+/gi, "").toLowerCase();
  const aliases = {
    card: "homepagecard",
    homepage: "homepagecard",
    homepagecardtext: "homepagecard",
    metadescription: "seometadata",
    seotitle: "seometadata",
    seo: "seometadata",
    caption: "socialcaption",
    facebookcaption: "socialcaption",
    instagramcaption: "socialcaption",
    socialcard: "socialcardtext",
    cardtext: "socialcardtext",
    subheadline: "dek",
  };
  return aliases[normalized] || normalized || "description";
}

function getStyleGuideFieldKey(fieldName, guide = loadWritingStyleGuide()) {
  const requested = normalizeFieldName(fieldName);
  return Object.keys(guide.fieldRules || {}).find((key) => normalizeFieldName(key) === requested) || "description";
}

function getBlockedWritingPhrases() {
  const guide = loadWritingStyleGuide();
  return uniqueClean([
    guide.blockedPublicWritingExamples || [],
    guide.weakFallbackPatterns || [],
    WEAK_WRITING_PATTERNS.map((entry) => entry.phrase),
    "Read the original source for the full report.",
  ]);
}

function getPreferredWritingShapes(category = "") {
  const guide = loadWritingStyleGuide();
  const shapes = Array.isArray(guide.preferredWritingShapes) ? guide.preferredWritingShapes : [];
  const categoryKey = normalizeCategory(category);
  const guidance = guide.categoryGuidance?.[categoryKey] || guide.categoryGuidance?.[categoryKey === "tech" ? "technology" : categoryKey] || {};
  const preferred = new Set((guidance.preferredShapes || []).map(cleanText).filter(Boolean));
  if (!preferred.size) return shapes;
  return [
    ...shapes.filter((shape) => preferred.has(cleanText(shape.id))),
    ...shapes.filter((shape) => !preferred.has(cleanText(shape.id))),
  ];
}

function getWritingRulesForField(fieldName = "description", category = "") {
  const guide = loadWritingStyleGuide();
  const fieldKey = getStyleGuideFieldKey(fieldName, guide);
  const categoryKey = normalizeCategory(category);
  return {
    schemaVersion: "live-news-writing-rules-for-field-v1",
    fieldName: fieldKey,
    category: categoryKey || "top",
    voice: guide.voice || {},
    fieldRules: guide.fieldRules?.[fieldKey] || guide.fieldRules?.description || {},
    categoryGuidance: guide.categoryGuidance?.[categoryKey] || guide.categoryGuidance?.[categoryKey === "tech" ? "technology" : categoryKey] || {},
    blockedPhrases: getBlockedWritingPhrases(),
    preferredShapes: getPreferredWritingShapes(categoryKey),
  };
}

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

function normalizeCategory(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "_");
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

function firstUsefulSentence(values) {
  for (const value of uniqueClean(values)) {
    if (detectFallbackRisk(value).risky) continue;
    const sentenceValue = splitSentences(value)[0] || value;
    if (wordCount(sentenceValue) >= 4) return sentence(sentenceValue);
  }
  return "";
}

function normalizeExactArticleUrl(value) {
  const raw = cleanText(value);
  if (!raw) return { url: "", valid: false, homepage: false };
  if (raw.startsWith("/stories/")) {
    return { url: raw, valid: true, homepage: false };
  }
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const homepage = /(^|\.)newsmorenow\.com$/i.test(parsed.hostname) && pathname === "/";
    const valid = /^https?:$/.test(parsed.protocol) && /\/stories\/[^/]+/i.test(parsed.pathname);
    return { url: valid ? parsed.toString() : raw, valid, homepage };
  } catch {
    return { url: raw, valid: false, homepage: false };
  }
}

function getStoryUrlFields(story = {}) {
  return [
    story.exactArticleUrl,
    story.liveNewsUrl,
    story.approvedStoryUrl,
    story.canonicalUrl,
    story.canonicalLiveNewsUrl,
  ];
}

function pickExactArticleUrl(story = {}) {
  let homepageUrl = "";
  for (const value of getStoryUrlFields(story)) {
    const result = normalizeExactArticleUrl(value);
    if (result.valid) return result;
    if (result.homepage) homepageUrl = result.url;
  }
  return homepageUrl
    ? { url: homepageUrl, valid: false, homepage: true }
    : { url: "", valid: false, homepage: false };
}

function getSourceUrl(story = {}) {
  return cleanText(
    story.originalSourceUrl ||
      story.sourceUrl ||
      story.link ||
      story.sourceBlock?.originalSourceUrl ||
      story.primarySourceUrl ||
      ""
  );
}

function getSourceName(story = {}) {
  return cleanText(
    story.primarySourceName ||
      story.sourceName ||
      story.source ||
      story.sourceAttribution ||
      story.sourceBlock?.attribution ||
      ""
  ).replace(/^source:\s*/i, "");
}

function detectWeakWritingPhrases(text) {
  const clean = cleanText(text);
  return WEAK_WRITING_PATTERNS
    .filter((entry) => entry.pattern.test(clean))
    .map((entry) => ({
      id: entry.id,
      phrase: entry.phrase,
    }));
}

function detectFallbackRisk(text) {
  const clean = cleanText(text);
  const weakMatches = detectWeakWritingPhrases(clean);
  const fallbackMatches = FALLBACK_PATTERNS
    .filter((entry) => entry.pattern.test(clean))
    .map((entry) => ({
      id: entry.id,
      phrase: entry.pattern.source,
    }));
  return {
    risky: weakMatches.length > 0 || fallbackMatches.length > 0,
    weakMatches,
    fallbackMatches,
    reasons: [...weakMatches, ...fallbackMatches].map((entry) => entry.id),
  };
}

function contextualFallbackRisk(text, context = {}) {
  const risk = detectFallbackRisk(text);
  if (context.publicSafetyRelevant === true) {
    const keep = (entry) => entry.id !== "stay_safe";
    const weakMatches = risk.weakMatches.filter(keep);
    const fallbackMatches = risk.fallbackMatches.filter(keep);
    return {
      ...risk,
      weakMatches,
      fallbackMatches,
      risky: weakMatches.length > 0 || fallbackMatches.length > 0,
      reasons: [...weakMatches, ...fallbackMatches].map((entry) => entry.id),
    };
  }
  return risk;
}

function ngrams(words, size) {
  const result = [];
  for (let index = 0; index <= words.length - size; index += 1) {
    result.push(words.slice(index, index + size).join(" "));
  }
  return result;
}

function normalizedWords(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenSimilarity(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? shared / union : 0;
}

function detectCopyRisk(candidateText, sourceText) {
  const candidate = cleanText(candidateText);
  const source = cleanText(sourceText);
  if (!candidate || !source) {
    return {
      risk: false,
      severity: "none",
      score: 100,
      similarity: 0,
      copiedPhrases: [],
      blocking: false,
      reason: "No source text was available for copy-risk comparison.",
    };
  }

  const normalizedCandidate = normalizedWords(candidate).join(" ");
  const normalizedSource = normalizedWords(source).join(" ");
  const sourceWords = normalizedWords(source);
  const candidateWords = normalizedWords(candidate);
  const copiedPhrases = [];

  for (const size of [8, 7, 6]) {
    for (const phrase of ngrams(sourceWords, size)) {
      if (phrase.length >= 35 && normalizedCandidate.includes(phrase)) {
        copiedPhrases.push(phrase);
      }
    }
  }

  const exact = normalizedCandidate && normalizedCandidate === normalizedSource;
  const containsSource = sourceWords.length >= 6 && normalizedCandidate.includes(normalizedSource);
  const similarity = tokenSimilarity(candidate, source);
  const severe = exact || containsSource || copiedPhrases.length > 0 || similarity >= 0.82;
  const warned = severe || similarity >= 0.66;

  return {
    risk: warned,
    severity: severe ? "block" : warned ? "warn" : "none",
    score: severe ? 35 : warned ? 72 : 100,
    similarity: Number(similarity.toFixed(3)),
    copiedPhrases: Array.from(new Set(copiedPhrases)).slice(0, 3),
    blocking: severe,
    reason: severe
      ? "Candidate wording is too close to publisher/source wording."
      : warned
        ? "Candidate wording may be too close to publisher/source wording."
        : "Copy risk is low.",
  };
}

function extractCapitalizedEntities(text) {
  const matches = cleanText(text).match(/\b[A-Z][A-Za-z'.-]+(?:\s+(?:[A-Z][A-Za-z'.-]+|of|and|the|for)){0,4}/g) || [];
  return uniqueClean(matches)
    .filter((entry) => !/^(Live News|Top Story|Story|Source|Read|The|A|An)$/i.test(entry))
    .slice(0, 16);
}

function categorizeEntities(entities, story = {}) {
  const places = uniqueClean([
    story.location,
    story.city && story.state ? `${story.city}, ${story.state}` : story.city,
    story.state,
    story.country,
    ...(story.places || []),
    ...entities.filter((entity) => /\b(City|County|State|America|U\.S\.|US|United States|San|New|Los)\b/.test(entity)),
  ]).slice(0, 10);

  const organizations = uniqueClean([
    ...(story.organizations || []),
    ...entities.filter((entity) =>
      /\b(Inc|Corp|Company|Council|Department|University|Agency|Committee|Court|Police|Hospital|School|Studios?|Records?|League|Team|News)\b/i.test(entity)
    ),
  ]).slice(0, 10);

  const people = uniqueClean([
    ...(story.people || []),
    ...entities.filter((entity) => {
      if (places.includes(entity) || organizations.includes(entity)) return false;
      const words = entity.split(/\s+/);
      return words.length >= 2 && words.length <= 4;
    }),
  ]).slice(0, 10);

  return { people, organizations, places };
}

function hasPublicSafetyLanguage(text) {
  return /\b(public safety|stay safe|safety warning|safety advisory|official warning|officials warned|emergency alert|evacuation order|road closure|shelter in place)\b/i.test(cleanText(text));
}

function detectPublicSafetyRelevance(story = {}, textValues = []) {
  if (story.publicSafetyRelevant === true) return true;
  const category = normalizeCategory(story.category);
  const tags = uniqueClean([story.tags, story.topicTags, story.topicSuggestions]).map(normalizeCategory);
  if (PUBLIC_SAFETY_CATEGORIES.has(category)) return true;
  if (tags.some((tag) => PUBLIC_SAFETY_CATEGORIES.has(tag))) return true;
  const text = uniqueClean(textValues).join(" ").toLowerCase();
  return PUBLIC_SAFETY_TERMS.some((term) => text.includes(term));
}

function getRawSourceDescriptions(story = {}) {
  return uniqueClean([
    story.originalPublisherTitle,
    story.sourceSummary,
    story.rawSummary,
    story.rssDescription,
    story.description,
    story.publisherDescription,
    ...(story.prohibitedPhrasesFromSources || []),
  ]);
}

function buildArticleWritingContext(story = {}) {
  const title = cleanText(story.liveNewsHeadline || story.headline || story.title || "");
  const originalPublisherTitle = cleanText(story.originalPublisherTitle || story.publisherTitle || "");
  const sourceName = getSourceName(story);
  const sourceUrl = getSourceUrl(story);
  const exactResult = pickExactArticleUrl(story);
  const exactArticleUrl = exactResult.url;
  const canonicalUrl = cleanText(story.canonicalUrl || exactArticleUrl || story.canonicalLiveNewsUrl || "");
  const category = cleanText(story.category || story.sourceCategory || "Top");
  const tags = uniqueClean([story.tags, story.topicTags, story.topicSuggestions]);
  const summaryValues = uniqueClean([
    story.liveNewsDek,
    story.dek,
    story.summaryShort,
    story.summaryLong,
    story.summary,
    story.liveNewsSummary,
    story.whyItMatters,
    story.liveNewsWhyItMatters,
  ]);
  const keyPoints = uniqueClean([story.keyPoints, story.liveNewsKeyPoints]);
  const confirmedFacts = uniqueClean([
    story.confirmedFacts,
    title,
    ...keyPoints,
    ...summaryValues.flatMap((value) => splitSentences(value)),
  ]).filter((fact) => !detectFallbackRisk(fact).risky);
  const unclearFacts = uniqueClean([story.unclearFacts, story.disputedOrUnclearClaims]);
  const timeline = uniqueClean([
    story.timeline?.map((entry) => cleanText(entry.label || entry.text || entry.at)),
    story.publishedAt ? `Published ${story.publishedAt}` : "",
    story.updatedAt ? `Updated ${story.updatedAt}` : "",
  ]);
  const mainEvent = firstUsefulSentence([
    story.mainEvent,
    title,
    story.liveNewsDek,
    story.dek,
    story.summaryShort,
    keyPoints[0],
    confirmedFacts[0],
  ]);
  const sourceDescriptions = getRawSourceDescriptions(story);
  const allTextForEntities = [title, originalPublisherTitle, ...confirmedFacts, ...summaryValues].join(" ");
  const entities = categorizeEntities(extractCapitalizedEntities(allTextForEntities), story);
  const whyItMatters = cleanText(story.liveNewsWhyItMatters || story.whyItMatters || story.whyItMattersCandidate || "");
  const readerAngle = cleanText(story.readerAngle || story.trendWhySelected || story.audienceAngle || whyItMatters || "");
  const publicSafetyRelevant = detectPublicSafetyRelevance(story, [
    title,
    originalPublisherTitle,
    category,
    ...tags,
    ...confirmedFacts,
    whyItMatters,
  ]);
  const missingContext = [];
  if (!mainEvent) missingContext.push("main_event_missing");
  if (!sourceName) missingContext.push("source_name_missing");
  if (!exactResult.valid) missingContext.push(exactResult.homepage ? "homepage_url_blocked" : "exact_article_url_missing");
  if (!confirmedFacts.length) missingContext.push("confirmed_facts_missing");

  const confidenceParts = [
    mainEvent ? 0.24 : 0,
    sourceName ? 0.16 : 0,
    exactResult.valid ? 0.18 : 0,
    confirmedFacts.length >= 2 ? 0.22 : confirmedFacts.length ? 0.12 : 0,
    sourceUrl ? 0.08 : 0,
    whyItMatters || readerAngle ? 0.07 : 0,
    keyPoints.length ? 0.05 : 0,
  ];

  return {
    storyId: cleanText(story.storyId || story.liveNewsStoryId || story.id || story.slug || stableHash(title || sourceUrl, 12)),
    exactArticleUrl,
    canonicalUrl,
    title,
    originalPublisherTitle,
    sourceName,
    sourceUrl,
    category,
    tags,
    location: cleanText(story.location || (story.city && story.state ? `${story.city}, ${story.state}` : story.city || story.state || "")) || null,
    people: entities.people,
    organizations: entities.organizations,
    places: entities.places,
    mainEvent,
    confirmedFacts,
    unclearFacts,
    timeline,
    readerAngle,
    whyItMatters,
    doNotSay: uniqueClean([
      originalPublisherTitle,
      sourceDescriptions,
      story.doNotSay,
      "This article discusses",
      "In a recent development",
      "Top Story:",
    ]),
    missingContext,
    publicSafetyRelevant,
    contextConfidence: Number(clamp(confidenceParts.reduce((sum, value) => sum + value, 0), 0, 1).toFixed(2)),
  };
}

function getCandidateText(candidate) {
  return cleanText(typeof candidate === "string" ? candidate : candidate?.text || candidate?.description || candidate?.caption || "");
}

function contextEvidenceText(context = {}) {
  return uniqueClean([
    context.title,
    context.originalPublisherTitle,
    context.sourceName,
    context.category,
    context.tags,
    context.location,
    context.people,
    context.organizations,
    context.places,
    context.mainEvent,
    context.confirmedFacts,
    context.whyItMatters,
    context.readerAngle,
    context.timeline,
  ]).join(" ");
}

function getUnsupportedTokens(candidate, context = {}) {
  const evidenceTokens = new Set(tokenize(contextEvidenceText(context)));
  const allowedTokens = new Set(ALLOWED_BRIDGE_TOKENS);
  if (context.publicSafetyRelevant === true) {
    allowedTokens.add("stay");
    allowedTokens.add("follow");
    allowedTokens.add("evacuation");
    allowedTokens.add("warning");
    allowedTokens.add("alert");
  }
  const candidateTokens = uniqueClean(tokenize(candidate))
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 4)
    .filter((token) => !allowedTokens.has(token));
  return candidateTokens.filter((token) => !evidenceTokens.has(token));
}

function makeTeacher(name, passed, score, reason, blocking = false, extra = {}) {
  return {
    name,
    passed: Boolean(passed),
    score: Math.round(clamp(Number(score) || 0, 0, 100)),
    reason: cleanText(reason),
    blocking: Boolean(blocking),
    ...extra,
  };
}

function storyFocusTeacher(candidate, context) {
  const text = getCandidateText(candidate);
  const mainTokens = new Set(tokenize(context.mainEvent || context.title));
  const textTokens = new Set(tokenize(text));
  const sharedMain = [...mainTokens].filter((token) => textTokens.has(token)).length;
  const factHits = (context.confirmedFacts || []).filter((fact) => tokenSimilarity(text, fact) >= 0.2).length;
  const missingMainEvent = !context.mainEvent;
  const focusRatio = mainTokens.size ? sharedMain / mainTokens.size : 0;
  const score = missingMainEvent ? 30 : clamp(35 + focusRatio * 45 + Math.min(factHits, 2) * 10, 0, 100);
  const passed = score >= 85;
  return makeTeacher(
    "StoryFocusTeacher",
    passed,
    score,
    passed ? "Writing focuses on the article's actual event." : "Writing does not clearly describe the article situation.",
    !passed
  );
}

function contextFaithfulnessTeacher(candidate, context) {
  const text = getCandidateText(candidate);
  const unsupportedTokens = getUnsupportedTokens(text, context);
  const forcedClaims = UNSUPPORTED_FORCE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  const tokenCount = Math.max(1, tokenize(text).length);
  const unsupportedRatio = unsupportedTokens.length / tokenCount;
  const score = clamp(100 - unsupportedTokens.length * 8 - unsupportedRatio * 50 - forcedClaims.length * 18, 0, 100);
  const blocking = score < 90 || forcedClaims.length > 0 || unsupportedTokens.length >= 5;
  return makeTeacher(
    "ContextFaithfulnessTeacher",
    !blocking,
    score,
    blocking
      ? `Possible unsupported details: ${unsupportedTokens.slice(0, 6).join(", ") || "unsupported claim pattern"}.`
      : "Writing stays within confirmed article context.",
    blocking,
    { unsupportedTokens: unsupportedTokens.slice(0, 10), forcedClaims }
  );
}

function humanClarityTeacher(candidate, context = {}) {
  const text = getCandidateText(candidate);
  const sentences = splitSentences(text);
  const words = wordCount(text);
  const weak = detectWeakWritingPhrases(text).filter((entry) => {
    return !(entry.id === "stay_safe" && context.publicSafetyRelevant === true);
  });
  const longSentences = sentences.filter((line) => wordCount(line) > 34);
  const grammarRisk = /\b(is|are|was|were)\s+\1\b|\bto\s+to\b|[,;:]\s*$/.test(text);
  const score = clamp(100 - weak.length * 22 - longSentences.length * 12 - (grammarRisk ? 20 : 0) - (words < 5 ? 20 : 0), 0, 100);
  const blocking = weak.length > 0 || grammarRisk;
  return makeTeacher(
    "HumanClarityTeacher",
    !blocking && score >= 76,
    score,
    blocking ? "Writing sounds robotic, unclear, or grammatically risky." : "Writing is readable and plain.",
    blocking,
    { weakPhrases: weak }
  );
}

function descriptionSpecificityTeacher(candidate, context) {
  const text = getCandidateText(candidate);
  const fallback = contextualFallbackRisk(text, context);
  const usefulFacts = (context.confirmedFacts || []).filter((fact) => tokenSimilarity(text, fact) >= 0.18).length;
  const namedEntityHit = [...(context.people || []), ...(context.organizations || []), ...(context.places || [])]
    .some((entity) => text.toLowerCase().includes(entity.toLowerCase()));
  const score = clamp(45 + Math.min(usefulFacts, 2) * 20 + (namedEntityHit ? 15 : 0) - fallback.reasons.length * 35, 0, 100);
  const blocking = fallback.risky || score < 70;
  return makeTeacher(
    "DescriptionSpecificityTeacher",
    !blocking,
    score,
    blocking ? "Writing is too generic or fallback-like." : "Writing includes specific article detail.",
    blocking,
    { fallbackReasons: fallback.reasons }
  );
}

function rhetoricalSituationTeacher(candidate, context, fieldName) {
  const text = getCandidateText(candidate);
  const hasMatterAngle = Boolean(context.whyItMatters && tokenSimilarity(text, context.whyItMatters) >= 0.12);
  const hasAudienceAngle = /\b(readers|residents|workers|users|fans|audiences|families|voters|consumers|investors|students|drivers)\b/i.test(text);
  const hasSource = context.sourceName && text.toLowerCase().includes(context.sourceName.toLowerCase());
  const isCompactField = /title|cardTitle|shortTitle/i.test(fieldName);
  const score = clamp(72 + (hasMatterAngle ? 12 : 0) + (hasAudienceAngle ? 8 : 0) + (hasSource ? 8 : 0) + (isCompactField ? 5 : 0), 0, 100);
  return makeTeacher(
    "RhetoricalSituationTeacher",
    score >= 72,
    score,
    score >= 72 ? "Writing fits the audience, purpose, and field." : "Writing needs a clearer purpose or reader angle.",
    false
  );
}

function rhythmCadenceTeacher(candidate) {
  const text = getCandidateText(candidate);
  const sentences = splitSentences(text);
  const lengths = sentences.map(wordCount);
  const repeatedStart = sentences.length > 1 && new Set(sentences.map((line) => normalizedWords(line).slice(0, 3).join(" "))).size < sentences.length;
  const allSameLength = lengths.length > 1 && Math.max(...lengths) - Math.min(...lengths) <= 2;
  const score = clamp(92 - (repeatedStart ? 20 : 0) - (allSameLength ? 10 : 0) - (sentences.length === 1 && wordCount(text) > 30 ? 10 : 0), 0, 100);
  return makeTeacher(
    "RhythmCadenceTeacher",
    score >= 70,
    score,
    score >= 70 ? "Sentence rhythm is acceptable." : "Sentence rhythm is too repetitive or dense.",
    false
  );
}

function interculturalRespectTeacher(candidate) {
  const text = getCandidateText(candidate);
  const hits = RESPECT_RISK_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  const score = hits.length ? 35 : 100;
  return makeTeacher(
    "InterculturalRespectTeacher",
    hits.length === 0,
    score,
    hits.length ? "Writing uses language that may stereotype or disrespect people." : "Writing uses neutral, respectful language.",
    hits.length > 0,
    { hits }
  );
}

function digitalMediaTeacher(candidate, context, fieldName) {
  const text = getCandidateText(candidate);
  const words = wordCount(text);
  const missingExactUrl = (context.missingContext || []).includes("exact_article_url_missing");
  const homepageBlocked = (context.missingContext || []).includes("homepage_url_blocked");
  const tooLong =
    /title/i.test(fieldName) ? words > 18 :
      /description|summary|caption|dek/i.test(fieldName) ? words > 55 :
        words > 70;
  const tooShort = /description|summary|caption|dek/i.test(fieldName) ? words < 8 : words < 3;
  const score = clamp(100 - (tooLong ? 18 : 0) - (tooShort ? 15 : 0) - (missingExactUrl ? 45 : 0) - (homepageBlocked ? 60 : 0), 0, 100);
  const blocking = missingExactUrl || homepageBlocked || score < 55;
  return makeTeacher(
    "DigitalMediaTeacher",
    !blocking,
    score,
    homepageBlocked
      ? "Homepage URLs cannot be used as article URLs."
      : missingExactUrl
        ? "An exact /stories/... article URL is required."
        : "Writing is usable for a public digital surface.",
    blocking
  );
}

function copyRiskTeacher(candidate, context) {
  const text = getCandidateText(candidate);
  const risks = uniqueClean(context.doNotSay || [])
    .map((sourceText) => detectCopyRisk(text, sourceText))
    .filter((risk) => risk.risk);
  const blocking = risks.some((risk) => risk.blocking);
  const score = risks.length ? Math.min(...risks.map((risk) => risk.score)) : 100;
  return makeTeacher(
    "CopyRiskTeacher",
    !blocking,
    score,
    risks.length
      ? risks.map((risk) => risk.reason).join(" ")
      : "Writing does not closely copy blocked publisher/source wording.",
    blocking,
    { risks }
  );
}

function fallbackDependencyTeacher(candidate, context) {
  const text = getCandidateText(candidate);
  const fallback = contextualFallbackRisk(text, context);
  const missingRequired = (context.missingContext || []).filter((entry) =>
    ["main_event_missing", "source_name_missing", "confirmed_facts_missing"].includes(entry)
  );
  const publicSafetyBlocked = hasPublicSafetyLanguage(text) && context.publicSafetyRelevant !== true;
  const score = clamp(100 - fallback.reasons.length * 35 - missingRequired.length * 18 - (publicSafetyBlocked ? 45 : 0), 0, 100);
  const blocking = fallback.risky || missingRequired.length > 0 || publicSafetyBlocked;
  return makeTeacher(
    "FallbackDependencyTeacher",
    !blocking,
    score,
    publicSafetyBlocked
      ? "Public safety language needs explicit article support."
      : fallback.risky
        ? "Writing depends on fallback or template language."
        : missingRequired.length
          ? `Writing needs more context: ${missingRequired.join(", ")}.`
          : "Writing is not dependent on fallback phrasing.",
    blocking,
    { fallbackReasons: fallback.reasons, missingRequired, publicSafetyBlocked }
  );
}

function runWritingTeachers(candidate, context, fieldName = "description") {
  const normalizedContext = context?.confirmedFacts ? context : buildArticleWritingContext(context || {});
  return [
    storyFocusTeacher(candidate, normalizedContext, fieldName),
    contextFaithfulnessTeacher(candidate, normalizedContext, fieldName),
    humanClarityTeacher(candidate, normalizedContext, fieldName),
    descriptionSpecificityTeacher(candidate, normalizedContext, fieldName),
    rhetoricalSituationTeacher(candidate, normalizedContext, fieldName),
    rhythmCadenceTeacher(candidate, normalizedContext, fieldName),
    interculturalRespectTeacher(candidate, normalizedContext, fieldName),
    digitalMediaTeacher(candidate, normalizedContext, fieldName),
    copyRiskTeacher(candidate, normalizedContext, fieldName),
    fallbackDependencyTeacher(candidate, normalizedContext, fieldName),
  ];
}

function findTeacher(teachers, name) {
  return teachers.find((teacher) => teacher.name === name) || { score: 0, blocking: true, passed: false };
}

function buildWritingExam(teachers) {
  const storyFocusTeacherResult = findTeacher(teachers, "StoryFocusTeacher");
  const factTeacher = findTeacher(teachers, "ContextFaithfulnessTeacher");
  const specificityTeacher = findTeacher(teachers, "DescriptionSpecificityTeacher");
  const clarityTeacher = findTeacher(teachers, "HumanClarityTeacher");
  const rhythmTeacher = findTeacher(teachers, "RhythmCadenceTeacher");
  const rhetoricalTeacher = findTeacher(teachers, "RhetoricalSituationTeacher");
  const copyTeacher = findTeacher(teachers, "CopyRiskTeacher");
  const fallbackTeacher = findTeacher(teachers, "FallbackDependencyTeacher");
  const digitalTeacher = findTeacher(teachers, "DigitalMediaTeacher");
  const respectTeacher = findTeacher(teachers, "InterculturalRespectTeacher");

  const storyFocus = storyFocusTeacherResult.score;
  const factFaithfulness = factTeacher.score;
  const specificity = specificityTeacher.score;
  const grammarClarity = clarityTeacher.score;
  const humanRhythm = rhythmTeacher.score;
  const sourceRespect = Math.round((rhetoricalTeacher.score + copyTeacher.score + respectTeacher.score) / 3);
  const digitalReadability = digitalTeacher.score;
  const total = Math.round(
    storyFocus * 0.25 +
      factFaithfulness * 0.25 +
      specificity * 0.15 +
      grammarClarity * 0.1 +
      humanRhythm * 0.1 +
      sourceRespect * 0.1 +
      digitalReadability * 0.05
  );
  const blockingReasons = [
    ...teachers.filter((teacher) => teacher.blocking).map((teacher) => `${teacher.name}: ${teacher.reason}`),
    total < 85 ? "Total writing score is below 85." : "",
    factFaithfulness < 90 ? "Fact faithfulness is below 90." : "",
    storyFocus < 85 ? "Story focus is below 85." : "",
    fallbackTeacher.blocking ? "Fallback/template language is blocked." : "",
    copyTeacher.blocking ? "Copied publisher wording is blocked." : "",
  ].filter(Boolean);

  return {
    storyFocus,
    factFaithfulness,
    specificity,
    grammarClarity,
    humanRhythm,
    sourceRespect,
    digitalReadability,
    total,
    passed: blockingReasons.length === 0,
    blockingReasons: Array.from(new Set(blockingReasons)),
  };
}

function evaluateWritingCandidate(candidate, context, fieldName = "description") {
  const normalizedContext = context?.confirmedFacts ? context : buildArticleWritingContext(context || {});
  const text = getCandidateText(candidate);
  const teachers = runWritingTeachers(text, normalizedContext, fieldName);
  const exam = buildWritingExam(teachers);
  return {
    schemaVersion: "live-news-writing-quality-evaluation-v1",
    fieldName,
    text,
    passed: exam.passed,
    status: exam.passed ? "approved" : "blocked",
    teachers,
    exam,
    contextSummary: {
      storyId: normalizedContext.storyId,
      exactArticleUrl: normalizedContext.exactArticleUrl,
      missingContext: normalizedContext.missingContext,
      contextConfidence: normalizedContext.contextConfidence,
    },
  };
}

function getWritingQualityGateResult(candidate, context, fieldName = "description") {
  const evaluation = evaluateWritingCandidate(candidate, context, fieldName);
  return {
    ok: evaluation.passed,
    status: evaluation.passed ? "public_ready" : "blocked",
    fieldName,
    text: evaluation.text,
    total: evaluation.exam.total,
    blockingReasons: evaluation.exam.blockingReasons,
    teachers: evaluation.teachers,
    evaluation,
  };
}

function getSecondaryFact(context = {}, exclude = "") {
  const excludeTokens = new Set(tokenize(exclude));
  return (context.confirmedFacts || []).find((fact) => {
    if (!fact || fact === context.mainEvent) return false;
    const tokens = tokenize(fact);
    if (!tokens.length) return false;
    const overlap = tokens.filter((token) => excludeTokens.has(token)).length / tokens.length;
    return overlap < 0.85 && !detectFallbackRisk(fact).risky;
  }) || "";
}

function generateDescriptionCandidates(contextInput = {}) {
  const context = contextInput?.confirmedFacts ? contextInput : buildArticleWritingContext(contextInput);
  const missingRequired = (context.missingContext || []).filter((entry) =>
    ["main_event_missing", "source_name_missing", "exact_article_url_missing", "homepage_url_blocked", "confirmed_facts_missing"].includes(entry)
  );
  if (missingRequired.length) {
    return {
      status: "needs_more_context",
      missingContext: missingRequired,
      candidates: [],
    };
  }

  const mainEvent = sentence(context.mainEvent);
  const secondaryFact = sentence(getSecondaryFact(context, mainEvent));
  const why = sentence(context.whyItMatters || context.readerAngle);
  const sourceName = cleanText(context.sourceName);
  const candidateInputs = [
    {
      id: "sourceFaithful",
      label: "Source faithful",
      text: truncateWords(`${mainEvent} ${sourceName} provides the original report for readers who want the full details.`, 38),
    },
    {
      id: "readerContext",
      label: "Reader context",
      text: truncateWords(`${mainEvent} ${why || secondaryFact}`, 38),
    },
    {
      id: "conciseWeb",
      label: "Concise web",
      text: truncateWords(`${mainEvent} ${secondaryFact || why}`, 32),
    },
  ];

  return {
    status: "ready",
    candidates: candidateInputs
      .map((candidate) => ({
        ...candidate,
        text: sentence(candidate.text),
      }))
      .filter((candidate) => wordCount(candidate.text) >= 6),
  };
}

function normalizeCandidateList(candidates) {
  if (Array.isArray(candidates)) return candidates;
  if (Array.isArray(candidates?.candidates)) return candidates.candidates;
  return [];
}

function selectBestWritingCandidate(candidates, context, fieldName = "description") {
  const list = normalizeCandidateList(candidates);
  const evaluated = list.map((candidate, index) => {
    const text = getCandidateText(candidate);
    const evaluation = evaluateWritingCandidate(text, context, fieldName);
    return {
      id: cleanText(candidate.id || `candidate-${index + 1}`),
      label: cleanText(candidate.label || candidate.id || `Candidate ${index + 1}`),
      text,
      evaluation,
    };
  });
  const sorted = [...evaluated].sort((a, b) => {
    if (a.evaluation.passed !== b.evaluation.passed) return a.evaluation.passed ? -1 : 1;
    return b.evaluation.exam.total - a.evaluation.exam.total;
  });
  return {
    status: sorted[0]?.evaluation.passed ? "selected" : "blocked",
    selected: sorted[0] || null,
    candidates: evaluated,
  };
}

module.exports = {
  buildArticleWritingContext,
  detectFallbackRisk,
  detectWeakWritingPhrases,
  detectCopyRisk,
  evaluateWritingCandidate,
  runWritingTeachers,
  selectBestWritingCandidate,
  generateDescriptionCandidates,
  getWritingQualityGateResult,
  loadWritingStyleGuide,
  loadWritingCurriculum,
  getWritingRulesForField,
  getBlockedWritingPhrases,
  getPreferredWritingShapes,
};
