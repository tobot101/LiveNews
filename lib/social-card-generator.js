const { cleanText } = require("./article-agents/text-utils");

const INSTAGRAM_CARD_FORMAT = "feed_card";
const INSTAGRAM_BRAND_LABEL = "Live News";
const INSTAGRAM_CARD_SIZE = {
  width: 1080,
  height: 1080,
};

function isDurablePublicImageUrl(value) {
  const raw = cleanText(value);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url.hostname)) return false;
    return /\.(jpe?g|png|webp)(\?|#|$)/i.test(url.pathname + url.search + url.hash);
  } catch {
    return false;
  }
}

function pickDurableImageUrl(context = {}) {
  return [
    context.imageUrl,
    context.thumbnailUrl,
    context.generatedCardUrl,
    context.cardUrl,
  ].map(cleanText).find(isDurablePublicImageUrl) || "";
}

function getOriginFromExactArticleUrl(value) {
  const raw = cleanText(value);
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return "";
  }
}

function getStorySlugFromExactArticleUrl(value) {
  const raw = cleanText(value);
  try {
    const url = new URL(raw);
    return cleanText(url.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    if (raw.startsWith("/stories/")) return cleanText(raw.split("/").filter(Boolean).pop() || "");
    return "";
  }
}

function buildGeneratedCardUrl(context = {}) {
  const exactArticleUrl = cleanText(context.exactArticleUrl || "");
  const origin = cleanText(context.origin || context.publicOrigin || getOriginFromExactArticleUrl(exactArticleUrl)).replace(/\/$/, "");
  const slug = getStorySlugFromExactArticleUrl(exactArticleUrl).replace(/[^a-z0-9-]/gi, "").toLowerCase();
  if (!origin || !slug) return "";
  return `${origin}/social-cards/${slug}.png`;
}

function buildInstagramCardPlan(context = {}) {
  const cardTitle = cleanText(context.cardTitle || context.shortTitle || context.title || "Live News story");
  const cardSubtitle = cleanText(context.cardSubtitle || context.summary || context.dek || "");
  const sourceLabel = cleanText(context.sourceLabel || context.sourceAttribution || context.source || "Original source");
  const exactArticleUrl = cleanText(context.exactArticleUrl || "");
  const approvedStoryImageUrl = [
    context.imageUrl,
    context.thumbnailUrl,
  ].map(cleanText).find(isDurablePublicImageUrl) || "";
  const existingGeneratedCardUrl = isDurablePublicImageUrl(context.generatedCardUrl) ? cleanText(context.generatedCardUrl) : "";
  const plannedGeneratedCardUrl = existingGeneratedCardUrl || buildGeneratedCardUrl(context);
  const durableImageUrl = approvedStoryImageUrl || pickDurableImageUrl(context) || plannedGeneratedCardUrl;
  const hasExactStoryUrl = /\/stories\/[^/]+/i.test(exactArticleUrl);
  const hasUsableCardText = Boolean(cardTitle && sourceLabel);
  const renderStatus = durableImageUrl
    ? "ready"
    : hasUsableCardText
      ? "needs_rendering"
      : "needs_image";

  return {
    platform: "instagram",
    format: INSTAGRAM_CARD_FORMAT,
    width: INSTAGRAM_CARD_SIZE.width,
    height: INSTAGRAM_CARD_SIZE.height,
    cardTitle,
    cardSubtitle,
    sourceLabel,
    brandLabel: INSTAGRAM_BRAND_LABEL,
    exactArticleUrl,
    imageSource: approvedStoryImageUrl ? "approved_story_image" : plannedGeneratedCardUrl ? "generated_live_news_card" : "generated_card_needed",
    imageUrl: durableImageUrl,
    generatedCardUrl: plannedGeneratedCardUrl,
    generatedCardPath: plannedGeneratedCardUrl ? new URL(plannedGeneratedCardUrl).pathname : "",
    altText: cleanText(context.altText || `${cardTitle}. Live News coverage with attribution to ${sourceLabel}.`),
    renderStatus,
    publishable: Boolean(renderStatus === "ready" && hasExactStoryUrl),
    missing: [
      !hasExactStoryUrl ? "exact /stories/... article URL" : "",
      renderStatus === "needs_rendering" ? "rendered durable social card image" : "",
      renderStatus === "needs_image" ? "card title/source text or durable image" : "",
    ].filter(Boolean),
    nextSteps: durableImageUrl
      ? ["Use the durable public image URL for Instagram media readiness."]
      : ["Render the generated Live News card to a durable public HTTPS image URL before Instagram publishing."],
  };
}

module.exports = {
  INSTAGRAM_CARD_FORMAT,
  buildGeneratedCardUrl,
  buildInstagramCardPlan,
  isDurablePublicImageUrl,
};
