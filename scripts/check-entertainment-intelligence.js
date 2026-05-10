const fs = require("fs");
const path = require("path");

const failures = [];
const memoryPath = path.join(__dirname, "..", "data", "entertainment-intelligence.json");
const briefPath = path.join(__dirname, "..", "docs", "entertainment-intelligence-brief.md");

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

if (failures.length) {
  console.error("Live News entertainment intelligence check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News entertainment intelligence check passed.");
console.log(`Source models checked: ${sourceIds.size}`);
console.log(`Coverage pillars checked: ${pillarIds.size}`);
