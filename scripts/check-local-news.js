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
const localJs = fs.readFileSync(path.join(root, "public", "local.js"), "utf8");

expect(serverJs.includes("resolveLocalRequestPlace"), "Server local API should resolve typed city/state input.");
expect(serverJs.includes("localHealthStats"), "Server health should include local-news stability diagnostics.");
expect(appJs.includes("syncResolvedLocalPlace(data.place)"), "Homepage local preview should accept canonical server place data.");
expect(localJs.includes("syncResolvedPlace(data.place)"), "Dedicated local page should accept canonical server place data.");
expect(localJs.includes("buildManualPlace(value)"), "Dedicated local page should parse manual city input before fetching.");

if (failures.length) {
  console.error("Live News local-news check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live News local-news check passed.");
console.log(`Places indexed: ${placesIndex.length}`);
console.log(`San Diego variants checked: ${variants.length}`);
