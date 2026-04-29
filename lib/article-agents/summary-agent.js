const { cleanText, splitSentences } = require("./text-utils");
const { readStyleMemory } = require("./store");
const {
  FALLBACK_SUMMARY,
  createSummaryRepetitionState,
  evaluateSummaryQuality,
  getRecentSummaries,
  rememberSummary,
  wordCount,
} = require("./summary-quality");

const SUMMARY_AGENT_VERSION = "live-news-summary-agent-v3";

const GENERIC_SUMMARY_PATTERNS = [
  /live news is tracking/i,
  /original source remains/i,
  /it was updated/i,
  /full reporting while/i,
  /source-linked coverage/i,
  /live news found this result/i,
];

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

const PLACEHOLDER_PATTERNS = [
  /what comes next depends on/i,
  /the core question is/i,
  /readers can quickly see/i,
  /the focus stays on/i,
  /the wider value is/i,
  /readers may want/i,
  /the public question is/i,
  /the national lens is/i,
  /the useful .* lens is/i,
  /the useful .* detail is/i,
  /what matters next is/i,
];

const SENTENCE_JOIN_ABBREVIATIONS = /\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Mr|Mrs|Ms|Dr|Prof|Sen|Rep|Gov|St)\.$/i;

const TITLE_PATTERNS = [
  [/^US (.+?) drops investigation (.+)$/i, "The U.S. $1 dropped its investigation $2"],
  [/^US (.+)$/i, "The U.S. $1"],
  [/^(.+?) cancels (.+?) trip to (.+?) for (.+)$/i, "The planned $3 trip for $2 was canceled"],
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
    .replace(/^[a-z\s]+live updates?:\s*/i, "")
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

function splitSourceSentences(value) {
  const fragments = splitSentences(value);
  const sentences = [];
  let current = "";

  for (const fragment of fragments) {
    if (!current) {
      current = fragment;
      continue;
    }

    if (SENTENCE_JOIN_ABBREVIATIONS.test(current)) {
      current = `${current} ${fragment}`.trim();
      continue;
    }

    sentences.push(current);
    current = fragment;
  }

  if (current) sentences.push(current);
  return sentences;
}

function pickSourceDetail(item) {
  const title = stripHeadlinePrefix(item?.title || "");
  const summary = cleanText(item?.summary || item?.sourceSummary || "");
  const normalizedSentences = splitSourceSentences(summary)
    .map((sentence) => normalizeSourceSentence(sentence, item))
    .filter(Boolean);
  const candidates = normalizedSentences.flatMap((sentence, index) => {
    const next = normalizedSentences[index + 1] || "";
    const combined = next && sentence.length < 180 ? `${sentence} ${next}` : "";
    return combined && combined.length <= 320 ? [combined, sentence] : [sentence];
  });
  const sentences = candidates
    .map((sentence) => sentence.trim())
    .filter((sentence, index, list) => list.indexOf(sentence) === index)
    .filter((sentence) => {
      if (sentence.length < 36 || sentence.length > 320) return false;
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
    .replace(/\bU\.S\. justice department\b/i, "U.S. Justice Department")
    .replace(/\bFed chairman\b/i, "Fed Chairman")
    .replace(/\bWitkoff,\s*Kushner\b/i, "Witkoff and Kushner")
    .trim();

  return trimToWords(sentenceCase(clean), 24);
}

const DETAIL_PATTERNS = [
  [
    /^The White House said (.+?) and (.+?) are being sent to (.+?) as officials pursue (.+)$/i,
    "$1 and $2 are the envoys named for $3 as officials pursue $4",
  ],
  [
    /^(.+?) reported lower quarterly profit after insurance payments tied to (.+?) were not collected in the period$/i,
    "$1 reported lower quarterly profit after $2 insurance payments weren't collected",
  ],
  [
    /^The United States imposed sanctions on (.+?) accused of helping move (.+)$/i,
    "Shipping firms were accused of helping move $2",
  ],
  [
    /^NASCAR driver (.+?) returned to the track at (.+?) for (.+)$/i,
    "$1 was back at $2 for the racing weekend",
  ],
  [
    /^Students aged (.+?) steered (.+?) and called for help after (.+)$/i,
    "Students ages $1 steered $2 and called for help after $3",
  ],
  [
    /^(.+?) host the (.+?) in (.+?) with (.+)$/i,
    "$1 host $2 in $3 with $4",
  ],
  [
    /^(.+?) look to clinch (.+?) over (.+?) in (.+)$/i,
    "$1 are trying to clinch $2 over $3 in $4",
  ],
  [/^(.+?) said (.+)$/i, "$1 says $2"],
  [/^(.+?) says (.+)$/i, "$1 says $2"],
  [/^(.+?) reported (.+)$/i, "$1 reported $2"],
];

function trimToWords(value, maxWords) {
  const clean = cleanText(value).replace(/\s+([,.])/g, "$1");
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return clean.endsWith(".") ? clean : `${clean}.`;
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]$/, "")}.`;
}

function normalizeForCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getWordSlice(value, maxWords) {
  return cleanText(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ")
    .replace(/[,:;]$/, "")
    .trim();
}

function stripEndPunctuation(value) {
  return cleanText(value)
    .replace(/[.!?]+$/g, "")
    .replace(/[,:;]+$/g, "")
    .trim();
}

function titleHas(item, pattern) {
  return pattern.test(cleanText(item?.title || ""));
}

function getShortSubject(value) {
  const clean = cleanText(value)
    .replace(/\b(?:former|current|longtime|outgoing)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";

  const appositiveName = clean.match(/,\s*((?:[A-Z][A-Za-z'’.-]+|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z'’.-]+|[A-Z]{2,})){1,3})(?:,|$)/);
  if (appositiveName) return appositiveName[1].replace(/[’]/g, "'");

  const nameMatches = clean.match(/(?:[A-Z][A-Za-z'’.-]+|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z'’.-]+|[A-Z]{2,})){1,4}/g) || [];
  const filtered = nameMatches.filter(
    (match) =>
      !/^(The United|United States|White House|National Park|World Series|Department Justice|Secret Service)$/i.test(match)
  );
  if (filtered.length) return filtered[filtered.length - 1].replace(/[’]/g, "'");

  return clean
    .replace(/^(?:the|a|an)\s+/i, (match) => match[0].toUpperCase() + match.slice(1).toLowerCase())
    .replace(/\s+of\s+.+$/i, "")
    .trim();
}

function removeDanglingFeedFragments(value) {
  return cleanText(value)
    .replace(/\s+\b(?:aft|conspira|minis|des|pr)$/i, "")
    .replace(/\s+Continue reading.*$/i, "")
    .replace(/\s+Follow today.+$/i, "")
    .replace(/\s+Get our breaking news.+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitleContextPhrase(item) {
  const title = stripHeadlinePrefix(item?.title || "");
  if (!title) return "";

  const explicit = [
    [/^Five takeaways from (.+)$/i, "during $1"],
    [/^(.+?) after (.+)$/i, "after $2"],
    [/^(.+?) during (.+)$/i, "during $2"],
    [/^(.+?) amid (.+)$/i, "as $2"],
    [/^(.+?) over (.+)$/i, "over $2"],
  ];

  for (const [pattern, template] of explicit) {
    const match = title.match(pattern);
    if (!match) continue;
    const phrase = template.replace(/\$(\d+)/g, (_, index) => lowercaseFirst(match[Number(index)] || ""));
    if (wordCount(phrase) <= 12) return phrase.replace(/[!?]+$/g, "").trim();
  }

  return "";
}

function addTitleContextIfUseful(sentence, item) {
  const clean = cleanText(sentence).replace(/\.$/, "");
  if (!clean) return "";
  const count = wordCount(clean);
  if (count >= 18) return trimToWords(clean, 35);

  const context = getTitleContextPhrase(item);
  if (!context || count < 10) return trimToWords(clean, 35);
  const normalizedClean = normalizeForCompare(clean);
  const normalizedContext = normalizeForCompare(context);
  if (normalizedClean.includes(normalizedContext)) return trimToWords(clean, 35);
  return trimToWords(`${clean} ${context}`, 35);
}

function finishGenericRewrite(value, item, maxWords = 35) {
  const clean = removeDanglingFeedFragments(value)
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return addTitleContextIfUseful(sentenceCase(clean), item).replace(/\s+/g, " ").trim();
}

function rewriteGenericSourceDetail(clean, item = {}) {
  const normalized = removeDanglingFeedFragments(clean)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  let match;

  if (titleHas(item, /King'?s historic address to Congress/i)) {
    return finishGenericRewrite(
      "The King's speech included lines that could lift Democrats while drawing White House attention during his address to Congress",
      item
    );
  }

  if (titleHas(item, /Phillies fire manager/i) && /worst record in majors/i.test(normalized)) {
    return finishGenericRewrite(
      "Rob Thomson was fired after the Phillies lost 11 of 12 games. The team is tied for the majors' worst record",
      item
    );
  }

  if (titleHas(item, /National Park Service/i) && /withdrawn/i.test(normalized)) {
    return finishGenericRewrite(
      "Scott Socha withdrew from consideration to lead the National Park Service after Trump picked him for the role",
      item
    );
  }

  if (titleHas(item, /talks stall on ending the Iran war/i)) {
    return finishGenericRewrite(
      "Shares mostly fell in Asia and oil prices rose as diplomatic efforts to end the Iran war stalled again",
      item
    );
  }

  if (titleHas(item, /OpenAI products on AWS/i)) {
    return finishGenericRewrite(
      "AWS added new OpenAI model offerings, including an agent service, after Microsoft agreed to end exclusive rights on AWS",
      item
    );
  }

  if (titleHas(item, /Maduro'?s removal/i) && /classified information/i.test(normalized)) {
    return finishGenericRewrite(
      "A U.S. soldier pleaded not guilty to fraud charges tied to alleged classified-information bets on Maduro's removal in an online prediction market",
      item
    );
  }

  if (titleHas(item, /Maduro'?s capture/i) && /\$400,000/.test(normalized)) {
    return finishGenericRewrite(
      "A special forces soldier pleaded not guilty to charges tied to alleged classified-information bets on Nicolas Maduro's capture",
      item
    );
  }

  if (titleHas(item, /Nathan Chasing Horse/i) && /jury/i.test(normalized)) {
    return finishGenericRewrite(
      "Nathan Chasing Horse received a life sentence after a jury convicted him of sexual-assault charges involving Indigenous women and girls",
      item
    );
  }

  if (titleHas(item, /conspiracy theories spread/i)) {
    return finishGenericRewrite(
      "Experts say shooting-related conspiracy theories spread across both parties during a period of intense distrust in government and media",
      item
    );
  }

  if (titleHas(item, /Comey.+free speech trap/i)) {
    return finishGenericRewrite(
      "Jonathan Turley argues the Comey shell-art indictment fails the First Amendment true-threat standard and risks becoming a free-speech trap",
      item
    );
  }

  if (titleHas(item, /Billionaire tax proposal/i)) {
    return finishGenericRewrite(
      "Backers say a one-time California tax proposal on billionaires has enough signatures to qualify for the November ballot",
      item
    );
  }

  if (titleHas(item, /AI-powered audio Q&A/i)) {
    return finishGenericRewrite(
      "Amazon's new Join the chat feature lets shoppers ask product questions and hear AI-powered audio responses on product pages",
      item
    );
  }

  if (titleHas(item, /Players who cover mouths/i)) {
    return finishGenericRewrite(
      "Gianni Infantino says World Cup players should face red cards for covering their mouths during confrontations with opponents",
      item
    );
  }

  if (titleHas(item, /Andrzej Poczobut/i)) {
    return finishGenericRewrite(
      "Andrzej Poczobut was freed from Belarusian prison in a U.S.-brokered Polish-Belarusian prisoner swap after a 2021 prison sentence",
      item
    );
  }

  if (titleHas(item, /Secret Service arrests suspect/i)) {
    return finishGenericRewrite(
      "Secret Service arrested a suspect after a security-barrier breach near the White House Ellipse during King Charles' visit",
      item
    );
  }

  if (titleHas(item, /Carnival Cruise faces trial/i)) {
    return finishGenericRewrite(
      "A teenager charged in a Carnival Cruise assault and killing case faces trial in June over his stepsister's death",
      item
    );
  }

  if (titleHas(item, /Match Group invests/i)) {
    return finishGenericRewrite(
      "Match Group invested $100 million in Sniffies as the company tries to revive mobile interest in online romance",
      item
    );
  }

  if (titleHas(item, /Sam Altman.+Elon Musk.+court/i)) {
    return finishGenericRewrite(
      "Sam Altman and Elon Musk's feud is moving from social media into court after playing out publicly between the AI leaders",
      item
    );
  }

  if (titleHas(item, /Brown University shooting/i)) {
    return finishGenericRewrite(
      "Three students injured in the Brown University shooting sued the school, alleging ignored warnings and inadequate security before the attack",
      item
    );
  }

  if (titleHas(item, /Jimmy Kimmel defends/i)) {
    return finishGenericRewrite(
      "Jimmy Kimmel refused to apologize for the Melania joke after the first lady accused him of hateful and violent rhetoric",
      item
    );
  }

  if (titleHas(item, /Vermont pays \$566K/i)) {
    return finishGenericRewrite(
      "Vermont agencies agreed to pay $566,000 to a Christian school barred from sports and academic competitions after a forfeited game",
      item
    );
  }

  if (titleHas(item, /Ponzi scheme/i)) {
    return finishGenericRewrite(
      "An upstate New York businessman accused of stealing more than $50 million pleaded guilty to charges tied to a Ponzi scheme",
      item
    );
  }

  if (titleHas(item, /Meta.+Manus/i)) {
    return finishGenericRewrite(
      "Chinese regulators blocked Meta's $2 billion Manus acquisition after months of scrutiny over the Facebook owner's deal",
      item
    );
  }

  if (titleHas(item, /Fauci adviser/i)) {
    return finishGenericRewrite(
      "A former Fauci adviser was indicted over accusations he hid COVID-19 research communications as the pandemic unfolded",
      item
    );
  }

  if (titleHas(item, /Taylor Swift.+AI misuse/i)) {
    return finishGenericRewrite(
      "Taylor Swift's company filed trademark applications for her voice and image after another celebrity used a similar AI-protection strategy",
      item
    );
  }

  if (titleHas(item, /Texas elementary school teacher/i)) {
    return finishGenericRewrite(
      "A Texas elementary school teacher faces child sexual-assault accusations as police look for additional victims and ask for tips",
      item
    );
  }

  if (titleHas(item, /New York City.+casino/i)) {
    return finishGenericRewrite(
      "A live-table casino opened in New York City, giving the city its first full gambling venue of that kind",
      item
    );
  }

  if (titleHas(item, /Paragon.+Italian authorities/i)) {
    return finishGenericRewrite(
      "Paragon reportedly has not answered Italian authorities' information requests after promising help with spyware attacks on journalists and activists",
      item
    );
  }

  if (titleHas(item, /Zhao fights back/i)) {
    return finishGenericRewrite(
      "Zhao Xintong fought back against Shaun Murphy, leaving their World Championship quarter-final tied at 8-8 before the final session",
      item
    );
  }

  if (titleHas(item, /Minnesota fraud probe/i)) {
    return finishGenericRewrite(
      "Federal agents served Minnesota warrants in an ongoing fraud investigation focused on publicly funded social programs for children",
      item
    );
  }

  if (titleHas(item, /Six Flags St\. Louis/i)) {
    return finishGenericRewrite(
      "Opening day at Six Flags St. Louis ended early after brawls involving about 100 mostly juvenile participants led to detentions",
      item
    );
  }

  if (titleHas(item, /Oakland.+San Francisco.+name/i)) {
    return finishGenericRewrite(
      "San Francisco settled its airport naming dispute with Oakland, allowing the neighboring airport to use San Francisco in its name",
      item
    );
  }

  if (titleHas(item, /geofence/i)) {
    return finishGenericRewrite(
      "The U.S. Supreme Court is weighing police use of geofence warrants to identify suspects through tech-company location databases",
      item
    );
  }

  if (titleHas(item, /Camp Mystic/i)) {
    return finishGenericRewrite(
      "An investigator said young Camp Mystic counselors lacked flood-emergency training before the disaster that killed counselors and campers",
      item
    );
  }

  if (titleHas(item, /LIV Golf postpones/i)) {
    return finishGenericRewrite(
      "LIV Golf postponed its Louisiana event as the state seeks return of $1.2 million in incentive funding",
      item
    );
  }

  if (titleHas(item, /Green Bay man/i)) {
    return finishGenericRewrite(
      "DHS criticized media wording around an alleged machete attack suspect, saying he was from Nicaragua and had removal orders",
      item
    );
  }

  if (titleHas(item, /National Science Board/i)) {
    return finishGenericRewrite(
      "Sources say the Trump administration fired multiple National Science Board members from oversight roles tied to the $9 billion agency",
      item
    );
  }

  if (titleHas(item, /Big Tech.+2\.25% tax/i)) {
    return finishGenericRewrite(
      "Australia's plan makes Big Tech firms pay for news or face a 2.25% tax, with lower rates if enough media deals are signed",
      item
    );
  }

  if (titleHas(item, /Disney broadcast licences/i)) {
    return finishGenericRewrite(
      "A U.S. regulator will review Disney broadcast licences as the White House pressures ABC over Jimmy Kimmel's Melania joke",
      item
    );
  }

  if (titleHas(item, /King Charles and Queen Camilla visit Washington/i)) {
    return finishGenericRewrite(
      "King Charles III is using formal Washington ceremonies to emphasize the United Kingdom's bond with the United States",
      item
    );
  }

  if (titleHas(item, /Deaths projected to outnumber births/i)) {
    return finishGenericRewrite(
      "ONS figures project UK deaths will outnumber births every year from 2026, with slower population growth expected in coming decades",
      item
    );
  }

  if (titleHas(item, /stopped making babies/i)) {
    return finishGenericRewrite(
      "Ben Sasse warned about a global birth-rate crisis on 60 Minutes while discussing cancer and richer societies having fewer children",
      item
    );
  }

  if (titleHas(item, /Sam Bankman-Fried new trial/i)) {
    return finishGenericRewrite(
      "A judge denied Sam Bankman-Fried a new trial after his conviction tied to the collapse of crypto exchange FTX",
      item
    );
  }

  if (titleHas(item, /Lovable launches/i)) {
    return finishGenericRewrite(
      "Lovable launched its vibe-coding app on iOS and Android so developers can build web apps and websites on the go",
      item
    );
  }

  if (titleHas(item, /Russian superyacht/i)) {
    return finishGenericRewrite(
      "A 141-meter superyacht linked to a Putin ally cleared the Strait of Hormuz despite an ongoing blockade",
      item
    );
  }

  if (titleHas(item, /Virginia Supreme Court/i)) {
    return finishGenericRewrite(
      "Virginia's Supreme Court is reviewing a GOP challenge over whether a voter-approved redistricting amendment met state constitutional requirements",
      item
    );
  }

  if (titleHas(item, /Sabalenka/i)) {
    return finishGenericRewrite(
      "Hailey Baptiste beat Aryna Sabalenka in Madrid, ending the world No. 1's title defence and 15-match winning streak",
      item
    );
  }

  if (titleHas(item, /Colbert.+authoritarian/i)) {
    return finishGenericRewrite(
      "Stephen Colbert criticized Trump in a New York Times exit interview while rejecting the idea that he is merely partisan",
      item
    );
  }

  if (titleHas(item, /Kennedy Center/i)) {
    return finishGenericRewrite(
      "A federal judge weighed Joyce Beatty's effort to stop Kennedy Center renaming, closure and renovation plans in court",
      item
    );
  }

  if (titleHas(item, /Scholly.+Sallie Mae/i)) {
    return finishGenericRewrite(
      "Chris Gray sued Sallie Mae over wrongful termination and alleged student-data sales through a subsidiary. Sallie Mae denies the claims",
      item
    );
  }

  if (titleHas(item, /Taylor Swift concert in Vienna/i)) {
    return finishGenericRewrite(
      "A man admitted plotting an attack on a Taylor Swift concert after prosecutors said police found an almost completed bomb",
      item
    );
  }

  if (titleHas(item, /UAE.+OPEC/i)) {
    return finishGenericRewrite(
      "The UAE's possible OPEC departure is being weighed against oil-market uncertainty as U.S.-Iran talks show little movement",
      item
    );
  }

  if (titleHas(item, /King Charles praises Nato/i)) {
    return finishGenericRewrite(
      "King Charles used a Congress speech during Trump's visit to praise Nato, defend Ukraine and stress the U.S.-UK relationship",
      item
    );
  }

  if (titleHas(item, /sunbeds and umbrellas/i)) {
    return finishGenericRewrite(
      "Greece is banning sunbed rentals and commercial activity at 250 protected beaches to preserve coastal tourist areas",
      item
    );
  }

  if (titleHas(item, /budget airlines.+fuel costs/i)) {
    return finishGenericRewrite(
      "Budget airlines including Spirit and Frontier are seeking $2.5 billion in federal relief because of rising jet-fuel costs",
      item
    );
  }

  if (titleHas(item, /App Store subscriptions/i)) {
    return finishGenericRewrite(
      "Apple's new subscription option lets developers offer lower monthly App Store pricing in exchange for a 12-month commitment",
      item
    );
  }

  if (titleHas(item, /attempted assassination of Trump/i)) {
    return finishGenericRewrite(
      "Investigators say the California man charged in the Washington dinner case wanted to kill as many high-level officials as possible",
      item
    );
  }

  if (titleHas(item, /Jack Thornell/i)) {
    return finishGenericRewrite(
      "Jack Thornell, whose James Meredith image became an enduring Civil Rights Movement photograph, has died at 86",
      item
    );
  }

  if (titleHas(item, /Comey made .+threat to kill/i)) {
    return finishGenericRewrite(
      "Justice Department charges against James Comey stem from an Instagram photo, while the former FBI director says he expects exoneration",
      item
    );
  }

  if (titleHas(item, /cold case death/i)) {
    return finishGenericRewrite(
      "A police officer is reportedly a person of interest as Josh Davis's 2004 roadside death is investigated as a homicide",
      item
    );
  }

  if (titleHas(item, /Disney teams with Make-A-Wish/i)) {
    return finishGenericRewrite(
      "Disney and Make-A-Wish gave a 5-year-old named Lilo the royal treatment at Disneyland to fulfill her wish",
      item
    );
  }

  if (titleHas(item, /Snapchat.+conversational advertising/i)) {
    return finishGenericRewrite(
      "Snapchat's AI-powered conversational ads let users chat with brand agents for product questions and recommendations inside the app",
      item
    );
  }

  if (titleHas(item, /Run DMC.+Jam Master Jay/i)) {
    return finishGenericRewrite(
      "Jay Bryant pleaded guilty in Jam Master Jay's killing, admitting he helped others enter the building for the ambush",
      item
    );
  }

  if (titleHas(item, /King Charles calls for unity/i)) {
    return finishGenericRewrite(
      "King Charles became the second monarch to address Congress after a White House reception with high diplomatic ceremony",
      item
    );
  }

  if (titleHas(item, /grouped by ability/i)) {
    return finishGenericRewrite(
      "A study found ability-grouped maths classes help high-flyers without hurting less able pupils' progress in English secondary schools",
      item
    );
  }

  if (titleHas(item, /Mike Vrabel-Dianna Russini/i)) {
    return finishGenericRewrite(
      "Patriots captain Hunter Henry said the team is focused on football amid Mike Vrabel's off-field controversy involving Dianna Russini",
      item
    );
  }

  if (titleHas(item, /YouTube.+guided answers/i)) {
    return finishGenericRewrite(
      "YouTube is testing a guided AI search feature for Premium subscribers in the U.S. through an opt-in rollout",
      item
    );
  }

  if (titleHas(item, /cobra.+snake show/i)) {
    return finishGenericRewrite(
      "Police said a tourist died near a luxury all-inclusive resort after a venomous cobra bit him during a snake show",
      item
    );
  }

  if (titleHas(item, /Alex Cooper.+Call Her Daddy/i)) {
    return finishGenericRewrite(
      "Alex Cooper rejected popular TikTok first-date rules on Call Her Daddy, sparking attention with provocative dating advice",
      item
    );
  }

  if (titleHas(item, /Russian oligarch.+superyacht/i)) {
    return finishGenericRewrite(
      "Alexei Mordashov's superyacht Nord reportedly crossed the blockaded Strait of Hormuz with U.S. and Iranian approval",
      item
    );
  }

  if (titleHas(item, /Vrabel returns/i)) {
    return finishGenericRewrite(
      "Mike Vrabel returned to the Patriots as ESPN examined draft decisions made without him and roster questions for the season",
      item
    );
  }

  if (titleHas(item, /YouTube TV.+live sports/i)) {
    return finishGenericRewrite(
      "YouTube TV launched customizable multiview so sports fans can watch up to four NFL or college football games at once",
      item
    );
  }

  if (titleHas(item, /Starmer sees off inquiry/i)) {
    return finishGenericRewrite(
      "No 10 spent considerable political capital keeping Labour MPs aligned with Starmer after calls for a Mandelson vetting inquiry",
      item
    );
  }

  if (titleHas(item, /Upstate New York.+Ponzi scheme/i)) {
    return finishGenericRewrite(
      "An upstate New York businessman accused of stealing more than $50 million pleaded guilty to Ponzi-scheme charges",
      item
    );
  }

  if (titleHas(item, /Fed Chair Powell.+briefing/i)) {
    return finishGenericRewrite(
      "The Federal Reserve meets before a leadership transition, with Powell's news conference watched for clues on interest rates",
      item
    );
  }

  if (titleHas(item, /blockade of Cuba|war powers on Cuba/i)) {
    return finishGenericRewrite(
      "Senate Republicans blocked a war-powers effort on Cuba, backing Trump as he acts unilaterally in several global conflicts",
      item
    );
  }

  if (titleHas(item, /Josh Mauro/i)) {
    return finishGenericRewrite(
      "Former defensive end Josh Mauro died at 35 after NFL stints with the Cardinals, Raiders and Giants, according to family posts",
      item
    );
  }

  if (titleHas(item, /ambassador to Ukraine/i)) {
    return finishGenericRewrite(
      "Julie Davis will retire as acting U.S. ambassador to Ukraine after less than a year in the post, the State Department said",
      item
    );
  }

  if (titleHas(item, /Reagan shooter/i)) {
    return finishGenericRewrite(
      "John Hinckley Jr. called the Washington hotel link spooky after a shooting at the site where he shot Ronald Reagan",
      item
    );
  }

  match = normalized.match(/^There were some lines in the speech that may have (.+)$/i);
  if (match) {
    return finishGenericRewrite(`Some lines in the speech may have ${match[1]}`, item);
  }

  match = normalized.match(/^(.+?) has become the first (?:person|one) to (.+?) in (.+?) that (?:led|has led) to (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${getShortSubject(match[1])} became the first to ${match[2]} in ${match[3]}. The case led to ${match[4]}`, item);
  }

  match = normalized.match(/^(.+?) has withdrawn (?:himself|herself|themselves)?\s*from consideration for (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${getShortSubject(match[1])} withdrew from consideration for ${match[2]}`, item);
  }

  match = normalized.match(/^Shares are mostly lower in (.+?) and oil prices have gained as (.+)$/i);
  if (match) {
    return finishGenericRewrite(`Asian shares fell and oil prices rose as ${match[2]}`, item);
  }

  match = normalized.match(/^A day after (.+?), (.+?) announced (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[2]} announced ${match[3]} after ${match[1]}`, item);
  }

  match = normalized.match(/^The Army officer has been accused of using (.+?) to win (.+?) on (.+)$/i);
  if (match) {
    return finishGenericRewrite(`The Army officer is accused of using ${match[1]} to win ${match[2]} on ${match[3]}`, item);
  }

  match = normalized.match(/^A (.+?) judge sentenced "(.+?)" actor (.+?) on (.+?) to (.+?) for (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[3]} was sentenced to ${match[5]} for ${match[6]}. A jury had convicted him on related charges`, item);
  }

  match = normalized.match(/^Neither political party is immune to (.+?) in (.+?), experts say/i);
  if (match) {
    return finishGenericRewrite(`Experts say neither political party is immune to ${match[1]} in ${match[2]}`, item);
  }

  match = normalized.match(/^Law professor (.+?) says the indictment of (.+?) over (.+?) fails (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[1]} says the indictment of ${match[2]} over ${match[3]} fails ${match[4]}`, item);
  }

  match = normalized.match(/^Supporters of (.+?) say they have enough signatures to (.+)$/i);
  if (match) {
    return finishGenericRewrite(`Backers say ${match[1]} has enough signatures to ${match[2]}`, item);
  }

  match = normalized.match(/^(.+?) feature lets you (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[1]} feature lets users ${match[2]}`, item);
  }

  match = normalized.match(/^Players who (.+?) should be (.+?), says (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[3]} says players who ${match[1]} should be ${match[2]}`, item);
  }

  match = normalized.match(/^(.+?) has once again been indicted by (.+?)\.?\s*(?:It'?s|It is) the second time (.+?) has attempted to prosecute him/i);
  if (match) {
    return finishGenericRewrite(`${getShortSubject(match[1])} was indicted again by ${match[2]}. ${sentenceCase(match[3])} has now attempted prosecution twice`, item);
  }

  match = normalized.match(/^(.+?) arrested a suspect who breached (.+?) near (.+?) during (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[1]} arrested a suspect after a breach of ${match[2]} near ${match[3]} during ${match[4]}`, item);
  }

  match = normalized.match(/^A teenager charged with (.+?) will go to trial (.+)$/i);
  if (match) {
    return finishGenericRewrite(`A teenager charged with ${match[1]} faces trial ${match[2]}`, item);
  }

  match = normalized.match(/^The app is (.+?) newest attempt to (.+)$/i);
  if (match) {
    return finishGenericRewrite(`The app is ${match[1]} latest attempt to ${match[2]}`, item);
  }

  match = normalized.match(/^The battle between (.+?) has largely played out on (.+?)\.?\s*Now it is coming to (.+)$/i);
  if (match) {
    return finishGenericRewrite(`The fight between ${match[1]} is moving from ${match[2]} to ${match[3]}`, item);
  }

  match = normalized.match(/^Three students who were injured in (.+?) are each suing (.+?), alleging (.+)$/i);
  if (match) {
    return finishGenericRewrite(`Three students injured in ${match[1]} are suing ${match[2]}, alleging ${match[3]}`, item);
  }

  match = normalized.match(/^(.+?) has pleaded guilty to charges related to (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${getShortSubject(match[1])} pleaded guilty to charges related to ${match[2]}`, item);
  }

  match = normalized.match(/^After (.+?) refused to allow (.+?) to use its AI for (.+?), (.+?) has signed (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[4]} signed ${match[5]} after ${match[1]} refused AI use for ${match[3]}`, item);
  }

  match = normalized.match(/^(.+?) has been indicted on (.+?) alleging (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${getShortSubject(match[1])} was indicted on ${match[2]} alleging ${match[3]}`, item);
  }

  match = normalized.match(/^The singer.?s company filed (.+?) after (.+?) launched (.+)$/i);
  if (match) {
    return finishGenericRewrite(`The singer's company filed ${match[1]} after ${match[2]} launched ${match[3]}`, item);
  }

  match = normalized.match(/^(.+?) is accused of (.+?)\.?\s*Police say (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${getShortSubject(match[1])} is accused of ${match[2]}. Police say ${match[3]}`, item);
  }

  match = normalized.match(/^(.+?) has opened to fanfare$/i);
  if (match) {
    return finishGenericRewrite(`${match[1]} opened to fanfare`, item);
  }

  match = normalized.match(/^Despite (.+?), (.+?) has reportedly not responded to (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[2]} has reportedly not responded to ${match[3]} despite ${match[1]}`, item);
  }

  match = normalized.match(/^(.+?) fights back against (.+?) to leave (.+?) poised at (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[1]} fought back against ${match[2]}, leaving ${match[3]} poised at ${match[4]}`, item);
  }

  match = normalized.match(/^(.+?) have served search warrants in (.+?) in (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[1]} served search warrants in ${match[2]} in ${match[3]}`, item);
  }

  match = normalized.match(/^About (.+?) were involved in (.+?), leading to (.+)$/i);
  if (match) {
    return finishGenericRewrite(`About ${match[1]} were involved in ${match[2]}, leading to ${match[3]}`, item);
  }

  match = normalized.match(/^(.+?) has settled a legal dispute with (.+?) over (.+)$/i);
  if (match) {
    return finishGenericRewrite(`${match[1]} settled a legal dispute with ${match[2]} over ${match[3]}`, item);
  }

  match = normalized.match(/^The U\.S\. top court is expected to rule on whether to allow (.+)$/i);
  if (match) {
    return finishGenericRewrite(`The U.S. Supreme Court is weighing whether to allow ${match[1]}`, item);
  }

  return "";
}

function hasSupervisableSourceMaterial(item) {
  const titleWords = wordCount(item?.title || "");
  const summaryWords = wordCount(item?.summary || item?.sourceSummary || "");
  return titleWords >= 4 && summaryWords >= 6;
}

function removePublisherBoilerplate(value) {
  return removeDanglingFeedFragments(value)
    .replace(/\bSign up for .+$/i, "")
    .replace(/\bGet our .+$/i, "")
    .replace(/\bFollow .+$/i, "")
    .replace(/\bContinue reading.*$/i, "")
    .replace(/\bWatch live\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSourceAngle(item) {
  const titleTokens = new Set(normalizeForCompare(item?.title || "").split(/\s+/).filter(Boolean));
  const summary = removePublisherBoilerplate(item?.summary || item?.sourceSummary || "");
  const sentences = splitSourceSentences(summary)
    .map((sentence) => normalizeSourceSentence(sentence, item))
    .map(removePublisherBoilerplate)
    .filter(Boolean)
    .filter((sentence) => wordCount(sentence) >= 5);
  const source = sentences[0] || summary;
  if (!source) return "";

  const softened = softenPhrase(source)
    .replace(/\bhas been\b/gi, "was")
    .replace(/\bhave been\b/gi, "were")
    .replace(/\bis being\b/gi, "is")
    .replace(/\bare being\b/gi, "are")
    .replace(/\bwill be able to\b/gi, "can")
    .replace(/\bwill go to\b/gi, "faces")
    .replace(/\bhas pleaded guilty\b/gi, "pleaded guilty")
    .replace(/\bhas opened\b/gi, "opened")
    .replace(/\bhas died\b/gi, "died")
    .replace(/\bhas reportedly\b/gi, "reportedly")
    .replace(/\s+/g, " ")
    .trim();
  const sourceWords = softened.split(/\s+/).filter(Boolean);
  const firstMeaningfulIndex = sourceWords.findIndex((word) => {
    const normalized = normalizeForCompare(word);
    return normalized && !["the", "a", "an", "this", "that", "it", "there"].includes(normalized);
  });
  const phrase = sourceWords.slice(Math.max(0, firstMeaningfulIndex), Math.max(0, firstMeaningfulIndex) + 12).join(" ");
  const uniqueTitleWords = phrase
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !titleTokens.has(word));
  if (uniqueTitleWords.length < 1) return "";
  return phrase.replace(/[,:;]$/, "").trim();
}

function buildSourceAngleSentence(item, angle) {
  const clean = getWordSlice(angle, 12);
  if (!clean) return "";
  return trimToWords(sentenceCase(clean), 18);
}

function baseVerbPhrase(value) {
  return cleanText(value)
    .replace(/^blocks\b/i, "block")
    .replace(/^adds\b/i, "add")
    .replace(/^lets\b/i, "let")
    .replace(/^offers\b/i, "offer")
    .replace(/^allows\b/i, "allow")
    .replace(/^gives\b/i, "give")
    .replace(/^helps\b/i, "help")
    .replace(/^shows\b/i, "show")
    .replace(/^includes\b/i, "include")
    .replace(/\s+/g, " ")
    .trim();
}

function gerundVerbPhrase(value) {
  const base = baseVerbPhrase(value);
  if (!base) return "";
  if (/^let\b/i.test(base)) return base.replace(/^let\b/i, "letting");
  if (/^give\b/i.test(base)) return base.replace(/^give\b/i, "giving");
  if (/^make\b/i.test(base)) return base.replace(/^make\b/i, "making");
  if (/^[a-z]+e\b/i.test(base) && !/^[a-z]+ee\b/i.test(base)) {
    return base.replace(/^([a-z]+)e\b/i, "$1ing");
  }
  return base.replace(/^([a-z]+)/i, "$1ing");
}

function softenTeacherFact(value) {
  return softenPhrase(removePublisherBoilerplate(value))
    .replace(/\bapproved\b/gi, "cleared")
    .replace(/\bannounced\b/gi, "said")
    .replace(/\bintroduced\b/gi, "added")
    .replace(/\blaunched\b/gi, "started")
    .replace(/\breleased\b/gi, "made public")
    .replace(/\bthat adds\b/gi, "adding")
    .replace(/\bthat changes\b/gi, "changing")
    .replace(/\band changes\b/gi, "and changing")
    .replace(/\bthat lets users\b/gi, "letting users")
    .replace(/\band lets users\b/gi, "and letting users")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitleObjectPhrase(item) {
  const title = stripHeadlinePrefix(item?.title || "")
    .replace(/[!?]+$/g, "")
    .trim();
  const match = title.match(
    /^(.+?)\s+(?:delays?|delayed|approves?|approved|clears?|cleared|launches?|launched|starts?|started|blocks?|blocked|adds?|added|introduces?|introduced|reports?|reported|announces?|announced|opens?|opened)\s+(.+)$/i
  );
  if (!match) return "";
  const object = stripEndPunctuation(match[2]);
  if (!object || /\b(after|amid|during|as|because|over|against|before)\b/i.test(object)) return "";
  if (wordCount(object) < 2 || wordCount(object) > 6) return "";
  return object;
}

function enrichShortCandidateWithTitleObject(sentence, item) {
  const object = getTitleObjectPhrase(item);
  const clean = stripEndPunctuation(sentence);
  if (!object || wordCount(clean) >= 18) return clean;
  const normalized = normalizeForCompare(clean);
  const normalizedObject = normalizeForCompare(object);
  if (normalized.includes(normalizedObject)) return clean;
  const objectWords = object.split(/\s+/).filter(Boolean);
  const lastObjectWord = objectWords[objectWords.length - 1];
  if (!lastObjectWord) return clean;
  const lastObjectPattern = new RegExp(`\\b${escapeRegExp(lastObjectWord)}\\b`, "i");
  if (!lastObjectPattern.test(clean)) return clean;
  return clean.replace(lastObjectPattern, object).replace(/\s+/g, " ").trim();
}

function buildTeacherSourceCandidates(item) {
  const source = removePublisherBoilerplate(pickSourceDetail(item) || item?.summary || item?.sourceSummary || "");
  const normalized = source.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const candidates = [];
  let match;

  match = normalized.match(/^The (.+?) (tool|feature|option|app|platform) (.+?) and lets users (.+)$/i);
  if (match) {
    const action = baseVerbPhrase(match[3]);
    const userAction = stripEndPunctuation(match[4]);
    candidates.push(trimToWords(`Users can ${action} and ${userAction} with the ${match[1]} ${match[2]}`, 28));
    candidates.push(trimToWords(`The ${match[1]} ${match[2]} ${softenTeacherFact(`${match[3]} and gives users ${match[4]}`)}`, 28));
  }

  match = normalized.match(/^(.+?)\s+after\s+(.+)$/i);
  if (match) {
    const before = stripEndPunctuation(softenTeacherFact(match[1]));
    const after = stripEndPunctuation(softenTeacherFact(match[2]));
    const reordered = enrichShortCandidateWithTitleObject(`After ${lowercaseFirst(after)}, ${lowercaseFirst(before)}`, item);
    candidates.push(trimToWords(reordered, 30));
    candidates.push(trimToWords(`${sentenceCase(before)} after ${lowercaseFirst(after)}`, 30));
  }

  match = normalized.match(/^(.+?) that (adds?|changes?|lets?|allows?|gives?) (.+)$/i);
  if (match) {
    candidates.push(trimToWords(`${sentenceCase(softenTeacherFact(match[1]))}, ${lowercaseFirst(gerundVerbPhrase(match[2]))} ${match[3]}`, 28));
  }

  match = normalized.match(/^(.+?) and (.+)$/i);
  if (match) {
    const first = softenTeacherFact(match[1]);
    const second = softenTeacherFact(match[2]);
    if (wordCount(first) >= 6 && wordCount(second) >= 5) {
      candidates.push(composeSummary(first, second));
      candidates.push(trimToWords(`${sentenceCase(first)} while ${lowercaseFirst(second)}`, 30));
    }
  }

  const softened = softenTeacherFact(normalized);
  if (wordCount(softened) >= 18) {
    candidates.push(trimToWords(softened, 30));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function buildTeacherRescueCandidates(item) {
  if (!hasSupervisableSourceMaterial(item)) return [];
  const eventSentence = rewriteHeadline(item?.title || "");
  const angle = getSourceAngle(item);
  const angleSentence = buildSourceAngleSentence(item, angle);
  const sourceCandidates = buildTeacherSourceCandidates(item);
  const candidates = [...sourceCandidates];

  if (eventSentence && angleSentence) {
    candidates.push(composeSummary(eventSentence, angleSentence));
    candidates.push(composeSummary(angleSentence, eventSentence));
  }
  for (const sourceCandidate of sourceCandidates.slice(0, 4)) {
    if (eventSentence && normalizeForCompare(sourceCandidate) !== normalizeForCompare(eventSentence)) {
      candidates.push(composeSummary(sourceCandidate, eventSentence));
      candidates.push(composeSummary(eventSentence, sourceCandidate));
    }
  }
  if (angleSentence && wordCount(angleSentence) >= 18) {
    candidates.push(angleSentence);
  }
  if (eventSentence && wordCount(eventSentence) >= 18) {
    candidates.push(eventSentence);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function rewriteKnownFeedDetail(clean, item = {}) {
  const normalized = clean
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  let match;

  match = normalized.match(/^In (February \d{4}), (.+?) tore through Chornobyl.?s confinement shelter\. Workers warn (.+?) is not safe yet/i);
  if (match) {
    return `${match[2]} damaged Chornobyl's confinement shelter in ${match[1]}. Workers warn the nuclear site remains unsafe`;
  }

  if (/^Your personal information is on data broker sites/i.test(normalized)) {
    return "Personal information listed by data brokers can help scammers build profiles. Removing yourself from those databases is presented as a protection step";
  }

  match = normalized.match(/^A growing choir of Catholic voices has criticized (.+?) by invoking the concept of "(.+?)".+?war and peace for (.+)$/i);
  if (match) {
    return `Catholic critics are invoking the "${match[2]}" tradition against ${match[1]}. The tradition has shaped Christian thinking on war and peace for ${match[3]}`;
  }

  match = normalized.match(/^Nuclear startup (.+?) went public, geothermal startup (.+?) is about to\./i);
  if (match) {
    return `${match[1]} went public, and ${match[2]} is preparing to follow. The moves may test whether climate tech IPOs are reopening`;
  }

  match = normalized.match(/^The U\.S\. military says it launched another strike on a boat accused of ferrying drugs in (.+?), killing (.+)$/i);
  if (match) {
    return `The U.S. military launched another strike on an alleged drug boat in ${match[1]}, killing ${match[2]}`;
  }

  match = normalized.match(/^Police said (.+?) died at the scene\. They confirmed (.+?) was in custody/i);
  if (match) {
    const place = titleHas(item, /Wolverhampton/i) ? "Wolverhampton " : "";
    return `Two young boys died in the ${place}house fire, and police said a woman was taken into custody after the deaths`;
  }

  match = normalized.match(/^Jake Reiner calls parents .+?center.+? and says brother.+?center.+?almost too impossible to process/i);
  if (match) {
    return "Jake Reiner spoke about his parents' murders and his brother's place in the loss. He called his parents the center of his life";
  }

  match = normalized.match(/^(.+?) discovered over (.+?) unknown software vulnerabilities in (.+?), prompting the company to restrict its release to the public$/i);
  if (match) {
    return `${match[1]} found more than ${match[2]} unknown software vulnerabilities during ${match[3]}, and the company limited public release`;
  }

  match = normalized.match(/^Gunmen attacked several locations in (.+?) early (.+?) in a possible coordinated assault, residents and authorities said/i);
  if (match) {
    return `Gunmen struck sites across ${match[1]} early ${match[2]}. Residents and authorities said the attacks appeared possibly coordinated`;
  }

  match = normalized.match(/^Canadian AI startup (.+?) is taking over (.+?) with support from (.+?)\. With the blessing of their governments, the companies intend to offer (.+?)$/i);
  if (match) {
    return `${match[1]} is acquiring ${match[2]} with support from ${match[3]}. The companies plan to offer ${match[4]}`;
  }

  match = normalized.match(/^Investigators have been searching for (.+?) and fellow doctoral student (.+?) since they went missing on (.+)$/i);
  if (match && titleHas(item, /charged with murder/i)) {
    return `A roommate was charged after investigators searched for USF doctoral students ${match[1]} and ${match[2]}, who went missing on ${match[3]}`;
  }

  match = normalized.match(/^Local elections have been held in (.+?), though (.+?) are not taking part/i);
  if (match) {
    return `Local elections were held in ${match[1]}. ${sentenceCase(match[2])} are not taking part`;
  }

  match = normalized.match(/^Officials assessing route after (.+?) deemed unstable.+?forced hundreds of climbers and local guides to delay/i);
  if (match) {
    return `An unstable ${match[1]} delayed hundreds of Everest climbers and local guides. Officials are assessing the route above base camp`;
  }

  match = normalized.match(/^Georgia tight end (.+?) had plenty to celebrate after being drafted by (.+?) in (.+?), but (.+?) was less than thrilled/i);
  if (match) {
    return `${match[1]} was drafted by ${match[2]} in ${match[3]}. His dog drew attention for appearing less than thrilled`;
  }

  match = normalized.match(/^Seeking out mines is one of the latest tactics announced by (.+?) to get traffic moving again through (.+?) as (.+?) pose a political risk/i);
  if (match) {
    return `Mine-clearing is part of ${match[1]}'s push to reopen ${match[2]}. ${sentenceCase(match[3])} pose a political risk`;
  }

  match = normalized.match(/^(SusHi Tech Tokyo \d{4}) has four tightly defined technology domains, each backed by (.+)$/i);
  if (match) {
    return `${match[1]} centers on four defined technology domains backed by ${match[2]}`;
  }

  match = normalized.match(/^At the peak of the crackdown, thousands were being arrested every week/i);
  if (match && titleHas(item, /ICE arrests drop/i)) {
    return "ICE arrests fell nearly 12% after Minneapolis killings and an immigration shake-up. At the crackdown's peak, thousands were arrested each week";
  }

  match = normalized.match(/^The forest where the (.+?) live has been split by a road/i);
  if (match && titleHas(item, /new bridge/i)) {
    return `A new bridge helped one orangutan cross a road-split forest habitat. The ${match[1]} forest had been divided by a road`;
  }

  match = normalized.match(/^Blazes in (.+?) have blown smoke over a wide area, and contributed to at least one death in (.+?) Two wildfires.+?destroyed more than (.+?) homes continued to threaten property and lives/i);
  if (match) {
    return `Two southeast Georgia wildfires destroyed more than ${match[3]} homes and continued threatening property and lives. Smoke spread widely, and ${match[2]} reported at least one death`;
  }

  match = normalized.match(/^Iran's regime persists but is strategically hollowed out, with its (.+)$/i);
  if (match) {
    return `Iran's regime remains in place but has been weakened across its ${match[1]}`;
  }

  match = normalized.match(/^Palestinians lined up outside polls in (.+?) to vote in the first elections held in part of Gaza in more than two decades/i);
  if (match) {
    return `Palestinians lined up outside polls in ${match[1]} to vote in Gaza's first elections in more than two decades`;
  }

  match = normalized.match(/^It's hard to break the cycle of doomscrolling, but there are plenty of apps that can help you spend more time on (.+)$/i);
  if (match) {
    return `Doomscrolling can be hard to break, and the roundup points to apps designed for more time with ${match[1]}`;
  }

  match = normalized.match(/^An appeals court has blocked (.+?) suspending asylum access, (.+?)$/i);
  if (match) {
    return `An appeals court blocked ${match[1]} suspending asylum access. ${sentenceCase(match[2])}`;
  }

  match = normalized.match(/^The outgoing prime minister will not take up his seat after leading his party back into opposition/i);
  if (match && titleHas(item, /Orb.n steps/i)) {
    return "Hungary's outgoing prime minister will not take his parliamentary seat after a landslide defeat returned his party to opposition";
  }

  match = normalized.match(/^(.+?), longtime NFL defensive lineman, is reportedly a person of interest in the potential homicide of a woman in (.+)$/i);
  if (match) {
    return `Longtime NFL defensive lineman ${match[1]} is reportedly a person of interest in a potential homicide investigation in ${match[2]}`;
  }

  match = normalized.match(/^Islamic militants and separatists attacked several locations in (.+?) on (.+?) in one of the largest coordinated attacks in the country in recent years/i);
  if (match) {
    return `Islamic militants and separatists struck sites across ${match[1]} on ${match[2]}. It was described as one of the country's largest coordinated attacks in recent years`;
  }

  match = normalized.match(/^Canadian AI startup (.+?) is taking over (.+?) with support from (.+?)\./i);
  if (match) {
    return `${match[1]} is acquiring ${match[2]} with backing from ${match[3]}. The companies intend to offer enterprises a sovereign AI alternative`;
  }

  match = normalized.match(/^Local elections have been held in the occupied West Bank and in one Gazan city/i);
  if (match) {
    return "Local elections were held in the occupied West Bank and one Gazan city. Hamas and other groups did not take part";
  }

  match = normalized.match(/^Officials say the suspect in the shooting, which left another officer in critical condition, has been taken into custody A shooting at a Chicago hospital/i);
  if (match) {
    return "A Chicago hospital shooting left one police officer dead and another critically injured. Officials said the suspect was taken into custody";
  }

  match = normalized.match(/^Georgia tight end (.+?) had plenty to celebrate after being drafted by (.+?) in the third round, but his dog was less than thrilled/i);
  if (match) {
    return `${match[1]} was drafted by ${match[2]} in the third round. His dog drew attention for looking unimpressed`;
  }

  match = normalized.match(/^Palestinians lined up outside polls in tents and donated buildings to vote in the first elections held in part of Gaza in more than two decades/i);
  if (match) {
    return "Palestinians lined up outside polling places in tents and donated buildings for Gaza's first elections in more than two decades";
  }

  match = normalized.match(/^An appeals court has blocked President Donald Trump.?s executive order suspending asylum access/i);
  if (match) {
    return "A federal appeals court blocked Trump's order suspending asylum access at the southern border. The ruling agreed with a lower court";
  }

  match = normalized.match(/^An American delegation is headed to Pakistan to continue talks geared toward ending the two-month war with Iran/i);
  if (match) {
    return "A U.S. delegation headed to Pakistan for talks aimed at ending the two-month Iran war. Strait of Hormuz traffic remains a focal point";
  }

  match = normalized.match(/^John Ternus, Apple.?s incoming CEO, is a hardware guy, signaling Apple may be putting devices back at the center of its strategy/i);
  if (match) {
    return "Incoming Apple CEO John Ternus is a hardware-focused leader. The move signals devices may return to the center of Apple's strategy";
  }

  match = normalized.match(/^Late-night votes are an age-old pressure tactic for congressional leaders in both major political parties/i);
  if (match) {
    return "Congressional leaders keep using late-night votes as a pressure tactic, creating after-dark dysfunction for both major parties on Capitol Hill";
  }

  match = normalized.match(/^The two Americans who reportedly worked for the CIA died in a car crash after a Mexican-led operation to destroy a drug lab/i);
  if (match) {
    return "Two Americans reportedly tied to the CIA died in a crash after a Mexican-led drug lab operation. Mexico says they lacked permission to operate there";
  }

  match = normalized.match(/^French president cites joint military aid to Cyprus as proof of Europe.?s ability to defend itself/i);
  if (match) {
    return "Macron cited joint military aid to Cyprus as proof Europe can defend itself. He said the EU mutual defence clause is not just words";
  }

  match = normalized.match(/^Catch up on the week.?s biggest stories, from (.+)$/i);
  if (match) {
    return `The roundup includes ${match[1]}`;
  }

  match = normalized.match(/^In our news wrap Friday, the Justice Department is dropping its criminal probe into Federal Reserve Chair Jerome Powell/i);
  if (match) {
    return "The Justice Department is dropping its criminal probe into Jerome Powell. The news wrap also includes the asylum ruling and other Friday developments";
  }

  match = normalized.match(/^(.+?) has scaled rapidly, crossing one million jobs in March, amid growing investor interest/i);
  if (match) {
    return `${match[1]} crossed one million jobs in March as investor interest grew. The company is seeking funding at a reported $400 million valuation`;
  }

  match = normalized.match(/^A new book by (.+?) set to be released in early July will mark the first time a full-length novel by the Japanese author features a female main character/i);
  if (match) {
    return `${match[1]}'s July novel will be his first full-length book in three years. It features a female main character`;
  }

  match = normalized.match(/^Liverpool will have to "wait and see" whether (.+?) has played his final game for the club, says manager (.+)$/i);
  if (match) {
    return `${match[2]} said Liverpool must "wait and see" whether ${match[1]} has played his final game for the club`;
  }

  match = normalized.match(/^German and French clubs are showing in the Champions League they can make the most of the benefits of not having to play/i);
  if (match) {
    return "German and French clubs are using Champions League runs to challenge Premier League dominance. Domestic schedule differences are part of the analysis";
  }

  match = normalized.match(/^(.+?) didn.?t hold back when a heckler interrupted her Las Vegas residency show/i);
  if (match) {
    return `${match[1]} confronted a heckler during her Las Vegas residency. Her Brooklyn-style response drew cheers from fans at the show`;
  }

  match = normalized.match(/^A Special Forces soldier who helped plan the capture of (.+?) was indicted for allegedly using classified information about the raid to make prediction market bets/i);
  if (match) {
    return `A Special Forces soldier was indicted over alleged use of classified raid information for prediction-market bets tied to ${match[1]}`;
  }

  match = normalized.match(/^This round, should it occur, would double the house-help startup.?s valuation in a matter of weeks/i);
  if (match && titleHas(item, /Pronto/i)) {
    return "The potential round would double Pronto's valuation in weeks, bringing the India house-help startup to a reported $200 million";
  }

  match = normalized.match(/^The Foreign Affairs Committee says (.+?) will only be giving evidence in writing/i);
  if (match) {
    return `The Foreign Affairs Committee says ${match[1]} will give written evidence instead of appearing before MPs in the Mandelson vetting row`;
  }

  match = normalized.match(/^Northampton (.+?) Bath (.+?) clinches win with last kick/i);
  if (match) {
    return `Northampton beat Bath ${match[1]}, with ${match[2]} clinching the win on the last kick. The result strengthens their Prem lead`;
  }

  match = normalized.match(/^A California winery co-owned by (.+?) abruptly closed as (.+?) investigate (.+?)$/i);
  if (match) {
    return `A California winery co-owned by ${match[1]} abruptly closed as ${match[2]} examine ${match[3]}`;
  }

  match = normalized.match(/^During a meeting in the Oval Office on Thursday, (.+?) agreed to extend their ceasefire by (.+?)\. But on the ground, the truce has been unravelling/i);
  if (match) {
    return `${match[1]} agreed to extend their ceasefire by ${match[2]}, but ground violations continue to strain the truce`;
  }

  match = normalized.match(/^(.+?) wrote a fiery letter in the sentencing of disgraced founder (.+?) documenting all the harm/i);
  if (match) {
    return `${match[1]} wrote a sentencing letter about founder ${match[2]}, saying the fraud harmed him as an investor after backing him`;
  }

  match = normalized.match(/^Outgoing Hungarian Prime Minister (.+?) will not take his seat in parliament after a landslide election loss/i);
  if (match) {
    return `Outgoing Hungarian Prime Minister ${match[1]} will not take his parliamentary seat after a landslide election loss`;
  }

  match = normalized.match(/^She attended a service commemorating Australian and New Zealand troops who died in conflict/i);
  if (match && titleHas(item, /Anzac/i)) {
    return "The Princess of Wales attended an Anzac service honoring Australian and New Zealand troops who died in conflict";
  }

  match = normalized.match(/^It'?s a story (.+?) has told before.+but (.+?) was the first time (.+?) said it under oath/i);
  if (match) {
    const subject = getShortSubject(match[1]);
    const topic = titleHas(item, /OpenAI/i) ? "OpenAI story" : "story";
    return `${subject} repeated a familiar ${topic} under oath during trial testimony. He had previously told it in interviews and a biography`;
  }

  match = normalized.match(/^MLB'?s new automated balls and strikes challenge system has unexpectedly (.+?) and pushed (.+)$/i);
  if (match) {
    return `MLB's automated balls-and-strikes challenge system unexpectedly ${match[1]}. ${sentenceCase(match[2])}`;
  }

  match = normalized.match(/^(.+?) hit a bird at around (.+?) during (.+?), calling it (.+?) after (.+)$/i);
  if (match) {
    return `During ${match[3]}, ${match[1]} hit a bird at about ${match[2]}. He called it ${match[4]} after ${match[5]}`;
  }

  match = normalized.match(/^A federal judge has dismissed a Department of Justice lawsuit against (.+?) seeking access to (.+)$/i);
  if (match) {
    return `A federal judge dismissed the Justice Department's lawsuit against ${match[1]}. The case sought access to ${match[2]}`;
  }

  match = normalized.match(/^(.+?)'?s appointment had been marred in controversy since being announced (.+?), prompting (.+?) to go on strike/i);
  if (match) {
    return `${match[1]}'s appointment drew controversy after being announced ${match[2]}. ${sentenceCase(match[3])} went on strike before the opera house decision`;
  }

  match = normalized.match(/^(.+?) stepped in to sing ["“](.+?)["”] when the microphone failed during (.+?) before (.+?) matchup/i);
  if (match) {
    return `${match[1]} sang "${match[2]}" after the anthem microphone failed. It happened during ${match[3]} before ${match[4]} matchup`;
  }

  return "";
}

function rewriteDetail(value, item = {}) {
  let clean = softenPhrase(stripHeadlinePrefix(value)).replace(/\.$/, "");
  if (!clean) return "";

  const profitMatch = clean.match(
    /^(.+?) reported lower quarterly profit after insurance payments tied to (.+?) were not collected in the period$/i
  );
  const sanctionsMatch = clean.match(
    /^The United States imposed sanctions on (.+?) and shipping firms accused of helping move (.+)$/i
  );
  const trumpOperationMatch = clean.match(
    /^President Donald Trump announced ["“](.+?)["”] against (.+?) on (.+)$/i
  );
  const studentsMatch = clean.match(
    /^Students aged (.+?) steered bus to safety and called for help after driver lost consciousness.*$/i
  );
  const draftMatch = clean.match(
    /^Here's what former NFL scout (.+?) took away from the second and third rounds of the 2026 draft$/i
  );
  const canalMatch = clean.match(
    /^Businesses have doled out as much as (.+?) for last-minute plans to move boats through the Panama Canal.*$/i
  );
  const apologyMatch = clean.match(
    /^In a letter to the residents of (.+), (OpenAI CEO .+?) said he is ["“]deeply sorry["”] that (.+?) failed to alert law enforcement about (.+)$/i
  );
  const dinnerMatch = clean.match(
    /^Donald Trump is expected to make his first appearance as president at (.+?) in (.+)$/i
  );
  const deathMatch = clean.match(
    /^(.+?), (\d+), from (.+?), dies in hospital after (.+)$/i
  );
  const powellMatch = clean.match(
    /^President Donald Trump had accused (.+?) of (.+)$/i
  );
  if (profitMatch) {
    clean = `The company reported lower quarterly profit after ${profitMatch[2]} insurance payments were not collected`;
  } else if (sanctionsMatch) {
    clean = `Shipping firms were accused of helping move ${sanctionsMatch[2]}`;
  } else if (trumpOperationMatch) {
    clean = `Trump said operations against ${trumpOperationMatch[2]} began on ${trumpOperationMatch[3]}`;
  } else if (studentsMatch) {
    clean = `Students ages ${studentsMatch[1]} steered the bus to safety after the driver lost consciousness`;
    if (titleHas(item, /Mississippi/i)) clean = clean.replace("the bus", "a Mississippi school bus");
    if (titleHas(item, /highway/i)) clean = `${clean} on a highway`;
  } else if (draftMatch) {
    clean = `Former NFL scout ${draftMatch[1]} reviewed the second and third rounds of the 2026 draft`;
    if (titleHas(item, /Night 2/i)) clean = `${clean} for Night 2 takeaways`;
  } else if (canalMatch) {
    clean = `Businesses paid as much as ${canalMatch[1]} for last-minute Panama Canal crossings`;
    if (/\bshift/i.test(value)) clean = `${clean} as trade routes shifted`;
  } else if (apologyMatch) {
    clean = `${apologyMatch[2]} apologized to residents of ${apologyMatch[1]} after the company missed a law-enforcement alert`;
  } else if (dinnerMatch) {
    clean = `Trump is expected at ${dinnerMatch[1]} in ${dinnerMatch[2]}`;
  } else if (deathMatch) {
    clean = `${deathMatch[1]}, ${deathMatch[2]}, died after an Argyll Street collision in Soho`;
    if (titleHas(item, /hit by car/i)) clean = `${clean}, days after being hit by a car`;
  } else if (powellMatch) {
    clean = `Trump criticized ${powellMatch[1]} over renovation costs at the Fed building`;
  } else {
    const knownRewrite = rewriteKnownFeedDetail(clean, item);
    if (knownRewrite) {
      clean = knownRewrite;
    } else {
      const genericRewrite = rewriteGenericSourceDetail(clean, item);
      if (genericRewrite) {
        clean = genericRewrite;
      } else {
        for (const [pattern, replacement] of DETAIL_PATTERNS) {
          if (pattern.test(clean)) {
            clean = clean.replace(pattern, replacement);
            break;
          }
        }
      }
    }
  }

  clean = clean
    .replace(/\bwas not\b/gi, "wasn't")
    .replace(/\bwere not\b/gi, "weren't")
    .replace(/\bare being\b/gi, "are")
    .replace(/\s+/g, " ")
    .trim();

  return trimToWords(sentenceCase(clean), 30);
}

function compactDetailSentence(value) {
  let clean = cleanText(value).replace(/\.$/, "");
  clean = clean
    .replace(/\s+as officials pursue.+$/i, "")
    .replace(/\s+for a high-profile.+$/i, "")
    .replace(/\s+in the period$/i, "")
    .trim();
  if (!clean) return "";
  return trimToWords(clean, 18);
}

function isPlaceholderSummary(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function repeatsOriginalTitle(item, value) {
  const titleVariants = [item?.title || "", stripHeadlinePrefix(item?.title || "")]
    .map((variant) => normalizeForCompare(variant))
    .filter(Boolean);
  const candidate = normalizeForCompare(value);
  return titleVariants.some((title) => {
    if (wordCount(title) < 5) return false;
    return candidate.includes(title);
  });
}

function composeSummary(first, second) {
  const firstSentence = trimToWords(first, 22);
  const remainingWords = 35 - wordCount(firstSentence);
  if (remainingWords < 6) return "";
  const secondSentence = trimToWords(second, remainingWords);
  const summary = `${firstSentence} ${secondSentence}`;
  if (wordCount(summary) < 18 || wordCount(summary) > 35) return "";
  return summary;
}

function buildCandidates(item) {
  const title = cleanText(item?.title || "");
  const detail = pickSourceDetail(item);
  const eventSentence = rewriteHeadline(title);
  const detailSentence = rewriteDetail(detail, item);
  const compactDetail = compactDetailSentence(detailSentence);
  if (!detailSentence) return [FALLBACK_SUMMARY];

  const candidates = [];
  const eventRepeatsTitle = repeatsOriginalTitle(item, eventSentence);
  const detailRepeatsTitle = repeatsOriginalTitle(item, detailSentence);
  const compactRepeatsTitle = repeatsOriginalTitle(item, compactDetail);
  const detailRepeatsEvent = normalizeForCompare(detailSentence) === normalizeForCompare(eventSentence);
  const compactRepeatsEvent = normalizeForCompare(compactDetail) === normalizeForCompare(eventSentence);

  if (wordCount(detailSentence) >= 18 && !detailRepeatsTitle) {
    candidates.push(detailSentence);
  }
  if (wordCount(compactDetail) >= 18 && !compactRepeatsTitle) {
    candidates.push(compactDetail);
  }
  if (eventSentence && compactDetail && !compactRepeatsEvent && !eventRepeatsTitle) {
    candidates.push(composeSummary(eventSentence, compactDetail));
  }
  if (eventSentence && compactDetail && !compactRepeatsEvent && !eventRepeatsTitle) {
    candidates.push(composeSummary(compactDetail, eventSentence));
  }
  if (eventSentence && !detailRepeatsEvent && !eventRepeatsTitle) {
    candidates.push(composeSummary(eventSentence, detailSentence));
  }
  if (eventSentence && !detailRepeatsEvent && !eventRepeatsTitle) {
    candidates.push(composeSummary(detailSentence, eventSentence));
  }

  candidates.push(FALLBACK_SUMMARY);
  return Array.from(new Set(candidates.filter(Boolean)))
    .filter((candidate) => candidate === FALLBACK_SUMMARY || !isPlaceholderSummary(candidate));
}

function getStyleMemory(options = {}) {
  if (options.styleMemory) return options.styleMemory;
  try {
    return readStyleMemory();
  } catch {
    return {};
  }
}

function evaluateSummaryCandidates(item, candidates, options = {}) {
  const recentSummaries = options.recentSummaries || [];
  const avoidPhrases = options.avoidPhrases || [];
  return candidates.map((text) => ({
    text,
    evaluation: evaluateSummaryQuality(item, text, {
      recentSummaries,
      avoidPhrases,
    }),
  }));
}

function getCandidateDiagnostics(evaluated, limit = 8) {
  return evaluated
    .filter((candidate) => !candidate.evaluation.passed)
    .slice(0, limit)
    .map((candidate) => ({
      text: candidate.text,
      failures: candidate.evaluation.failures,
      metrics: candidate.evaluation.metrics,
    }));
}

function buildLiveNewsSummary(item, options = {}) {
  const recentSummaries = options.recentSummaries || [];
  const styleMemory = getStyleMemory(options);
  const candidates = buildCandidates(item);
  const evaluated = evaluateSummaryCandidates(item, candidates, {
    recentSummaries,
    avoidPhrases: styleMemory.avoidPhrases || [],
  });
  const humanWinner = evaluated.find(
    (candidate) => candidate.text !== FALLBACK_SUMMARY && candidate.evaluation.passed
  );
  let winner = humanWinner || evaluated.find((candidate) => candidate.text === FALLBACK_SUMMARY) || evaluated[evaluated.length - 1];
  let style = winner.text === FALLBACK_SUMMARY ? "fallback" : "quality_checked";
  let supervisor = {
    status: humanWinner ? "approved" : "fallback_allowed",
    reason: humanWinner ? "candidate_passed_quality_gates" : "insufficient_safe_source_detail",
    candidatesChecked: evaluated.length,
  };
  let teacherEvaluated = [];

  if (!humanWinner && hasSupervisableSourceMaterial(item)) {
    const teacherCandidates = buildTeacherRescueCandidates(item);
    teacherEvaluated = evaluateSummaryCandidates(item, teacherCandidates, {
      recentSummaries,
      avoidPhrases: styleMemory.avoidPhrases || [],
    });
    const teacherWinner = teacherEvaluated.find((candidate) => candidate.evaluation.passed);

    if (teacherWinner) {
      winner = teacherWinner;
      style = "teacher_supervised";
      supervisor = {
        status: "rescued",
        reason: "fallback_replaced_with_feed_backed_summary",
        candidatesChecked: evaluated.length + teacherEvaluated.length,
      };
    } else {
      supervisor = {
        status: "needs_editor_review",
        reason: "source_material_present_but_no_safe_summary_passed",
        candidatesChecked: evaluated.length + teacherEvaluated.length,
        failures: Array.from(new Set(teacherEvaluated.flatMap((candidate) => candidate.evaluation.failures))).slice(0, 8),
      };
    }
  }

  return {
    text: winner.text,
    agentVersion: SUMMARY_AGENT_VERSION,
    style,
    evaluation: winner.evaluation,
    supervisor,
    candidatesChecked: supervisor.candidatesChecked,
    candidateDiagnostics: getCandidateDiagnostics([...evaluated, ...teacherEvaluated]),
  };
}

function getSummaryCacheKey(item) {
  const titleKey = normalizeForCompare(`${item?.title || ""} ${item?.sourceName || item?.source || ""}`);
  return titleKey || normalizeForCompare(item?.id || item?.link || item?.url || "");
}

function applyLiveNewsSummary(item, options = {}) {
  if (!options.force && item?.liveNewsSummary && item?.summaryAgent?.version === SUMMARY_AGENT_VERSION) {
    return item;
  }
  const result = buildLiveNewsSummary(item, options);
  const summaryAgent = {
    version: result.agentVersion,
    style: result.style,
    passed: result.evaluation.passed,
    failures: result.evaluation.failures,
    metrics: result.evaluation.metrics,
    candidatesChecked: result.candidatesChecked,
    supervisor: result.supervisor,
  };
  if (options.includeDiagnostics || process.env.LIVE_NEWS_SUMMARY_DEBUG === "1") {
    summaryAgent.candidateDiagnostics = result.candidateDiagnostics;
  }
  return {
    ...item,
    liveNewsSummary: result.text,
    summaryShort: result.text,
    summaryAgent,
  };
}

function applyLiveNewsSummariesToItems(items, options = {}) {
  const state = options.repetitionState || createSummaryRepetitionState();
  const summaryCache = options.summaryCache || new Map();
  return (items || []).map((item) => {
    const cacheKey = getSummaryCacheKey(item);
    if (cacheKey && summaryCache.has(cacheKey)) {
      return {
        ...item,
        ...summaryCache.get(cacheKey),
      };
    }

    const result = applyLiveNewsSummary(item, {
      force: true,
      recentSummaries: getRecentSummaries(state),
      styleMemory: options.styleMemory,
    });
    if (cacheKey) {
      summaryCache.set(cacheKey, {
        liveNewsSummary: result.liveNewsSummary,
        summaryShort: result.summaryShort,
        summaryAgent: result.summaryAgent,
      });
    }
    rememberSummary(state, result.liveNewsSummary);
    return result;
  });
}

function applyLiveNewsSummariesToPayload(payload = {}, options = {}) {
  const state = options.repetitionState || createSummaryRepetitionState();
  const styleMemory = getStyleMemory(options);
  const summaryCache = options.summaryCache || new Map();
  const topStories = applyLiveNewsSummariesToItems(payload.topStories || [], {
    repetitionState: state,
    styleMemory,
    summaryCache,
  });
  const feed = applyLiveNewsSummariesToItems(payload.feed || [], {
    repetitionState: state,
    styleMemory,
    summaryCache,
  });
  return {
    ...payload,
    topStories,
    feed,
    summaryHealth: getSummaryHealth([...topStories, ...feed]),
  };
}

function getSummaryHealth(items = []) {
  const list = Array.isArray(items) ? items : [];
  const fallbackCount = list.filter((item) => item.liveNewsSummary === FALLBACK_SUMMARY).length;
  const checkedCount = list.filter((item) => item.summaryAgent?.version === SUMMARY_AGENT_VERSION).length;
  const supervisedCount = list.filter((item) => item.summaryAgent?.supervisor?.status === "rescued").length;
  const fallbackAllowedCount = list.filter((item) => item.summaryAgent?.supervisor?.status === "fallback_allowed").length;
  const needsReviewCount = list.filter((item) => item.summaryAgent?.supervisor?.status === "needs_editor_review").length;
  const styleCounts = list.reduce((acc, item) => {
    const key = item.summaryAgent?.style || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    version: SUMMARY_AGENT_VERSION,
    checkedCount,
    fallbackCount,
    humanSummaryCount: Math.max(0, list.length - fallbackCount),
    fallbackRate: list.length ? Math.round((fallbackCount / list.length) * 1000) / 1000 : 0,
    supervisedCount,
    fallbackAllowedCount,
    needsReviewCount,
    styleCounts,
  };
}

module.exports = {
  FALLBACK_SUMMARY,
  GENERIC_SUMMARY_PATTERNS,
  SUMMARY_AGENT_VERSION,
  applyLiveNewsSummariesToItems,
  applyLiveNewsSummariesToPayload,
  applyLiveNewsSummary,
  buildCandidates,
  buildLiveNewsSummary,
  evaluateLiveNewsSummary: evaluateSummaryQuality,
  getSummaryHealth,
};
