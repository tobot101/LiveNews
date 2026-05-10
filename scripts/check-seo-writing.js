const { buildSeoPackage, detectKeywordStuffing, evaluateSeoCandidate } = require("../lib/article-agents/seo-package");
const { buildArticleWritingContext } = require("../lib/article-agents/writing-quality");
const { renderPublicStoryPage } = require("../lib/article-agents/story-renderer");

const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const story = {
  storyId: "seo-story-1",
  slug: "transit-safety-plan-abc123",
  liveNewsUrl: "/stories/transit-safety-plan-abc123",
  canonicalUrl: "/stories/transit-safety-plan-abc123",
  title: "Transit safety plan advances after public review",
  headline: "Transit safety plan advances after public review",
  originalPublisherTitle: "City leaders approve overnight transit safety plan after public review",
  description:
    "An overnight transit safety plan advanced after public review. Riders and station workers could see updated reporting procedures.",
  summaryShort:
    "An overnight transit safety plan advanced after public review. Riders and station workers could see updated reporting procedures.",
  summary: [
    "City leaders approved overnight transit station safety changes after public review.",
    "Riders and station workers are expected to see updated reporting procedures.",
  ],
  keyPoints: [
    "City leaders approved the plan after public review.",
    "Riders and station workers could see updated reporting procedures.",
  ],
  whyItMatters: "The changes could affect late-night riders and transit workers.",
  category: "Local",
  primarySourceName: "Metro Daily",
  sourceName: "Metro Daily",
  originalSourceUrl: "https://example.com/transit-safety-plan",
  publishedAt: "2026-05-10T12:00:00.000Z",
  updatedAt: "2026-05-10T12:30:00.000Z",
};

const seoPackage = buildSeoPackage(story);
expect(seoPackage.storyId === "seo-story-1", "SEO package should preserve storyId.");
expect(seoPackage.seoTitle, "SEO package should create an SEO title.");
expect(seoPackage.metaDescription, "SEO package should create a meta description.");
expect(seoPackage.canonicalUrl === "/stories/transit-safety-plan-abc123", "SEO package should use exact /stories/... canonical URL.");
expect(seoPackage.exactArticleUrl === "/stories/transit-safety-plan-abc123", "SEO package should use exact /stories/... article URL.");
expect(seoPackage.structuredDataType === "NewsArticle", "SEO package should use NewsArticle structured data type.");
expect(
  seoPackage.seoTitle.replace(/\s+\|\s+Live News$/i, "") !== story.originalPublisherTitle,
  "SEO title should not copy the publisher title exactly."
);
expect(/transit safety plan/i.test(seoPackage.metaDescription), "Meta description should describe the actual story situation.");
expect(!/read the original source|this article discusses/i.test(seoPackage.metaDescription), "Meta description should block generic fallback language.");
expect(!detectKeywordStuffing(seoPackage.seoTitle).stuffed, "SEO title should avoid keyword stuffing.");

const context = buildArticleWritingContext(story);
const fallbackGate = evaluateSeoCandidate("Read the original source for the full report.", context, "metaDescription");
expect(!fallbackGate.ok, "Generic fallback meta description should be blocked.");

const stuffedGate = evaluateSeoCandidate(
  "Transit transit transit transit plan plan plan plan update",
  context,
  "seoTitle"
);
expect(!stuffedGate.ok && stuffedGate.keywordStuffing.stuffed, "Keyword-stuffed SEO title should be blocked.");

const homepagePackage = buildSeoPackage({
  ...story,
  liveNewsUrl: "https://newsmorenow.com/",
  canonicalUrl: "https://newsmorenow.com/",
});
expect(homepagePackage.status !== "ready", "Homepage URL should block article SEO package readiness.");
expect(homepagePackage.warnings.includes("homepage_url_blocked"), "Homepage canonical warning should be visible.");
expect(!homepagePackage.canonicalUrl, "Homepage URL should not be accepted as article canonical.");

const publicSafetyGate = evaluateSeoCandidate(
  "City council reviewed a budget plan. Stay safe while officials respond.",
  buildArticleWritingContext({
    ...story,
    storyId: "seo-normal-local",
    liveNewsUrl: "/stories/city-budget-plan-abc123",
    canonicalUrl: "/stories/city-budget-plan-abc123",
    title: "City council reviews budget plan",
    description: "City council reviewed a budget plan.",
    summary: ["City council reviewed a budget plan."],
    category: "Local",
  }),
  "metaDescription"
);
expect(!publicSafetyGate.ok, "Public safety language should be conditional only.");

const html = renderPublicStoryPage(
  {
    ...story,
    seoPackage,
    metaTitle: seoPackage.seoTitle,
    metaDescription: seoPackage.metaDescription,
    schemaType: seoPackage.structuredDataType,
  },
  { origin: "https://newsmorenow.com" }
);
expect(
  html.includes('<link rel="canonical" href="https://newsmorenow.com/stories/transit-safety-plan-abc123"'),
  "Rendered story page should use exact canonical URL."
);
expect(html.includes('"@type":"NewsArticle"') || html.includes('"@type": "NewsArticle"'), "Rendered story page should include NewsArticle metadata.");
expect(html.includes(seoPackage.metaDescription), "Rendered story page should use SEO package meta description.");

if (failures.length) {
  console.error("Live News SEO writing check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News SEO writing check passed.");
console.log(JSON.stringify({
  seoTitle: seoPackage.seoTitle,
  metaDescription: seoPackage.metaDescription,
  canonicalUrl: seoPackage.canonicalUrl,
  structuredDataType: seoPackage.structuredDataType,
}, null, 2));
