const { cleanText, splitSentences, stableHash } = require("./text-utils");
const { readStyleMemory } = require("./store");
const {
  FALLBACK_SUMMARY,
  createSummaryRepetitionState,
  evaluateSummaryQuality,
  getRecentSummaries,
  rememberSummary,
} = require("./summary-quality");

const SUMMARY_AGENT_VERSION = "live-news-summary-agent-v2";

const GENERIC_SUMMARY_PATTERNS = [
  /live news is tracking/i,
  /original source remains/i,
  /it was updated/i,
  /full reporting while/i,
  /source-linked coverage/i,
  /live news found this result/i,
];

const CATEGORY_STYLES = {
  Local: [
    "The local question is who nearby is affected, where it happened, and what changes next.",
    "For residents, the useful details are place, timing, and possible impact.",
    "The update keeps attention on the affected place and what may change nearby.",
    "Readers in the area can focus on location, timing, and practical impact.",
    "The useful local angle is what changed and how close-to-home the impact may be.",
    "People nearby can look for the place involved, the timing, and any next steps.",
  ],
  Business: [
    "The business question is whether money, workers, customers, or market pressure changes next.",
    "Readers can watch for costs, company moves, or consumer impact without extra noise.",
    "The useful business lens is what changes for money, markets, or the company involved.",
    "What matters next is whether prices, jobs, customers, or investor confidence shift.",
    "The money question is what changed, who may pay, and what moves next.",
    "Business readers can focus on the company, the cost, and the possible market effect.",
  ],
  Tech: [
    "The tech question is how users, platforms, privacy, or tools could change next.",
    "Readers may want the practical effect on devices, apps, data, or access.",
    "The useful tech lens is what changes for the product, platform, company, or user.",
    "The user question is whether the change helps, limits, or exposes people online.",
    "What matters next is the tool involved, the platform rules, and any user impact.",
    "Tech readers can focus on the product, privacy issue, platform, or access change.",
  ],
  Sports: [
    "The sports question is what changes for the team, player, result, or next matchup.",
    "Fans can focus on performance, availability, standings, or what follows.",
    "The useful sports lens is the result, the people involved, and the next contest.",
    "Supporters may watch the lineup, momentum, or schedule after this.",
    "The next question is what it means for the player, club, standings, or season.",
    "Sports readers get the most value from the result and what follows.",
  ],
  Entertainment: [
    "The audience question is what changed around the person, release, event, or reaction.",
    "Fans can focus on the performer, project, event, or public response.",
    "The useful entertainment lens is why the person, show, release, or event is drawing attention.",
    "Viewers may care most about the release, the reaction, and who is involved.",
    "The next question is why audiences are reacting and what changes after the event.",
    "Entertainment readers can follow the public moment without losing the basic facts.",
  ],
  International: [
    "The global question is how the country, policy, conflict, or diplomacy moves next.",
    "Readers can focus on the place involved, the pressure around it, and what may follow.",
    "The international lens is whether the decision reaches beyond one place.",
    "What matters next is how leaders, borders, or governments respond.",
    "The wider stakes depend on the country involved and what happens after this.",
    "Global readers can watch diplomacy, conflict, policy, or public safety next.",
  ],
  National: [
    "The public question is who is affected and what could change next.",
    "Readers can focus on the decision, dispute, event, and possible public impact.",
    "The national lens is how the issue may affect public life.",
    "What matters next is whether the issue changes public life or draws a response.",
    "The useful public detail is who feels it, what shifts, and what comes next.",
    "National readers can track the change without losing the basic facts.",
  ],
  Top: [
    "The core question is who is affected, why it matters, and what changes next.",
    "Readers can quickly see what happened, who is involved, and the next question.",
    "The wider value is knowing the main event and why people may follow it.",
    "What comes next depends on the people, place, decision, or pressure involved.",
    "The useful reader takeaway is the event, the impact, and the next step.",
    "The focus stays on what happened and why it may matter.",
  ],
};

const SOFT_REWRITES = [
  [/\bdispatching\b/gi, "sending"],
  [/\bprobe\b/gi, "investigation"],
  [/\bslams\b/gi, "criticizes"],
  [/\bblasted\b/gi, "criticized"],
  [/\bchokehold\b/gi, "pressure"],
  [/\bamid\b/gi, "as"],
  [/\bto face\b/gi, "facing"],
  [/\bapproves?\b/gi, "clears"],
  [/\blaunches?\b/gi, "starts"],
  [/\s*&\s*/g, " and "],
];

const TITLE_PATTERNS = [
  [/^US (.+)$/i, "The U.S. $1"],
  [/^(.+?) says (.+?) sending (.+)$/i, "$1 says $2 is sending $3"],
  [/^(.+?) sending (.+)$/i, "$1 is sending $2"],
  [/^(.+?) drops investigation (.+)$/i, "$1 dropped its investigation $2"],
  [/^(.+?) to miss (.+)$/i, "$1 will miss $2"],
  [/^(.+?) to publish (.+)$/i, "$1 plans to publish $2"],
  [/^(.+?) treated for (.+)$/i, "$1 received treatment for $2"],
  [/^(.+?) pulls out of (.+)$/i, "$1 withdrew from $2"],
  [/^(.+?) approved for (.+)$/i, "$1 received approval for $2"],
  [/^(.+?) preview:\s*(.+)$/i, "$1 preview looks at $2"],
  [/^(.+?) calendar:\s*(.+)$/i, "$1 calendar lists $2"],
  [/^Close watch on how (.+?) and (.+?) will get along at (.+)$/i, "$1 and $2 face close scrutiny at $3"],
  [/^Companies are paying millions to cross Panama Canal during (.+)$/i, "Companies face million-dollar Panama Canal fees during $1"],
  [/^(\d+) Takeaways From (.+)$/i, "$1 takeaways from $2"],
  [/^NASCAR's (.+?) gets out of the pool and into her fire suit for big race, NFL Draft drama, plus .+$/i,
    "$1 appears in a race-week roundup with NFL Draft drama"],
  [/^NASCAR driver (.+?) returned to the track at (.+?) for (.+)$/i, "$1 is back at $2 for $3"],
  [/^(.+?)'s profit fell (\d+%) as it didn't collect (?:big|large)?\s*insurance payments for (.+)$/i,
    "$1 reported a $2 profit drop tied to missing insurance payments for $3"],
  [/^(.+?) inflation rate is ([^,]+),\s*(.+?) show$/i, "$1 inflation is $2, new $3 show"],
  [/^Reclassifying (.+?) might only be the first step for (.+)$/i,
    "Reclassifying $1 could be one early step for $2"],
  [/^Head-on bus crash near (.+?) injures (.+)$/i, "A head-on bus crash near $1 injured $2"],
  [/^Major storm system advances across (.+)$/i, "A major storm system moved across $1"],
  [/^Markets rally as (.+)$/i, "Markets rallied as $1"],
  [/^New (.+?) sparks debate (.+)$/i, "A new $1 sparked debate $2"],
];

function stripHeadlinePrefix(value) {
  return cleanText(value)
    .replace(/^(watch|video|listen|live updates?|the latest|latest|breaking|photos?):\s*/i, "")
    .replace(/\s+-\s+[^-]{2,60}$/i, "")
    .replace(/[!?]+$/g, "")
    .trim();
}

function normalizeAcronyms(value) {
  return cleanText(value)
    .replace(/\bUS\b/g, "U.S.")
    .replace(/U\.S\.\.+/g, "U.S.")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value) {
  const clean = normalizeAcronyms(value);
  if (!clean) return "";
  if (/^U\.S\./.test(clean)) return clean;
  return `${clean[0].toUpperCase()}${clean.slice(1)}`;
}

function lowercaseFirst(value) {
  const clean = cleanText(value);
  if (!clean || /^U\.S\./.test(clean)) return clean;
  return `${clean[0].toLowerCase()}${clean.slice(1)}`;
}

function normalizeSourceSentence(sentence, item) {
  const sourceName = cleanText(item?.sourceName || item?.source || "");
  const title = stripHeadlinePrefix(item?.title || "");
  let clean = stripHeadlinePrefix(sentence)
    .replace(/\s*\|\s*[^|]{2,60}$/g, "")
    .replace(/\s+-\s+[^-]{2,60}$/g, "")
    .trim();

  if (sourceName) {
    clean = clean
      .replace(new RegExp(`\\s+${escapeRegExp(sourceName)}$`, "i"), "")
      .replace(new RegExp(`^${escapeRegExp(sourceName)}\\s*:?\\s*`, "i"), "")
      .trim();
  }

  if (clean.toLowerCase() === title.toLowerCase()) return "";
  return clean;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickSourceDetail(item) {
  const title = stripHeadlinePrefix(item?.title || "");
  const summary = cleanText(item?.summary || item?.sourceSummary || "");
  const sentences = splitSentences(summary)
    .map((sentence) => normalizeSourceSentence(sentence, item))
    .filter((sentence) => {
      if (sentence.length < 36 || sentence.length > 220) return false;
      if (GENERIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(sentence))) return false;
      if (sentence.toLowerCase() === title.toLowerCase()) return false;
      return true;
    });
  return sentences[0] || "";
}

function softenPhrase(value) {
  let clean = normalizeAcronyms(value);
  for (const [pattern, replacement] of SOFT_REWRITES) {
    clean = clean.replace(pattern, replacement);
  }
  return clean.replace(/\s+/g, " ").trim();
}

function rewriteHeadline(value) {
  let clean = softenPhrase(stripHeadlinePrefix(value));
  if (!clean) return "";

  const colonAttribution = clean.match(/^(.*?):\s*(officials|police|authorities|sources?|reports?)$/i);
  if (colonAttribution) {
    clean = `${sentenceCase(colonAttribution[2])} say ${lowercaseFirst(colonAttribution[1])}`;
  }

  const commaAttribution = clean.match(/^(.*?),\s*(.+\s+says|.+\s+said|report says)$/i);
  if (commaAttribution) {
    const subject = commaAttribution[2]
      .replace(/\s+says$/i, "")
      .replace(/\s+said$/i, "")
      .trim();
    clean = `${sentenceCase(subject)} says ${sentenceCase(commaAttribution[1])}`;
  }

  for (const [pattern, replacement] of TITLE_PATTERNS) {
    if (pattern.test(clean)) {
      clean = clean.replace(pattern, replacement);
      break;
    }
  }

  clean = clean
    .replace(/\bgets criticized\b/i, "is criticized")
    .replace(/\bwas criticized\b/i, "was criticized")
    .trim();

  return trimToWords(sentenceCase(clean), 24);
}

function trimToWords(value, maxWords) {
  const clean = cleanText(value).replace(/\s+([,.])/g, "$1");
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return clean.endsWith(".") ? clean : `${clean}.`;
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]$/, "")}.`;
}

function getCategoryStyles(item) {
  const category = cleanText(item?.category || "Top");
  const styles = CATEGORY_STYLES[category] || CATEGORY_STYLES.Top;
  const hash = parseInt(stableHash(item?.id || item?.link || item?.title || "summary", 8), 16);
  const start = hash % styles.length;
  return [...styles.slice(start), ...styles.slice(0, start)];
}

function getPrimarySentences(item) {
  const detail = pickSourceDetail(item);
  const title = cleanText(item?.title || "");
  const sentences = [rewriteHeadline(title)];
  const rewrittenDetail = rewriteHeadline(detail);
  if (rewrittenDetail && !sentences.includes(rewrittenDetail)) sentences.push(rewrittenDetail);
  return sentences.filter(Boolean);
}

function buildCandidates(item) {
  const primarySentences = getPrimarySentences(item);
  if (!primarySentences.length) return [FALLBACK_SUMMARY];

  const candidates = [];

  primarySentences.forEach((primary, sentenceIndex) => {
    const shortPrimary = primary.replace(/\.$/, "");
    const styles = getCategoryStyles({ ...item, id: `${item?.id || item?.title}:${sentenceIndex}` });
    styles.forEach((style) => candidates.push(`${primary} ${style}`));
    styles.forEach((style) => candidates.push(`${style} ${shortPrimary}.`));
  });

  candidates.push(...primarySentences);
  candidates.push(FALLBACK_SUMMARY);
  return candidates.map((candidate) => trimToWords(candidate, 38));
}

function getStyleMemory(options = {}) {
  if (options.styleMemory) return options.styleMemory;
  try {
    return readStyleMemory();
  } catch {
    return {};
  }
}

function buildLiveNewsSummary(item, options = {}) {
  const recentSummaries = options.recentSummaries || [];
  const styleMemory = getStyleMemory(options);
  const candidates = buildCandidates(item);
  const evaluated = candidates.map((text) => ({
    text,
    evaluation: evaluateSummaryQuality(item, text, {
      recentSummaries,
      avoidPhrases: styleMemory.avoidPhrases || [],
    }),
  }));
  const winner = evaluated.find((candidate) => candidate.evaluation.passed) || evaluated[evaluated.length - 1];

  return {
    text: winner.text,
    agentVersion: SUMMARY_AGENT_VERSION,
    style: winner.text === FALLBACK_SUMMARY ? "fallback" : "quality_checked",
    evaluation: winner.evaluation,
    candidatesChecked: evaluated.length,
  };
}

function applyLiveNewsSummary(item, options = {}) {
  if (!options.force && item?.liveNewsSummary && item?.summaryAgent?.version === SUMMARY_AGENT_VERSION) {
    return item;
  }
  const result = buildLiveNewsSummary(item, options);
  return {
    ...item,
    liveNewsSummary: result.text,
    summaryShort: result.text,
    summaryAgent: {
      version: result.agentVersion,
      style: result.style,
      passed: result.evaluation.passed,
      failures: result.evaluation.failures,
      metrics: result.evaluation.metrics,
      candidatesChecked: result.candidatesChecked,
    },
  };
}

function applyLiveNewsSummariesToItems(items, options = {}) {
  const state = options.repetitionState || createSummaryRepetitionState();
  return (items || []).map((item) => {
    const result = applyLiveNewsSummary(item, {
      force: true,
      recentSummaries: getRecentSummaries(state),
      styleMemory: options.styleMemory,
    });
    rememberSummary(state, result.liveNewsSummary);
    return result;
  });
}

function applyLiveNewsSummariesToPayload(payload = {}, options = {}) {
  const state = options.repetitionState || createSummaryRepetitionState();
  const styleMemory = getStyleMemory(options);
  return {
    ...payload,
    topStories: applyLiveNewsSummariesToItems(payload.topStories || [], {
      repetitionState: state,
      styleMemory,
    }),
    feed: applyLiveNewsSummariesToItems(payload.feed || [], {
      repetitionState: state,
      styleMemory,
    }),
  };
}

module.exports = {
  FALLBACK_SUMMARY,
  GENERIC_SUMMARY_PATTERNS,
  SUMMARY_AGENT_VERSION,
  applyLiveNewsSummariesToItems,
  applyLiveNewsSummariesToPayload,
  applyLiveNewsSummary,
  buildLiveNewsSummary,
  evaluateLiveNewsSummary: evaluateSummaryQuality,
};
