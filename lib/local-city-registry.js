const fs = require("fs");
const path = require("path");
const { normalizeCity, readLocalCities, slugify } = require("./local-intelligence-models");

const DEFAULT_US_PLACES_PATH = path.join(__dirname, "..", "data", "us-places.json");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function cityIdFromParts(citySlug, stateAbbr, stateSlug) {
  return `city-${[citySlug, String(stateAbbr || stateSlug || "").toLowerCase()].filter(Boolean).join("-")}`;
}

function normalizeDirectoryCity(input = {}) {
  const name = cleanText(input.name || input.cityName || input.city || "");
  const stateAbbr = cleanText(input.state_abbr || input.stateAbbr || input.state || "").toUpperCase();
  const stateName = cleanText(input.state_name || input.stateName || "");
  const citySlug = cleanText(input.slug || input.citySlug || slugify(name));
  const stateSlug = cleanText(input.state_slug || input.stateSlug || slugify(stateName || stateAbbr));
  return {
    cityId: cleanText(input.id || input.cityId || cityIdFromParts(citySlug, stateAbbr, stateSlug)),
    cityName: name,
    citySlug,
    stateName,
    stateSlug,
    stateAbbr,
    countyName: cleanText(input.county_name || input.countyName || ""),
    timezone: cleanText(input.timezone || ""),
    latitude: input.latitude ?? input.lat ?? null,
    longitude: input.longitude ?? input.lon ?? null,
    population: input.population ?? null,
    isPopular: input.isPopular === true,
    source: input.source || "local_registry",
  };
}

function directoryCityToLocalCity(city = {}) {
  return normalizeCity({
    id: city.cityId,
    name: city.cityName,
    slug: city.citySlug,
    state_name: city.stateName,
    state_slug: city.stateSlug,
    state_abbr: city.stateAbbr,
    county_name: city.countyName,
    timezone: city.timezone,
    latitude: city.latitude,
    longitude: city.longitude,
    population: city.population,
    index_status: "watch",
  });
}

function readUsPlaces(options = {}) {
  const placesPath = options.paths?.usPlaces || DEFAULT_US_PLACES_PATH;
  const payload = readJson(placesPath, { places: [] });
  return (payload.places || []).map((place) =>
    normalizeDirectoryCity({
      ...place,
      source: "us_places",
    })
  );
}

function readSeededLocalCities(options = {}) {
  return (readLocalCities(options.paths?.localCities).cities || []).map((city) =>
    normalizeDirectoryCity({
      ...city,
      source: "local_intelligence",
    })
  );
}

function mergeCities(cities = []) {
  const byKey = new Map();
  for (const city of cities) {
    if (!city.cityName || !city.citySlug || !city.stateSlug) continue;
    const key = `${city.stateSlug}/${city.citySlug}`;
    const existing = byKey.get(key) || {};
    byKey.set(key, {
      ...city,
      ...existing,
      ...city,
      isPopular: existing.isPopular === true || city.isPopular === true,
      source: [existing.source, city.source].filter(Boolean).join(",") || city.source,
    });
  }
  return [...byKey.values()].sort((left, right) => {
    const stateSort = left.stateName.localeCompare(right.stateName);
    return stateSort || left.cityName.localeCompare(right.cityName);
  });
}

function getLocalCityDirectory(options = {}) {
  const seeded = readSeededLocalCities(options);
  const usPlaces = readUsPlaces(options);
  return mergeCities([...usPlaces, ...seeded]);
}

function getPopularLocalCities(options = {}) {
  const directory = getLocalCityDirectory(options);
  const seededKeys = new Set(readSeededLocalCities(options).map((city) => `${city.stateSlug}/${city.citySlug}`));
  const majorCityOrder = [
    "new-york/new-york",
    "california/los-angeles",
    "illinois/chicago",
    "texas/houston",
    "arizona/phoenix",
    "pennsylvania/philadelphia",
    "texas/san-antonio",
    "california/san-diego",
    "texas/dallas",
    "florida/jacksonville",
    "texas/austin",
    "texas/fort-worth",
    "california/san-jose",
    "ohio/columbus",
    "north-carolina/charlotte",
    "indiana/indianapolis",
    "california/san-francisco",
    "washington/seattle",
    "colorado/denver",
    "oklahoma/oklahoma-city",
    "tennessee/nashville",
    "texas/el-paso",
    "district-of-columbia/washington",
    "massachusetts/boston",
    "nevada/las-vegas",
    "oregon/portland",
    "michigan/detroit",
    "kentucky/louisville",
    "tennessee/memphis",
    "maryland/baltimore",
  ];
  const majorNames = new Set(majorCityOrder);
  const majorOrder = new Map(majorCityOrder.map((key, index) => [key, index]));
  return [...directory]
    .map((city) => ({
      ...city,
      isPopular: city.isPopular || seededKeys.has(`${city.stateSlug}/${city.citySlug}`) || majorNames.has(`${city.stateSlug}/${city.citySlug}`),
    }))
    .filter((city) => city.isPopular)
    .sort((left, right) => {
      const leftKey = `${left.stateSlug}/${left.citySlug}`;
      const rightKey = `${right.stateSlug}/${right.citySlug}`;
      const leftRank = majorOrder.has(leftKey) ? majorOrder.get(leftKey) : Number.MAX_SAFE_INTEGER;
      const rightRank = majorOrder.has(rightKey) ? majorOrder.get(rightKey) : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if ((right.population || 0) !== (left.population || 0)) return (right.population || 0) - (left.population || 0);
      return left.cityName.localeCompare(right.cityName);
    })
    .slice(0, 30);
}

function findDirectoryCityByRoute(stateSlug, citySlug, options = {}) {
  const stateTarget = cleanText(stateSlug).toLowerCase();
  const cityTarget = cleanText(citySlug).toLowerCase();
  return getLocalCityDirectory(options).find((city) => {
    return city.stateSlug === stateTarget && city.citySlug === cityTarget;
  }) || null;
}

module.exports = {
  directoryCityToLocalCity,
  findDirectoryCityByRoute,
  getLocalCityDirectory,
  getPopularLocalCities,
  normalizeDirectoryCity,
};
