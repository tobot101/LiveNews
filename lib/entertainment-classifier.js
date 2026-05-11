const { cleanText } = require("./article-agents/text-utils");

const ALLOWED_SUBBEATS = new Set([
  "movies",
  "tv_streaming",
  "music",
  "celebrity_culture",
  "awards",
  "books_publishing",
  "theater_arts",
  "gaming_creator",
  "trailers_releases",
  "stars_we_lost",
  "general_entertainment",
]);

const SUBBEAT_LABELS = {
  movies: "Movies",
  tv_streaming: "TV & streaming",
  music: "Music",
  celebrity_culture: "Celebrity & culture",
  awards: "Awards",
  books_publishing: "Books & publishing",
  theater_arts: "Theater & arts",
  gaming_creator: "Gaming & creator culture",
  trailers_releases: "Trailers & releases",
  stars_we_lost: "Stars we lost",
  general_entertainment: "General entertainment",
};

const ENTERTAINMENT_SOURCE_TERMS = [
  "abcnews.go.com/entertainment",
  "access hollywood",
  "billboard",
  "cnn.com/entertainment",
  "deadline",
  "e! online",
  "eonline.com",
  "entertainment tonight",
  "etonline.com",
  "hollywood reporter",
  "page six",
  "pagesix.com",
  "people magazine",
  "people.com",
  "pitchfork",
  "rolling stone",
  "the guardian culture",
  "thewrap",
  "tmz",
  "tmz.com",
  "us weekly",
  "vanity fair",
  "variety",
  "vulture",
];

const SUBBEAT_RULES = [
  {
    id: "stars_we_lost",
    terms: [
      "dead",
      "death",
      "dies",
      "died",
      "funeral",
      "legacy",
      "memorial",
      "obituary",
      "remembered for",
      "stars we lost",
      "tribute",
    ],
  },
  {
    id: "trailers_releases",
    terms: [
      "first look",
      "premiere date",
      "release date",
      "teaser",
      "trailer",
    ],
  },
  {
    id: "awards",
    terms: [
      "academy awards",
      "bafta",
      "emmys",
      "golden globes",
      "grammys",
      "guild awards",
      "nominations",
      "nominees",
      "oscars",
      "tonys",
      "winner",
      "winners",
    ],
  },
  {
    id: "tv_streaming",
    terms: [
      "apple tv+",
      "cancellation",
      "disney+",
      "episode",
      "hulu",
      "max",
      "netflix",
      "prime video",
      "renewal",
      "season",
      "series",
      "showrunner",
      "streaming",
      "tv series",
      "tv show",
      "television",
    ],
  },
  {
    id: "music",
    terms: [
      "album",
      "artist",
      "band",
      "concert",
      "festival",
      "music video",
      "rapper",
      "single",
      "singer",
      "song",
      "tour",
    ],
  },
  {
    id: "movies",
    terms: [
      "actor",
      "actress",
      "cast",
      "cinema",
      "director",
      "film",
      "franchise",
      "movie",
      "premiere",
      "production",
    ],
  },
  {
    id: "books_publishing",
    terms: [
      "adaptation",
      "author",
      "book release",
      "book",
      "novel",
      "publishing",
    ],
  },
  {
    id: "theater_arts",
    terms: [
      "broadway",
      "exhibition",
      "musical",
      "performing arts",
      "play",
      "stage",
      "theater",
      "theatre",
    ],
  },
  {
    id: "gaming_creator",
    terms: [
      "creator",
      "game release",
      "gaming",
      "online entertainment",
      "streamer",
      "tiktok creator",
      "youtube creator",
    ],
  },
  {
    id: "celebrity_culture",
    terms: [
      "celebrity",
      "celebrity interview",
      "culture story",
      "public appearance",
      "public announcement",
      "red carpet",
      "reality tv",
      "star",
      "verified public announcement",
    ],
  },
];

const ENTERTAINMENT_CORE_TERMS = [
  "actor",
  "actress",
  "album",
  "artist",
  "award",
  "book",
  "broadway",
  "celebrity",
  "cinema",
  "concert",
  "creator",
  "emmys",
  "film",
  "gaming",
  "grammys",
  "hollywood",
  "movie",
  "music",
  "netflix",
  "novel",
  "oscars",
  "performer",
  "publishing",
  "rapper",
  "release date",
  "singer",
  "song",
  "streaming",
  "theater",
  "trailer",
  "tv show",
];

const ORDINARY_NON_ENTERTAINMENT_TERMS = [
  "arrested after shooting",
  "evacuation order",
  "highway closure",
  "missing person alert",
  "road closure",
  "school lockdown",
  "severe weather warning",
  "shooting investigation",
  "traffic crash",
];

const SENSITIVE_TERMS = [
  "allegation",
  "alleged",
  "arrest",
  "charged",
  "custody",
  "dead",
  "death",
  "died",
  "dies",
  "family tragedy",
  "health",
  "hospitalized",
  "lawsuit",
  "legal",
  "memorial",
  "obituary",
  "tribute",
];

function normalizeText(value) {
  return cleanText(value).toLowerCase();
}

function getTextParts(story = {}) {
  const entities = story.entities || {};
  return [
    story.category,
    story.sourceName,
    story.source,
    story.attribution,
    story.sourceUrl,
    story.domain,
    story.title,
    story.headline,
    story.liveNewsHeadline,
    story.description,
    story.summary,
    story.liveNewsSummary,
    story.dek,
    story.tags?.join(" "),
    story.people?.join(" "),
    story.organizations?.join(" "),
    story.places?.join(" "),
    entities.people?.join(" "),
    entities.organizations?.join(" "),
    entities.places?.join(" "),
  ].filter(Boolean);
}

function getEntertainmentText(story = {}) {
  return normalizeText(getTextParts(story).join(" "));
}

function getEntertainmentSourceText(story = {}) {
  return normalizeText([
    story.sourceName,
    story.source,
    story.attribution,
    story.sourceUrl,
    story.domain,
  ].filter(Boolean).join(" "));
}

function includesTerm(text, term) {
  const clean = normalizeText(term);
  if (!clean) return false;
  if (clean.includes(" ")) return text.includes(clean);
  return new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

function matchingTerms(text, terms) {
  return terms.filter((term) => includesTerm(text, term));
}

function getSubbeatScores(text) {
  return SUBBEAT_RULES.map((rule) => {
    const matches = matchingTerms(text, rule.terms);
    return {
      subbeat: rule.id,
      matches,
      score: matches.length,
    };
  }).filter((entry) => entry.score > 0);
}

function hasAudienceEntertainmentSignal(story = {}) {
  const audience = story?.summaryAgent?.audience;
  const text = normalizeText([
    audience?.primaryPattern?.id,
    audience?.primaryPattern?.label,
  ].filter(Boolean).join(" "));
  return text.includes("entertainment");
}

function getSensitiveFlags(text) {
  const flags = [];
  for (const term of SENSITIVE_TERMS) {
    if (includesTerm(text, term)) flags.push(term.replace(/\s+/g, "_"));
  }
  return [...new Set(flags)];
}

function classifyEntertainmentStory(story = {}) {
  const category = normalizeText(story.category);
  const text = getEntertainmentText(story);
  const sourceText = getEntertainmentSourceText(story);
  const reasons = [];
  const sourceMatches = matchingTerms(sourceText, ENTERTAINMENT_SOURCE_TERMS);
  const coreMatches = matchingTerms(text, ENTERTAINMENT_CORE_TERMS);
  const subbeatScores = getSubbeatScores(text);
  const sensitiveFlags = getSensitiveFlags(text);
  const hasEntertainmentCategory = category === "entertainment";
  const hasAudienceSignal = hasAudienceEntertainmentSignal(story);
  const ordinaryNonEntertainment = matchingTerms(text, ORDINARY_NON_ENTERTAINMENT_TERMS);

  if (hasEntertainmentCategory) reasons.push("publisher_category_entertainment");
  if (sourceMatches.length) reasons.push(`entertainment_source:${sourceMatches.slice(0, 3).join("|")}`);
  if (hasAudienceSignal) reasons.push("audience_pattern_entertainment");
  if (coreMatches.length) reasons.push(`entertainment_terms:${coreMatches.slice(0, 5).join("|")}`);

  const bestSubbeat = subbeatScores.sort((a, b) => b.score - a.score)[0] || null;
  const hasCentralEntertainmentSignal =
    hasEntertainmentCategory ||
    sourceMatches.length > 0 ||
    hasAudienceSignal ||
    coreMatches.length > 0 ||
    subbeatScores.length > 0;

  if (!hasCentralEntertainmentSignal) {
    return {
      isEntertainment: false,
      subbeat: null,
      label: "",
      confidence: 0,
      reasons: ordinaryNonEntertainment.length ? ["ordinary_non_entertainment_story"] : [],
      sensitivityFlags: [],
    };
  }

  const categoryLooksRisky = ["crime", "public safety", "public_safety", "sports", "local"].includes(category);
  if (categoryLooksRisky && !coreMatches.length && !sourceMatches.length && !hasEntertainmentCategory) {
    return {
      isEntertainment: false,
      subbeat: null,
      label: "",
      confidence: 0,
      reasons: ["blocked_unrelated_sensitive_or_sports_category"],
      sensitivityFlags: sensitiveFlags,
    };
  }

  const subbeat = ALLOWED_SUBBEATS.has(bestSubbeat?.subbeat)
    ? bestSubbeat.subbeat
    : "general_entertainment";
  if (bestSubbeat?.matches?.length) {
    reasons.push(`subbeat:${subbeat}:${bestSubbeat.matches.slice(0, 4).join("|")}`);
  }

  let confidence = 38;
  if (hasEntertainmentCategory) confidence += 28;
  if (sourceMatches.length) confidence += 18;
  if (hasAudienceSignal) confidence += 10;
  confidence += Math.min(coreMatches.length * 6, 24);
  confidence += Math.min((bestSubbeat?.score || 0) * 8, 24);
  if (ordinaryNonEntertainment.length && !sourceMatches.length && !hasEntertainmentCategory) confidence -= 25;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return {
    isEntertainment: confidence >= 45,
    subbeat,
    label: getEntertainmentSubbeatLabel(subbeat),
    confidence,
    reasons: [...new Set(reasons)],
    sensitivityFlags: sensitiveFlags,
  };
}

function isEntertainmentStory(story = {}) {
  return classifyEntertainmentStory(story).isEntertainment;
}

function classifyEntertainmentSubbeat(story = {}) {
  return classifyEntertainmentStory(story).subbeat || "";
}

function getEntertainmentSubbeatLabel(subbeat) {
  return SUBBEAT_LABELS[subbeat] || SUBBEAT_LABELS.general_entertainment;
}

function getEntertainmentClassificationReasons(story = {}) {
  return classifyEntertainmentStory(story).reasons;
}

function getEntertainmentConfidence(story = {}) {
  return classifyEntertainmentStory(story).confidence;
}

function normalizeEntertainmentStory(story = {}) {
  const classification = classifyEntertainmentStory(story);
  return {
    ...story,
    entertainmentClassification: classification,
    entertainmentSubbeat: classification.subbeat || "",
    entertainmentLabel: classification.label || "",
    entertainmentConfidence: classification.confidence,
    entertainmentSensitive: classification.sensitivityFlags.length > 0,
    entertainmentSensitivityFlags: classification.sensitivityFlags,
  };
}

module.exports = {
  ALLOWED_SUBBEATS,
  classifyEntertainmentStory,
  classifyEntertainmentSubbeat,
  getEntertainmentClassificationReasons,
  getEntertainmentConfidence,
  getEntertainmentSubbeatLabel,
  isEntertainmentStory,
  normalizeEntertainmentStory,
};
