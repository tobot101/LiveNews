const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    dump() {
      return Object.fromEntries(store.entries());
    },
  };
}

function loadPrefsRuntime(localStorage = createLocalStorage()) {
  const code = fs.readFileSync(path.join(root, "public", "live-news-prefs.js"), "utf8");
  const context = {
    window: { localStorage },
    console,
    Date,
    JSON,
    Math,
    Set,
    Map,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { api: context.window.LiveNewsPrefs, localStorage };
}

const tsSource = fs.readFileSync(path.join(root, "src", "lib", "personalization", "liveNewsPrefs.ts"), "utf8");
const browserSource = fs.readFileSync(path.join(root, "public", "live-news-prefs.js"), "utf8");
const localHtml = fs.readFileSync(path.join(root, "public", "local.html"), "utf8");
const localJs = fs.readFileSync(path.join(root, "public", "local.js"), "utf8");
const crawlable = fs.readFileSync(path.join(root, "lib", "local-crawlable-pages.js"), "utf8");
const docs = fs.readFileSync(path.join(root, "docs", "local-intelligence-engine.md"), "utf8");

expect(tsSource.includes('LIVE_NEWS_PREFS_KEY = "liveNews:v1:prefs"'), "TypeScript prefs module should use liveNews:v1:prefs.");
expect(browserSource.includes('const KEY = "liveNews:v1:prefs"'), "Browser prefs runtime should use liveNews:v1:prefs.");
expect(!tsSource.includes("document.cookie") && !browserSource.includes("document.cookie"), "Local preferences should not fingerprint with cookies.");
expect(!/gtag|fbq|third[- ]party|fingerprint/i.test(tsSource + browserSource), "Local preferences should not use third-party tracking or fingerprinting.");

const { api, localStorage } = loadPrefsRuntime();
const requiredFunctions = [
  "getLiveNewsPrefs",
  "saveLiveNewsPrefs",
  "clearLiveNewsPrefs",
  "setSavedCity",
  "getSavedCity",
  "followTopic",
  "unfollowTopic",
  "getFollowedTopics",
  "markCityVisited",
  "getSeenStoryIds",
  "getNewStoriesSinceLastVisit",
  "dismissPrompt",
  "shouldShowPrompt",
];
requiredFunctions.forEach((name) => {
  expect(typeof api[name] === "function", `${name} should be exported by LiveNewsPrefs.`);
});

api.clearLiveNewsPrefs();
const savedCity = api.setSavedCity({
  cityId: "los-angeles-ca",
  citySlug: "los-angeles",
  stateSlug: "california",
  label: "Los Angeles, CA",
});
expect(savedCity.cityId === "los-angeles-ca", "setSavedCity should store normalized cityId.");
expect(api.getSavedCity().label === "Los Angeles, CA", "getSavedCity should return the saved local page.");
expect(api.getLiveNewsPrefs().promptHistory.save_city.status === "accepted", "Saving a city should mark save_city as accepted.");

api.followTopic("los-angeles-ca", "Traffic");
api.followTopic("los-angeles-ca", "weather");
api.followTopic("los-angeles-ca", "traffic");
expect(api.getFollowedTopics("los-angeles-ca").join(",") === "traffic,weather", "followTopic should store unique normalized topics.");
api.unfollowTopic("los-angeles-ca", "weather");
expect(api.getFollowedTopics("los-angeles-ca").join(",") === "traffic", "unfollowTopic should remove one topic.");

api.saveLiveNewsPrefs({
  ...api.getLiveNewsPrefs(),
  lastVisitByCity: { "los-angeles-ca": "2026-05-13T09:00:00-07:00" },
  seenStoryIdsByCity: { "los-angeles-ca": ["story_1"] },
});
const newStories = api.getNewStoriesSinceLastVisit("los-angeles-ca", [
  { id: "story_1", lastUpdatedAt: "2026-05-13T11:00:00-07:00" },
  { id: "story_2", lastUpdatedAt: "2026-05-13T11:00:00-07:00" },
  { id: "story_old", lastUpdatedAt: "2026-05-12T11:00:00-07:00" },
]);
expect(newStories.length === 1 && newStories[0].id === "story_2", "getNewStoriesSinceLastVisit should return unseen updates after last visit.");
api.markCityVisited("los-angeles-ca", ["story_1", "story_2"]);
expect(api.getSeenStoryIds("los-angeles-ca").includes("story_2"), "markCityVisited should store visible story IDs.");
expect(Boolean(api.getLiveNewsPrefs().lastVisitByCity["los-angeles-ca"]), "markCityVisited should track the city last visit time.");

api.dismissPrompt("newsletter", 7);
expect(api.shouldShowPrompt("newsletter") === false, "Dismissed prompts should not show before dismissedUntil.");
api.saveLiveNewsPrefs({
  ...api.getLiveNewsPrefs(),
  promptHistory: {
    ...api.getLiveNewsPrefs().promptHistory,
    newsletter: {
      status: "dismissed",
      dismissedUntil: "2000-01-01T00:00:00.000Z",
    },
  },
});
expect(api.shouldShowPrompt("newsletter") === true, "Dismissed prompts should show again after dismissedUntil.");

api.clearLiveNewsPrefs();
expect(api.getSavedCity() === null, "clearLiveNewsPrefs should clear saved city.");
expect(!localStorage.dump()["liveNews:v1:prefs"], "clearLiveNewsPrefs should remove liveNews:v1:prefs from localStorage.");

const corruptedStorage = createLocalStorage();
corruptedStorage.setItem("liveNews:v1:prefs", "{not valid json");
const corrupted = loadPrefsRuntime(corruptedStorage).api;
expect(corrupted.getLiveNewsPrefs().savedCity === null, "Corrupted localStorage JSON should fall back to empty prefs.");

const throwingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};
const blocked = loadPrefsRuntime(throwingStorage).api;
expect(blocked.getLiveNewsPrefs().savedCity === null, "Blocked localStorage should fall back to empty prefs.");
expect(blocked.setSavedCity({ cityId: "san-diego-ca", citySlug: "san-diego", stateSlug: "california", label: "San Diego, CA" }).cityId === "san-diego-ca", "Blocked localStorage should not break explicit save attempts.");

expect(localHtml.includes("live-news-prefs.js"), "Local page should load the prefs runtime.");
expect(localHtml.includes("localPageClearPrefs"), "Local page should include a Clear local preferences control.");
expect(localJs.includes("Make ${city.label} your local page?"), "Local page should show first-city save prompt.");
expect(localJs.includes("new update${newStories.length === 1 ? \"\" : \"s\"} since your last visit"), "Local page should show returning visit update prompt.");
expect(localJs.includes("Follow ${city.label}"), "Local page should show repeated topic interest prompt.");
expect(localJs.includes("Morning Brief"), "Local page should show newsletter placeholder prompt after multiple visits.");
expect(crawlable.includes("LiveNewsPrefs.setSavedCity"), "Crawlable local pages should save city through LiveNewsPrefs.");
expect(crawlable.includes("LiveNewsPrefs.followTopic"), "Crawlable local topic pages should follow topics through LiveNewsPrefs.");
expect(crawlable.includes("data-clear-local-prefs"), "Crawlable local pages should expose clear local preferences control.");
expect(docs.includes("liveNews:v1:prefs"), "Local intelligence docs should document the prefs storage key.");
expect(docs.includes("Do not fingerprint users"), "Local intelligence docs should include anti-fingerprinting guardrail.");

if (failures.length) {
  console.error("Live News local personalization check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News local personalization check passed.");
console.log(`Preference key: ${api.key}`);
console.log(`Functions checked: ${requiredFunctions.length}`);
