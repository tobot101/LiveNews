(function () {
  const GENERIC_FALLBACK_PATTERNS = [
    /\bread the original source for the full report\b/i,
    /\bsource-linked coverage\b/i,
    /\blive news is tracking\b/i,
    /\bthis article discusses\b/i,
    /\bin a recent development\b/i,
    /\bthe story continues to unfold\b/i,
    /\bread more about this story\b/i,
    /\blatest update on this topic\b/i,
    /\bwhat you need to know\b/i,
    /\ba major update has emerged\b/i,
    /\breaders are reacting\b/i,
    /\byou won'?t believe\b/i,
    /\bshocking\b/i,
    /^top story:\s*/i,
  ];
  const GOSSIP_BAIT_PATTERNS = [
    /\bdrama alert\b/i,
    /\bbombshell\b/i,
    /\bspills? tea\b/i,
    /\bclaps back\b/i,
    /\bfans are saying\b/i,
    /\binternet reacts\b/i,
    /\bmeltdown\b/i,
    /\bscandal\b/i,
    /\bfeud\b/i,
    /\bshades?\b/i,
  ];
  const RELATIONSHIP_CLAIM_PATTERNS = [
    /\bsecret romance\b/i,
    /\bromance rumors?\b/i,
    /\blove triangle\b/i,
    /\bcaught cheating\b/i,
    /\bdating drama\b/i,
    /\baffair\b/i,
    /\bhookup\b/i,
  ];
  const SENSITIVE_ENTERTAINMENT_PATTERNS = [
    /\balleged\b/i,
    /\ballegation\b/i,
    /\blawsuit\b/i,
    /\blegal\b/i,
    /\bcharged\b/i,
    /\barrest\b/i,
    /\bdied\b/i,
    /\bdies\b/i,
    /\bdead\b/i,
    /\bobituary\b/i,
    /\bmemorial\b/i,
    /\btribute\b/i,
  ];
  const SENSATIONAL_SENSITIVE_PATTERNS = [
    /\bshocking\b/i,
    /\bbombshell\b/i,
    /\bexplosive\b/i,
    /\bscandalous\b/i,
    /\bchaos\b/i,
  ];
  const PUBLIC_SAFETY_TERMS = [
    "evacuation order",
    "shelter in place",
    "boil water notice",
    "road closure",
    "public advisory",
    "emergency alert",
    "officials warned",
    "official warning",
    "recall notice",
    "safety advisory",
    "missing person",
    "active alert",
    "weather warning",
    "health warning",
  ];
  const PUBLIC_SAFETY_CATEGORIES = new Set([
    "public_safety",
    "emergency",
    "alert",
    "weather_alert",
    "evacuation",
    "road_closure",
    "missing_person",
    "recall",
    "health_warning",
    "disaster",
    "official_advisory",
  ]);

  function cleanText(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&ndash;|&mdash;/g, " - ")
      .replace(/&rsquo;|&#8217;/g, "'")
      .replace(/&lsquo;|&#8216;/g, "'")
      .replace(/&quot;|&#8220;|&#8221;/g, "\"")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncateText(value, maxLength = 210) {
    const text = cleanText(value);
    if (!maxLength || text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
  }

  function normalizeKey(value) {
    return cleanText(value).toLowerCase().replace(/\s+/g, "_");
  }

  function isPublicSafetyRelevant(item = {}) {
    if (item.publicSafetyRelevant === true || item.writingQuality?.context?.publicSafetyRelevant === true) return true;
    const category = normalizeKey(item.category);
    const tags = Array.isArray(item.tags) ? item.tags.map(normalizeKey) : [];
    if (PUBLIC_SAFETY_CATEGORIES.has(category) || tags.some((tag) => PUBLIC_SAFETY_CATEGORIES.has(tag))) return true;
    const text = [
      item.liveNewsHeadline,
      item.title,
      item.description,
      item.liveNewsSummary,
      item.summary,
      item.whyItMatters,
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return PUBLIC_SAFETY_TERMS.some((term) => text.includes(term));
  }

  function isEntertainmentItem(item = {}) {
    return (
      item.category === "Entertainment" ||
      item.entertainmentClassification?.isEntertainment === true ||
      Boolean(item.entertainmentSubbeat) ||
      Number(item.entertainmentConfidence || 0) >= 45
    );
  }

  function detectPublicWritingRisk(text, item = {}, options = {}) {
    const value = cleanText(text);
    const risks = [];
    if (!value) risks.push("missing");
    if (GENERIC_FALLBACK_PATTERNS.some((pattern) => pattern.test(value))) risks.push("generic_fallback_or_robotic_phrase");
    if (isEntertainmentItem(item)) {
      if (GOSSIP_BAIT_PATTERNS.some((pattern) => pattern.test(value))) risks.push("gossip_bait");
      if (RELATIONSHIP_CLAIM_PATTERNS.some((pattern) => pattern.test(value)) && !options.approved) {
        risks.push("unsupported_relationship_claim");
      }
      if (
        SENSITIVE_ENTERTAINMENT_PATTERNS.some((pattern) => pattern.test(value)) &&
        SENSATIONAL_SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))
      ) {
        risks.push("sensitive_entertainment_tone");
      }
    }
    if (/\bstay safe\b/i.test(value) && !isPublicSafetyRelevant(item)) risks.push("unsupported_public_safety_language");
    return { safe: risks.length === 0, risks };
  }

  function firstSafeCandidate(item, candidates) {
    for (const candidate of candidates) {
      const text = cleanText(candidate.value);
      if (!text) continue;
      if (!detectPublicWritingRisk(text, item, { approved: Boolean(candidate.approved), source: candidate.source }).safe) continue;
      return { source: candidate.source, text, approved: Boolean(candidate.approved) };
    }
    return null;
  }

  function getSafeDisplayTitle(item = {}) {
    const selected = firstSafeCandidate(item, [
      { source: "liveNewsHeadline", value: item.liveNewsHeadline, approved: true },
      { source: "approvedTitle", value: item.approvedTitle || item.approvedHeadline, approved: true },
      { source: "title", value: item.title || item.headline, approved: Boolean(item.hasLiveNewsStory) },
    ]);
    return selected?.text || "Untitled story";
  }

  function getSafeDisplaySummary(item = {}, maxLength = 210) {
    const selected = firstSafeCandidate(item, [
      { source: "approvedDescription", value: item.approvedDescription || item.liveNewsDescription, approved: true },
      { source: "description", value: item.description, approved: Boolean(item.hasLiveNewsStory || item.writingQualityStatus === "ready") },
      { source: "liveNewsSummary", value: item.liveNewsSummary || item.summaryShort, approved: true },
      { source: "liveNewsDek", value: item.liveNewsDek || item.dek, approved: Boolean(item.hasLiveNewsStory) },
      { source: "summaryText", value: item.summaryText || item.summaryLong || item.liveNewsSummaryLong, approved: Boolean(item.hasLiveNewsStory) },
      { source: "summaryAgent", value: item.summaryAgent?.version ? item.summary : "", approved: true },
      { source: "summary", value: item.summary, approved: false },
    ]);
    return selected ? truncateText(selected.text, maxLength) : "";
  }

  function getPublicCardWritingStatus(item = {}) {
    const title = getSafeDisplayTitle(item);
    const summary = getSafeDisplaySummary(item, 260);
    const reasons = [];
    if (!summary) reasons.push("safe_summary_missing");
    if (detectPublicWritingRisk(item.summary || item.liveNewsSummary || "", item).risks.length) {
      reasons.push("weak_summary_blocked");
    }
    return {
      status: summary ? "ready" : title ? "title_only" : "needs_review",
      title,
      summary,
      publicSafetyRelevant: isPublicSafetyRelevant(item),
      reasons,
    };
  }

  function getSafeEntertainmentDisplayTitle(item = {}) {
    return getSafeDisplayTitle(item);
  }

  function getSafeEntertainmentDisplaySummary(item = {}, maxLength = 210) {
    return getSafeDisplaySummary(item, maxLength);
  }

  function getSafeEntertainmentCard(item = {}, maxLength = 210) {
    const title = getSafeEntertainmentDisplayTitle(item);
    const summary = getSafeEntertainmentDisplaySummary(item, maxLength);
    const rawText = [
      item.description,
      item.summary,
      item.liveNewsSummary,
      item.sourceSummary,
      item.rawSummary,
    ].filter(Boolean).join(" ");
    const rawRisk = rawText ? detectPublicWritingRisk(rawText, item) : { risks: [] };
    const titleRisk = detectPublicWritingRisk(title, item, { approved: true });
    const reasons = [];
    if (!summary) reasons.push("safe_summary_missing");
    if (rawRisk.risks.length) reasons.push(...rawRisk.risks.map((risk) => `blocked_${risk}`));
    if (titleRisk.risks.length) reasons.push(...titleRisk.risks.map((risk) => `title_${risk}`));
    const needsReview = reasons.length > 0 || !summary;
    return {
      title,
      summary,
      status: needsReview ? "needs_review" : "ready",
      displayMode: summary ? "full" : "minimal",
      isEntertainment: isEntertainmentItem(item),
      subbeat: item.entertainmentSubbeat || item.entertainmentClassification?.subbeat || "general_entertainment",
      label: item.entertainmentLabel || item.entertainmentClassification?.label || "General entertainment",
      publicSafetyRelevant: isPublicSafetyRelevant(item),
      reasons: Array.from(new Set(reasons)),
    };
  }

  window.LiveNewsPublicWriting = {
    detectPublicWritingRisk,
    getPublicCardWritingStatus,
    getSafeEntertainmentCard,
    getSafeEntertainmentDisplaySummary,
    getSafeEntertainmentDisplayTitle,
    getSafeDisplaySummary,
    getSafeDisplayTitle,
    isEntertainmentItem,
    isPublicSafetyRelevant,
  };
})();
