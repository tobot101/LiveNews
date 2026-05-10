const {
  buildArticleWritingContext,
  detectCopyRisk,
  detectFallbackRisk,
  evaluateWritingCandidate,
  generateDescriptionCandidates,
  selectBestWritingCandidate,
} = require("./writing-quality");
const { cleanText, tokenize, uniqueBy } = require("./text-utils");

const SEO_PACKAGE_SCHEMA_VERSION = "live-news-seo-package-v1";
const STRUCTURED_DATA_TYPE = "NewsArticle";

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
}

function normalizeStoryUrl(value) {
  const raw = cleanText(value);
  if (!raw) return { url: "", valid: false, homepage: false };
  if (raw.startsWith("/stories/")) return { url: raw, valid: true, homepage: false };
  try {
    const parsed = new URL(raw);
    const pathName = parsed.pathname.replace(/\/+$/, "") || "/";
    const homepage = /(^|\.)newsmorenow\.com$/i.test(parsed.hostname) && pathName === "/";
    return {
      url: /\/stories\/[^/]+/i.test(parsed.pathname) ? parsed.toString() : raw,
      valid: /\/stories\/[^/]+/i.test(parsed.pathname),
      homepage,
    };
  } catch {
    return { url: raw, valid: false, homepage: false };
  }
}

function getExactStoryUrl(story = {}, context = {}) {
  const candidates = [
    context.exactArticleUrl,
    story.exactArticleUrl,
    story.liveNewsUrl,
    story.approvedStoryUrl,
    story.canonicalUrl,
    story.canonicalLiveNewsUrl,
  ];
  let homepageUrl = "";
  for (const candidate of candidates) {
    const result = normalizeStoryUrl(candidate);
    if (result.valid) return result;
    if (result.homepage) homepageUrl = result.url;
  }
  return homepageUrl
    ? { url: homepageUrl, valid: false, homepage: true }
    : { url: "", valid: false, homepage: false };
}

function detectKeywordStuffing(text) {
  const tokens = tokenize(text);
  if (tokens.length < 6) return { stuffed: false, repeated: [] };
  const counts = tokens.reduce((acc, token) => {
    acc[token] = (acc[token] || 0) + 1;
    return acc;
  }, {});
  const repeated = Object.entries(counts)
    .filter(([, count]) => count >= 4 || count / tokens.length >= 0.28)
    .map(([token]) => token);
  return {
    stuffed: repeated.length > 0,
    repeated,
  };
}

function hasUnsupportedPublicSafety(text, context = {}) {
  return /\bstay safe\b|\bsafety warning\b|\bofficials urge\b/i.test(cleanText(text)) && context.publicSafetyRelevant !== true;
}

function evaluateSeoCandidate(candidateText, contextInput, fieldName = "metaDescription") {
  const context = contextInput?.confirmedFacts ? contextInput : buildArticleWritingContext(contextInput || {});
  const text = cleanText(candidateText);
  const evaluation = evaluateWritingCandidate(text, context, fieldName);
  const fallback = detectFallbackRisk(text);
  const keywordStuffing = detectKeywordStuffing(text);
  const copyRisk = detectCopyRisk(text.replace(/\s+\|\s+Live News$/i, ""), context.originalPublisherTitle || "");
  const publicSafetyBlocked = hasUnsupportedPublicSafety(text, context);
  const missingExact = (context.missingContext || []).includes("exact_article_url_missing");
  const homepageBlocked = (context.missingContext || []).includes("homepage_url_blocked");
  const blockingReasons = [
    ...(evaluation.exam?.blockingReasons || []),
    fallback.risky ? "SEO text uses generic fallback or robotic language." : "",
    keywordStuffing.stuffed ? `SEO text repeats keywords too often: ${keywordStuffing.repeated.join(", ")}.` : "",
    copyRisk.blocking ? "SEO text copies publisher wording too closely." : "",
    publicSafetyBlocked ? "SEO text uses public-safety language without source support." : "",
    missingExact ? "SEO story URL must be an exact /stories/... URL." : "",
    homepageBlocked ? "Homepage URL cannot be used as an article canonical URL." : "",
  ].filter(Boolean);

  return {
    ok: evaluation.passed && blockingReasons.length === 0,
    status: evaluation.passed && blockingReasons.length === 0 ? "ready" : "blocked",
    text,
    fieldName,
    evaluation,
    fallback,
    copyRisk,
    keywordStuffing,
    publicSafetyBlocked,
    blockingReasons,
  };
}

function stripLiveNewsSuffix(value) {
  return cleanText(value).replace(/\s+\|\s+Live News$/i, "");
}

function titleCandidates(context, story = {}) {
  const title = cleanText(context.title || story.title || story.headline);
  const category = cleanText(story.category || context.category || "");
  const source = cleanText(story.primarySourceName || context.sourceName || "");
  return uniqueBy(
    [
      story.metaTitle,
      title ? `${title} | Live News` : "",
      title && category ? `${title} | ${category} News` : "",
      title && source ? `${title} | Live News` : "",
    ]
      .map((candidate) => truncate(candidate, 68))
      .filter(Boolean),
    (candidate) => candidate.toLowerCase()
  );
}

function metaDescriptionCandidates(context, story = {}) {
  const generated = generateDescriptionCandidates(context);
  return uniqueBy(
    [
      story.metaDescription,
      story.description,
      story.summaryShort,
      story.dek,
      story.summaryText,
      ...(asArray(story.summary).length ? [asArray(story.summary).join(" ")] : []),
      ...(generated.candidates || []).map((candidate) => candidate.text),
    ]
      .map((candidate) => truncate(candidate, 158))
      .filter(Boolean),
    (candidate) => candidate.toLowerCase()
  );
}

function selectSeoTitle(context, story = {}) {
  const candidates = titleCandidates(context, story).map((text, index) => ({
    id: `seoTitle${index + 1}`,
    label: "SEO title",
    text,
    evaluation: evaluateSeoCandidate(stripLiveNewsSuffix(text), context, "seoTitle"),
  }));
  const selected = candidates.find((candidate) => candidate.evaluation.ok) || candidates[0] || null;
  return {
    selected,
    candidates,
  };
}

function selectMetaDescription(context, story = {}) {
  const candidates = metaDescriptionCandidates(context, story).map((text, index) => ({
    id: `metaDescription${index + 1}`,
    label: "Meta description",
    text,
    evaluation: evaluateSeoCandidate(text, context, "metaDescription"),
  }));
  const selected = candidates.find((candidate) => candidate.evaluation.ok) || null;
  if (selected) return { selected, candidates };

  const fallbackSelection = selectBestWritingCandidate(
    (generateDescriptionCandidates(context).candidates || []).map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      text: truncate(candidate.text, 158),
    })),
    context,
    "metaDescription"
  );
  const fallbackSelected = fallbackSelection.selected
    ? {
        ...fallbackSelection.selected,
        evaluation: evaluateSeoCandidate(fallbackSelection.selected.text, context, "metaDescription"),
      }
    : null;
  return {
    selected: fallbackSelected?.evaluation?.ok ? fallbackSelected : null,
    candidates: [...candidates, ...(fallbackSelection.candidates || [])],
  };
}

function getPrimaryKeyword(context = {}, story = {}) {
  const candidates = [
    story.primaryKeyword,
    story.topicName,
    story.topicCluster,
    context.readerAngle,
    context.mainEvent,
    context.title,
  ].map(cleanText).filter(Boolean);
  const source = candidates[0] || "Live News story";
  const words = tokenize(source).slice(0, 5);
  return words.length ? words.join(" ") : truncate(source, 60);
}

function getRelatedQueries(context = {}, story = {}) {
  return uniqueBy(
    [
      ...(story.relatedQueries || []),
      ...(story.trendSignals || []).flatMap((signal) => signal.relatedQueries || []),
      ...(story.topicKeywords || []),
      ...(context.keywords || []),
    ]
      .map(cleanText)
      .filter(Boolean)
      .slice(0, 8),
    (query) => query.toLowerCase()
  );
}

function getSearchIntent(context = {}, story = {}) {
  const category = cleanText(story.category || context.category || "news").toLowerCase();
  const keyword = getPrimaryKeyword(context, story);
  if (category.includes("local")) return `Find source-linked local context about ${keyword}.`;
  if (category.includes("sport")) return `Find the latest source-linked sports context about ${keyword}.`;
  if (category.includes("business")) return `Find source-linked business context about ${keyword}.`;
  if (category.includes("entertain")) return `Find source-linked entertainment context about ${keyword}.`;
  return `Find clear source-linked context about ${keyword}.`;
}

function buildSeoPackage(story = {}, options = {}) {
  const context = buildArticleWritingContext(story);
  const storyUrl = getExactStoryUrl(story, context);
  const titleSelection = selectSeoTitle(context, story);
  const descriptionSelection = selectMetaDescription(context, story);
  const seoTitle = titleSelection.selected?.text || "";
  const metaDescription = descriptionSelection.selected?.text || "";
  const titleExam = titleSelection.selected?.evaluation?.evaluation?.exam || null;
  const descriptionExam = descriptionSelection.selected?.evaluation?.evaluation?.exam || null;
  const teacherChecks = [
    ...(titleSelection.selected?.evaluation?.evaluation?.teachers || []).map((teacher) => ({ ...teacher, fieldName: "seoTitle" })),
    ...(descriptionSelection.selected?.evaluation?.evaluation?.teachers || []).map((teacher) => ({ ...teacher, fieldName: "metaDescription" })),
  ];
  const warnings = uniqueBy(
    [
      ...(!storyUrl.valid ? [storyUrl.homepage ? "homepage_url_blocked" : "exact_article_url_missing"] : []),
      ...(context.missingContext || []),
      ...(titleSelection.selected?.evaluation?.blockingReasons || []),
      ...(descriptionSelection.selected?.evaluation?.blockingReasons || []),
      ...(!descriptionSelection.selected ? ["meta_description_not_public_ready"] : []),
    ].map(cleanText).filter(Boolean),
    (warning) => warning.toLowerCase()
  );
  const total = Math.round(
    [titleExam?.total, descriptionExam?.total]
      .filter((score) => Number.isFinite(Number(score)))
      .reduce((sum, score, index, list) => sum + Number(score) / list.length, 0)
  );

  return {
    schemaVersion: SEO_PACKAGE_SCHEMA_VERSION,
    storyId: cleanText(story.storyId || context.storyId),
    exactArticleUrl: storyUrl.valid ? storyUrl.url : "",
    canonicalUrl: storyUrl.valid ? storyUrl.url : "",
    seoTitle,
    metaDescription,
    primaryKeyword: getPrimaryKeyword(context, story),
    relatedQueries: getRelatedQueries(context, story),
    topicCluster: cleanText(story.topicCluster || story.topicName || context.readerAngle || story.category || "Live News coverage"),
    structuredDataType: STRUCTURED_DATA_TYPE,
    imageAltText: cleanText(story.imageAlt || story.imageCredit || stripLiveNewsSuffix(seoTitle) || context.title),
    searchIntent: getSearchIntent(context, story),
    writingExam: {
      total: Number.isFinite(total) ? total : 0,
      passed: warnings.length === 0 && Boolean(seoTitle && metaDescription),
      fields: {
        seoTitle: titleExam,
        metaDescription: descriptionExam,
      },
    },
    teacherChecks,
    warnings,
    titleCandidates: titleSelection.candidates,
    metaDescriptionCandidates: descriptionSelection.candidates,
    status: warnings.length === 0 && seoTitle && metaDescription ? "ready" : "needs_review",
    trendGuidanceUsed: Boolean((story.trendSignals || []).length || (story.relatedQueries || []).length || options.trendSignals?.length),
  };
}

module.exports = {
  SEO_PACKAGE_SCHEMA_VERSION,
  buildSeoPackage,
  detectKeywordStuffing,
  evaluateSeoCandidate,
};
