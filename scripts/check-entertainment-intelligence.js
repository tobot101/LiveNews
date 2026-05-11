const fs = require("fs");
const path = require("path");

const failures = [];
const memoryPath = path.join(__dirname, "..", "data", "entertainment-intelligence.json");
const briefPath = path.join(__dirname, "..", "docs", "entertainment-intelligence-brief.md");
const appPath = path.join(__dirname, "..", "public", "app.js");
const categoryPath = path.join(__dirname, "..", "public", "category.js");
const serverPath = path.join(__dirname, "..", "server.js");
const {
  classifyEntertainmentStory,
  getEntertainmentSubbeatLabel,
  isEntertainmentStory,
  normalizeEntertainmentStory,
} = require("../lib/entertainment-classifier");
const {
  detectPublicWritingRisk,
  getSafeEntertainmentCard,
  getSafeEntertainmentDisplaySummary,
  getSafeEntertainmentDisplayTitle,
  getSafeDisplaySummary,
  getSafeDisplayTitle,
} = require("../lib/public-card-writing");

function fail(message) {
  failures.push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

if (!fs.existsSync(memoryPath)) fail("Entertainment intelligence memory file is missing.");
if (!fs.existsSync(briefPath)) fail("Entertainment intelligence brief is missing.");

const memory = fs.existsSync(memoryPath) ? readJson(memoryPath) : {};
const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, "utf8") : "";
const appJs = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";
const categoryJs = fs.existsSync(categoryPath) ? fs.readFileSync(categoryPath, "utf8") : "";
const serverJs = fs.existsSync(serverPath) ? fs.readFileSync(serverPath, "utf8") : "";

if (memory.schemaVersion !== "live-news-entertainment-intelligence-v1") {
  fail("Entertainment intelligence schema version is wrong.");
}
if (memory.mode !== "source_respectful_aggregate_learning_only") {
  fail("Entertainment intelligence must remain aggregate-safe and source-respectful.");
}
if (!Array.isArray(memory.nonNegotiables) || memory.nonNegotiables.length < 5) {
  fail("Entertainment intelligence must include durable non-negotiable rules.");
}
if (!memory.nonNegotiables.some((rule) => /never copy/i.test(rule))) {
  fail("Entertainment intelligence must explicitly block copied wording.");
}
if (!memory.nonNegotiables.some((rule) => /private messages|personal profiles|usernames/i.test(rule))) {
  fail("Entertainment intelligence must block private or personal-data learning.");
}

const sourceIds = new Set((memory.sourceMap || []).map((source) => source.id));
[
  "entertainment_tonight",
  "e_news",
  "variety",
  "billboard",
  "people",
  "access_hollywood",
  "thewrap",
  "meta_reels",
  "pew_social_news",
].forEach((requiredSource) => {
  if (!sourceIds.has(requiredSource)) fail(`Missing entertainment source model: ${requiredSource}`);
});

const pillarIds = new Set((memory.coveragePillars || []).map((pillar) => pillar.id));
[
  "celebrity_public_moment",
  "music_momentum",
  "film_tv_streaming",
  "awards_red_carpet",
  "entertainment_business",
  "fan_utility",
].forEach((requiredPillar) => {
  if (!pillarIds.has(requiredPillar)) fail(`Missing entertainment coverage pillar: ${requiredPillar}`);
});

const banned = memory.writingIntelligence?.bannedEntertainmentOpeners || [];
["Shocking", "Drama alert", "Top Story:", "Source-linked coverage"].forEach((phrase) => {
  if (!banned.includes(phrase)) fail(`Banned entertainment opener missing: ${phrase}`);
});

const captionShapes = memory.writingIntelligence?.captionShapes || [];
if (captionShapes.length < 5) fail("Entertainment intelligence needs at least five caption shapes.");

const teacherChecks = memory.growthLoop?.teacherChecks || [];
["source_respect", "entertainment_specificity", "human_angle", "rumor_risk", "exact_story_link"].forEach((check) => {
  if (!teacherChecks.includes(check)) fail(`Missing entertainment teacher check: ${check}`);
});

const blockedInputs = memory.growthLoop?.inputsBlocked || [];
["copied comments", "usernames", "private messages", "individual profiles"].forEach((blocked) => {
  if (!blockedInputs.includes(blocked)) fail(`Missing blocked entertainment learning input: ${blocked}`);
});

if (!brief.includes("Live News Entertainment Intelligence Brief")) {
  fail("Entertainment brief should have the expected title.");
}
if (!brief.includes("Future Build Priorities")) {
  fail("Entertainment brief should include future build priorities.");
}
if (!brief.includes("Research References")) {
  fail("Entertainment brief should include research references.");
}

function expectClassification(story, expectedSubbeat, label) {
  const classification = classifyEntertainmentStory(story);
  if (!classification.isEntertainment) {
    fail(`${label} should classify as entertainment.`);
    return classification;
  }
  if (classification.subbeat !== expectedSubbeat) {
    fail(`${label} should classify as ${expectedSubbeat}, got ${classification.subbeat}.`);
  }
  return classification;
}

expectClassification({
  category: "Top",
  title: "Artist headlines downtown summer music festival",
  summary: "The singer will perform new songs during the festival weekend.",
  sourceName: "Live News source",
}, "music", "Top artist/festival story");
const topCategoryEntertainmentStory = normalizeEntertainmentStory({
  category: "Top",
  title: "Singer announces arena tour after new album release",
  summary: "The artist added dates for the tour tied to the album rollout.",
  liveNewsHeadline: "Singer adds arena tour dates after album release",
});
if (!topCategoryEntertainmentStory.entertainmentClassification?.isEntertainment || topCategoryEntertainmentStory.entertainmentSubbeat !== "music") {
  fail("Source category Top should still enter the homepage Entertainment lane when the shared classifier says entertainment.");
}
if (getSafeDisplayTitle(topCategoryEntertainmentStory) !== "Singer adds arena tour dates after album release") {
  fail("Entertainment cards should prefer the approved Live News headline over the raw publisher title.");
}
if (getSafeEntertainmentDisplayTitle(topCategoryEntertainmentStory) !== "Singer adds arena tour dates after album release") {
  fail("Entertainment-safe display title should prefer liveNewsHeadline.");
}
const approvedDescriptionStory = normalizeEntertainmentStory({
  category: "Top",
  title: "Publisher title should not be the card focus",
  liveNewsHeadline: "Actor joins a new streaming series",
  approvedDescription: "The actor joined a streaming series, with the report focusing on the confirmed casting update.",
  summary: "Read the original source for the full report.",
});
const approvedDescriptionCard = getSafeEntertainmentCard(approvedDescriptionStory, 180);
if (approvedDescriptionCard.summary !== "The actor joined a streaming series, with the report focusing on the confirmed casting update.") {
  fail("Entertainment card should prefer approved description over raw fallback summary.");
}
if (approvedDescriptionCard.displayMode !== "full") {
  fail("Entertainment card with approved description should render as a full safe card.");
}
const approvedEntertainmentStory = normalizeEntertainmentStory({
  category: "Top",
  title: "Public figure attends a verified culture event",
  entertainmentSubbeat: "celebrity_culture",
  entertainmentConfidence: 72,
});
if (!approvedEntertainmentStory.entertainmentClassification?.isEntertainment || approvedEntertainmentStory.entertainmentSubbeat !== "celebrity_culture") {
  fail("Approved entertainmentSubbeat and entertainmentConfidence should keep a Top-category story in Entertainment.");
}

const actorInterview = classifyEntertainmentStory({
  category: "Top",
  title: "Actor opens up in verified public interview before new series",
  summary: "The performer discussed the role and the TV project.",
});
if (!actorInterview.isEntertainment || !["celebrity_culture", "movies", "tv_streaming"].includes(actorInterview.subbeat)) {
  fail(`Top actor interview should classify as celebrity_culture, movies, or tv_streaming, got ${actorInterview.subbeat}.`);
}

expectClassification({ category: "Entertainment", title: "Director announces cast for new film" }, "movies", "Movie story");
expectClassification({ category: "Top", title: "Netflix renews hit series for another season" }, "tv_streaming", "Streaming renewal");
expectClassification({ category: "General", title: "Singer releases new album before tour" }, "music", "Music story");
expectClassification({ category: "Culture", title: "Grammy nominations put new artists in focus" }, "awards", "Awards nomination");
expectClassification({ category: "Lifestyle", title: "Author announces novel adaptation and book release" }, "books_publishing", "Book/author story");
expectClassification({ category: "General", title: "Broadway musical opens after stage previews" }, "theater_arts", "Theater/Broadway story");
expectClassification({ category: "Top", title: "YouTube creator joins gaming release event" }, "gaming_creator", "Gaming/creator story");
expectClassification({ category: "Top", title: "Film teaser trailer reveals premiere date" }, "trailers_releases", "Trailer story");
const starsWeLost = expectClassification({ category: "Entertainment", title: "Beloved actor dies as fans and colleagues share tribute" }, "stars_we_lost", "Celebrity death story");
if (!starsWeLost.sensitivityFlags.length) fail("Celebrity death story should include sensitivity flags.");

if (isEntertainmentStory({ category: "Sports", title: "Lakers beat Warriors in playoff game" })) {
  fail("Ordinary sports story should not become entertainment without entertainment signals.");
}
if (isEntertainmentStory({ category: "Local", title: "Road closure follows emergency alert downtown" })) {
  fail("Ordinary public safety/local story should not become entertainment without entertainment signals.");
}

[
  { category: "Entertainment", title: "Film earnings rise after weekend" },
  { category: "Entertainment", title: "Streaming guide adds new shows" },
  { category: "Entertainment", title: "Studio executive discusses media contract" },
].forEach((story) => {
  const classification = classifyEntertainmentStory(story);
  if (["box_office", "what_to_watch", "entertainment_biz", "business", "trend"].includes(classification.subbeat)) {
    fail(`Forbidden entertainment subbeat produced: ${classification.subbeat}`);
  }
});

const normalized = normalizeEntertainmentStory({ category: "Top", title: "Singer releases new song" });
if (!normalized.entertainmentClassification || normalized.entertainmentSubbeat !== "music") {
  fail("normalizeEntertainmentStory should attach shared entertainment classification fields.");
}
if (getEntertainmentSubbeatLabel("entertainment_biz") === "Entertainment Biz") {
  fail("Entertainment biz should not be an allowed public label.");
}
if (!serverJs.includes('require("./lib/entertainment-classifier")')) {
  fail("Server should use the shared entertainment classifier module.");
}
if (!serverJs.includes("isEntertainmentStory(item)") || !serverJs.includes('normalizedCategory === "Entertainment"')) {
  fail("/category/entertainment should use the shared entertainment classifier.");
}
if (!serverJs.includes("renderEntertainmentCategoryRoutePage") || !serverJs.includes("renderCrawlerEntertainmentCategoryGroups")) {
  fail("/category/entertainment crawlable route should render Entertainment-specific grouped content.");
}
if (!serverJs.includes("ENTERTAINMENT_CATEGORY_SUBBEATS") || !serverJs.includes("getCrawlerEntertainmentSubbeat")) {
  fail("/category/entertainment route should expose allowed Entertainment subbeat grouping.");
}
if (!categoryJs.includes("ENTERTAINMENT_SUBBEAT_FILTERS") || !categoryJs.includes("isEntertainmentCategoryItem")) {
  fail("Browser category page should include Entertainment subbeat filters and classifier-aware item checks.");
}
if (!categoryJs.includes("entertainmentClassification?.isEntertainment") || !categoryJs.includes("entertainmentConfidence")) {
  fail("Browser /category/entertainment should accept shared classifier and approved entertainment confidence signals.");
}
[
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
].forEach((subbeat) => {
  if (!categoryJs.includes(subbeat) || !serverJs.includes(subbeat)) {
    fail(`/category/entertainment should support subbeat: ${subbeat}`);
  }
});
[
  "Box Office",
  "What To Watch",
  "Entertainment Biz",
  "Business of Entertainment",
].forEach((blockedPublicSection) => {
  if (categoryJs.includes(blockedPublicSection) || appJs.includes(blockedPublicSection) || serverJs.includes(blockedPublicSection)) {
    fail(`Entertainment pages should not expose blocked public section: ${blockedPublicSection}`);
  }
});
if (!appJs.includes("entertainmentClassification") || appJs.includes("ENTERTAINMENT_STORY_PATTERN")) {
  fail("Homepage should use server-provided shared classification instead of local regex matching.");
}
["getSafeEntertainmentTitle", "getSafeEntertainmentSummary", "getEntertainmentCardStatus"].forEach((helper) => {
  if (!appJs.includes(helper)) fail(`Homepage Entertainment renderer is missing helper: ${helper}`);
  if (!serverJs.includes(helper)) fail(`Crawlable Entertainment renderer is missing helper: ${helper}`);
});
if (!appJs.includes("buildEntertainmentTitleLink") || !appJs.includes("buildEntertainmentSummaryParagraph")) {
  fail("Homepage Entertainment cards should render through safe Entertainment-specific title and summary helpers.");
}
if (!serverJs.includes("renderCrawlerEntertainmentTitleLink")) {
  fail("Crawlable Entertainment cards should render through a safe Entertainment-specific title link helper.");
}
if (!appJs.includes("data-card-status") || !serverJs.includes("data-card-status")) {
  fail("Entertainment cards should carry internal safe-writing card status on homepage and crawlable HTML.");
}
const weakSummaryStory = normalizeEntertainmentStory({
  category: "Top",
  title: "Actor joins new streaming series",
  liveNewsHeadline: "Actor joins new streaming series",
  summary: "This article discusses a recent entertainment update.",
});
if (getSafeDisplaySummary(weakSummaryStory, 118)) {
  fail("Homepage Entertainment cards should block generic fallback summaries.");
}
const weakEntertainmentCard = getSafeEntertainmentCard(weakSummaryStory, 118);
if (weakEntertainmentCard.status !== "needs_review" || weakEntertainmentCard.displayMode !== "minimal") {
  fail("Weak Entertainment writing should be marked needs_review and reduced to a minimal card.");
}
[
  "This article discusses a film premiere.",
  "In a recent development, a singer released a song.",
  "Top Story: Actor joins a new series.",
].forEach((weakText) => {
  if (getSafeDisplaySummary({ ...weakSummaryStory, liveNewsSummary: weakText }, 118)) {
    fail(`Entertainment public summary should block weak phrase: ${weakText}`);
  }
});
[
  "Drama alert: Actor spills tea on secret romance.",
  "Bombshell feud rocks the cast after the finale.",
].forEach((bait) => {
  if (detectPublicWritingRisk(bait, weakSummaryStory).safe) {
    fail(`Entertainment public writing should block gossip bait: ${bait}`);
  }
});
if (detectPublicWritingRisk("Actor is in a secret romance with co-star.", weakSummaryStory).safe) {
  fail("Entertainment writing should block unsupported relationship claims.");
}
const obituaryCard = getSafeEntertainmentCard(normalizeEntertainmentStory({
  category: "Entertainment",
  title: "Actor dies at 84",
  liveNewsHeadline: "Actor dies at 84",
  approvedDescription: "The actor died at 84, and the report looks back at the work audiences knew across film and television.",
}), 180);
if (obituaryCard.status !== "ready" || /shocking|bombshell/i.test(obituaryCard.summary)) {
  fail("Entertainment obituary card should use neutral, respectful wording.");
}
const legalCard = getSafeEntertainmentCard(normalizeEntertainmentStory({
  category: "Entertainment",
  title: "Actor faces lawsuit over production dispute",
  liveNewsHeadline: "Actor faces lawsuit over production dispute",
  approvedDescription: "The lawsuit centers on a production dispute, with the report outlining the confirmed legal filing.",
}), 180);
if (legalCard.status !== "ready" || /drama alert|bombshell|scandal/i.test(legalCard.summary)) {
  fail("Entertainment legal or allegation stories should use neutral wording.");
}
if (detectPublicWritingRisk("Stay safe while following the celebrity update.", weakSummaryStory).safe) {
  fail("Entertainment cards should not force public safety language.");
}
["getSafeEntertainmentCard", "getSafeEntertainmentDisplayTitle", "getSafeEntertainmentDisplaySummary"].forEach((helper) => {
  if (!appJs.includes(helper) || !categoryJs.includes(helper) || !serverJs.includes(helper)) {
    fail(`Entertainment public surfaces should use shared helper: ${helper}`);
  }
});
if (/box_office|what_to_watch|entertainment_biz/.test(fs.readFileSync(path.join(__dirname, "..", "lib", "entertainment-classifier.js"), "utf8"))) {
  fail("Shared entertainment classifier must not define forbidden subbeats.");
}
if (/Google Trends|Search Console|Semrush|Ahrefs|Glimpse|Exploding Topics/.test(fs.readFileSync(path.join(__dirname, "..", "lib", "entertainment-classifier.js"), "utf8"))) {
  fail("Entertainment classifier should not require trend intelligence.");
}

if (failures.length) {
  console.error("Live News entertainment intelligence check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News entertainment intelligence check passed.");
console.log(`Source models checked: ${sourceIds.size}`);
console.log(`Coverage pillars checked: ${pillarIds.size}`);
