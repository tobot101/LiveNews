const fs = require("fs");
const path = require("path");
const {
  applyLiveNewsSummary,
  applyLiveNewsSummariesToItems,
  applyLiveNewsSummariesToPayload,
  buildLiveNewsSummary,
  evaluateLiveNewsSummary,
  getSummaryHealth,
} = require("../lib/article-agents/summary-agent");
const {
  FALLBACK_SUMMARY,
  GRAMMAR_GUARD_PATTERNS,
  getFirstWords,
  wordCount,
} = require("../lib/article-agents/summary-quality");
const {
  AUDIENCE_INTELLIGENCE_VERSION,
  deriveAudienceIntelligence,
} = require("../lib/article-agents/audience-intelligence");
const {
  extractResearchFromHtml,
  mergeResearchEvidence,
} = require("../lib/article-agents/summary-research-agent");

const root = path.join(__dirname, "..");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const samples = [
  {
    id: "summary-live-prefix-test",
    title: "Iran live updates: Trump cancels Witkoff, Kushner trip to Islamabad for peace talks",
    summary:
      "President Donald Trump announced \"major combat operations\" against Iran on Feb. 28, with massive joint U.S.-Israeli strikes.",
    sourceName: "ABC News",
    category: "Top",
    sourceCount: 2,
    publishedAt: "2026-04-24T18:52:00.000Z",
  },
  {
    id: "summary-national-test",
    title: "WATCH: Trump dispatching Witkoff and Kushner to Pakistan for new Iran talks, White House says",
    summary:
      "The White House said Steve Witkoff and Jared Kushner are being sent to Pakistan as officials pursue new talks involving Iran.",
    sourceName: "PBS NewsHour",
    category: "National",
    sourceCount: 2,
    publishedAt: "2026-04-24T18:52:00.000Z",
  },
  {
    id: "summary-business-test",
    title: "Norfolk Southern's profit fell 27% as it didn't collect big insurance payments for Ohio derailment",
    summary:
      "Norfolk Southern reported lower quarterly profit after insurance payments tied to the Ohio derailment were not collected in the period.",
    sourceName: "ABC News",
    category: "Business",
    sourceCount: 1,
    publishedAt: "2026-04-24T14:18:59.000Z",
  },
  {
    id: "summary-feed-test",
    title: "US imposes sanctions on a China-based oil refinery and 40 shippers over Iranian oil",
    summary:
      "The United States imposed sanctions on a refinery and shipping firms accused of helping move Iranian oil.",
    sourceName: "ABC News",
    category: "Business",
    sourceCount: 1,
    publishedAt: "2026-04-24T18:58:28.000Z",
  },
  {
    id: "summary-noisy-title-test",
    title: "NASCAR's Natalie Decker gets out of the pool & into her fire suit for big race, NFL Draft drama, plus MEAT!",
    summary:
      "NASCAR driver Natalie Decker returned to the track at Talladega for a high-profile racing weekend.",
    sourceName: "Fox News",
    category: "Sports",
    sourceCount: 1,
    publishedAt: "2026-04-24T13:08:17.000Z",
  },
];

const liveRegressionSamples = [
  {
    id: "live-king-address",
    title: "Five takeaways from the King's historic address to Congress",
    summary:
      "There were some lines in the speech that may have buoyed Democrats – and raised eyebrows in the White House.",
    sourceName: "BBC News",
    category: "Top",
  },
  {
    id: "live-damon-jones",
    title: "Ex-player Damon Jones first to plead guilty in basketball gambling sweep",
    summary:
      "Former NBA player and assistant coach Damon Jones has become the first person to plead guilty in a gambling sweep that led to the arrests of more than 30 people.",
    sourceName: "PBS NewsHour",
    category: "National",
  },
  {
    id: "live-phillies-manager",
    title: "Slumping Phillies fire manager Rob Thomson after losing 11 of last 12 games",
    summary:
      "Thomson led team to World Series appearance in 2022 Phillies are tied for worst record in majors this season Rob Thomson, who led the Phillies to four straight playoff appearances, including the 2022 World Series, was fired as the team’s manager on Tuesday aft",
    sourceName: "The Guardian",
    category: "Sports",
  },
  {
    id: "live-aws-openai",
    title: "Amazon is already offering new OpenAI products on AWS",
    summary:
      "A day after OpenAI got Microsoft to agree to end exclusive rights, AWS announced a slate of OpenAI model offerings, including a new agent service.",
    sourceName: "TechCrunch",
    category: "Tech",
  },
  {
    id: "live-apple-subscription",
    title: "Apple introduces a cheaper option for App Store subscriptions",
    summary:
      "Apple is adding a new subscription option that lets app developers offer lower monthly pricing in exchange for a 12-month commitment.",
    sourceName: "TechCrunch",
    category: "Tech",
  },
  {
    id: "live-grammar-has-says",
    title: "Trump to remove whisky tariffs after King's visit",
    summary:
      "Donald Trump has says he will remove all tariffs and restrictions on whisky imports in honour of King Charles and Queen Camilla's state visit to the U.S.",
    sourceName: "BBC News",
    category: "Business",
  },
  {
    id: "live-supreme-geofence",
    title: "US Supreme Court appears split over controversial use of ‘geofence’ search warrants",
    summary:
      "The U.S. top court is expected to rule on whether to allow police to identify criminal suspects by dragnet searching the databases of tech giants.",
    sourceName: "TechCrunch",
    category: "Tech",
  },
];

const teacherSupervisorSamples = [
  {
    id: "teacher-local-housing",
    title: "City council approves new housing plan after months of debate",
    summary:
      "The council approved a revised housing plan that adds 2,000 homes and changes zoning rules after months of public debate.",
    sourceName: "City Desk",
    category: "Local",
  },
  {
    id: "teacher-tech-privacy",
    title: "Company launches new tool for online privacy",
    summary:
      "The browser tool blocks third-party tracking scripts and lets users delete stored site data from one dashboard.",
    sourceName: "Tech Wire",
    category: "Tech",
  },
  {
    id: "teacher-election-certification",
    title: "Election board delays vote count certification",
    summary:
      "The board delayed certification after members requested additional ballot reviews and legal guidance from state officials.",
    sourceName: "AP",
    category: "National",
  },
];

const localSummarySamples = [
  {
    id: "local-mission-fire",
    title: "Update: Mission Fire in San Diego County hits 100% containment by Sunday morning",
    summary: "Update: Mission Fire in San Diego County hits 100% containment by Sunday morning Sacramento Bee",
    sourceName: "Sacramento Bee",
    category: "Local",
  },
  {
    id: "local-ebike-safety",
    title: "12-year-old e-bike rider suffers brain bleeds, serious injuries after colliding with Tesla",
    summary: "12-year-old e-bike rider suffers brain bleeds, serious injuries after colliding with Tesla fox5sandiego.com",
    sourceName: "fox5sandiego.com",
    category: "Local",
  },
  {
    id: "local-lake-hodges",
    title: "San Diego landmark Lake Hodges is a disaster waiting to happen",
    summary: "San Diego landmark Lake Hodges is a disaster waiting to happen inewsource",
    sourceName: "inewsource",
    category: "Local",
  },
  {
    id: "local-scrippshenge",
    title: "Spectators gather as Scrippshenge returns to San Diego",
    summary: "Spectators gather as Scrippshenge returns to San Diego cbs8.com",
    sourceName: "cbs8.com",
    category: "Local",
  },
  {
    id: "local-kratom-complaint",
    title: "State public health officials file complaint against kratom business in San Diego area",
    summary: "State public health officials file complaint against kratom business in San Diego area KESQ",
    sourceName: "KESQ",
    category: "Local",
  },
];

const sourceResearchSample = {
  id: "research-stagecoach",
  title: "Ella Langley surprises Stagecoach crowd by bringing out Theo Von instead of expected Morgan Wallen",
  summary: "Fans expected a different guest during the festival set.",
  sourceName: "Fox News",
  category: "Entertainment",
  link: "https://example.com/stagecoach",
};

const sourceResearchHtml = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="Ella Langley brings Theo Von onstage at Stagecoach" />
    <meta property="og:description" content="Ella Langley brought comedian Theo Von on stage at Stagecoach after fans expected Morgan Wallen. The surprise guest joined her during the festival set." />
    <script type="application/ld+json">{"@type":"NewsArticle","headline":"Stagecoach surprise","description":"Theo Von appeared during Ella Langley's Stagecoach performance, surprising fans who had expected Morgan Wallen."}</script>
  </head>
  <body>
    <article>
      <p>Ella Langley brought comedian Theo Von on stage during her Stagecoach set after fans expected Morgan Wallen.</p>
      <p>The surprise guest appearance became one of the festival set's talked-about moments.</p>
    </article>
  </body>
</html>`;

function normalizeExact(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^(watch|video|listen|live updates?|the latest|latest|breaking|photos?):\s*/i, "")
    .replace(/^[a-z\s]+live updates?:\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

for (const sample of samples) {
  const result = buildLiveNewsSummary(sample);
  const text = result.text;
  expect(result.evaluation.passed, `${sample.id} summary should pass quality gates.`);
  expect(!/Live News is tracking|It was updated|original source remains|source-linked coverage/i.test(text), `${sample.id} should not use old generic tracking copy.`);
  expect(!/^(Live News|This article discusses|The report says|According to|In a recent development|Officials announced|The story highlights|This update centers|The key development is)/i.test(text), `${sample.id} should not use a robotic opener.`);
  expect(!/What comes next depends on|The core question is|Readers can quickly see|The focus stays on|The wider value is|Readers may want/i.test(text), `${sample.id} should not use placeholder summary framing.`);
  expect(text === FALLBACK_SUMMARY || (wordCount(text) >= 18 && wordCount(text) <= 35), `${sample.id} should keep an 18-35 word summary unless using the neutral fallback.`);
  expect(
    /Trump|Witkoff|Kushner|Pakistan|Islamabad|Iran|Norfolk|profit|insurance|derailment|sanctions|refinery|Iranian oil|Natalie|Decker|Talladega/i.test(text),
    `${sample.id} should include article-specific details.`
  );
  expect(text !== sample.summary, `${sample.id} should not copy the RSS description directly.`);
  expect(!normalizeExact(text).includes(normalizeExact(sample.title)), `${sample.id} should not repeat the title exactly inside the summary.`);
  const reevaluated = evaluateLiveNewsSummary(sample, text);
  expect(reevaluated.passed, `${sample.id} should pass reevaluation.`);
}

for (const sample of liveRegressionSamples) {
  const result = buildLiveNewsSummary(sample);
  const text = result.text;
  expect(result.evaluation.passed, `${sample.id} should pass the strengthened live-data quality gates.`);
  expect(text !== FALLBACK_SUMMARY, `${sample.id} should produce a real Live News summary instead of fallback.`);
  expect(!/Live News is tracking|Read the original source|What comes next|Readers can|The focus stays on/i.test(text), `${sample.id} should not use fallback or robotic filler.`);
  expect(!/\bhas\s+says\b/i.test(text), `${sample.id} should repair broken grammar before publishing.`);
  expect(wordCount(text) >= 18 && wordCount(text) <= 35, `${sample.id} should stay within 18-35 words.`);
  expect(result.audienceIntelligence?.version === AUDIENCE_INTELLIGENCE_VERSION, `${sample.id} should carry audience intelligence metadata.`);
  expect(result.audienceIntelligence?.primaryPattern?.id, `${sample.id} should identify a primary audience pattern.`);
}

expect(
  GRAMMAR_GUARD_PATTERNS.some((pattern) => pattern.test("Donald Trump has says he will remove whisky tariffs.")),
  "Grammar guard should catch has-says phrasing."
);

for (const sample of teacherSupervisorSamples) {
  const result = buildLiveNewsSummary(sample);
  const text = result.text;
  expect(result.evaluation.passed, `${sample.id} should pass after teacher supervision.`);
  expect(text !== FALLBACK_SUMMARY, `${sample.id} should not fallback when useful source detail exists.`);
  expect(result.supervisor?.status === "rescued", `${sample.id} should be marked as rescued by the parent/teacher check.`);
  expect(result.style === "teacher_supervised", `${sample.id} should report the teacher-supervised style.`);
  expect(!/Live News is tracking|What comes next|Readers can|The focus stays on|The account includes/i.test(text), `${sample.id} should avoid old generic or supervisor scaffolding language.`);
  expect(wordCount(text) >= 18 && wordCount(text) <= 35, `${sample.id} should stay within 18-35 words.`);
}

for (const sample of localSummarySamples) {
  const result = buildLiveNewsSummary(sample);
  const text = result.text;
  expect(result.evaluation.passed, `${sample.id} local summary should pass quality gates.`);
  expect(text !== FALLBACK_SUMMARY, `${sample.id} should not fall back when the local headline has enough safe detail.`);
  expect(!/Read the original source|Live News is tracking|What comes next|Readers can/i.test(text), `${sample.id} should avoid fallback and robotic local copy.`);
  expect(wordCount(text) >= 18 && wordCount(text) <= 35, `${sample.id} should stay within 18-35 words.`);
}

const extractedResearch = extractResearchFromHtml(sourceResearchHtml, sourceResearchSample.link);
expect(extractedResearch.facts.length >= 2, "Source-page research should extract useful metadata and article-page facts.");
const researchedSample = {
  ...sourceResearchSample,
  summaryResearch: mergeResearchEvidence(sourceResearchSample, extractedResearch),
};
const researchedResult = buildLiveNewsSummary(researchedSample);
expect(researchedResult.text !== FALLBACK_SUMMARY, "Source-page research should keep a thin RSS item from falling back.");
expect(researchedResult.evaluation.passed, "Source-page research summary should pass quality gates.");
expect(
  /Ella Langley|Theo Von|Stagecoach|festival/i.test(researchedResult.text),
  "Source-page research summary should use facts discovered from the article page."
);

const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const categoryJs = fs.readFileSync(path.join(root, "public", "category.js"), "utf8");
const searchJs = fs.readFileSync(path.join(root, "public", "search.js"), "utf8");
const localJs = fs.readFileSync(path.join(root, "public", "local.js"), "utf8");
const localHtml = fs.readFileSync(path.join(root, "public", "local.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
expect(serverJs.includes("applyLiveNewsSummary"), "Server should apply summary agents before stories reach the UI.");
expect(appJs.includes("getDisplaySummary(item, 150)"), "Latest News Feed should render the shared Live News summary field.");
expect(appJs.includes("if (item.liveNewsSummary)"), "UI summary rendering should prefer Live News agent summaries.");
expect(!appJs.includes("Live News is tracking this"), "Latest News fallback should not return the old generic tracking sentence.");
expect(!appJs.includes("if (item.summary) return truncateText(item.summary"), "Homepage cards should not fall back to RSS summaries as final copy.");
expect(!categoryJs.includes("Live News found this result"), "Category results should not return the old generic result summary.");
expect(!searchJs.includes("Live News found this result"), "Search results should not return the old generic result summary.");
expect(!categoryJs.includes("Coverage centers on"), "Category results should not use generic database-style summary fallbacks.");
expect(!searchJs.includes("Coverage centers on"), "Search results should not use generic database-style summary fallbacks.");
expect(!localJs.includes("${item.summary ?"), "Local cards should not render raw RSS summaries directly.");
expect(localHtml.includes("Live News summarizes source-linked coverage with attribution. Full reporting"), "Local page should use the source-respectful disclaimer.");
expect(stylesCss.includes(".story-source-link"), "Article cards should style crawlable original-source links.");
expect(serverJs.includes("applyLiveNewsSummariesToPayload"), "Server should apply summary agents across page sections so nearby cards can be checked for repetition.");
expect(serverJs.includes("renderCrawlableHomepage"), "Homepage should render crawlable article cards before client hydration when possible.");
expect(serverJs.includes("renderCrawlerSourceLink"), "Crawlable article cards should include original source links.");
expect(serverJs.includes("summaryHealth: currentPayload.summaryHealth"), "Health checks should expose summary supervisor diagnostics.");
expect(serverJs.includes("hydrateSummaryResearchForItems"), "Server should run summary source research during refresh before public rendering.");
expect(serverJs.includes("summaryResearch: summaryResearchStats"), "Health checks should expose summary research diagnostics.");
expect(serverJs.includes("audienceIntelligence"), "Health checks should expose audience-intelligence diagnostics.");
expect(serverJs.includes("feedCandidates") && serverJs.includes("topStoryKeys"), "Latest feed should exclude stories already shown in Top Stories.");
expect(serverJs.includes("requireSummaryAdmin"), "Summary review routes should require private editor authentication.");
expect(serverJs.includes("X-Robots-Tag"), "Private summary review pages should send noindex headers.");
expect(!serverJs.includes('SITEMAP_STABLE_PAGES.push("/admin/summaries")'), "Private summary review pages should not be added to the sitemap.");

const payload = {
  topStories: [samples[0]],
  feed: [samples[2], samples[3]],
};
const shapedPayload = applyLiveNewsSummariesToPayload(payload);
expect(shapedPayload.feed.every((item) => item.liveNewsSummary), "Latest News Feed items should receive Live News summaries.");
expect(
  shapedPayload.feed.every((item) => !/Live News is tracking|It was updated|original source remains/i.test(item.liveNewsSummary)),
  "Latest News Feed summaries should not use old generic tracking copy."
);
expect(
  shapedPayload.feed.every((item) => item.liveNewsSummary === FALLBACK_SUMMARY || (wordCount(item.liveNewsSummary) >= 18 && wordCount(item.liveNewsSummary) <= 35)),
  "Latest News Feed summaries should stay compact."
);
expect(shapedPayload.summaryHealth?.version, "Payloads should include summary health diagnostics.");
expect(shapedPayload.summaryHealth.checkedCount === shapedPayload.topStories.length + shapedPayload.feed.length, "Summary health should count checked stories.");
expect(typeof shapedPayload.summaryHealth.supervisedCount === "number", "Summary health should count teacher-supervised rescues.");
expect(typeof shapedPayload.summaryHealth.needsReviewCount === "number", "Summary health should count summaries needing editor review.");
expect(shapedPayload.summaryHealth.audienceIntelligence?.version === AUDIENCE_INTELLIGENCE_VERSION, "Summary health should include audience-intelligence metrics.");
expect(shapedPayload.feed.every((item) => item.summaryAgent?.audience?.version === AUDIENCE_INTELLIGENCE_VERSION), "Every public feed summary should include audience-intelligence metadata.");

const audienceSample = {
  id: "audience-money-workers",
  title: "Factory workers face layoffs as company cuts costs after profit drop",
  summary: "The company said falling profit and higher costs led to layoffs affecting factory workers and nearby suppliers.",
  sourceName: "Business Desk",
  category: "Business",
};
const audienceIntelligence = deriveAudienceIntelligence(audienceSample);
expect(
  ["jobs_and_workers", "money_and_prices"].includes(audienceIntelligence.primaryPattern.id),
  "Audience intelligence should prioritize worker or money patterns when the evidence supports them."
);
expect(audienceIntelligence.status === "patterned", "Audience intelligence should mark strong evidence as patterned.");

const liveHealthItems = liveRegressionSamples.map((sample) => ({
  ...sample,
  ...buildLiveNewsSummary(sample),
})).map((sample) => ({
  ...sample,
  liveNewsSummary: sample.text,
  summaryAgent: { version: sample.agentVersion, style: sample.style },
}));
const liveHealth = getSummaryHealth(liveHealthItems);
expect(liveHealth.fallbackCount === 0, "Regression samples should report zero fallback summaries.");

const supervisedPayload = applyLiveNewsSummariesToPayload({
  topStories: [],
  feed: teacherSupervisorSamples,
});
expect(
  supervisedPayload.summaryHealth.supervisedCount === teacherSupervisorSamples.length,
  "Teacher-supervised samples should be counted in summary health."
);
expect(
  supervisedPayload.feed.every((item) => item.summaryAgent?.supervisor?.status === "rescued"),
  "Teacher supervisor status should travel with each article card."
);

const duplicatePayload = applyLiveNewsSummariesToPayload({
  topStories: [samples[0]],
  feed: [samples[0]],
});
expect(
  duplicatePayload.feed[0].liveNewsSummary === duplicatePayload.topStories[0].liveNewsSummary,
  "Duplicate stories should reuse the approved summary instead of falling back because of nearby repetition."
);

const repetitionSamples = [
  {
    id: "repeat-local-1",
    title: "Local transit upgrades approved for downtown corridor",
    summary: "Local transit upgrades were approved for the downtown corridor after a city review.",
    sourceName: "City Desk",
    category: "Local",
    sourceCount: 1,
  },
  {
    id: "repeat-local-2",
    title: "Local transit upgrades delayed near airport station",
    summary: "Local transit upgrades near the airport station were delayed as scheduling questions continued.",
    sourceName: "City Desk",
    category: "Local",
    sourceCount: 1,
  },
];
const repetitionChecked = applyLiveNewsSummariesToItems(repetitionSamples);
const nonFallbackRepetition = repetitionChecked.filter((item) => item.liveNewsSummary !== FALLBACK_SUMMARY);
const firstOpeners = nonFallbackRepetition.map((item) => getFirstWords(item.liveNewsSummary));
expect(new Set(firstOpeners).size === firstOpeners.length, "Nearby cards should not reuse the same first four words.");
const firstThreeOpeners = nonFallbackRepetition.map((item) => getFirstWords(item.liveNewsSummary, 3));
expect(new Set(firstThreeOpeners).size === firstThreeOpeners.length, "Nearby cards should not reuse the same first three words.");
expect(
  repetitionChecked.every((item) => item.summaryAgent.passed),
  "Nearby-card repetition checks should still produce passing summaries."
);

const styleMemoryChecked = buildLiveNewsSummary(samples[0], {
  styleMemory: { avoidPhrases: ["This story matters because"] },
});
expect(
  styleMemoryChecked.evaluation.passed,
  "Summary generation should honor editable style-memory avoid phrases without failing safe candidates."
);

if (failures.length) {
  console.error("Live News summary-agent check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News summary-agent check passed.");
console.log(`Samples checked: ${samples.length + liveRegressionSamples.length + teacherSupervisorSamples.length + localSummarySamples.length + 1}`);
