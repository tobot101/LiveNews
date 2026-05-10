const {
  buildInstagramCardPlan,
  isDurablePublicImageUrl,
} = require("../lib/social-card-generator");
const { renderInstagramCardPng } = require("../lib/social-card-image");

const failures = [];

function fail(message) {
  failures.push(message);
}

const noImagePlan = buildInstagramCardPlan({
  cardTitle: "City Council Approves Overnight Transit Plan",
  cardSubtitle: "Riders and station workers are expected to see updated reporting procedures.",
  sourceLabel: "Live News Test Source",
  exactArticleUrl: "https://newsmorenow.com/stories/transit-plan-test",
});

if (noImagePlan.platform !== "instagram" || noImagePlan.format !== "feed_card") {
  fail("Instagram card plan should describe the platform and feed-card format.");
}
if (noImagePlan.renderStatus !== "ready" || noImagePlan.publishable !== true) {
  fail("Instagram card plan without a publisher image should use a generated Live News card and become publish-ready.");
}
if (noImagePlan.imageSource !== "generated_live_news_card" || !noImagePlan.generatedCardUrl.includes("/social-cards/transit-plan-test.png")) {
  fail("No-image Instagram plan should create a stable generated card URL.");
}

const readyPlan = buildInstagramCardPlan({
  cardTitle: "Library expansion opens downtown",
  cardSubtitle: "Students and residents now have more public workspace.",
  sourceLabel: "Live News Test Source",
  exactArticleUrl: "https://newsmorenow.com/stories/library-expansion-test",
  imageUrl: "https://newsmorenow.com/social-cards/library-expansion-test.png",
});

if (readyPlan.renderStatus !== "ready" || readyPlan.publishable !== true) {
  fail("Instagram card plan with a durable public image URL should be publish-ready.");
}
if (readyPlan.imageSource !== "approved_story_image") {
  fail("Durable article image URL should be treated as an approved story image.");
}
if (!readyPlan.cardTitle || !readyPlan.altText) {
  fail("Instagram card plan should include card title and alt text.");
}
if (isDurablePublicImageUrl("http://newsmorenow.com/card.png") || isDurablePublicImageUrl("https://localhost/card.png")) {
  fail("Durable image validation must reject non-HTTPS or local URLs.");
}

const png = renderInstagramCardPng({
  cardTitle: "City Council Approves Overnight Transit Plan",
  cardSubtitle: "Riders and station workers are expected to see updated reporting procedures.",
  sourceLabel: "Live News Test Source",
  exactArticleUrl: "https://newsmorenow.com/stories/transit-plan-test",
});
if (!Buffer.isBuffer(png) || png.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  fail("Generated Instagram card should render as a real PNG image.");
}

if (failures.length) {
  console.error("Live News social card generator check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News social card generator check passed.");
console.log(`No-image render status: ${noImagePlan.renderStatus}`);
console.log(`Ready render status: ${readyPlan.renderStatus}`);
