const { cleanText, clamp, splitSentences } = require("./text-utils");

const ROBOTIC_PHRASES = [
  "this story matters because",
  "according to reports",
  "in a major development",
  "the situation continues to unfold",
  "this comes as",
  "here is what you need to know",
];

function includesExactPhrase(text, phrase) {
  const normalizedText = cleanText(text).toLowerCase();
  const normalizedPhrase = cleanText(phrase).toLowerCase();
  return normalizedPhrase.length >= 28 && normalizedText.includes(normalizedPhrase);
}

function scoreAttribution(packet, draft) {
  let score = 0;
  if (packet.primarySourceName && draft.sourceAttribution) score += 25;
  if (packet.originalSourceUrl && draft.sourceBlock?.originalSourceUrl) score += 35;
  if ((draft.sourceBlock?.supportingSourceUrls || []).length > 0) score += 20;
  if (draft.sourceAttribution.toLowerCase().includes("source:")) score += 20;
  return clamp(score, 0, 100);
}

function scoreOriginality(packet, draft) {
  const publicText = [draft.headline, draft.dek, ...(draft.summary || [])].join(" ");
  const prohibited = packet.prohibitedPhrasesFromSources || [];
  const copied = prohibited.filter((phrase) => includesExactPhrase(publicText, phrase));
  let score = 100 - copied.length * 35;
  if (cleanText(draft.headline).toLowerCase() === cleanText(packet.originalPublisherTitle).toLowerCase()) {
    score -= 45;
  }
  return clamp(score, 0, 100);
}

function scoreStyle(draft, styleMemory = {}) {
  const publicText = [draft.headline, draft.dek, ...(draft.summary || [])].join(" ").toLowerCase();
  const roboticHits = ROBOTIC_PHRASES.filter((phrase) => publicText.includes(phrase));
  const recent = Array.isArray(styleMemory.recentFingerprints) ? styleMemory.recentFingerprints : [];
  const signature = draft.styleFingerprint?.signature;
  const duplicateStyle = signature && recent.some((fingerprint) => fingerprint.signature === signature);
  const variance = Number(draft.styleFingerprint?.sentenceVariance || 0);
  let score = 100 - roboticHits.length * 18;
  if (duplicateStyle) score -= 25;
  if (variance < 2) score -= 10;
  return clamp(score, 0, 100);
}

function scoreGrounding(packet, draft) {
  let score = 50;
  if (Array.isArray(packet.facts) && packet.facts.length >= 2) score += 20;
  if ((draft.keyPoints || []).length >= 3) score += 15;
  if (draft.summary?.every((line) => cleanText(line).length > 0)) score += 10;
  if (packet.disputedOrUnclearClaims?.length) score -= 10;
  return clamp(score, 0, 100);
}

function scoreReadability(draft) {
  const summary = draft.summary || [];
  const sentences = splitSentences([draft.dek, ...summary].join(" "));
  const longSentences = sentences.filter((sentence) => sentence.split(/\s+/).length > 32);
  let score = 100;
  if (!draft.dek || draft.dek.length > 220) score -= 15;
  if (summary.length < 2 || summary.length > 3) score -= 15;
  if (longSentences.length) score -= longSentences.length * 10;
  if ((draft.keyPoints || []).length < 3) score -= 15;
  return clamp(score, 0, 100);
}

function scoreSafety(packet, draft) {
  let score = 100;
  if (!draft.requiredHumanReview) score -= 50;
  if (draft.autoPublishAllowed) score -= 50;
  if (packet.sensitiveTopicFlags?.length && draft.reviewStatus !== "needs_human_review") score -= 35;
  return clamp(score, 0, 100);
}

function evaluateDraft(packet, draft, styleMemory = {}) {
  const scores = {
    attribution: scoreAttribution(packet, draft),
    originality: scoreOriginality(packet, draft),
    style: scoreStyle(draft, styleMemory),
    grounding: scoreGrounding(packet, draft),
    readability: scoreReadability(draft),
    safety: scoreSafety(packet, draft),
  };
  const overall = Math.round(
    scores.attribution * 0.22 +
      scores.originality * 0.2 +
      scores.style * 0.16 +
      scores.grounding * 0.18 +
      scores.readability * 0.12 +
      scores.safety * 0.12
  );
  const failures = Object.entries(scores)
    .filter(([, score]) => score < 75)
    .map(([name, score]) => ({ gate: name, score }));

  return {
    overall,
    scores,
    passed: failures.length === 0 && overall >= 80,
    failures,
    recommendation: failures.length ? "rewrite_or_editor_review" : "human_review_ready",
    evaluatedAt: new Date().toISOString(),
  };
}

module.exports = {
  ROBOTIC_PHRASES,
  evaluateDraft,
};
