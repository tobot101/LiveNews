const { STORE_PATHS, readJson, writeJson } = require("./store");
const { cleanText, getDomain, slugify, stableHash, uniqueBy } = require("./text-utils");

const APPROVED_STORIES_SCHEMA_VERSION = "live-news-approved-stories-v1";

function readApprovedStore() {
  return readJson(STORE_PATHS.approvedStories, {
    schemaVersion: APPROVED_STORIES_SCHEMA_VERSION,
    updatedAt: null,
    stories: [],
  });
}

function listApprovedStories() {
  const store = readApprovedStore();
  return (store.stories || [])
    .filter((story) => story.status === "approved" && story.public === true)
    .sort((a, b) => new Date(b.publishedAt || b.approvedAt || 0) - new Date(a.publishedAt || a.approvedAt || 0));
}

function getApprovedStorySummaries() {
  return listApprovedStories().map((story) => ({
    storyId: story.storyId,
    slug: story.slug,
    headline: story.headline,
    summaryShort: story.summaryShort,
    category: story.category,
    liveNewsUrl: story.liveNewsUrl,
    originalSourceUrl: story.originalSourceUrl,
    primarySourceName: story.primarySourceName,
    approvedAt: story.approvedAt,
    publishedAt: story.publishedAt,
    updatedAt: story.updatedAt,
  }));
}

function findApprovedStoryBySlug(slug) {
  const requested = cleanText(slug).toLowerCase();
  if (!requested) return null;
  return listApprovedStories().find((story) => story.slug.toLowerCase() === requested) || null;
}

function normalizeUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.replace(/\/$/, "").toLowerCase();
  }
}

function getStorySourceUrls(story) {
  return uniqueBy(
    [
      story.originalSourceUrl,
      ...(story.supportingSources || []).map((source) => source.sourceUrl),
      ...(story.sourceBlock?.supportingSourceUrls || []),
    ]
      .map(normalizeUrl)
      .filter(Boolean),
    (url) => url
  );
}

function getCandidateStoryIds(item) {
  const ids = [item.storyId, item.id].map(cleanText).filter(Boolean);
  if (item.id) ids.push(`ln-${stableHash(item.id, 14)}`);
  if (item.link || item.originalSourceUrl) {
    ids.push(`ln-${stableHash(item.link || item.originalSourceUrl, 14)}`);
  }
  return new Set(ids);
}

function matchApprovedStoryForItem(item, approvedStories = listApprovedStories()) {
  if (!item) return null;
  const candidateIds = getCandidateStoryIds(item);
  const candidateUrls = [
    item.link,
    item.originalSourceUrl,
    item.sourceUrl,
    item.approvedStoryUrl,
  ]
    .map(normalizeUrl)
    .filter(Boolean);

  return (
    approvedStories.find((story) => candidateIds.has(story.storyId)) ||
    approvedStories.find((story) => candidateIds.has(story.slug)) ||
    approvedStories.find((story) => {
      const storyUrls = getStorySourceUrls(story);
      return candidateUrls.some((url) => storyUrls.includes(url));
    }) ||
    null
  );
}

function enrichNewsItemsWithApprovedStories(items, approvedStories = listApprovedStories()) {
  return (items || []).map((item) => {
    const story = matchApprovedStoryForItem(item, approvedStories);
    if (!story) return item;
    return {
      ...item,
      hasLiveNewsStory: true,
      approvedStoryUrl: story.liveNewsUrl || `/stories/${story.slug}`,
      liveNewsUrl: story.liveNewsUrl || `/stories/${story.slug}`,
      liveNewsHeadline: story.headline,
      liveNewsSummary: story.summaryShort,
      liveNewsStoryId: story.storyId,
      reviewStatus: "approved",
    };
  });
}

function enrichNewsPayloadWithApprovedStories(payload) {
  const approvedStories = listApprovedStories();
  return {
    ...payload,
    approvedStories: getApprovedStorySummaries(),
    topStories: enrichNewsItemsWithApprovedStories(payload.topStories || [], approvedStories),
    feed: enrichNewsItemsWithApprovedStories(payload.feed || [], approvedStories),
  };
}

function buildSummaryText(draft) {
  const summary = Array.isArray(draft.summary) ? draft.summary : [draft.summary].filter(Boolean);
  return summary.map(cleanText).filter(Boolean);
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const trimmed = text.slice(0, maxLength - 1).replace(/\s+\S*$/, "");
  return `${trimmed}...`;
}

function buildMetaDescription(draft) {
  const summary = buildSummaryText(draft).join(" ");
  const sourceName = cleanText(draft.sourceBlock?.attribution || draft.sourceAttribution || "");
  const fallback = [summary, sourceName].filter(Boolean).join(" ");
  return truncate(fallback || draft.dek || draft.headline, 155);
}

function validateDraftForApproval(draft) {
  const failures = [];
  if (!draft) {
    return { ok: false, failures: ["Draft was not found."] };
  }
  if (!draft.storyId) failures.push("Draft is missing storyId.");
  if (!draft.slug) failures.push("Draft is missing slug.");
  if (!cleanText(draft.headline)) failures.push("Draft is missing a Live News headline.");
  if (!cleanText(draft.dek)) failures.push("Draft is missing a deck summary.");
  if (!buildSummaryText(draft).length) failures.push("Draft is missing summary text.");
  if (!draft.sourceBlock?.originalSourceUrl) failures.push("Draft is missing the original source URL.");
  if (!draft.sourceBlock?.attribution && !draft.sourceAttribution) {
    failures.push("Draft is missing source attribution.");
  }
  if (draft.evaluation?.passed !== true) {
    failures.push("Draft has not passed the quality gates.");
  }
  if (Number(draft.evaluation?.scores?.safety || 0) < 90) {
    failures.push("Draft safety score is below the publishing gate.");
  }
  if (Number(draft.evaluation?.scores?.attribution || 0) < 75) {
    failures.push("Draft attribution score is below the publishing gate.");
  }
  const headline = cleanText(draft.headline).toLowerCase();
  const publisherTitle = cleanText(draft.originalPublisherTitle).toLowerCase();
  if (headline && publisherTitle && headline === publisherTitle) {
    failures.push("Draft headline copies the publisher headline exactly.");
  }
  return { ok: failures.length === 0, failures };
}

function toApprovedStory(draft, options = {}) {
  const approvedAt = options.approvedAt || new Date().toISOString();
  const summary = buildSummaryText(draft);
  const slug = slugify(draft.slug || draft.headline || draft.storyId);
  const liveNewsUrl = draft.canonicalLiveNewsUrl || `/stories/${slug}`;
  const originalSourceUrl = cleanText(draft.sourceBlock?.originalSourceUrl || "");
  const supportingUrls = uniqueBy(
    [originalSourceUrl, ...(draft.sourceBlock?.supportingSourceUrls || [])]
      .map(cleanText)
      .filter(Boolean),
    (url) => url
  );
  const supportingSources = supportingUrls.map((sourceUrl) => ({
    sourceName:
      sourceUrl === originalSourceUrl
        ? cleanText(draft.primarySourceName || "Original source")
        : getDomain(sourceUrl) || "Supporting source",
    sourceUrl,
    domain: getDomain(sourceUrl),
  }));

  return {
    schemaVersion: "live-news-approved-story-v1",
    storyId: cleanText(draft.storyId),
    slug,
    liveNewsUrl,
    canonicalUrl: liveNewsUrl,
    status: "approved",
    public: true,
    reviewStatus: "approved",
    socialStatus: "ready_for_create_clips_later",
    approvedAt,
    approvedBy: cleanText(options.approvedBy || "Live News editor"),
    publishedAt: approvedAt,
    updatedAt: approvedAt,
    headline: cleanText(draft.headline),
    dek: cleanText(draft.dek),
    summary,
    summaryShort: truncate(summary.slice(0, 2).join(" "), 240),
    summaryLong: summary.join(" "),
    keyPoints: (draft.keyPoints || []).map(cleanText).filter(Boolean).slice(0, 5),
    whyItMatters: cleanText(draft.whyItMatters),
    category: cleanText(draft.category || draft.sourceCategory || "Top"),
    urgencyState: cleanText(draft.urgencyState || "watch"),
    crossSourceScore: Number(draft.evaluation?.overall || 0),
    primarySourceName: cleanText(draft.primarySourceName || draft.sourceAttribution || "Original source"),
    sourceAttribution: cleanText(draft.sourceAttribution || draft.sourceBlock?.attribution || ""),
    sourceBlock: {
      attribution: cleanText(draft.sourceBlock?.attribution || draft.sourceAttribution || ""),
      originalSourceUrl,
      supportingSourceUrls: supportingUrls,
    },
    originalSourceUrl,
    supportingSources,
    originalPublisherTitle: cleanText(draft.originalPublisherTitle || ""),
    metaTitle: truncate(`${cleanText(draft.headline)} | Live News`, 65),
    metaDescription: buildMetaDescription(draft),
    schemaType: "NewsArticle",
    quality: {
      evaluation: draft.evaluation || null,
      riskFlags: draft.riskFlags || [],
      modelMode: draft.modelMode || "",
      promptVersion: draft.promptVersion || "",
    },
  };
}

function approveDraft(draft, options = {}) {
  const validation = validateDraftForApproval(draft);
  if (!validation.ok) {
    const error = new Error(`Draft is not ready for approval: ${validation.failures.join(" ")}`);
    error.failures = validation.failures;
    throw error;
  }
  const story = toApprovedStory(draft, options);
  const current = readApprovedStore();
  const stories = [
    story,
    ...(current.stories || []).filter((item) => item.storyId !== story.storyId && item.slug !== story.slug),
  ];
  writeJson(STORE_PATHS.approvedStories, {
    schemaVersion: APPROVED_STORIES_SCHEMA_VERSION,
    updatedAt: story.updatedAt,
    stories,
  });
  return story;
}

module.exports = {
  APPROVED_STORIES_SCHEMA_VERSION,
  approveDraft,
  enrichNewsItemsWithApprovedStories,
  enrichNewsPayloadWithApprovedStories,
  findApprovedStoryBySlug,
  getApprovedStorySummaries,
  listApprovedStories,
  matchApprovedStoryForItem,
  readApprovedStore,
  toApprovedStory,
  validateDraftForApproval,
};
