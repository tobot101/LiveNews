const {
  cleanText,
  splitSentences,
  stableHash,
} = require("./text-utils");

const SUMMARY_AGENT_VERSION = "live-news-summary-agent-v1";
const GENERIC_SUMMARY_PATTERNS = [
  /live news is tracking/i,
  /original source remains/i,
  /it was updated/i,
  /full reporting while/i,
  /source-linked coverage/i,
  /live news found this result/i,
];

const CATEGORY_CONTEXT = {
  Business: "business impact",
  Entertainment: "culture and media context",
  International: "global context",
  National: "national context",
  Sports: "sports context",
  Tech: "technology context",
  Local: "local context",
  Top: "broader public context",
};

const STYLE_DIALS = [
  {
    opening: "focus",
    lead: "The article focuses on",
    contextVerb: "adds context around",
  },
  {
    opening: "update",
    lead: "This update centers on",
    contextVerb: "helps frame",
  },
  {
    opening: "source",
    lead: "The report follows",
    contextVerb: "puts attention on",
  },
  {
    opening: "reader_value",
    lead: "The key development is",
    contextVerb: "gives readers context on",
  },
];

const VERB_TO_FRAGMENT = new Map([
  ["advances", "advancing"],
  ["advanced", "advancing"],
  ["announced", "announcing"],
  ["announces", "announcing"],
  ["approved", "approving"],
  ["approves", "approving"],
  ["asked", "asking"],
  ["asks", "asking"],
  ["became", "becoming"],
  ["becomes", "becoming"],
  ["cleared", "clearing"],
  ["clears", "clearing"],
  ["criticized", "criticizing"],
  ["criticizes", "criticizing"],
  ["cut", "cutting"],
  ["cuts", "cutting"],
  ["died", "dying"],
  ["dies", "dying"],
  ["dropped", "dropping"],
  ["drops", "dropping"],
  ["expanded", "expanding"],
  ["expands", "expanding"],
  ["faced", "facing"],
  ["faces", "facing"],
  ["fell", "falling"],
  ["focuses", "focusing"],
  ["focused", "focusing"],
  ["got", "getting"],
  ["gets", "getting"],
  ["hit", "reaching"],
  ["hits", "reaching"],
  ["imposed", "imposing"],
  ["imposes", "imposing"],
  ["injured", "injuring"],
  ["injures", "injuring"],
  ["issued", "issuing"],
  ["issues", "issuing"],
  ["launched", "launching"],
  ["launches", "launching"],
  ["lost", "losing"],
  ["moved", "moving"],
  ["moves", "moving"],
  ["obtained", "obtaining"],
  ["obtains", "obtaining"],
  ["opened", "opening"],
  ["opens", "opening"],
  ["planned", "planning"],
  ["plans", "planning"],
  ["popped", "jumping"],
  ["pops", "jumping"],
  ["pulled", "pulling"],
  ["pulls", "pulling"],
  ["pushed", "pushing"],
  ["pushes", "pushing"],
  ["rallied", "rallying"],
  ["rallies", "rallying"],
  ["reported", "reporting"],
  ["reports", "reporting"],
  ["revealed", "revealing"],
  ["reveals", "revealing"],
  ["returned", "returning"],
  ["returns", "returning"],
  ["rose", "rising"],
  ["rises", "rising"],
  ["said", "saying"],
  ["says", "saying"],
  ["sought", "seeking"],
  ["seeks", "seeking"],
  ["shared", "sharing"],
  ["shares", "sharing"],
  ["slashed", "cutting"],
  ["slashes", "cutting"],
  ["sparked", "sparking"],
  ["sparks", "sparking"],
  ["started", "starting"],
  ["starts", "starting"],
  ["stepped", "stepping"],
  ["steps", "stepping"],
  ["tightened", "tightening"],
  ["tightens", "tightening"],
  ["treated", "receiving treatment"],
  ["treats", "treating"],
  ["urged", "urging"],
  ["urges", "urging"],
  ["wanted", "seeking"],
  ["wants", "seeking"],
  ["warned", "warning"],
  ["warns", "warning"],
  ["withdrew", "withdrawing"],
  ["withdraws", "withdrawing"],
  ["won", "winning"],
  ["wins", "winning"],
]);

const SAFE_LOWERCASE_STARTERS = new Set([
  "a",
  "an",
  "another",
  "business",
  "entertainment",
  "experts",
  "federal",
  "fitness",
  "global",
  "health",
  "local",
  "major",
  "markets",
  "middle",
  "national",
  "new",
  "playoff",
  "reclassifying",
  "researchers",
  "small",
  "state",
  "states",
  "tech",
  "the",
  "this",
]);

function stripHeadlinePrefix(value) {
  return cleanText(value)
    .replace(/^(watch|video|listen|live updates?|breaking|photos?):\s*/i, "")
    .replace(/\s+-\s+[^-]{2,60}$/i, "")
    .trim();
}

function normalizeSourceSentence(sentence, item) {
  const sourceName = cleanText(item?.sourceName || item?.source || "");
  const title = stripHeadlinePrefix(item?.title || "");
  let clean = stripHeadlinePrefix(sentence)
    .replace(/\s+/g, " ")
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

function normalizeAcronyms(value) {
  return cleanText(value)
    .replace(/\bUS\b/g, "U.S.")
    .replace(/U\.S\.\.+/g, "U.S.")
    .replace(/\s*&\s*/g, " and ");
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
      if (sentence.length < 45 || sentence.length > 240) return false;
      if (GENERIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(sentence))) return false;
      if (sentence.toLowerCase() === title.toLowerCase()) return false;
      return true;
    });
  return sentences[0] || "";
}

function titleToFocus(value) {
  const clean = stripHeadlinePrefix(value)
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
  if (!clean) return "the latest development";

  const colonAttribution = clean.match(/^(.*?):\s*(officials|police|authorities|sources?|reports?)$/i);
  if (colonAttribution) {
    return `${colonAttribution[1].trim()}, according to ${formatAttributionSubject(colonAttribution[2])}`;
  }

  const commaAttribution = clean.match(/^(.*?),\s*(.+\s+says|.+\s+said|report says)$/i);
  if (commaAttribution) {
    return `${commaAttribution[1].trim()}, according to ${formatAttributionSubject(commaAttribution[2]
      .replace(/\s+says$/i, "")
      .replace(/\s+said$/i, "")
      .trim())}`;
  }

  const colonParts = clean.split(/:\s+/).filter(Boolean);
  if (colonParts.length > 1) {
    return colonParts.slice(1).join(": ").trim();
  }

  const profitMatch = clean.match(
    /^(.+?)'s profit fell (\d+%) as it didn't collect (?:big|large)?\s*insurance payments for (.+)$/i
  );
  if (profitMatch) {
    return `${profitMatch[1].trim()} reported a ${profitMatch[2]} profit drop tied to missing insurance payments for ${profitMatch[3].trim()}`;
  }

  const inflationMatch = clean.match(/^(.+?) inflation rate is ([^,]+),\s*(.+?) show$/i);
  if (inflationMatch) {
    return `${inflationMatch[1].trim()} inflation at ${inflationMatch[2].trim()}, according to ${inflationMatch[3].trim()}`;
  }

  const sanctionsMatch = clean.match(/^US imposes sanctions on (.+?) and (\d+) shippers over (.+)$/i);
  if (sanctionsMatch) {
    return `the U.S. sanctions targeting ${sanctionsMatch[1].trim()} plus ${sanctionsMatch[2].trim()} shipping companies tied to ${sanctionsMatch[3].trim()}`;
  }

  const firstStepMatch = clean.match(/^Reclassifying (.+?) might only be the first step for (.+)$/i);
  if (firstStepMatch) {
    return `a possible first step for ${firstStepMatch[2].trim()} through reclassifying ${firstStepMatch[1].trim()}`;
  }

  return clean.length > 150 ? `${clean.slice(0, 147).replace(/\s+\S*$/, "")}...` : clean;
}

function formatAttributionSubject(value) {
  const clean = cleanText(value);
  if (/^(officials|police|authorities|sources?|reports?)$/i.test(clean)) {
    return clean.toLowerCase();
  }
  if (/^(white house|pentagon|senate|house|supreme court|justice department)$/i.test(clean)) {
    return `the ${clean}`;
  }
  return clean;
}

function softenFocusPhrase(focus) {
  return normalizeAcronyms(focus)
    .replace(/\bdispatching\b/gi, "sending")
    .replace(/\bamid\b/gi, "as")
    .replace(/\bslams\b/gi, "criticizes")
    .replace(/\bto face\b/gi, "facing")
    .replace(/\bblasted\b/gi, "criticized")
    .replace(/\bapproves?\b/gi, "clears")
    .replace(/\blaunches?\b/gi, "starts")
    .replace(/\bprobe\b/gi, "investigation")
    .replace(/[!?]+$/g, "")
    .trim();
}

function lowercaseFirstCharacter(value) {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function lowercaseFirstWordWhenSafe(value) {
  const clean = cleanText(value);
  if (/^U\.S\.?$/i.test(clean)) return "the U.S.";
  if (/^U\.S\.\s+/i.test(clean)) return `the ${clean}`;
  const firstWord = clean.match(/^[A-Za-z.]+/)?.[0] || "";
  if (!firstWord) return clean;
  if (SAFE_LOWERCASE_STARTERS.has(firstWord.toLowerCase())) {
    return lowercaseFirstCharacter(clean);
  }
  return clean;
}

function fragmentFromHeadline(value) {
  const clean = softenFocusPhrase(value)
    .replace(/^How\s+/i, "how ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "the latest development";

  const questionMatch = clean.match(/^(.+?)\?\s*(.+)$/);
  if (questionMatch) {
    return normalizeAcronyms(
      `${lowercaseFirstWordWhenSafe(questionMatch[2].trim())} after questions about ${lowercaseFirstWordWhenSafe(questionMatch[1].trim())}`
    );
  }

  const customRewrites = [
    [/^Markets rally as (.+)$/i, "markets rallying as $1"],
    [/^Major storm system advances across (.+)$/i, "a major storm system advancing across $1"],
    [/^Head-on bus crash near (.+?) injures (.+)$/i, "a head-on bus crash near $1 injuring $2"],
    [/^Head-on bus crash (.+)$/i, "a head-on bus crash $1"],
    [/^(.+?) approved for (.+)$/i, "$1 receiving approval for $2"],
    [/^New (.+?) sparks debate (.+)$/i, "a new $1 sparking debate $2"],
    [/^Playoff race tightens after (.+)$/i, "the playoff race tightening after $1"],
    [/^Global summit focuses on (.+)$/i, "a global summit focused on $1"],
    [/^NASCAR driver (.+?) (?:returned|returning) to the track at (.+?) for (.+)$/i, "NASCAR driver $1 back at $2 for $3"],
    [/^(.+?) to publish (.+)$/i, "$1 planning to publish $2"],
    [/^(.+?) treated for (.+)$/i, "$1 receiving treatment for $2"],
    [/^(.+?) inflation at (.+)$/i, "$1 inflation at $2"],
  ];
  for (const [pattern, replacement] of customRewrites) {
    if (pattern.test(clean)) {
      return normalizeAcronyms(lowercaseFirstWordWhenSafe(clean.replace(pattern, replacement))).trim();
    }
  }

  const verbPattern = new RegExp(
    `^(.+?)\\s+(${Array.from(VERB_TO_FRAGMENT.keys()).join("|")})\\s+(.+)$`,
    "i"
  );
  const match = clean.match(verbPattern);
  if (match) {
    const subject = lowercaseFirstWordWhenSafe(match[1].trim());
    const verb = VERB_TO_FRAGMENT.get(match[2].toLowerCase()) || match[2].toLowerCase();
    return normalizeAcronyms(`${subject} ${verb} ${match[3].trim()}`);
  }

  return normalizeAcronyms(lowercaseFirstWordWhenSafe(clean));
}

function composeLeadSentence(style, focus) {
  const fragment = fragmentFromHeadline(focus);
  return trimSentence(`${style.lead} ${fragment}`, 170);
}

function getPrimaryFocus(item, detail) {
  const title = cleanText(item?.title || "");
  if (detail && /[!]|\bplus\b/i.test(title)) {
    return detail;
  }
  return titleToFocus(title);
}

function trimSentence(value, maxLength = 190) {
  const clean = cleanText(value).replace(/\s+([,.])/g, "$1");
  if (clean.length <= maxLength) return clean.endsWith(".") ? clean : `${clean}.`;
  const trimmed = clean.slice(0, maxLength - 1).replace(/\s+\S*$/, "");
  return `${trimmed}.`;
}

function getStyle(item) {
  const hash = parseInt(stableHash(item?.id || item?.link || item?.title || "summary", 8), 16);
  return STYLE_DIALS[hash % STYLE_DIALS.length];
}

function buildContextSentence(item, detail, style) {
  const category = cleanText(item?.category || "Top");
  const sourceName = cleanText(item?.sourceName || item?.source || "the lead source");
  const sourceCount = Number(item?.sourceCount || 1);
  const categoryContext = CATEGORY_CONTEXT[category] || CATEGORY_CONTEXT.Top;
  const sourceLine = sourceCount > 1
    ? `${sourceName} leads a ${sourceCount}-source cluster that adds ${categoryContext}.`
    : `${sourceName} is the lead source, so the summary stays focused on confirmed details.`;

  if (!detail) return sourceLine;
  const detailFocus = fragmentFromHeadline(detail)
    .replace(/\baccording to\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (detailFocus.length < 45) return sourceLine;
  const detailLine = trimSentence(`The source detail ${style.contextVerb} ${detailFocus}`, 180);
  if (GENERIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(detailLine))) return sourceLine;
  if (getExactPhraseFailures(detail, detailLine, 9).length) return sourceLine;
  return detailLine;
}

function buildLiveNewsSummary(item) {
  const style = getStyle(item);
  const detail = pickSourceDetail(item);
  const focus = softenFocusPhrase(getPrimaryFocus(item, detail));
  const lead = composeLeadSentence(style, focus);
  const context = buildContextSentence(item, detail, style);
  const text = `${lead} ${context}`;
  const evaluation = evaluateLiveNewsSummary(item, text);

  if (evaluation.passed) {
    return {
      text: trimSentence(text, 320),
      agentVersion: SUMMARY_AGENT_VERSION,
      style: style.opening,
      evaluation,
    };
  }

  const sourceName = cleanText(item?.sourceName || item?.source || "the lead source");
  const fallback = trimSentence(`${composeLeadSentence(style, focus)} ${sourceName} is the lead source, and the wording stays focused on verified details.`, 280);
  return {
    text: fallback,
    agentVersion: SUMMARY_AGENT_VERSION,
    style: style.opening,
    evaluation: evaluateLiveNewsSummary(item, fallback),
  };
}

function getExactPhraseFailures(source, candidate, minWords = 9) {
  const cleanSource = cleanText(source).toLowerCase();
  const cleanCandidate = cleanText(candidate).toLowerCase();
  if (!cleanSource || !cleanCandidate) return [];
  const sourceWords = cleanSource.split(/\s+/).filter(Boolean);
  const failures = [];
  for (let size = minWords; size <= Math.max(minWords, 14); size += 1) {
    for (let index = 0; index <= sourceWords.length - size; index += 1) {
      const phrase = sourceWords.slice(index, index + size).join(" ");
      if (phrase.length > 45 && cleanCandidate.includes(phrase)) {
        failures.push(phrase);
      }
    }
  }
  return Array.from(new Set(failures)).slice(0, 3);
}

function evaluateLiveNewsSummary(item, summary) {
  const clean = cleanText(summary);
  const failures = [];
  if (clean.length < 70) failures.push("too_short");
  if (clean.length > 340) failures.push("too_long");
  if (GENERIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(clean))) {
    failures.push("generic_tracking_copy");
  }
  const titlePhrases = getExactPhraseFailures(item?.title || "", clean, 12);
  const sourcePhrases = getExactPhraseFailures(item?.summary || "", clean, 9);
  if (titlePhrases.length || sourcePhrases.length) failures.push("copied_source_phrase");
  if (!/[A-Za-z]{3,}/.test(clean)) failures.push("missing_article_detail");
  return {
    passed: failures.length === 0,
    failures,
    checkedAt: new Date().toISOString(),
  };
}

function applyLiveNewsSummary(item) {
  if (item?.liveNewsSummary && item?.summaryAgent?.version === SUMMARY_AGENT_VERSION) {
    return item;
  }
  const result = buildLiveNewsSummary(item);
  return {
    ...item,
    liveNewsSummary: result.text,
    summaryShort: result.text,
    summaryAgent: {
      version: result.agentVersion,
      style: result.style,
      passed: result.evaluation.passed,
      failures: result.evaluation.failures,
    },
  };
}

module.exports = {
  GENERIC_SUMMARY_PATTERNS,
  SUMMARY_AGENT_VERSION,
  applyLiveNewsSummary,
  buildLiveNewsSummary,
  evaluateLiveNewsSummary,
};
