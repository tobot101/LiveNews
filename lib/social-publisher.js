const { cleanText, extractFocusPhrase, slugify, stableHash, uniqueBy } = require("./article-agents/text-utils");
const { STORE_PATHS, readJson, writeJson } = require("./article-agents/store");
const {
  SOCIAL_TEACHER_STACK,
  buildSocialAudiencePlan,
  buildSocialCaptionVariants,
  buildSocialLearningHooks,
  buildSocialRunLearningPlan,
  evaluateSocialTeacherStack,
  readSocialStyleMemory,
} = require("./social-intelligence");

const SOCIAL_DRAFTS_SCHEMA_VERSION = "live-news-social-drafts-v1";
const SOCIAL_AGENT_SEQUENCE = [
  "Story Selector Agent",
  "Exact Link Gate",
  "Audience Pattern Mapper",
  "Caption Variant Agent",
  "Media Card Planner",
  "Attribution Guard",
  "Source Safety Teacher",
  "Human Relevance Teacher",
  "Rhythm Variety Teacher",
  "Platform Fit Teacher",
  "Growth Memory Teacher",
  "Publishing Supervisor",
  "Human Approval Gate",
];
const DEFAULT_SOCIAL_LIMIT = 16;
const BLOCKED_SOCIAL_PHRASES = [
  "this article discusses",
  "the report says",
  "according to",
  "readers may want",
  "what comes next depends",
  "the core question is",
  "the focus stays on",
  "the wider value is",
];

function normalizeOrigin(origin) {
  return String(origin || "https://newsmorenow.com").trim().replace(/\/$/, "");
}

function absoluteUrl(origin, pathname) {
  const cleanOrigin = normalizeOrigin(origin);
  const path = String(pathname || "").trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${cleanOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

function sentence(value, fallback = "") {
  const text = cleanText(value || fallback);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function truncateWords(value, maxWords) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function formatSocialDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getItemKey(item) {
  return cleanText(item?.id || item?.approvedStoryUrl || item?.liveNewsUrl || item?.link || item?.title);
}

function getItemTitle(item) {
  return cleanText(item.liveNewsHeadline || item.title || "Live News story");
}

function getItemSummary(item) {
  return cleanText(item.liveNewsSummary || item.summaryShort || item.liveNewsDek || item.summary || "");
}

function getItemRawSummary(item) {
  return cleanText(item.summary || item.sourceSummary || item.description || "");
}

function getItemOriginalTitle(item) {
  return cleanText(item.originalPublisherTitle || item.title || "");
}

function getSourceName(item) {
  return cleanText(item.sourceName || item.source || item.primarySourceName || "Original source");
}

function getOriginalSourceUrl(item) {
  return cleanText(item.link || item.originalSourceUrl || item.url || item.sourceUrl || "");
}

function getInternalStoryPath(item) {
  const direct = cleanText(item.approvedStoryUrl || item.liveNewsUrl || "");
  if (direct && direct.startsWith("/stories/")) return direct;
  if (/^https?:\/\/[^/]+\/stories\//i.test(direct)) {
    try {
      return new URL(direct).pathname;
    } catch {
      return "";
    }
  }
  return "";
}

function getFutureStoryPath(item) {
  const title = getItemTitle(item);
  const focus = extractFocusPhrase(title, item.category || "Top");
  const base = getItemKey(item) || `${title}:${item.publishedAt || ""}`;
  return `/stories/${slugify(focus)}-${stableHash(base, 8).slice(-6)}`;
}

function getLinkState(item, origin) {
  const internalPath = getInternalStoryPath(item);
  const hasApprovedStory = Boolean(item.hasLiveNewsStory || item.approvedStoryUrl || item.liveNewsUrl);
  const exactArticleUrl = internalPath ? absoluteUrl(origin, internalPath) : "";
  const futureArticleUrl = absoluteUrl(origin, getFutureStoryPath(item));
  return {
    exactArticleUrl,
    futureArticleUrl,
    originalSourceUrl: getOriginalSourceUrl(item),
    status: exactArticleUrl && hasApprovedStory ? "ready_exact_live_news_article" : "needs_live_news_article_approval",
    shareableNow: Boolean(exactArticleUrl && hasApprovedStory),
    reason: exactArticleUrl && hasApprovedStory
      ? "Exact Live News story page is available."
      : "No public Live News article page exists yet, so social posting stays blocked.",
  };
}

function selectSocialItems(payload, limit = DEFAULT_SOCIAL_LIMIT) {
  const labeled = [
    { item: payload?.topStoryOfDay, placement: "top_story_of_the_day", priority: 100 },
    { item: payload?.topStoryOfWeek, placement: "top_story_of_the_week", priority: 95 },
    ...(payload?.topStories || []).map((item, index) => ({
      item,
      placement: "top_story",
      priority: 90 - index,
    })),
    ...(payload?.feed || []).map((item, index) => ({
      item,
      placement: "latest_feed",
      priority: 70 - Math.min(index, 60) / 2,
    })),
  ]
    .filter((entry) => entry.item)
    .filter((entry) => getOriginalSourceUrl(entry.item) || getInternalStoryPath(entry.item));

  return uniqueBy(labeled, (entry) => getItemKey(entry.item))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(1, Number(limit || DEFAULT_SOCIAL_LIMIT)));
}

function buildCaptionCore(item) {
  const title = truncateWords(getItemTitle(item), 18);
  const summary = truncateWords(getItemSummary(item), 34);
  const rawSummary = truncateWords(getItemRawSummary(item), 42);
  const dek = truncateWords(item.liveNewsDek || item.dek || "", 30);
  const whyItMatters = truncateWords(item.liveNewsWhyItMatters || item.whyItMatters || "", 30);
  const source = getSourceName(item);
  const category = cleanText(item.category || "Top");
  return {
    title,
    originalTitle: truncateWords(getItemOriginalTitle(item), 22),
    summary,
    rawSummary,
    dek,
    whyItMatters,
    keyPoints: (item.liveNewsKeyPoints || item.keyPoints || []).map(cleanText).filter(Boolean).slice(0, 3),
    tags: (item.tags || item.topicTags || []).map(cleanText).filter(Boolean).slice(0, 8),
    publicSafetyRelevant: item.publicSafetyRelevant === true,
    imageUrl: cleanText(item.imageUrl || item.thumbnailUrl || ""),
    generatedCardUrl: cleanText(item.generatedCardUrl || ""),
    source,
    category,
    publishedDate: formatSocialDate(item.publishedAt),
  };
}

function buildInstagramCaption(item, linkState, placementLabel) {
  const core = buildCaptionCore(item);
  const lines = [
    `LIVE NEWS`,
    placementLabel,
    "",
    sentence(core.title),
  ];
  if (core.summary && core.summary.toLowerCase() !== core.title.toLowerCase()) {
    lines.push(sentence(core.summary));
  }
  lines.push("");
  lines.push(`Source-linked coverage from ${core.source}.`);
  lines.push(linkState.shareableNow ? `Read: ${linkState.exactArticleUrl}` : `Article page: pending editor approval`);
  lines.push("#LiveNews #News #SourceLinkedCoverage");
  return lines.join("\n");
}

function buildFacebookCaption(item, linkState, placementLabel) {
  const core = buildCaptionCore(item);
  const lines = [
    `${placementLabel}: ${sentence(core.title)}`,
  ];
  if (core.summary && core.summary.toLowerCase() !== core.title.toLowerCase()) {
    lines.push(sentence(core.summary));
  }
  lines.push(`Source-linked coverage from ${core.source}.`);
  if (linkState.shareableNow) lines.push(linkState.exactArticleUrl);
  return lines.join("\n\n");
}

function buildMediaCardSpec(item, placementLabel) {
  const core = buildCaptionCore(item);
  return {
    format: "square_social_card",
    width: 1080,
    height: 1080,
    safeArea: 920,
    background: "low-glare news gradient",
    brand: "Live News",
    tagline: "Anytime & Anywhere",
    label: placementLabel,
    title: core.title,
    sourceLine: `${core.source} • ${core.category} • ${core.publishedDate}`,
    imageUrl: cleanText(item.imageUrl || item.thumbnailUrl || item.generatedCardUrl || ""),
    generatedCardUrl: cleanText(item.generatedCardUrl || ""),
    imageCredit: cleanText(item.imageCredit || core.source),
    imageRequiredBeforePosting: false,
  };
}

function getPlacementLabel(placement) {
  const labels = {
    top_story_of_the_day: "Top Story of the Day",
    top_story_of_the_week: "Top Story of the Week",
    top_story: "Top Story",
    latest_feed: "Latest Coverage",
  };
  return labels[placement] || "Live News Coverage";
}

function evaluateSocialDraft(draft) {
  const failures = [];
  const warnings = [];
  const teacherReport = draft.teacherReport || evaluateSocialTeacherStack(draft);
  const combinedText = [
    draft.platforms?.instagram?.caption,
    draft.platforms?.facebook?.caption,
  ].join(" ").toLowerCase();

  if (draft.autoPostAllowed !== false) failures.push("Auto-posting must stay disabled.");
  if (draft.publishStatus !== "private_review_only") failures.push("Draft must remain private review-only.");
  if (!draft.sourceAttribution) failures.push("Source attribution is missing.");
  if (!draft.originalSourceUrl) failures.push("Original source URL is missing.");
  if (!draft.linkState?.shareableNow) warnings.push("Exact public Live News article page is not ready yet.");
  if (draft.linkState?.exactArticleUrl && /newsmorenow\.com\/?$/i.test(draft.linkState.exactArticleUrl)) {
    failures.push("Social drafts must not point to the homepage.");
  }
  for (const phrase of BLOCKED_SOCIAL_PHRASES) {
    if (combinedText.includes(phrase)) failures.push(`Caption uses blocked phrase: ${phrase}.`);
  }
  if (combinedText.includes("officials announced") && !/official/i.test(draft.title)) {
    warnings.push("Caption may use an official-source framing without enough support.");
  }
  failures.push(...(teacherReport.failures || []));
  warnings.push(...(teacherReport.warnings || []));

  return {
    passed: failures.length === 0,
    shareableNow: Boolean(draft.linkState?.shareableNow && failures.length === 0),
    failures: uniqueBy(failures.map((failure) => ({ failure })), (entry) => entry.failure).map((entry) => entry.failure),
    warnings: uniqueBy(warnings.map((warning) => ({ warning })), (entry) => entry.warning).map((entry) => entry.warning),
    teacherReport,
  };
}

function buildSocialDraft(entry, options = {}) {
  const item = entry.item;
  const origin = normalizeOrigin(options.origin);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const placementLabel = getPlacementLabel(entry.placement);
  const socialMemory = options.socialMemory || readSocialStyleMemory();
  const linkState = getLinkState(item, origin);
  const storyKey = getItemKey(item);
  const socialDraftId = `ln-social-${stableHash(`${storyKey}:${entry.placement}`, 14)}`;
  const title = getItemTitle(item);
  const summary = getItemSummary(item);
  const category = cleanText(item.category || "Top");
  const sourceAttribution = getSourceName(item);
  const audiencePlan = buildSocialAudiencePlan(item, {
    placement: entry.placement,
    placementLabel,
  });
  const captionVariants = buildSocialCaptionVariants(
    {
      title,
      originalTitle: getItemOriginalTitle(item),
      summary,
      rawSummary: getItemRawSummary(item),
      dek: cleanText(item.liveNewsDek || item.dek || ""),
      whyItMatters: cleanText(item.liveNewsWhyItMatters || item.whyItMatters || ""),
      keyPoints: (item.liveNewsKeyPoints || item.keyPoints || []).map(cleanText).filter(Boolean).slice(0, 3),
      tags: (item.tags || item.topicTags || []).map(cleanText).filter(Boolean).slice(0, 8),
      publicSafetyRelevant: item.publicSafetyRelevant === true,
      imageUrl: cleanText(item.imageUrl || item.thumbnailUrl || ""),
      generatedCardUrl: cleanText(item.generatedCardUrl || ""),
      category,
      source: sourceAttribution,
      publishedDate: formatSocialDate(item.publishedAt),
      placementLabel,
      linkState,
    },
    audiencePlan,
    socialMemory
  );
  const draft = {
    schemaVersion: "live-news-social-draft-v1",
    socialDraftId,
    storyId: cleanText(item.liveNewsStoryId || item.storyId || item.id || ""),
    placement: entry.placement,
    placementLabel,
    title,
    summary,
    category,
    sourceAttribution,
    originalSourceUrl: getOriginalSourceUrl(item),
    publishedAt: cleanText(item.publishedAt || ""),
    generatedAt,
    reviewStatus: "needs_human_review",
    publishStatus: "private_review_only",
    metaPostingStatus: "not_connected",
    autoPostAllowed: false,
    publicVisible: false,
    linkState,
    audiencePlan,
    teacherStack: SOCIAL_TEACHER_STACK.map((teacher) => teacher.name),
    learningHooks: buildSocialLearningHooks(audiencePlan),
    platforms: {
      instagram: {
        status: linkState.shareableNow ? "ready_for_manual_review" : "blocked_until_article_page_exists",
        caption: captionVariants.instagram.caption,
        primaryVariantId: captionVariants.instagram.primaryVariantId,
        variants: captionVariants.instagram.variants,
        mediaCard: buildMediaCardSpec(item, placementLabel),
        imagePlan: captionVariants.instagram.imagePlan,
      },
      facebook: {
        status: linkState.shareableNow ? "ready_for_manual_review" : "blocked_until_article_page_exists",
        caption: captionVariants.facebook.caption,
        primaryVariantId: captionVariants.facebook.primaryVariantId,
        variants: captionVariants.facebook.variants,
        link: linkState.exactArticleUrl,
      },
    },
    requirementsBeforeAutoPost: [
      "Approve a public Live News article page for the exact story.",
      "Confirm Facebook Page and Instagram professional account are connected in the same business portfolio.",
      "Store Meta tokens only in private environment variables.",
      "Pass Meta App Review for requested publishing permissions.",
      "Keep human approval enabled until social drafts have a proven quality record.",
    ],
    futureMetaPermissions: [
      "pages_show_list",
      "pages_read_engagement",
      "instagram_basic",
      "pages_manage_posts",
      "instagram_content_publish",
    ],
  };
  draft.teacherReport = evaluateSocialTeacherStack(draft);
  draft.supervisor = evaluateSocialDraft(draft);
  return draft;
}

function buildSocialPublisherRun(newsPayload, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const limit = Math.min(Math.max(Number(options.limit || DEFAULT_SOCIAL_LIMIT), 1), 50);
  const origin = normalizeOrigin(options.origin);
  const socialMemory = options.socialMemory || readSocialStyleMemory();
  const drafts = selectSocialItems(newsPayload, limit).map((entry) =>
    buildSocialDraft(entry, { origin, generatedAt, socialMemory })
  );
  const readyCount = drafts.filter((draft) => draft.supervisor.shareableNow).length;
  const blockedCount = drafts.length - readyCount;
  return {
    schemaVersion: SOCIAL_DRAFTS_SCHEMA_VERSION,
    mode: "private_review_only",
    autoPost: false,
    generatedAt,
    origin,
    run: {
      runId: `ln-social-run-${stableHash(`${generatedAt}:${drafts.map((draft) => draft.socialDraftId).join(",")}`, 14)}`,
      agentSequence: SOCIAL_AGENT_SEQUENCE,
      draftCount: drafts.length,
      readyForManualReview: readyCount,
      blockedUntilArticlePage: blockedCount,
      metaPostingEnabled: false,
      publicVisible: false,
      teacherStack: SOCIAL_TEACHER_STACK.map((teacher) => teacher.name),
    },
    learningPlan: buildSocialRunLearningPlan(drafts),
    drafts,
  };
}

function readSocialDraftStore() {
  return readJson(STORE_PATHS.socialDrafts, {
    schemaVersion: SOCIAL_DRAFTS_SCHEMA_VERSION,
    mode: "private_review_only",
    autoPost: false,
    updatedAt: null,
    run: null,
    learningPlan: null,
    drafts: [],
  });
}

function saveSocialPublisherRun(result) {
  writeJson(STORE_PATHS.socialDrafts, {
    schemaVersion: SOCIAL_DRAFTS_SCHEMA_VERSION,
    mode: "private_review_only",
    autoPost: false,
    updatedAt: new Date().toISOString(),
    run: result.run,
    learningPlan: result.learningPlan,
    drafts: result.drafts,
  });
}

module.exports = {
  DEFAULT_SOCIAL_LIMIT,
  SOCIAL_AGENT_SEQUENCE,
  SOCIAL_DRAFTS_SCHEMA_VERSION,
  buildSocialPublisherRun,
  evaluateSocialDraft,
  readSocialDraftStore,
  saveSocialPublisherRun,
};
