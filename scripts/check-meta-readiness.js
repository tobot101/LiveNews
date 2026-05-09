const { buildMetaReadiness } = require("../lib/meta-readiness");

const failures = [];

const empty = buildMetaReadiness({});
if (empty.readyForApiTesting) {
  failures.push("Meta readiness should not pass without required private configuration.");
}
if (empty.autoPostAllowed !== false || empty.publicVisible !== false) {
  failures.push("Meta readiness must keep auto-posting disabled and private.");
}
if (!empty.missing.includes("META_PAGE_ACCESS_TOKEN")) {
  failures.push("Meta readiness should require a private Page access token for later API testing.");
}

const configured = buildMetaReadiness({
  META_APP_ID: "123",
  META_PAGE_ID: "456",
  META_INSTAGRAM_BUSINESS_ACCOUNT_ID: "789",
  META_PAGE_ACCESS_TOKEN: "secret-token-value",
  META_APP_REVIEW_APPROVED: "true",
  LIVE_NEWS_META_POSTING_ENABLED: "true",
});

if (!configured.readyForApiTesting || !configured.postingEnabled) {
  failures.push("Meta readiness should recognize a fully configured private API test setup.");
}

const serialized = JSON.stringify(configured);
if (serialized.includes("secret-token-value")) {
  failures.push("Meta readiness must never expose token values.");
}

if (configured.autoPostAllowed !== false) {
  failures.push("Meta readiness must not allow auto-posting, even when configured.");
}

for (const permission of ["pages_show_list", "instagram_basic", "instagram_content_publish"]) {
  if (!configured.requiredPermissions.includes(permission)) {
    failures.push(`Meta readiness is missing required permission ${permission}.`);
  }
}

if (failures.length) {
  console.error("Live News Meta readiness check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News Meta readiness check passed.");
console.log(`Missing when empty: ${empty.missing.length}`);
console.log(`Configured status: ${configured.status}`);
