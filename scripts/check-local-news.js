const fs = require("fs");
const path = require("path");
const {
  buildLocalQueryVariants,
  parseLocalPlaceInput,
  resolveLocalPlaceInput,
} = require("../lib/local-news-helpers");

const root = path.join(__dirname, "..");
const failures = [];
const placesPayload = JSON.parse(fs.readFileSync(path.join(root, "data", "us-places.json"), "utf8"));
const stateNameByCode = new Map();
const placesIndex = (placesPayload.places || []).map((place) => {
  if (place.state && place.stateName && !stateNameByCode.has(place.state)) {
    stateNameByCode.set(place.state, place.stateName);
  }
  return {
    ...place,
    search: `${place.display} ${place.officialName} ${place.stateName}`.toLowerCase(),
  };
});

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const sanDiegoParsed = parseLocalPlaceInput("San Diego, CA");
expect(sanDiegoParsed.name === "San Diego", "San Diego typed with state should split city name.");
expect(sanDiegoParsed.state === "CA", "San Diego typed with state should preserve CA.");

const duplicateStateParsed = parseLocalPlaceInput("San Diego, CA", "CA");
expect(duplicateStateParsed.display === "San Diego, CA", "Explicit state should not duplicate an already-typed state.");

const newYorkParsed = parseLocalPlaceInput("New York", "NY");
expect(newYorkParsed.name === "New York", "City names that match state names should not be stripped.");

const denverParsed = parseLocalPlaceInput("Denver Colorado");
expect(denverParsed.name === "Denver", "Denver typed with a state name should split city name.");
expect(denverParsed.state === "CO", "Denver typed with a state name should normalize to CO.");

const resolvedSanDiego = resolveLocalPlaceInput({
  city: "San Diego, CA",
  state: "",
  placesIndex,
  stateNameByCode,
});
expect(resolvedSanDiego.name === "San Diego", "Resolved San Diego should use the canonical city.");
expect(resolvedSanDiego.state === "CA", "Resolved San Diego should use the canonical state.");
expect(resolvedSanDiego.display === "San Diego, CA", "Resolved San Diego should keep a clean display label.");
expect(!Object.prototype.hasOwnProperty.call(resolvedSanDiego, "search"), "Resolved places must not leak search-only fields.");

const variants = buildLocalQueryVariants("San Diego, CA", "", stateNameByCode);
expect(variants.includes("San Diego CA"), "Local queries should include normalized city/state search.");
expect(variants.includes("San Diego California local news"), "Local queries should include state-name local news search.");
expect(variants.some((variant) => variant.endsWith("when:2d")), "Local queries should include recency-focused variants.");
expect(!variants.some((variant) => variant.includes("San Diego, CA CA")), "Local queries must not duplicate state data.");

const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const localJs = fs.readFileSync(path.join(root, "public", "local.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const localCrawlablePages = fs.readFileSync(path.join(root, "lib", "local-crawlable-pages.js"), "utf8");

expect(serverJs.includes("resolveLocalRequestPlace"), "Server local API should resolve typed city/state input.");
expect(serverJs.includes("localHealthStats"), "Server health should include local-news stability diagnostics.");
expect(serverJs.includes("LOCAL_RESPONSE_SUMMARY_RESEARCH_LIMIT"), "Local news should cap slow source-page summary research separately from intake.");
expect(serverJs.includes("summaryResearchTargets"), "Local news should run source-page summary research on a compact first response batch.");
expect(serverJs.includes("const summaryHealth = getSummaryHealth(summarized)"), "Local API should return summary health for local stories.");
expect(serverJs.includes("lastAudienceIntelligence"), "Server health should expose local audience-intelligence diagnostics.");
expect(serverJs.includes("hasLocalRelevance(item, place)"), "Local feeds should filter weak city matches before summary agents run.");
expect(serverJs.includes("LOCAL_CITY_ALIASES"), "Local feeds should keep city-specific aliases for teams and neighborhoods.");
expect(serverJs.includes("live & on demand"), "Local feeds should block event listings that cannot produce useful news summaries.");
expect(serverJs.includes("getPlaceSearchScore"), "City search should rank major exact city matches before smaller same-name places.");
expect(serverJs.includes("localArticleFeed = getCachedLocalNews(place)"), "Crawlable city routes should render quickly from cached local article intelligence when available.");
expect(serverJs.includes("refreshLocalNewsInBackground(place)"), "Crawlable city routes should refresh local article intelligence in the background instead of blocking HTML.");
expect(serverJs.includes("paginateLocalPayload"), "Local API should paginate response items so large local feeds stay responsive.");
expect(indexHtml.includes("home-search-local-panel"), "Homepage should expose Local News inside the compact Search + Local module.");
expect(indexHtml.includes('id="topCityGrid"'), "Homepage compact Local News should render city chips.");
expect(indexHtml.includes('id="localDeepDive" href="/local/cities"'), "Homepage compact Local News should link See more to the full city directory page.");
expect(!indexHtml.includes('id="localFeed"'), "Homepage compact Local News should not render local story cards inline.");
expect(!indexHtml.includes("local-preview-card"), "Homepage compact Local News should not render the old preview card.");
expect(appJs.includes("buildLocalPageHref(place)") && appJs.includes("link.href = buildLocalPageHref(place)"), "Homepage compact Local News city chips should build crawlable city links.");
expect(appJs.includes('return `/local/${encodeURIComponent(stateSlug)}/${encodeURIComponent(citySlug)}`'), "Homepage compact city links should navigate to /local/[stateSlug]/[citySlug].");
expect(appJs.includes("if (elements.localFeed && elements.localStatus)"), "Homepage compact city selection should not fetch preview stories without preview elements.");
expect(localJs.includes("syncResolvedPlace(data.place)"), "Dedicated local page should accept canonical server place data.");
expect(localJs.includes("buildManualPlace(value)"), "Dedicated local page should parse manual city input before fetching.");
expect(localJs.includes("getDisplaySummary(item)"), "Dedicated local page should render shared Live News local summaries.");
expect(localJs.includes("local-story-card"), "Dedicated local page should render local stories with organized card markup.");
expect(localJs.includes("getPublishedDateBadge(item)"), "Dedicated local page should display a clear published-date badge.");
expect(stylesCss.includes(".local-story-card"), "Dedicated local page should style local stories like readable Live News cards.");
expect(localCrawlablePages.includes("data-local-live-feed"), "Crawlable city pages should mount a live article feed.");
expect(localCrawlablePages.includes('fetch("/api/local?"'), "Crawlable city pages should load recent local articles from the existing local API.");
expect(localCrawlablePages.includes('limit: "12"'), "Crawlable city pages should request a compact first batch of local articles.");
expect(localCrawlablePages.includes("Local Pulse") && localCrawlablePages.includes("clusters.length ?"), "Cluster dashboard sections should only render when cluster data exists.");

if (failures.length) {
  console.error("Live News local-news check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News local-news check passed.");
console.log(`Places indexed: ${placesIndex.length}`);
console.log(`San Diego variants checked: ${variants.length}`);
