const { cleanText, splitSentences, tokenize } = require("./text-utils");

const FALLBACK_SUMMARY = "Read the original source for the full report.";
const MIN_SUMMARY_WORDS = 18;
const MAX_SUMMARY_WORDS = 38;
const RECENT_SUMMARY_LIMIT = 12;

const ROBOTIC_OPENERS = [
  /^this article discusses\b/i,
  /^this article focuses\b/i,
  /^the article discusses\b/i,
  /^the article focuses\b/i,
  /^the report says\b/i,
  /^the report follows\b/i,
  /^according to\b/i,
  /^in a recent development\b/i,
  /^officials announced\b/i,
  /^the story highlights\b/i,
  /^this update centers\b/i,
  /^the key development is\b/i,
  /^live news\b/i,
];

const FILLER_PATTERNS = [
  /\brecent development\b/i,
  /\bimportant story\b/i,
  /\bdeveloping story\b/i,
  /\bfull context\b/i,
  /\bsource-linked\b/i,
  /\bconfirmed details\b/i,
  /\blead source\b/i,
  /\bsource cluster\b/i,
  /\btracking this\b/i,
  /\bcontinues to unfold\b/i,
  /\bvarious\b/i,
];

const DATABASE_PATTERNS = [
  /\bthis (national|international|business|tech|sports|entertainment|local|top) story\b/i,
  /\bcategory\b/i,
  /\bmetadata\b/i,
  /\bsource entries\b/i,
  /\bsummary\b/i,
];

const REPEAT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const HUMAN_ANGLE_WORDS = {
  Local: ["resident", "residents", "city", "local", "nearby", "community", "place"],
  Business: ["company", "market", "money", "workers", "consumers", "customers", "investors", "profit", "cost"],
  Tech: ["product", "platform", "users", "privacy", "tools", "app", "software", "device"],
  Sports: ["team", "player", "fans", "game", "match", "season", "race", "coach"],
  Entertainment: ["release", "audience", "fans", "event", "music", "film", "show", "artist", "actor"],
  International: ["country", "countries", "conflict", "policy", "global", "government", "leaders", "border"],
  National: ["public", "policy", "court", "government", "people", "workers", "state", "states"],
  Top: ["public", "people", "readers", "policy", "company", "team", "country", "users"],
};

function wordCount(value) {
  return getWords(value).length;
}

function getWords(value) {
  return cleanText(value)
    .replace(/U\.S\./g, "US")
    .replace(/[^A-Za-z0-9%$]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function getRepeatWords(value) {
  return getWords(value).map((word) => word.toLowerCase());
}

function getFirstWords(value, count = 4) {
  return getRepeatWords(value).slice(0, count).join(" ");
}

function getSentencePattern(value) {
  const sentences = splitSentences(value);
  const words = getRepeatWords(value);
  const first = words[0] || "";
  const second = words[1] || "";
  const third = words[2] || "";
  const length = wordCount(value);
  const lengthBand = length <= 22 ? "short" : length <= 30 ? "medium" : "long";
  const opener =
    ["after", "as", "for", "with", "without"].includes(first)
      ? "context_first"
      : first === "the" || first === "a" || first === "an"
        ? "article_first"
        : /^[A-Z]/.test(cleanText(value)[0] || "")
          ? "subject_first"
          : "plain_first";
  const verbShape = /ing$/.test(third || second) ? "gerund" : /ed$/.test(third || second) ? "past" : "direct";
  return `${sentences.length}:${lengthBand}:${opener}:${first}:${verbShape}`;
}

function getPhraseSet(value, size = 3) {
  const words = getRepeatWords(value);
  const phrases = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    const phraseWords = words.slice(index, index + size);
    if (phraseWords.every((word) => REPEAT_STOPWORDS.has(word))) continue;
    phrases.add(phraseWords.join(" "));
  }
  return phrases;
}

function getRepeatedPhrases(summary, recentSummaries) {
  const phrases = getPhraseSet(summary, 4);
  const repeated = [];
  for (const recent of recentSummaries) {
    const recentPhrases = getPhraseSet(recent, 4);
    for (const phrase of phrases) {
      if (recentPhrases.has(phrase)) repeated.push(phrase);
    }
  }
  return Array.from(new Set(repeated)).slice(0, 4);
}

function getExactPhraseFailures(source, candidate, minWords = 8) {
  const sourceWords = getRepeatWords(source);
  const candidateText = getRepeatWords(candidate).join(" ");
  if (!sourceWords.length || !candidateText) return [];
  const failures = [];
  for (let size = minWords; size <= Math.max(minWords, 12); size += 1) {
    for (let index = 0; index <= sourceWords.length - size; index += 1) {
      const phrase = sourceWords.slice(index, index + size).join(" ");
      if (phrase.length > 42 && candidateText.includes(phrase)) {
        failures.push(phrase);
      }
    }
  }
  return Array.from(new Set(failures)).slice(0, 3);
}

function getTokenSimilarity(source, candidate) {
  const sourceTokens = new Set(tokenize(source));
  const candidateTokens = new Set(tokenize(candidate));
  if (!sourceTokens.size || !candidateTokens.size) return 0;
  const shared = [...candidateTokens].filter((token) => sourceTokens.has(token)).length;
  const total = new Set([...sourceTokens, ...candidateTokens]).size;
  return total ? shared / total : 0;
}

function isTooCloseToRss(item, summary) {
  const rss = cleanText(item?.summary || item?.sourceSummary || "");
  if (!rss || summary === FALLBACK_SUMMARY) return false;
  const exact = cleanText(rss).toLowerCase() === cleanText(summary).toLowerCase();
  const phraseFailures = getExactPhraseFailures(rss, summary, 8);
  const similarity = getTokenSimilarity(rss, summary);
  const sourceLength = wordCount(rss);
  const candidateLength = wordCount(summary);
  const lengthRatio = sourceLength ? candidateLength / sourceLength : 0;
  return exact || phraseFailures.length > 0 || (similarity >= 0.64 && lengthRatio >= 0.45);
}

function hasUsefulHumanAngle(item, summary) {
  const text = cleanText(summary).toLowerCase();
  const category = cleanText(item?.category || "Top");
  const categoryWords = HUMAN_ANGLE_WORDS[category] || HUMAN_ANGLE_WORDS.Top;
  const hasCategoryAngle = categoryWords.some((word) => text.includes(word));
  const factTokens = tokenize([item?.title, item?.summary, item?.sourceName, item?.category].filter(Boolean).join(" "));
  const hasSpecificFact = factTokens.some((token) => text.includes(token));
  const hasAction = /\b(will|could|may|faces?|adds?|cuts?|drops?|rises?|falls?|wins?|loses?|miss(?:es)?|plans?|approves?|blocks?|changes?|returns?|warns?|seeks?|moves?|starts?|ends?|opens?|closes?|costs?|affects?|matters?)\b/i.test(text);
  return hasSpecificFact && (hasCategoryAngle || hasAction);
}

function evaluateRepetition(summary, recentSummaries) {
  if (summary === FALLBACK_SUMMARY) {
    return {
      repeatedFirstWords: false,
      repeatedPattern: false,
      repeatedPhrases: [],
    };
  }
  const firstWords = getFirstWords(summary);
  const pattern = getSentencePattern(summary);
  const recentFirstWords = recentSummaries.map((recent) => getFirstWords(recent));
  const recentPatterns = recentSummaries.map((recent) => getSentencePattern(recent));
  return {
    repeatedFirstWords: Boolean(firstWords && recentFirstWords.includes(firstWords)),
    repeatedPattern: recentPatterns.includes(pattern),
    repeatedPhrases: getRepeatedPhrases(summary, recentSummaries),
  };
}

function evaluateSummaryQuality(item, summary, options = {}) {
  const clean = cleanText(summary);
  const recentSummaries = options.recentSummaries || [];
  const avoidPhrases = Array.isArray(options.avoidPhrases) ? options.avoidPhrases : [];
  const failures = [];
  const isFallback = clean === FALLBACK_SUMMARY;
  const count = wordCount(clean);

  if (!clean) failures.push("empty_summary");
  if (!isFallback && count < MIN_SUMMARY_WORDS) failures.push("too_short");
  if (!isFallback && count > MAX_SUMMARY_WORDS) failures.push("too_long");
  if (!isFallback && ROBOTIC_OPENERS.some((pattern) => pattern.test(clean))) failures.push("robotic_opener");
  if (!isFallback && FILLER_PATTERNS.some((pattern) => pattern.test(clean))) failures.push("vague_filler");
  if (!isFallback && DATABASE_PATTERNS.some((pattern) => pattern.test(clean))) failures.push("database_language");
  if (
    !isFallback &&
    avoidPhrases.some((phrase) => clean.toLowerCase().includes(cleanText(phrase).toLowerCase()))
  ) {
    failures.push("style_memory_avoid_phrase");
  }
  if (!isFallback && isTooCloseToRss(item, clean)) failures.push("too_close_to_rss");
  if (!isFallback && !hasUsefulHumanAngle(item, clean)) failures.push("missing_human_angle");

  const repetition = evaluateRepetition(clean, recentSummaries);
  if (repetition.repeatedFirstWords) failures.push("same_first_4_words");
  if (repetition.repeatedPattern) failures.push("same_sentence_pattern");
  if (repetition.repeatedPhrases.length) failures.push("repeated_phrase_nearby");

  return {
    passed: failures.length === 0,
    failures,
    checkedAt: new Date().toISOString(),
    metrics: {
      wordCount: count,
      firstWords: getFirstWords(clean),
      sentencePattern: getSentencePattern(clean),
      rssSimilarity: getTokenSimilarity(item?.summary || item?.sourceSummary || "", clean),
      repeatedPhrases: repetition.repeatedPhrases,
      fallback: isFallback,
    },
  };
}

function createSummaryRepetitionState(limit = RECENT_SUMMARY_LIMIT) {
  return {
    limit,
    recentSummaries: [],
  };
}

function getRecentSummaries(state) {
  return state?.recentSummaries || [];
}

function rememberSummary(state, summary) {
  if (!state) return;
  state.recentSummaries.push(cleanText(summary));
  if (state.recentSummaries.length > state.limit) {
    state.recentSummaries.splice(0, state.recentSummaries.length - state.limit);
  }
}

module.exports = {
  FALLBACK_SUMMARY,
  MAX_SUMMARY_WORDS,
  MIN_SUMMARY_WORDS,
  ROBOTIC_OPENERS,
  createSummaryRepetitionState,
  evaluateSummaryQuality,
  getExactPhraseFailures,
  getFirstWords,
  getRecentSummaries,
  getSentencePattern,
  rememberSummary,
  wordCount,
};
