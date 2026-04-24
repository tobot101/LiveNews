const US_STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const STATE_CODE_BY_NAME = new Map(
  Object.entries(US_STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStateCode(value) {
  const cleaned = normalizeText(value).replace(/\./g, "");
  if (!cleaned) return "";
  const upper = cleaned.toUpperCase();
  if (US_STATE_NAMES[upper]) return upper;
  return STATE_CODE_BY_NAME.get(cleaned.toLowerCase()) || "";
}

function getStateName(code, stateNameLookup) {
  const normalized = normalizeStateCode(code);
  if (!normalized) return "";
  if (stateNameLookup instanceof Map && stateNameLookup.get(normalized)) {
    return stateNameLookup.get(normalized);
  }
  return US_STATE_NAMES[normalized] || "";
}

function stripTrailingStateFromCity(city, stateCode) {
  const normalizedCity = normalizeText(city).replace(/\s*,\s*$/g, "");
  const stateName = getStateName(stateCode);
  if (stateName && normalizedCity.toLowerCase() === stateName.toLowerCase()) {
    return normalizedCity;
  }
  const statePattern = [stateCode, stateName]
    .filter(Boolean)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!statePattern) return normalizedCity;
  return normalizedCity
    .replace(new RegExp(`\\s*,?\\s*(${statePattern})$`, "i"), "")
    .replace(/\s*,\s*$/g, "")
    .trim();
}

function parseLocalPlaceInput(cityValue, stateValue = "") {
  const rawCity = normalizeText(cityValue)
    .replace(/\s*,\s*(usa|u\.s\.a\.|united states)$/i, "")
    .trim();
  const explicitState = normalizeStateCode(stateValue);
  if (!rawCity) {
    return {
      name: "",
      display: "",
      state: explicitState,
      stateName: getStateName(explicitState),
      geoid: "",
    };
  }

  if (explicitState) {
    const name = stripTrailingStateFromCity(rawCity, explicitState);
    return {
      name,
      display: name ? `${name}, ${explicitState}` : explicitState,
      state: explicitState,
      stateName: getStateName(explicitState),
      geoid: "",
    };
  }

  const commaParts = rawCity.split(",").map((part) => normalizeText(part)).filter(Boolean);
  if (commaParts.length > 1) {
    const possibleState = normalizeStateCode(commaParts[commaParts.length - 1]);
    if (possibleState) {
      const name = commaParts.slice(0, -1).join(", ");
      return {
        name,
        display: `${name}, ${possibleState}`,
        state: possibleState,
        stateName: getStateName(possibleState),
        geoid: "",
      };
    }
  }

  const stateNamePattern = Object.values(US_STATE_NAMES)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const trailingStateMatch = rawCity.match(
    new RegExp(`^(.*?)\\s+(${stateNamePattern}|[A-Za-z]{2})$`, "i")
  );
  if (trailingStateMatch) {
    const possibleState = normalizeStateCode(trailingStateMatch[2]);
    const name = normalizeText(trailingStateMatch[1]);
    if (name && possibleState) {
      return {
        name,
        display: `${name}, ${possibleState}`,
        state: possibleState,
        stateName: getStateName(possibleState),
        geoid: "",
      };
    }
  }

  return {
    name: rawCity,
    display: rawCity,
    state: "",
    stateName: "",
    geoid: "",
  };
}

function stripSearchField(place) {
  if (!place) return null;
  const { search, ...rest } = place;
  return rest;
}

function resolveLocalPlaceInput({ city, state, placesIndex = [], stateNameByCode = new Map() }) {
  const parsed = parseLocalPlaceInput(city, state);
  if (!parsed.name) return parsed;
  const targetName = parsed.name.toLowerCase();
  const targetState = parsed.state;
  const targetDisplay = parsed.display.toLowerCase();

  const exactDisplay = placesIndex.find((place) => {
    const display = String(place.display || `${place.name}, ${place.state}`).toLowerCase();
    return display === targetDisplay;
  });
  if (exactDisplay) return stripSearchField(exactDisplay);

  const exactNameAndState = placesIndex.find((place) => {
    return (
      String(place.name || "").toLowerCase() === targetName &&
      (!targetState || String(place.state || "").toUpperCase() === targetState)
    );
  });
  if (exactNameAndState) return stripSearchField(exactNameAndState);

  return {
    ...parsed,
    stateName: parsed.stateName || getStateName(parsed.state, stateNameByCode),
    display: parsed.state ? `${parsed.name}, ${parsed.state}` : parsed.display,
  };
}

function buildLocalQueryVariants(city, state, stateNameLookup) {
  const parsed = parseLocalPlaceInput(city, state);
  const cleanedCity = parsed.name;
  const cleanedState = parsed.state || normalizeStateCode(state);
  if (!cleanedCity) return [];
  const stateName = getStateName(cleanedState, stateNameLookup);
  const baseVariants = [
    [cleanedCity, cleanedState].filter(Boolean).join(" "),
    [cleanedCity, cleanedState, "local news"].filter(Boolean).join(" "),
    [cleanedCity, stateName, "local news"].filter(Boolean).join(" "),
    `"${cleanedCity}" ${cleanedState}`.trim(),
    `"${cleanedCity}" ${stateName}`.trim(),
  ].map((value) => value.trim()).filter(Boolean);
  const withRecency = baseVariants.slice(0, 4).map((value) => `${value} when:2d`);
  return Array.from(new Set([...baseVariants, ...withRecency]));
}

module.exports = {
  US_STATE_NAMES,
  buildLocalQueryVariants,
  getStateName,
  normalizeStateCode,
  parseLocalPlaceInput,
  resolveLocalPlaceInput,
};
