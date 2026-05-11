const { cleanText, clamp, splitSentences, stableHash } = require("./text-utils");
const {
  applyOriginalWritingPackageToDraft,
  buildOriginalStoryWritingPackage,
} = require("./original-writing-package");

const DRAFT_SCHEMA_VERSION = "live-news-draft-v1";
const SOFT_REWRITES = [
  [/\bapproved\b/gi, "advanced"],
  [/\bapprove\b/gi, "advance"],
  [/\bapproves\b/gi, "advances"],
  [/\bdispatching\b/gi, "sending"],
  [/\bprobe\b/gi, "investigation"],
  [/\bslams\b/gi, "criticizes"],
  [/\bblasted\b/gi, "criticized"],
  [/\bamid\b/gi, "as"],
  [/\s*&\s*/g, " and "],
];
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

function sentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function capitalize(value) {
  const text = cleanText(value);
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function lowerFirst(value) {
  const text = cleanText(value);
  return text ? `${text[0].toLowerCase()}${text.slice(1)}` : "";
}

function applySoftRewrites(value) {
  return SOFT_REWRITES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), cleanText(value));
}

function rewriteSourceSentence(value) {
  let text = applySoftRewrites(value)
    .replace(/^(watch|video|listen|live updates?|breaking|photos?):\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!text) return "";
  const transforms = [
    [/^city leaders (?:advanced|advance|cleared) (?:a |the )?(.+?) after (.+)$/i, "A $1 advanced after $2"],
    [/^(.+?) (?:advanced|advance|cleared) (?:a |the )?(.+?) after (.+)$/i, "$2 advanced after $3"],
    [/^(.+?) says (.+)$/i, "$2, $1 says"],
    [/^the plan includes (.+?) and (.+)$/i, "$2 and $1 are part of the plan"],
    [/^the plan includes (.+)$/i, "$1 are part of the plan"],
    [/^the changes include (.+?) and (.+)$/i, "$2 and $1 are part of the changes"],
    [/^the changes include (.+)$/i, "$1 are part of the changes"],
    [/^(.+?) are expected to see (.+)$/i, "$1 could see $2"],
    [/^(.+?) is expected to see (.+)$/i, "$1 could see $2"],
  ];
  for (const [pattern, replacement] of transforms) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement);
      break;
    }
  }
  text = text.replace(/^A ([aeiou])/i, "An $1");
  return sentence(capitalize(text));
}

function buildHeadline(packet) {
  const original = cleanText(packet.originalPublisherTitle || packet.focusPhrase || "Live News story");
  const rewritten = rewriteSourceSentence(original).replace(/[.!?]$/, "");
  let headline = rewritten
    .replace(/^A ([a-z])/i, (_, letter) => letter.toUpperCase())
    .replace(/^The ([a-z])/i, (_, letter) => letter.toUpperCase());
  if (headline.toLowerCase() === original.toLowerCase()) {
    const focus = cleanText(packet.focusPhrase || "");
    headline = focus && focus.toLowerCase() !== original.toLowerCase()
      ? `${capitalize(focus)} in focus`
      : `Latest context on ${original}`;
  }
  return headline || capitalize(cleanText(packet.focusPhrase || original));
}

function buildDek(packet, summary) {
  if (summary?.[0] && summary?.[1]) return `${summary[0]} ${summary[1]}`;
  const second = cleanText(summary?.[1] || "");
  if (second) return second;
  return cleanText(summary?.[0] || buildHeadline(packet));
}

function buildSummary(packet) {
  const candidates = Array.isArray(packet.summaryCandidates) ? packet.summaryCandidates : [];
  const rewritten = candidates.map(rewriteSourceSentence).filter(Boolean);
  if (!rewritten.length) {
    return [rewriteSourceSentence(packet.originalPublisherTitle || packet.focusPhrase)].filter(Boolean);
  }
  return rewritten.slice(0, 3);
}

function buildKeyPoints(packet) {
  const points = [];
  const summaryFacts = (packet.summaryCandidates || []).map(rewriteSourceSentence).filter(Boolean);
  points.push(...summaryFacts);
  if (packet.primarySourceName) {
    points.push(`Lead source: ${packet.primarySourceName}.`);
  }
  if (packet.originalSourceUrl) {
    points.push("Original source link is attached for attribution and reader verification.");
  }
  if (packet.crossSourceCount > 1) {
    points.push(`${packet.crossSourceCount} source entries are available for added context.`);
  }
  if (packet.sourcePublishedAt) {
    points.push(`Latest source timestamp: ${packet.sourcePublishedAt}.`);
  }
  if (packet.sensitiveTopicFlags?.length) {
    points.push("Sensitivity flags are present, so human review is required.");
  }
  return points.slice(0, 5);
}

function buildWhyItMatters(packet, headline, summary) {
  const event = lowerFirst(headline).replace(/^(a|an|the)\s+/i, "").replace(/[.!?]$/, "");
  const detail = cleanText(summary?.[1] || summary?.find((line) => !line.toLowerCase().includes(event.slice(0, 24).toLowerCase())) || "");
  if (!event || !detail) return "";
  const cleanDetail = lowerFirst(detail).replace(/[.!?]$/, "");
  return sentence(`The ${event} matters because ${cleanDetail}`);
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
  const headline = buildHeadline(packet, style);
  const summary = buildSummary(packet, style);
  const dek = buildDek(packet, summary);
  const whyItMatters = buildWhyItMatters(packet, headline, summary);
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
    headline,
    title: headline,
    dek,
    description: summary.slice(0, 2).join(" "),
    summary,
    sourceSummary: packet.summaryCandidates.join(" "),
    sourceFacts: [
      ...(packet.summaryCandidates || []),
      ...(packet.facts || []).map((fact) => fact.text || fact),
    ].map(cleanText).filter(Boolean),
    keyPoints: buildKeyPoints(packet),
    whyItMatters,
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
  const writingPackage = buildOriginalStoryWritingPackage(draft);
  Object.assign(draft, applyOriginalWritingPackageToDraft(draft, writingPackage));
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
