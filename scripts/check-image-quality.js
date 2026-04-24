const fs = require("fs");
const path = require("path");
const {
  getArticleImageRejectionReason,
  getImageDimensionHints,
  isAuthenticArticleImageUrl,
  isStrongArticleImageSize,
  pickAuthenticArticleImageUrl,
} = require("../lib/article-images");
const { buildImageResearchQueries } = require("../lib/image-research-agent");

const root = path.join(__dirname, "..");
const failures = [];

const rejectedSamples = [
  "https://www.google.com/s2/favicons?domain=abcnews.go.com&sz=128",
  "https://static.guim.co.uk/images/favicons/46bd2faa1ab438684a6d4528a655a8bd/152x152.png",
  "https://example.com/assets/site-logo.png",
  "https://example.com/apple-touch-icon.png",
  "https://example.com/news/photo.jpg?w=128&h=128",
  "https://example.com/brandmark.svg",
];

const acceptedSamples = [
  "https://media.example.com/photos/2026/04/storm-front-1600x900.jpg",
  "https://cdn.example.com/article/national-weather-update.jpg?width=1200&height=675",
];

for (const sample of rejectedSamples) {
  if (isAuthenticArticleImageUrl(sample)) {
    failures.push(`Decorative image was accepted: ${sample}`);
  }
}

for (const sample of acceptedSamples) {
  if (!isAuthenticArticleImageUrl(sample)) {
    failures.push(`${sample} was rejected: ${getArticleImageRejectionReason(sample)}`);
  }
}

const selected = pickAuthenticArticleImageUrl([rejectedSamples[0], rejectedSamples[2], acceptedSamples[0]]);
if (selected !== acceptedSamples[0]) {
  failures.push("Image picker did not skip decorative candidates before choosing an article image.");
}

const hints = getImageDimensionHints("https://example.com/photo.jpg?width=1200&height=675");
if (!isStrongArticleImageSize(hints.width, hints.height)) {
  failures.push("Strong image dimension hints should qualify as article-size media.");
}

const researchQueries = buildImageResearchQueries({
  title: "WATCH: Tornado rips through northwest Oklahoma amid severe storms across Plains",
  summary: "Powerful storms damaged homes and closed roads in Oklahoma.",
  category: "Top",
});
if (!researchQueries.length || researchQueries[0].toLowerCase().includes("watch")) {
  failures.push("Image research agent should build focused topic queries instead of source-style headlines.");
}

const searchJs = fs.readFileSync(path.join(root, "public", "search.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");

if (searchJs.includes("google.com/s2/favicons") || appJs.includes("google.com/s2/favicons")) {
  failures.push("Public story/search visuals must not use Google favicon fallbacks as article images.");
}

if (!serverJs.includes("researchPublicMediaImage") || !serverJs.includes("validateArticleImageCandidate")) {
  failures.push("Server image pipeline must research alternatives and validate candidates before display.");
}

if (!searchJs.includes("image-failed") || !searchJs.includes("getSourceInitials")) {
  failures.push("Search results must include a non-logo fallback when authentic images are unavailable.");
}

if (!searchJs.includes("validateSearchImage") || !appJs.includes("validateStoryImage")) {
  failures.push("Client-side image guards must reject weak loaded images that slip past the server.");
}

if (failures.length) {
  console.error("Live News image-quality check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News image-quality check passed.");
console.log(`Rejected decorative samples: ${rejectedSamples.length}`);
console.log(`Accepted article samples: ${acceptedSamples.length}`);
console.log(`Research queries checked: ${researchQueries.length}`);
