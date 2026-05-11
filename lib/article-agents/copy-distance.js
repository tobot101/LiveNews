const { cleanText, clamp, splitSentences, tokenize, uniqueBy } = require("./text-utils");

const SYNONYM_CANONICAL = new Map([
  ["leaders", "official"],
  ["officials", "official"],
  ["lawmakers", "official"],
  ["councilmembers", "official"],
  ["approved", "approve"],
  ["approves", "approve"],
  ["advance", "approve"],
  ["advances", "approve"],
  ["advanced", "approve"],
  ["backed", "approve"],
  ["support", "approve"],
  ["supports", "approve"],
  ["security", "safety"],
  ["safe", "safety"],
  ["proposal", "plan"],
  ["program", "plan"],
  ["initiative", "plan"],
  ["overnight", "night"],
  ["late", "night"],
  ["late-night", "night"],
  ["public", "community"],
  ["review", "review"],
  ["tribute", "memorial"],
  ["remembered", "memorial"],
  ["dies", "death"],
  ["died", "death"],
]);

const STRUCTURE_WORDS = new Set([
  "after",
  "amid",
  "before",
  "during",
  "following",
  "from",
  "in",
  "into",
  "near",
  "on",
  "over",
  "through",
  "under",
  "with",
  "without",
]);

const COPY_DISTANCE_BRIDGE_TOKENS = new Set([
  "article",
  "backed",
  "context",
  "coverage",
  "details",
  "named",
  "news",
  "page",
  "readers",
  "report",
  "reported",
  "reporting",
  "reports",
  "source",
  "story",
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function flattenTexts(value) {
  return asArray(value).flatMap((entry) => {
    if (Array.isArray(entry)) return flattenTexts(entry);
    if (entry && typeof entry === "object") {
      return cleanText(entry.text || entry.fact || entry.title || entry.summary || entry.value || "");
    }
    return cleanText(entry);
  }).filter(Boolean);
}

function uniqueClean(values) {
  return uniqueBy(flattenTexts(values), (value) => value.toLowerCase());
}

function words(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9%$]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function canonicalToken(token) {
  const clean = cleanText(token).toLowerCase().replace(/[^a-z0-9-]+/g, "");
  return SYNONYM_CANONICAL.get(clean) || clean;
}

function canonicalTokens(value) {
  return tokenize(value).map(canonicalToken).filter(Boolean);
}

function ngrams(list, n) {
  const grams = [];
  for (let index = 0; index <= list.length - n; index += 1) {
    grams.push(list.slice(index, index + n).join(" "));
  }
  return grams;
}

function overlapRatio(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size || !rightSet.size) return 0;
  const shared = [...leftSet].filter((item) => rightSet.has(item)).length;
  return shared / Math.min(leftSet.size, rightSet.size);
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size || !rightSet.size) return 0;
  const shared = [...leftSet].filter((item) => rightSet.has(item)).length;
  return shared / new Set([...leftSet, ...rightSet]).size;
}

function allowedFactTokens(factMap = {}) {
  return new Set(
    uniqueClean([
      factMap.people,
      factMap.organizations,
      factMap.places,
      factMap.projects,
      factMap.dates,
    ])
      .flatMap(words)
      .filter((token) => token.length > 2)
  );
}

function stripAllowedFactTokens(tokens, factMap = {}) {
  const allowed = allowedFactTokens(factMap);
  return tokens.filter((token) => !allowed.has(token) && !COPY_DISTANCE_BRIDGE_TOKENS.has(token));
}

function calculateLexicalOverlap(candidate, sourceTexts) {
  const candidateTokens = canonicalTokens(candidate);
  return Math.max(0, ...uniqueClean(sourceTexts).map((sourceText) =>
    overlapRatio(candidateTokens, canonicalTokens(sourceText))
  ));
}

function calculateNgramOverlap(candidate, sourceTexts, n = 3) {
  const candidateGrams = ngrams(canonicalTokens(candidate), n);
  return Math.max(0, ...uniqueClean(sourceTexts).map((sourceText) =>
    overlapRatio(candidateGrams, ngrams(canonicalTokens(sourceText), n))
  ));
}

function calculatePhraseOverlap(candidate, sourceTexts) {
  return Math.max(
    calculateNgramOverlap(candidate, sourceTexts, 4),
    calculateNgramOverlap(candidate, sourceTexts, 5),
    calculateNgramOverlap(candidate, sourceTexts, 6)
  );
}

function wordShape(token) {
  const clean = canonicalToken(token);
  if (!clean) return "";
  if (/^\d+$/.test(clean)) return "NUM";
  if (STRUCTURE_WORDS.has(clean)) return clean;
  if (clean.length <= 3) return "SHORT";
  return `${clean.slice(0, 3)}${clean.length}`;
}

function sentenceSkeleton(value) {
  const sourceWords = words(value);
  if (!sourceWords.length) return [];
  return sourceWords.map(wordShape).filter(Boolean);
}

function skeletonSimilarity(candidateSentence, sourceSentence) {
  const candidateSkeleton = sentenceSkeleton(candidateSentence);
  const sourceSkeleton = sentenceSkeleton(sourceSentence);
  if (!candidateSkeleton.length || !sourceSkeleton.length) return 0;
  const lengthSimilarity = Math.min(candidateSkeleton.length, sourceSkeleton.length) / Math.max(candidateSkeleton.length, sourceSkeleton.length);
  const trigramSimilarity = overlapRatio(ngrams(candidateSkeleton, 3), ngrams(sourceSkeleton, 3));
  const canonicalSimilarity = overlapRatio(canonicalTokens(candidateSentence), canonicalTokens(sourceSentence));
  const structureWordsCandidate = words(candidateSentence).filter((word) => STRUCTURE_WORDS.has(canonicalToken(word)));
  const structureWordsSource = words(sourceSentence).filter((word) => STRUCTURE_WORDS.has(canonicalToken(word)));
  const structureSimilarity = overlapRatio(structureWordsCandidate, structureWordsSource);
  return Number(clamp(
    trigramSimilarity * 0.38 +
      canonicalSimilarity * 0.32 +
      lengthSimilarity * 0.18 +
      structureSimilarity * 0.12,
    0,
    1
  ).toFixed(3));
}

function calculateStructuralSimilarity(candidate, sourceTexts) {
  const candidateSentences = splitSentences(candidate);
  const sourceSentences = uniqueClean(sourceTexts).flatMap(splitSentences);
  if (!candidateSentences.length || !sourceSentences.length) return 0;
  let maxScore = 0;
  for (const candidateSentence of candidateSentences) {
    for (const sourceSentence of sourceSentences) {
      maxScore = Math.max(maxScore, skeletonSimilarity(candidateSentence, sourceSentence));
    }
  }
  return maxScore;
}

function detectDistinctiveSourcePhrases(candidate, sourcePhrases = []) {
  const normalizedCandidate = words(candidate).join(" ");
  return uniqueClean(sourcePhrases)
    .filter((phrase) => !phrase.startsWith("pattern:"))
    .filter((phrase) => words(phrase).length >= 4)
    .filter((phrase) => normalizedCandidate.includes(words(phrase).join(" ")))
    .slice(0, 8);
}

function sourceTextsFromFactMap(factMap = {}) {
  return uniqueClean([
    factMap.originalPublisherTitle,
    factMap.sourceSummary,
  ]);
}

function getCopyDistanceScore(candidate, sourceTexts = [], factMap = {}) {
  const providedSourceTexts = uniqueClean(sourceTexts);
  const allSourceTexts = providedSourceTexts.length ? providedSourceTexts : sourceTextsFromFactMap(factMap);
  const lexicalOverlapRaw = calculateLexicalOverlap(candidate, allSourceTexts);
  const candidateTokensWithoutFacts = stripAllowedFactTokens(canonicalTokens(candidate), factMap);
  const sourceTextsWithoutFacts = allSourceTexts.map((sourceText) =>
    stripAllowedFactTokens(canonicalTokens(sourceText), factMap).join(" ")
  );
  const lexicalOverlapWithoutFacts = Math.max(0, ...sourceTextsWithoutFacts.map((sourceText) =>
    overlapRatio(candidateTokensWithoutFacts, sourceText.split(/\s+/).filter(Boolean))
  ));
  const phraseOverlap = calculatePhraseOverlap(candidate, allSourceTexts);
  const structuralSimilarity = calculateStructuralSimilarity(candidate, allSourceTexts);
  const distinctivePhrases = detectDistinctiveSourcePhrases(candidate, factMap.doNotCopyPhrases || allSourceTexts);
  const nonFactSourceTokenCounts = sourceTextsWithoutFacts.map((sourceText) => sourceText.split(/\s+/).filter(Boolean).length);
  const factOnlyMatch = Math.max(0, ...nonFactSourceTokenCounts) < 3 && lexicalOverlapRaw >= 0.75;
  const lexicalSignal = factOnlyMatch ? 0 : Math.min(lexicalOverlapRaw, lexicalOverlapWithoutFacts + 0.25);
  const phraseSignal = factOnlyMatch ? 0 : phraseOverlap;
  const structureSignal = factOnlyMatch ? 0 : structuralSimilarity;
  const weightedRisk = clamp(
    Math.max(lexicalSignal * 0.78, lexicalOverlapWithoutFacts * 0.9) * 0.34 +
      phraseSignal * 0.27 +
      structureSignal * 0.27 +
      (distinctivePhrases.length ? 0.24 : 0),
    0,
    1
  );
  let risk = "low";
  if (
    distinctivePhrases.length ||
    phraseSignal >= 0.72 ||
    structureSignal >= 0.84 ||
    (lexicalOverlapRaw >= 0.92 && lexicalOverlapWithoutFacts >= 0.58 && (phraseSignal >= 0.45 || structureSignal >= 0.82))
  ) {
    risk = "blocked";
  } else if (
    weightedRisk >= 0.7 ||
    phraseSignal >= 0.52 ||
    structureSignal >= 0.82 ||
    (lexicalOverlapRaw >= 0.95 && lexicalOverlapWithoutFacts >= 0.75 && structureSignal >= 0.78)
  ) {
    risk = "high";
  } else if (weightedRisk >= 0.42 || lexicalOverlapWithoutFacts >= 0.58 || structureSignal >= 0.62) {
    risk = "medium";
  }
  const score = Math.round(clamp(100 - weightedRisk * 100 - (risk === "blocked" ? 20 : risk === "high" ? 10 : 0), 0, 100));
  const reasons = [
    lexicalOverlapRaw >= 0.78 ? "High lexical overlap with source wording." : "",
    lexicalOverlapWithoutFacts >= 0.58 ? "Overlap remains high after allowing names, places, dates, and official terms." : "",
    phraseSignal >= 0.52 ? "Source phrase sequence is too similar." : "",
    structureSignal >= 0.62 ? "Sentence skeleton is too close to source structure." : "",
    distinctivePhrases.length ? "Distinctive source phrase appears in candidate." : "",
  ].filter(Boolean);

  return {
    score,
    risk,
    lexicalOverlap: Number(lexicalOverlapRaw.toFixed(3)),
    phraseOverlap: Number(phraseOverlap.toFixed(3)),
    structuralSimilarity: Number(structuralSimilarity.toFixed(3)),
    distinctivePhrases,
    reasons,
    recommendedStrategy: suggestCopyRiskRewriteStrategy({ risk, reasons, distinctivePhrases }),
  };
}

function explainCopyRisk(candidate, sourceTexts = [], factMap = {}) {
  const risk = getCopyDistanceScore(candidate, sourceTexts, factMap);
  return {
    ...risk,
    explanation: risk.risk === "low"
      ? "Copy distance is acceptable. The candidate uses source-backed facts without matching publisher wording or structure."
      : `${risk.risk} copy risk: ${risk.reasons.join(" ") || "Candidate is too close to source wording."}`,
  };
}

function suggestCopyRiskRewriteStrategy(copyRisk = {}) {
  const risk = typeof copyRisk.risk === "string" ? copyRisk.risk : "low";
  if (risk === "low") return "No rewrite required; keep source attribution and fact checks.";
  if (copyRisk.distinctivePhrases?.length) {
    return "Rebuild from the fact map and remove distinctive source phrases before rewriting.";
  }
  if ((copyRisk.reasons || []).some((reason) => /skeleton|structure/i.test(reason))) {
    return "Change the opening angle and sentence order; do not mirror the publisher's sentence skeleton.";
  }
  if ((copyRisk.reasons || []).some((reason) => /lexical|phrase/i.test(reason))) {
    return "Use the same facts with different phrasing, sentence order, and Live News voice.";
  }
  return "Rewrite from confirmed facts, not source sentences.";
}

module.exports = {
  calculateLexicalOverlap,
  calculatePhraseOverlap,
  calculateNgramOverlap,
  calculateStructuralSimilarity,
  detectDistinctiveSourcePhrases,
  getCopyDistanceScore,
  explainCopyRisk,
  suggestCopyRiskRewriteStrategy,
};
