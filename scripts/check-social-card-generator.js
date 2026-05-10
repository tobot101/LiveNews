const {
  buildInstagramCardPlan,
  isDurablePublicImageUrl,
} = require("../lib/social-card-generator");

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
if (noImagePlan.renderStatus !== "needs_rendering" || noImagePlan.publishable !== false) {
  fail("Instagram card plan without a durable image/card URL should need rendering and not be publishable.");
}
if (noImagePlan.imageSource !== "generated_card_needed") {
  fail("No-image Instagram plan should request a generated card.");
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

if (failures.length) {
  console.error("Live News social card generator check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News social card generator check passed.");
console.log(`No-image render status: ${noImagePlan.renderStatus}`);
console.log(`Ready render status: ${readyPlan.renderStatus}`);
