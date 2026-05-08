const fs = require("fs");
const path = require("path");
const {
  buildSocialPublisherRun,
  saveSocialPublisherRun,
} = require("../lib/social-publisher");

const fallbackPath = path.join(__dirname, "..", "data", "news.json");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number(process.env.LIVE_NEWS_SOCIAL_LIMIT || 16);
const origin = String(process.env.PUBLIC_SITE_URL || "https://newsmorenow.com").replace(/\/$/, "");

const payload = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
const result = buildSocialPublisherRun(payload, { origin, limit });
saveSocialPublisherRun(result);

console.log(`Live News social publisher generated ${result.drafts.length} private review drafts.`);
console.log(`Run: ${result.run.runId}`);
console.log(`Ready with exact Live News links: ${result.run.readyForManualReview}/${result.run.draftCount}`);
console.log(`Blocked until article page approval: ${result.run.blockedUntilArticlePage}`);
console.log("Auto-post: disabled");
