const fs = require("fs");
const path = require("path");
const { runArticleAgents } = require("../lib/article-agents/pipeline");
const { saveAgentRun } = require("../lib/article-agents/store");

const fallbackPath = path.join(__dirname, "..", "data", "news.json");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number(process.env.LIVE_NEWS_DRAFT_LIMIT || 16);

function loadNewsPayload() {
  const raw = fs.readFileSync(fallbackPath, "utf8");
  return JSON.parse(raw);
}

const payload = loadNewsPayload();
const result = runArticleAgents(payload, { limit });
saveAgentRun(result);

console.log(`Live News article agents generated ${result.drafts.length} review-only drafts.`);
console.log(`Run: ${result.run.runId}`);
console.log(`Publish-ready quality gates passed: ${result.run.passedQualityGates}/${result.run.draftCount}`);
if (result.run.passedQualityGates < result.run.draftCount) {
  console.log("Some drafts still require source links, rewriting, or editor checks before publishing.");
}
console.log("Auto-publish: disabled");
