const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const failures = [];

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const serverJs = read("server.js");
const indexHtml = read("public/index.html");
const stylesCss = read("public/styles.css");
const storyRenderer = read("lib/article-agents/story-renderer.js");
const robotsTxt = read("public/robots.txt");
const publicSitemap = read("public/sitemap.xml");
const packageJson = read("package.json");

[
  "buildWebsiteSchema",
  "buildOrganizationSchema",
  "buildWebPageSchema",
  "buildBreadcrumbSchema",
  "renderJsonLdScripts",
].forEach((helperName) => {
  expect(serverJs.includes(helperName), `SEO helper missing from server.js: ${helperName}`);
});

expect(
  serverJs.includes('"@type": "NewsMediaOrganization"'),
  "Homepage should expose Organization/NewsMediaOrganization structured data."
);
expect(
  serverJs.includes('"@type": "WebSite"') && serverJs.includes('alternateName: "LiveNews"'),
  "Homepage should expose WebSite structured data for Google site-name clarity."
);
expect(
  serverJs.includes('pageType: "CollectionPage"') && serverJs.includes("buildStructuredItemList"),
  "News index pages should expose CollectionPage structured data with visible story lists."
);
expect(
  serverJs.includes("buildPageShellSchemas") && serverJs.includes('"@type": "BreadcrumbList"'),
  "Stable public pages should include breadcrumb structured data."
);
expect(
  serverJs.includes("buildHomeStructuredData") && serverJs.includes("homeStructuredData"),
  "Crawlable homepage should inject structured data before sending HTML."
);

expect(
  storyRenderer.includes('story.schemaType || "NewsArticle"'),
  "Internal story pages must keep NewsArticle structured data."
);
expect(
  storyRenderer.includes('"@type": "BreadcrumbList"'),
  "Internal story pages should include breadcrumb structured data."
);

expect(indexHtml.includes('class="panel seo-discovery-panel"'), "Homepage should include the SEO discovery panel.");
[
  "/top-stories",
  "/latest",
  "/local",
  "/category/national",
  "/category/world",
  "/category/business",
  "/category/technology",
  "/category/sports",
  "/category/entertainment",
  "/sources",
  "/editorial-policy",
].forEach((href) => {
  expect(indexHtml.includes(`href="${href}"`), `Homepage discovery links should include ${href}.`);
});

expect(
  indexHtml.includes("Browse Live News") && indexHtml.includes("National News") && indexHtml.includes("World News"),
  "Homepage should use clear, crawl-visible labels for news discovery."
);
expect(
  indexHtml.includes('<a href="/about">About</a>') &&
    indexHtml.includes('<a href="/privacy">Privacy</a>') &&
    indexHtml.includes('<a href="/contact">Contact</a>'),
  "Homepage footer should expose stable trust and policy links."
);
expect(
  stylesCss.includes(".seo-discovery-panel") && stylesCss.includes(".seo-discovery-grid"),
  "SEO discovery panel styles are missing."
);

expect(!robotsTxt.includes("Disallow: /favicon"), "robots.txt should not block the favicon.");
expect(robotsTxt.includes("Sitemap: https://newsmorenow.com/sitemap.xml"), "robots.txt should point Google to sitemap.xml.");
expect(publicSitemap.includes("https://newsmorenow.com/terms"), "Static sitemap fallback should match stable legal routes.");
expect(!/<loc>https?:\/\/(?!newsmorenow\.com\/)/.test(publicSitemap), "Static sitemap should avoid external publisher URLs.");
expect(packageJson.includes("check-seo-structure.js"), "npm test should include the SEO structure check.");

if (failures.length) {
  console.error("Live News SEO structure check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News SEO structure check passed.");
