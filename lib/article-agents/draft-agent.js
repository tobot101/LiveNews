const { cleanText, clamp, splitSentences, stableHash } = require("./text-utils");

const DRAFT_SCHEMA_VERSION = "live-news-draft-v1";
const STYLE_VARIANTS = [
  {
    openingType: "direct_fact",
    articleShape: "quick_brief",
    sentenceRhythm: "short_and_direct",
    headlinePrefix: "What To Know About",
  },
  {
    openingType: "source_cluster",
    articleShape: "context_card",
    sentenceRhythm: "mixed_context",
    headlinePrefix: "Latest Context On",
  },
  {
    openingType: "reader_impact",
    articleShape: "why_it_matters",
    sentenceRhythm: "calm_explainer",
    headlinePrefix: "Why",
  },
  {
    openingType: "timeline_first",
    articleShape: "developing_update",
    sentenceRhythm: "compact_update",
    headlinePrefix: "New Details Around",
  },
  {
    openingType: "accountability",
    articleShape: "source_checked_brief",
    sentenceRhythm: "measured",
    headlinePrefix: "Live News Tracks",
  },
];

function chooseStyle(packet) {
  const hash = parseInt(stableHash(packet.storyId || packet.slug || packet.focusPhrase, 8), 16);
  return STYLE_VARIANTS[hash % STYLE_VARIANTS.length];
}

function buildHeadline(packet, style) {
  const focus = cleanText(packet.focusPhrase || packet.originalPublisherTitle || "This Story");
  if (style.headlinePrefix === "Why") {
    return `Why ${focus} Matters Now`;
  }
  return `${style.headlinePrefix} ${focus}`;
}

function buildDek(packet, style) {
  const source = cleanText(packet.primarySourceName || "the original source");
  const category = cleanText(packet.category || "Top");
  const count = Number(packet.crossSourceCount || 1);
  if (style.openingType === "source_cluster" && count > 1) {
    return `Live News is tracking this ${category.toLowerCase()} story through ${count} source entries, led by ${source}.`;
  }
  if (style.openingType === "reader_impact") {
    return `A clear look at the latest source-linked details and why the story may matter to readers.`;
  }
  if (style.openingType === "timeline_first" && packet.sourcePublishedAt) {
    return `The latest source timestamp is ${packet.sourcePublishedAt}, with Live News holding the draft for review.`;
  }
  return `Live News prepared this review-only brief from source-linked coverage led by ${source}.`;
}

function buildSummary(packet, style) {
  const source = cleanText(packet.primarySourceName || "the original source");
  const focus = cleanText(packet.focusPhrase || "this story");
  const category = cleanText(packet.category || "Top").toLowerCase();
  const sourceCount = Number(packet.crossSourceCount || 1);
  const candidates = Array.isArray(packet.summaryCandidates) ? packet.summaryCandidates : [];
  const sourceContext = sourceCount > 1
    ? `${source} is the lead source, with ${sourceCount - 1} additional source entries grouped for context.`
    : `${source} is the lead source for this draft.`;

  const lines = {
    direct_fact: [
      `${focus} is a ${category} story Live News is holding for editor review before publication.`,
      sourceContext,
    ],
    source_cluster: [
      `Live News grouped the available coverage around ${focus} into a source packet before drafting.`,
      sourceContext,
    ],
    reader_impact: [
      `The key reader value is clarity: what happened, where the sourcing comes from, and what remains unconfirmed.`,
      `${focus} is being handled as a review-only story so the final page can stay accurate and readable.`,
    ],
    timeline_first: [
      `The story packet records the latest source timestamp and keeps the draft tied to source-linked facts.`,
      `${focus} should not publish until an editor checks the wording, source link, and sensitivity flags.`,
    ],
    accountability: [
      `This draft is built from a structured source packet rather than copied publisher wording.`,
      `${focus} remains in review so attribution, tone, and factual support can be checked before readers see it.`,
    ],
  };

  const summary = lines[style.openingType] || lines.direct_fact;
  if (candidates.length && candidates[0].length < 180) {
    summary.push("The source packet includes a short publisher summary, but the public draft must use original Live News wording.");
  }
  return summary.slice(0, 3);
}

function buildKeyPoints(packet) {
  const points = [];
  if (packet.primarySourceName) {
    points.push(`Lead source: ${packet.primarySourceName}.`);
  }
  if (packet.originalSourceUrl) {
    points.push("Original source link is attached for attribution and reader verification.");
  }
  if (packet.crossSourceCount > 1) {
    points.push(`${packet.crossSourceCount} source entries are grouped with this story packet.`);
  }
  if (packet.sourcePublishedAt) {
    points.push(`Latest source timestamp: ${packet.sourcePublishedAt}.`);
  }
  if (packet.sensitiveTopicFlags?.length) {
    points.push("Sensitivity flags are present, so human review is required.");
  }
  return points.slice(0, 5);
}

function buildSourceBlock(packet) {
  return {
    attribution: cleanText(packet.attributionLine || `Source: ${packet.primarySourceName || "original source"}.`),
    originalSourceUrl: cleanText(packet.originalSourceUrl || ""),
    supportingSourceUrls: (packet.supportingSources || [])
      .map((source) => source.sourceUrl)
      .filter(Boolean)
      .slice(0, 6),
  };
}

function fingerprintDraft(draft, style) {
  const text = [draft.headline, draft.dek, ...(draft.summary || [])].join(" ");
  const sentences = splitSentences(text);
  const lengths = sentences.map((sentence) => sentence.split(/\s+/).filter(Boolean).length);
  const averageSentenceWords = lengths.length
    ? Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length)
    : 0;
  const variance = lengths.length
    ? Math.round(
        lengths.reduce((sum, value) => sum + Math.abs(value - averageSentenceWords), 0) / lengths.length
      )
    : 0;
  return {
    openingType: style.openingType,
    articleShape: style.articleShape,
    sentenceRhythm: style.sentenceRhythm,
    averageSentenceWords,
    sentenceVariance: variance,
    signature: stableHash(`${style.openingType}:${style.articleShape}:${averageSentenceWords}:${draft.headline}`, 12),
  };
}

function generateDraft(packet, options = {}) {
  const style = chooseStyle(packet);
  const draft = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    storyId: packet.storyId,
    slug: packet.slug,
    canonicalLiveNewsUrl: packet.canonicalLiveNewsUrl,
    category: packet.category,
    urgencyState: packet.urgencyState,
    primarySourceName: packet.primarySourceName,
    thumbnailUrl: packet.thumbnailUrl,
    imageCredit: packet.imageCredit,
    headline: buildHeadline(packet, style),
    dek: buildDek(packet, style),
    summary: buildSummary(packet, style),
    keyPoints: buildKeyPoints(packet),
    whyItMatters: cleanText(packet.whyItMattersCandidate || ""),
    sourceAttribution: cleanText(packet.attributionLine || ""),
    sourceBlock: buildSourceBlock(packet),
    originalPublisherTitle: cleanText(packet.originalPublisherTitle || ""),
    prohibitedPhrasesFromSources: packet.prohibitedPhrasesFromSources || [],
    requiredHumanReview: true,
    reviewStatus: "needs_human_review",
    publishStatus: "private_review_only",
    autoPublishAllowed: false,
    riskFlags: packet.sensitiveTopicFlags || [],
    generatedAt: options.generatedAt || new Date().toISOString(),
    promptVersion: "live-news-review-draft-v1",
    modelMode: "deterministic-local-agent",
  };
  draft.styleFingerprint = fingerprintDraft(draft, style);
  draft.readability = {
    summaryParagraphs: draft.summary.length,
    keyPointCount: draft.keyPoints.length,
    estimatedReadingSeconds: clamp(
      Math.round(
        [draft.headline, draft.dek, ...draft.summary, ...draft.keyPoints, draft.whyItMatters]
          .join(" ")
          .split(/\s+/)
          .filter(Boolean).length / 3
      ),
      10,
      90
    ),
  };
  return draft;
}

module.exports = {
  DRAFT_SCHEMA_VERSION,
  generateDraft,
};
