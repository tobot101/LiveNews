const { cleanText, clamp, splitSentences, stableHash, tokenize, uniqueBy } = require("./text-utils");

const COMMENT_FIELD_NAMES = new Set([
  "comments",
  "publicComments",
  "userComments",
  "socialComments",
  "commentText",
  "commentTexts",
  "copiedComments",
  "privateMessages",
  "usernames",
  "profiles",
]);

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

const WEAK_SOURCE_PATTERNS = [
  /\bread the original source for the full report\b/i,
  /\bthis article discusses\b/i,
  /\bin a recent development\b/i,
  /\bthe story continues to unfold\b/i,
  /\breaders are reacting\b/i,
  /\byou won'?t believe\b/i,
  /\bshocking\b/i,
];

const SENSITIVITY_PATTERNS = [
  { id: "death", pattern: /\b(dead|death|died|dies|obituary|memorial|tribute)\b/i },
  { id: "legal", pattern: /\b(lawsuit|charged|arrest|custody|trial|court|alleged|allegation)\b/i },
  { id: "health", pattern: /\b(health|hospitalized|medical|diagnosis|illness)\b/i },
  { id: "children", pattern: /\b(child|children|minor|student)\b/i },
  { id: "public_safety", pattern: /\b(emergency alert|evacuation order|road closure|recall notice|safety advisory|weather warning)\b/i },
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function flattenValues(value) {
  return asArray(value).flatMap((entry) => {
    if (Array.isArray(entry)) return flattenValues(entry);
    if (entry && typeof entry === "object") {
      return cleanText(entry.fact || entry.text || entry.label || entry.title || entry.name || entry.value || "");
    }
    return cleanText(entry);
  }).filter(Boolean);
}

function uniqueClean(values) {
  return uniqueBy(flattenValues(values), (value) => value.toLowerCase());
}

function normalizeCategory(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function getStoryId(story = {}) {
  const seed = cleanText(
    story.storyId ||
      story.liveNewsStoryId ||
      story.id ||
      story.slug ||
      story.liveNewsUrl ||
      story.approvedStoryUrl ||
      story.title ||
      story.originalPublisherTitle ||
      story.sourceUrl
  );
  return seed || `source-fact-${stableHash(JSON.stringify(story).slice(0, 2000), 12)}`;
}

function getSourceName(story = {}) {
  return cleanText(
    story.primarySourceName ||
      story.sourceName ||
      story.source ||
      story.sourceAttribution ||
      story.sourceBlock?.attribution ||
      story.publisher ||
      ""
  ).replace(/^source:\s*/i, "");
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

function normalizeExactArticleUrl(value) {
  const raw = cleanText(value);
  if (!raw) return { url: "", valid: false, homepage: false };
  if (raw.startsWith("/stories/")) return { url: raw, valid: true, homepage: false };
  if (raw === "/" || raw === "/index.html") return { url: raw, valid: false, homepage: true };
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const isLiveNews = /(^|\.)newsmorenow\.com$/i.test(parsed.hostname);
    return {
      url: /^\/stories\/[^/]+/i.test(parsed.pathname) ? parsed.toString() : raw,
      valid: /^https?:$/.test(parsed.protocol) && /\/stories\/[^/]+/i.test(parsed.pathname),
      homepage: isLiveNews && pathname === "/",
    };
  } catch {
    return { url: raw, valid: false, homepage: false };
  }
}

function pickExactArticleUrl(story = {}) {
  let homepageUrl = "";
  for (const value of [
    story.exactArticleUrl,
    story.liveNewsUrl,
    story.approvedStoryUrl,
    story.canonicalUrl,
    story.canonicalLiveNewsUrl,
  ]) {
    const result = normalizeExactArticleUrl(value);
    if (result.valid) return result;
    if (result.homepage) homepageUrl = result.url;
  }
  return homepageUrl
    ? { url: homepageUrl, valid: false, homepage: true }
    : { url: "", valid: false, homepage: false };
}

function getOriginalPublisherTitle(story = {}) {
  return cleanText(story.originalPublisherTitle || story.publisherTitle || story.sourceTitle || story.title || "");
}

function getLiveNewsTitle(story = {}) {
  return cleanText(story.liveNewsHeadline || story.approvedTitle || story.headline || story.title || "");
}

function getSourceSummary(story = {}) {
  return cleanText(
    story.sourceSummary ||
      story.rawSummary ||
      story.rssDescription ||
      story.publisherDescription ||
      story.sourceDescription ||
      story.description ||
      ""
  );
}

function isWeakSourceText(value) {
  const text = cleanText(value);
  return !text || WEAK_SOURCE_PATTERNS.some((pattern) => pattern.test(text));
}

function sourceFields(story = {}) {
  const liveNewsTitle = getLiveNewsTitle(story);
  const originalPublisherTitle = getOriginalPublisherTitle(story);
  return [
    {
      sourceField: "title",
      values: [
        liveNewsTitle,
        liveNewsTitle && originalPublisherTitle && liveNewsTitle !== originalPublisherTitle
          ? ""
          : originalPublisherTitle,
      ],
    },
    { sourceField: "dek", values: [story.liveNewsDek, story.dek, story.subheadline] },
    { sourceField: "summary", values: [story.liveNewsSummary, story.summary, story.summaryShort, story.summaryLong, getSourceSummary(story)] },
    { sourceField: "keyPoints", values: [story.keyPoints, story.liveNewsKeyPoints, story.confirmedFacts, story.sourceFacts, story.facts] },
    { sourceField: "body", values: [story.bodyExcerpt, story.articleExcerpt, story.contentSnippet] },
  ];
}

function extractConfirmedFacts(story = {}) {
  const facts = [];
  for (const field of sourceFields(story)) {
    for (const value of flattenValues(field.values)) {
      const sentences = splitSentences(value);
      const candidates = sentences.length ? sentences : [value];
      for (const candidate of candidates) {
        const fact = cleanText(candidate);
        if (!fact || isWeakSourceText(fact)) continue;
        if (COMMENT_FIELD_NAMES.has(field.sourceField)) continue;
        facts.push({
          fact,
          sourceField: field.sourceField,
          confidence: field.sourceField === "keyPoints" || field.sourceField === "title" ? 0.92 : 0.82,
        });
      }
    }
  }
  return uniqueBy(facts, (entry) => entry.fact.toLowerCase()).slice(0, 18);
}

function extractUnclearFacts(story = {}) {
  return uniqueClean([
    story.unclearFacts,
    story.disputedOrUnclearClaims,
    story.unconfirmedClaims,
    story.needsVerification,
  ]).map((fact) => ({
    fact,
    confidence: 0.38,
  }));
}

function extractCapitalizedEntities(text) {
  return uniqueClean(cleanText(text).match(/\b[A-Z][A-Za-z'.-]+(?:\s+(?:[A-Z][A-Za-z'.-]+|of|and|the|for|&)){0,5}/g) || [])
    .filter((entry) => !/^(The|A|An|Live News|Top Story|Source|Read|What|This)$/i.test(entry))
    .slice(0, 28);
}

function extractEntities(story = {}) {
  const text = [
    getLiveNewsTitle(story),
    getOriginalPublisherTitle(story),
    getSourceSummary(story),
    story.dek,
    story.summary,
    story.keyPoints,
    story.whyItMatters,
  ].flatMap(flattenValues).join(" ");
  const capitalized = extractCapitalizedEntities(text);
  const explicitPeople = uniqueClean([story.people, story.entities?.people]);
  const explicitOrganizations = uniqueClean([story.organizations, story.entities?.organizations]);
  const explicitPlaces = uniqueClean([
    story.places,
    story.entities?.places,
    story.location,
    story.city && story.state ? `${story.city}, ${story.state}` : story.city,
    story.state,
    story.country,
  ]);
  const organizations = uniqueClean([
    explicitOrganizations,
    capitalized.filter((entity) =>
      /\b(Inc|Corp|Company|Council|Department|University|Agency|Committee|Court|Police|Hospital|School|Studios?|Records?|League|Team|News|Office|Administration|Foundation|Association|Commission|Transit)\b/i.test(entity)
    ),
  ]).slice(0, 12);
  const places = uniqueClean([
    explicitPlaces,
    capitalized.filter((entity) =>
      /\b(City|County|State|America|U\.S\.|US|United States|San|New|Los|California|Florida|Texas|Morocco|London|Paris)\b/i.test(entity)
    ),
  ]).slice(0, 12);
  const people = uniqueClean([
    explicitPeople,
    capitalized.filter((entity) => {
      if (organizations.includes(entity) || places.includes(entity)) return false;
      const words = entity.split(/\s+/);
      return words.length >= 2 && words.length <= 4;
    }),
  ]).slice(0, 12);
  const projects = uniqueClean([
    story.projects,
    story.entities?.projects,
    (text.match(/["']([^"']{3,80})["']/g) || []).map((entry) => entry.replace(/^["']|["']$/g, "")),
    capitalized.filter((entity) => /\b(Plan|Act|Bill|Program|Project|Film|Series|Album|Tour|Festival|Game|Book|Novel)\b/i.test(entity)),
  ]).slice(0, 12);
  return { people, organizations, places, projects };
}

function extractDates(story = {}) {
  const text = [
    story.publishedAt,
    story.updatedAt,
    story.date,
    story.eventDate,
    getLiveNewsTitle(story),
    getOriginalPublisherTitle(story),
    getSourceSummary(story),
    story.summary,
    story.keyPoints,
  ].flatMap(flattenValues).join(" ");
  const dateLike = text.match(/\b(?:Jan\.?|January|Feb\.?|February|Mar\.?|March|Apr\.?|April|May|Jun\.?|June|Jul\.?|July|Aug\.?|August|Sep\.?|Sept\.?|September|Oct\.?|October|Nov\.?|November|Dec\.?|December)\s+\d{1,2}(?:,\s+\d{4})?|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b20\d{2}\b/g) || [];
  return uniqueClean([story.publishedAt ? `Published ${story.publishedAt}` : "", story.updatedAt ? `Updated ${story.updatedAt}` : "", dateLike]).slice(0, 12);
}

function extractTimeline(story = {}) {
  return uniqueClean([
    story.timeline?.map((entry) => cleanText(entry.label || entry.text || entry.at || entry.date || "")),
    story.publishedAt ? `Published ${story.publishedAt}` : "",
    story.updatedAt ? `Updated ${story.updatedAt}` : "",
    extractDates(story),
  ]).slice(0, 14);
}

function firstUsefulFact(facts = []) {
  return cleanText(facts.find((entry) => entry.fact && entry.fact.split(/\s+/).length >= 4)?.fact || "");
}

function extractReaderAngleCandidates(story = {}) {
  const category = normalizeCategory(story.category || story.sourceCategory);
  const candidates = uniqueClean([
    story.readerAngle,
    story.audienceAngle,
    story.whyItMatters,
    story.liveNewsWhyItMatters,
    category === "local" ? "Local readers may need the place, impact, and public-service context." : "",
    category === "business" ? "Readers may need the company, market, workers, or consumer impact." : "",
    category === "tech" || category === "technology" ? "Readers may need the product, platform, user, privacy, or tool impact." : "",
    category === "sports" ? "Readers may need the player, team, result, or next matchup." : "",
    category === "entertainment" ? "Readers may need the person, project, release, event, or audience context." : "",
    category === "international" ? "Readers may need the country, policy, conflict, or global impact." : "",
  ]);
  return candidates.slice(0, 8);
}

function extractWhyItMattersCandidates(story = {}) {
  return uniqueClean([
    story.whyItMatters,
    story.liveNewsWhyItMatters,
    story.impact,
    story.context,
    story.coverageContext,
  ]).slice(0, 8);
}

function phraseFragments(value) {
  const text = cleanText(value);
  if (!text || text.split(/\s+/).length < 4) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const fragments = [];
  const sizes = [8, 7, 6, 5, 4];
  for (const size of sizes) {
    for (let index = 0; index <= words.length - size; index += Math.max(1, Math.floor(size / 2))) {
      const fragment = words.slice(index, index + size).join(" ");
      if (fragment.length >= 24 && fragment.length <= 100) fragments.push(fragment);
    }
  }
  return fragments;
}

function sentencePattern(value) {
  const words = tokenize(value).slice(0, 10);
  if (words.length < 5) return "";
  return `pattern:${words.map((word) => (word.length > 6 ? `${word.slice(0, 4)}*` : word)).join(" ")}`;
}

function extractDoNotCopyPhrases(story = {}) {
  const sourceTexts = uniqueClean([
    story.originalPublisherTitle,
    story.publisherTitle,
    story.sourceTitle,
    story.sourceSummary,
    story.rawSummary,
    story.rssDescription,
    story.publisherDescription,
    story.sourceDescription,
    story.prohibitedPhrasesFromSources,
  ]);
  const fragments = sourceTexts.flatMap((text) => [
    ...phraseFragments(text),
    sentencePattern(text),
  ]);
  return uniqueClean(fragments)
    .filter((phrase) => phrase.length <= 110)
    .slice(0, 40);
}

function extractDoNotSay(story = {}) {
  return uniqueClean([
    story.doNotSay,
    "This article discusses",
    "In a recent development",
    "The story continues to unfold",
    "Readers are reacting",
    "A major update has emerged",
    "You won't believe",
    "Shocking",
    "Top Story:",
    "Stay safe unless publicSafetyRelevant is true",
  ]);
}

function extractSensitivityFlags(story = {}) {
  const text = [
    getLiveNewsTitle(story),
    getOriginalPublisherTitle(story),
    getSourceSummary(story),
    story.summary,
    story.keyPoints,
    story.category,
    story.tags,
  ].flatMap(flattenValues).join(" ");
  return SENSITIVITY_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.id);
}

function isPublicSafetyRelevant(story = {}, confirmedFacts = []) {
  if (story.publicSafetyRelevant === true) return true;
  const category = normalizeCategory(story.category || story.sourceCategory);
  const tags = uniqueClean([story.tags, story.topicTags]).map(normalizeCategory);
  if (PUBLIC_SAFETY_CATEGORIES.has(category) || tags.some((tag) => PUBLIC_SAFETY_CATEGORIES.has(tag))) return true;
  const text = [
    getLiveNewsTitle(story),
    getOriginalPublisherTitle(story),
    getSourceSummary(story),
    ...confirmedFacts.map((entry) => entry.fact || entry),
  ].join(" ").toLowerCase();
  return PUBLIC_SAFETY_TERMS.some((term) => text.includes(term));
}

function buildSourceFactMap(story = {}) {
  const exactResult = pickExactArticleUrl(story);
  const confirmedFacts = extractConfirmedFacts(story);
  const unclearFacts = extractUnclearFacts(story);
  const entities = extractEntities(story);
  const timeline = extractTimeline(story);
  const readerAngleCandidates = extractReaderAngleCandidates(story);
  const whyItMattersCandidates = extractWhyItMattersCandidates(story);
  const sourceName = getSourceName(story);
  const sourceUrl = getSourceUrl(story);
  const originalPublisherTitle = getOriginalPublisherTitle(story);
  const sourceSummary = getSourceSummary(story);
  const mainEvent = cleanText(story.mainEvent || getLiveNewsTitle(story) || firstUsefulFact(confirmedFacts));
  const missingContext = [];
  if (!mainEvent) missingContext.push("main_event_missing");
  if (!sourceName) missingContext.push("source_name_missing");
  if (!exactResult.valid) missingContext.push(exactResult.homepage ? "homepage_url_blocked" : "exact_article_url_missing");
  if (!confirmedFacts.length) missingContext.push("confirmed_facts_missing");
  const contextConfidence = Number(clamp(
    (mainEvent ? 0.22 : 0) +
      (sourceName ? 0.14 : 0) +
      (sourceUrl ? 0.08 : 0) +
      (exactResult.valid ? 0.18 : 0) +
      (confirmedFacts.length >= 3 ? 0.22 : confirmedFacts.length ? 0.12 : 0) +
      (readerAngleCandidates.length ? 0.08 : 0) +
      (entities.people.length || entities.organizations.length || entities.places.length ? 0.08 : 0),
    0,
    1
  ).toFixed(2));

  return {
    storyId: getStoryId(story),
    exactArticleUrl: exactResult.url,
    sourceName,
    sourceUrl,
    originalPublisherTitle,
    sourceSummary,
    sourceCategory: cleanText(story.sourceCategory || story.category || "Top"),
    confirmedFacts,
    unclearFacts,
    people: entities.people,
    organizations: entities.organizations,
    places: entities.places,
    projects: entities.projects,
    dates: extractDates(story),
    mainEvent,
    timeline,
    readerAngleCandidates,
    whyItMattersCandidates,
    doNotCopyPhrases: extractDoNotCopyPhrases(story),
    doNotSay: extractDoNotSay(story),
    sensitivityFlags: extractSensitivityFlags(story),
    missingContext,
    contextConfidence,
    publicSafetyRelevant: isPublicSafetyRelevant(story, confirmedFacts),
  };
}

function validateFactMap(factMap = {}) {
  const missingContext = uniqueClean(factMap.missingContext || []);
  if (!factMap.mainEvent) missingContext.push("main_event_missing");
  if (!factMap.sourceName) missingContext.push("source_name_missing");
  const exact = normalizeExactArticleUrl(factMap.exactArticleUrl);
  if (!exact.valid) missingContext.push(exact.homepage ? "homepage_url_blocked" : "exact_article_url_missing");
  if (!Array.isArray(factMap.confirmedFacts) || !factMap.confirmedFacts.length) {
    missingContext.push("confirmed_facts_missing");
  }
  return {
    ready: missingContext.length === 0,
    missingContext: uniqueClean(missingContext),
    blockingReasons: uniqueClean(missingContext.map((entry) => {
      if (entry === "homepage_url_blocked") return "Homepage URL cannot be used as an article URL.";
      if (entry === "exact_article_url_missing") return "Exact /stories/... URL is required.";
      return entry;
    })),
    contextConfidence: Number(factMap.contextConfidence || 0),
  };
}

function summarizeFactMapForWriter(factMap = {}) {
  return {
    storyId: cleanText(factMap.storyId),
    exactArticleUrl: cleanText(factMap.exactArticleUrl),
    sourceName: cleanText(factMap.sourceName),
    sourceUrl: cleanText(factMap.sourceUrl),
    mainEvent: cleanText(factMap.mainEvent),
    confirmedFacts: (factMap.confirmedFacts || []).map((entry) => cleanText(entry.fact || entry)).filter(Boolean),
    unclearFacts: (factMap.unclearFacts || []).map((entry) => cleanText(entry.fact || entry)).filter(Boolean),
    people: uniqueClean(factMap.people),
    organizations: uniqueClean(factMap.organizations),
    places: uniqueClean(factMap.places),
    projects: uniqueClean(factMap.projects),
    dates: uniqueClean(factMap.dates),
    readerAngleCandidates: uniqueClean(factMap.readerAngleCandidates),
    whyItMattersCandidates: uniqueClean(factMap.whyItMattersCandidates),
    doNotSay: uniqueClean(factMap.doNotSay),
    sensitivityFlags: uniqueClean(factMap.sensitivityFlags),
    missingContext: uniqueClean(factMap.missingContext),
    contextConfidence: Number(factMap.contextConfidence || 0),
  };
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

function compareCandidateToFactMap(candidate, factMap = {}) {
  const text = cleanText(typeof candidate === "string" ? candidate : candidate?.text || candidate?.description || candidate?.caption || "");
  const writerSummary = summarizeFactMapForWriter(factMap);
  const evidenceText = [
    writerSummary.mainEvent,
    writerSummary.confirmedFacts,
    writerSummary.people,
    writerSummary.organizations,
    writerSummary.places,
    writerSummary.projects,
    writerSummary.dates,
    writerSummary.readerAngleCandidates,
    writerSummary.whyItMattersCandidates,
  ].flatMap(flattenValues).join(" ");
  const evidenceTokens = new Set(tokenize(evidenceText));
  const candidateTokens = uniqueClean(tokenize(text)).map((token) => token.toLowerCase());
  const unsupportedTokens = candidateTokens
    .filter((token) => token.length >= 4)
    .filter((token) => !evidenceTokens.has(token))
    .filter((token) => !["article", "coverage", "source", "story", "readers", "context", "report", "reports", "reported", "says", "said"].includes(token));
  const copiedPhrases = uniqueClean(factMap.doNotCopyPhrases || [])
    .filter((phrase) => !phrase.startsWith("pattern:"))
    .filter((phrase) => cleanText(phrase).length >= 24)
    .filter((phrase) => cleanText(phrase).split(/\s+/).length >= 5)
    .filter((phrase) => text.toLowerCase().includes(cleanText(phrase).toLowerCase()));
  const sourceSimilarity = Math.max(
    tokenSimilarity(text, factMap.originalPublisherTitle || ""),
    tokenSimilarity(text, factMap.sourceSummary || ""),
    ...uniqueClean(factMap.doNotCopyPhrases || [])
      .filter((phrase) => !phrase.startsWith("pattern:"))
      .slice(0, 20)
      .map((phrase) => tokenSimilarity(text, phrase))
  );
  const factHits = (factMap.confirmedFacts || []).filter((entry) => tokenSimilarity(text, entry.fact || entry) >= 0.18).length;
  const storyFocusScore = clamp(35 + Math.min(factHits, 3) * 16 + tokenSimilarity(text, factMap.mainEvent || "") * 35, 0, 100);
  const copyRisk = copiedPhrases.length > 0 || sourceSimilarity >= 0.9;
  return {
    candidate: text,
    withinFactMap: unsupportedTokens.length < 5,
    unsupportedTokens: unsupportedTokens.slice(0, 12),
    factHits,
    storyFocusScore: Math.round(storyFocusScore),
    copyRisk: {
      risk: copyRisk,
      similarity: Number(sourceSimilarity.toFixed(3)),
      copiedPhrases: copiedPhrases.slice(0, 5),
      use: "copy_risk_detection_only",
    },
    readyForPublicWriting: validateFactMap(factMap).ready && !copyRisk && unsupportedTokens.length < 5 && storyFocusScore >= 70,
  };
}

module.exports = {
  buildSourceFactMap,
  extractConfirmedFacts,
  extractUnclearFacts,
  extractEntities,
  extractTimeline,
  extractReaderAngleCandidates,
  extractDoNotCopyPhrases,
  extractDoNotSay,
  validateFactMap,
  summarizeFactMapForWriter,
  compareCandidateToFactMap,
};
