const fs = require("fs");
const path = require("path");

const failures = [];
const memoryPath = path.join(__dirname, "..", "data", "entertainment-intelligence.json");
const briefPath = path.join(__dirname, "..", "docs", "entertainment-intelligence-brief.md");
const appPath = path.join(__dirname, "..", "public", "app.js");
const serverPath = path.join(__dirname, "..", "server.js");
const {
  classifyEntertainmentStory,
  getEntertainmentSubbeatLabel,
  isEntertainmentStory,
  normalizeEntertainmentStory,
} = require("../lib/entertainment-classifier");

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
if (!appJs.includes("entertainmentClassification") || appJs.includes("ENTERTAINMENT_STORY_PATTERN")) {
  fail("Homepage should use server-provided shared classification instead of local regex matching.");
}
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
