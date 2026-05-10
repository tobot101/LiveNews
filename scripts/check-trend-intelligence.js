const {
  buildTrendInputs,
  clusterStoriesByTrendTopic,
  containsForbiddenPrivateData,
  explainTrendRanking,
  normalizeTrendSignal,
  rankStoryOfWeek,
  rankTopStoryOfDay,
} = require("../lib/trend-intelligence");
const { loadGoogleTrendsSignals } = require("../lib/trend-adapters/google-trends-adapter");
const {
  loadSearchConsoleSignals,
  normalizeSearchConsoleMetric,
} = require("../lib/trend-adapters/search-console-adapter");
const { loadAnswerThePublicSignals } = require("../lib/trend-adapters/answerthepublic-adapter");
const { loadPinterestTrendsSignals } = require("../lib/trend-adapters/pinterest-trends-adapter");
const { loadSemrushSignals } = require("../lib/trend-adapters/semrush-adapter");
const { loadAhrefsSignals } = require("../lib/trend-adapters/ahrefs-adapter");
const { loadGlimpseSignals } = require("../lib/trend-adapters/glimpse-adapter");
const { loadExplodingTopicsSignals } = require("../lib/trend-adapters/exploding-topics-adapter");
const { loadInternalAnalyticsSignals } = require("../lib/trend-adapters/internal-analytics-adapter");
const { isPublicSafetyRelevant } = require("../lib/social-intelligence");

const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const now = "2026-05-10T12:00:00.000Z";
const stories = [
  {
    id: "viral-day-1",
    title: "Celebrity cast surprise sends movie searches higher overnight",
    liveNewsSummary:
      "A surprise casting update drove fresh attention overnight. Entertainment readers are following what the move means for the film release.",
    category: "Entertainment",
    sourceName: "Live News Test Source",
    sourceCount: 2,
    sourceWeight: 1.2,
    score: 91,
    publishedAt: "2026-05-10T09:00:00.000Z",
    approvedStoryUrl: "/stories/celebrity-cast-surprise-test",
  },
  {
    id: "sustained-week-latest",
    title: "Morocco search update keeps focus on missing U.S. service members",
    liveNewsSummary:
      "The latest update keeps attention on the search and what families, officials, and military readers are waiting to learn next.",
    category: "National",
    sourceName: "Live News Test Source",
    sourceCount: 5,
    sourceWeight: 1.4,
    score: 93,
    publishedAt: "2026-05-10T05:00:00.000Z",
    approvedStoryUrl: "/stories/morocco-search-update-test",
  },
  {
    id: "sustained-week-context",
    title: "What the Morocco search means after several days of coverage",
    liveNewsSummary:
      "The story has moved across several days as readers track the official search, family impact, and military context.",
    category: "National",
    sourceName: "Live News Test Source",
    sourceCount: 4,
    sourceWeight: 1.2,
    score: 87,
    publishedAt: "2026-05-07T10:00:00.000Z",
    approvedStoryUrl: "/stories/morocco-search-context-test",
  },
  {
    id: "business-steady",
    title: "Retail chain keeps shoppers watching price changes",
    liveNewsSummary:
      "The company update gives consumers another reason to watch shipping costs and retail prices this week.",
    category: "Business",
    sourceName: "Live News Test Source",
    sourceCount: 3,
    sourceWeight: 1.1,
    score: 84,
    publishedAt: "2026-05-08T12:00:00.000Z",
    approvedStoryUrl: "/stories/retail-price-changes-test",
  },
];

const trendSignals = [
  normalizeTrendSignal({
    source: "google_trends",
    topic: "celebrity cast surprise",
    keywords: ["celebrity", "cast", "movie"],
    category: "entertainment",
    region: "US",
    timeframe: "24h",
    normalizedInterest: 99,
    absoluteVolumeEstimate: 500000,
    baselineDelta: 80,
    growthRate: 91,
    sustainedDays: 1,
    relatedQueries: ["movie cast surprise"],
    confidence: 0.9,
    collectedAt: now,
    notes: "Mock normalized interest only.",
  }),
  normalizeTrendSignal({
    source: "search_console",
    topic: "morocco service members search",
    keywords: ["morocco", "service", "members", "search"],
    category: "national",
    region: "US",
    timeframe: "7d",
    normalizedInterest: 78,
    baselineDelta: 24,
    growthRate: 21,
    sustainedDays: 5,
    relatedQueries: ["missing service members Morocco"],
    confidence: 0.86,
    collectedAt: now,
    notes: "Mock first-party aggregate Search Console signal.",
  }),
  normalizeTrendSignal({
    source: "manual",
    topic: "retail price changes",
    keywords: ["retail", "price", "shoppers"],
    category: "business",
    region: "US",
    timeframe: "7d",
    normalizedInterest: 62,
    sustainedDays: 3,
    confidence: 0.66,
    collectedAt: now,
    notes: "Manual aggregate public signal.",
  }),
].filter(Boolean);

const siteMetrics = [
  normalizeSearchConsoleMetric({
    storyId: "sustained-week-latest",
    topic: "morocco service members search",
    query: "morocco service members",
    category: "national",
    timeframe: "7d",
    clicks: 82,
    impressions: 1200,
    sustainedDays: 5,
  }),
];

const day = rankTopStoryOfDay(stories, trendSignals, siteMetrics, { now });
const week = rankStoryOfWeek(stories, trendSignals, siteMetrics, { now, daySelection: day });
const spikeDay = rankTopStoryOfDay([stories[0], stories[3]], trendSignals, [], { now });

expect(spikeDay?.storyId === "viral-day-1", "One-day viral spike should be able to win Top Story of the Day.");
expect(week?.storyId !== day?.storyId, "Top Story of the Day and Story of the Week should not select the same article when alternatives exist.");
expect(week?.storyId !== "viral-day-1", "One-day viral spike should not win Story of the Week by default.");
expect(week?.sustainedDays >= 2, "Story of the Week should require at least 2-3 days of sustained interest.");
expect(/week|sustained|multi-day/i.test(week?.whySelected || ""), "Weekly explanation should describe sustained week value.");
expect(week?.storyId === "sustained-week-latest" || week?.storyId === "sustained-week-context", "Sustained topic should win Story of the Week.");
expect(week?.signalsUsed?.every((signal) => signal.source && signal.timeframe && signal.confidence && signal.collectedAt), "TrendSignal summaries should include source, timeframe, confidence, and collectedAt.");
expect(explainTrendRanking(day).length > 40 && explainTrendRanking(week).length > 40, "Ranking explanations should be generated.");

const sameTopicDay = rankTopStoryOfDay(stories.slice(1, 3), trendSignals, siteMetrics, { now });
const sameTopicWeek = rankStoryOfWeek(stories.slice(1, 3), trendSignals, siteMetrics, {
  now,
  daySelection: sameTopicDay,
});
expect(sameTopicWeek?.topicId === sameTopicDay?.topicId, "Same topic may appear for day and week when it is genuinely sustained.");
expect(sameTopicWeek?.storyId !== sameTopicDay?.storyId, "Same topic should choose a different weekly article when one exists.");
expect(sameTopicWeek?.duplicateStatus === "same_topic_as_day", "Same-topic selections should be marked with a duplicate status.");
expect(/latest development/i.test(sameTopicDay?.whySelected || "") || sameTopicDay?.label === "Top Story of the Day", "Day selection should keep the current-development role.");
expect(/sustained story arc/i.test(sameTopicWeek?.whySelected || ""), "Week selection should use a sustained story-arc angle when topic overlaps.");

const duplicateNoDay = rankStoryOfWeek([stories[1]], trendSignals, siteMetrics, { now });
const duplicateWithDay = rankStoryOfWeek([stories[1]], trendSignals, siteMetrics, {
  now,
  daySelection: { ...sameTopicDay, story: stories[1], storyId: stories[1].id, topicId: sameTopicDay.topicId },
});
expect(duplicateWithDay?.score < duplicateNoDay?.score, "Same exact article should receive a duplicate penalty.");
expect(duplicateWithDay?.duplicateStatus === "same_article_as_day", "Same exact article should be marked as duplicate when no alternative exists.");

const topics = clusterStoriesByTrendTopic(stories, trendSignals);
expect(topics.length >= 2, "Trend clustering should group stories into multiple reusable topics.");
expect(topics.every((topic) => topic.topicId && Array.isArray(topic.trendSignals)), "TrendTopic objects should include IDs and signal arrays.");

expect(trendSignals[0].source === "google_trends", "Mock Google Trends signal should normalize as google_trends.");
expect(trendSignals[0].absoluteVolumeEstimate === null, "Google Trends 0-100 data must not be treated as raw search volume.");
expect(siteMetrics[0].collectionMethod === "first_party_aggregate_site_performance", "Search Console metrics should be first-party aggregate site performance only.");

const unsafeSignal = normalizeTrendSignal({
  source: "manual",
  topic: "private user discussion",
  usernames: ["not-allowed"],
  normalizedInterest: 80,
});
expect(!unsafeSignal, "TrendSignal normalization should reject private usernames.");
expect(containsForbiddenPrivateData({ privateMessages: ["do not store"] }), "Private messages should be detected as forbidden.");

const trendInputs = buildTrendInputs({
  trendMemory: {
    signals: [
      {
        source: "manual",
        topic: "safe public topic",
        normalizedInterest: 55,
        timeframe: "7d",
        sustainedDays: 3,
        confidence: 0.7,
        collectedAt: now,
      },
      {
        source: "manual",
        topic: "unsafe copied comments",
        publicCommentText: "Do not save this copied comment.",
        normalizedInterest: 99,
      },
    ],
    siteMetrics: [{ storyId: "safe", views: 10 }, { username: "blocked", views: 999 }],
  },
  socialPerformanceMemory: {},
});
expect(trendInputs.signals.length === 1 && trendInputs.siteMetrics.length === 1, "Trend inputs should filter private data from memory.");

Promise.all([
  loadGoogleTrendsSignals(),
  loadSearchConsoleSignals(),
  loadAnswerThePublicSignals(),
  loadPinterestTrendsSignals(),
  loadSemrushSignals(),
  loadAhrefsSignals(),
  loadGlimpseSignals(),
  loadExplodingTopicsSignals(),
  loadInternalAnalyticsSignals(),
])
  .then((adapterResults) => {
    expect(
      adapterResults.every((signals) => Array.isArray(signals) && signals.length === 0),
      "Missing optional trend APIs should not break the system."
    );

    const ordinaryWeather = {
      title: "Weekend rain expected across San Diego",
      summary: "Forecasts call for showers with no active warnings, closures, or official advisories.",
      category: "Local",
    };
    expect(!isPublicSafetyRelevant(ordinaryWeather), "Weather should not automatically become public safety.");
    expect(!isPublicSafetyRelevant({ title: "City council reviews park plan", category: "Local" }), "Local news should not automatically become public safety.");
    expect(isPublicSafetyRelevant({ title: "County issues evacuation order near wildfire", category: "Local" }), "Explicit public alerts should still be public safety.");

    if (failures.length) {
      console.error("Live News trend-intelligence check failed:");
      failures.forEach((failure) => console.error(`- ${failure}`));
      process.exit(1);
    }

    console.log("Live News trend-intelligence check passed.");
    console.log("Example Top Story of the Day output:");
    console.log(JSON.stringify({ ...day, story: undefined }, null, 2));
    console.log("Example Story of the Week output:");
    console.log(JSON.stringify({ ...week, story: undefined }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
