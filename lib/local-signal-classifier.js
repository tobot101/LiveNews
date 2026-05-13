const {
  normalizeInputSignal,
  readLocalCities,
  readLocalSources,
  readSourceCityCoverage,
} = require("./local-intelligence-models");

const CLASSIFIER_VERSION = "live-news-local-signal-classifier-v1";

const LOCAL_TOPIC_RULES = [
  {
    topic: "breaking",
    label: "Breaking",
    terms: [
      "breaking",
      "just in",
      "urgent",
      "live update",
      "emergency alert",
      "evacuation order",
      "shelter in place",
      "active alert",
    ],
    urgency: "breaking",
  },
  {
    topic: "crime-public-safety",
    label: "Crime & public safety",
    terms: [
      "arrest",
      "charges",
      "crime",
      "fire",
      "missing person",
      "police",
      "public advisory",
      "recall notice",
      "safety advisory",
      "shelter in place",
      "shooting",
      "suspect",
      "evacuation",
      "official warning",
      "boil water notice",
      "emergency alert",
    ],
    sourceTypes: ["police_fire"],
    sensitive: true,
  },
  {
    topic: "traffic",
    label: "Traffic",
    terms: [
      "accident",
      "bridge",
      "collision",
      "crash",
      "detour",
      "freeway",
      "highway",
      "interstate",
      "lane closure",
      "ramp",
      "road closure",
      "traffic",
    ],
    urgency: "high",
  },
  {
    topic: "weather",
    label: "Weather",
    terms: [
      "flood",
      "forecast",
      "heat",
      "rain",
      "snow",
      "storm",
      "weather",
      "wind",
      "national weather service",
    ],
    sourceTypes: ["weather"],
  },
  {
    topic: "schools",
    label: "Schools",
    terms: [
      "campus",
      "college",
      "education",
      "school",
      "school board",
      "school district",
      "student",
      "teacher",
      "university",
    ],
    sourceTypes: ["school"],
  },
  {
    topic: "city-hall",
    label: "City Hall",
    terms: [
      "budget",
      "city council",
      "county board",
      "hearing",
      "mayor",
      "ordinance",
      "permit",
      "public meeting",
      "vote",
      "zoning",
    ],
    sourceTypes: ["official_city", "official_county"],
  },
  {
    topic: "events",
    label: "Events",
    terms: [
      "ceremony",
      "concert",
      "event",
      "fair",
      "farmers market",
      "festival",
      "parade",
      "performance",
    ],
    sourceTypes: ["event"],
  },
  {
    topic: "sports",
    label: "Sports",
    terms: [
      "coach",
      "game",
      "playoffs",
      "player",
      "season",
      "stadium",
      "team",
      "tournament",
    ],
    sourceTypes: ["sports"],
  },
  {
    topic: "local-economy",
    label: "Local economy",
    terms: [
      "business",
      "company",
      "development",
      "downtown",
      "jobs",
      "restaurant",
      "store",
      "unemployment",
      "wages",
      "workers",
    ],
  },
  {
    topic: "health",
    label: "Health",
    terms: [
      "clinic",
      "disease",
      "health",
      "hospital",
      "medical",
      "patient",
      "public health",
      "vaccine",
    ],
  },
  {
    topic: "transit",
    label: "Transit",
    terms: [
      "airport",
      "bus",
      "rail",
      "route",
      "service change",
      "station",
      "train",
      "transit",
      "trolley",
    ],
    sourceTypes: ["transit"],
  },
  {
    topic: "housing",
    label: "Housing",
    terms: [
      "apartment",
      "homelessness",
      "homes",
      "housing",
      "mortgage",
      "rent",
      "renters",
      "shelter",
      "tenant",
    ],
  },
  {
    topic: "courts",
    label: "Courts",
    terms: [
      "attorney",
      "court",
      "judge",
      "lawsuit",
      "ruling",
      "sentencing",
      "trial",
      "verdict",
    ],
    sensitive: true,
  },
  {
    topic: "community",
    label: "Community",
    terms: [
      "charity",
      "community",
      "library",
      "neighborhood",
      "nonprofit",
      "park",
      "residents",
      "volunteer",
    ],
    sourceTypes: ["community"],
  },
];

const HIGH_URGENCY_TERMS = [
  "active alert",
  "boil water notice",
  "emergency alert",
  "evacuation",
  "missing person",
  "official warning",
  "recall notice",
  "road closure",
  "safety advisory",
  "shelter in place",
  "wildfire",
];

const LOW_URGENCY_TERMS = [
  "calendar",
  "ceremony",
  "community event",
  "farmers market",
  "preview",
  "registration opens",
  "weekend event",
];

const TRUST_CONFIDENCE = {
  official: 95,
  established_publisher: 82,
  community: 64,
  blog: 48,
  unknown: 36,
};

const COVERAGE_BOOSTS = {
  primary: 16,
  nearby: 9,
  statewide: 7,
  regional: 6,
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value) {
  return ` ${cleanText(value).toLowerCase().replace(/[^a-z0-9+.-]+/g, " ")} `;
}

function compact(value) {
  return cleanText(value).toLowerCase();
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function unique(values = []) {
  return [...new Set((values || []).map(cleanText).filter(Boolean))];
}

function hasPhrase(text, phrase) {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(phrase).trim();
  if (!needle) return false;
  return haystack.includes(` ${needle} `);
}

function textForSignal(signal = {}) {
  return [
    signal.title,
    signal.excerpt,
    signal.author,
    signal.canonical_url,
    signal.original_url,
    signal.raw_source_type,
  ].filter(Boolean).join(" ");
}

function getSource(signal = {}, sources = []) {
  const sourceId = cleanText(signal.source_id);
  return (sources || []).find((source) => source.id === sourceId || source.slug === sourceId) || null;
}

function sourceText(source = {}) {
  return [source.name, source.slug, source.homepage_url, source.source_type].filter(Boolean).join(" ");
}

function getSignalSourceType(signal = {}, sources = []) {
  const source = getSource(signal, sources);
  return cleanText(source?.source_type || "other");
}

function getSignalLatLon(signal = {}) {
  const entities = signal.entities_json || {};
  const candidates = [
    entities,
    entities.location || {},
    entities.coordinates || {},
    entities.geo || {},
  ];
  for (const candidate of candidates) {
    const lat = Number(candidate.latitude ?? candidate.lat);
    const lon = Number(candidate.longitude ?? candidate.lng ?? candidate.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { latitude: lat, longitude: lon };
  }
  return null;
}

function distanceMiles(a, b) {
  if (!a || !b) return Infinity;
  const lat1 = Number(a.latitude);
  const lon1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  return 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

function addCandidateScore(map, city = {}, score, reason) {
  if (!city || !city.id || score <= 0) return;
  const existing = map.get(city.id) || {
    city_id: city.id,
    name: city.name,
    slug: city.slug,
    state_abbr: city.state_abbr,
    state_name: city.state_name,
    county_name: city.county_name,
    confidence: 0,
    reasons: [],
  };
  existing.confidence = clamp(Math.max(existing.confidence, score));
  if (reason) existing.reasons.push(reason);
  map.set(city.id, existing);
}

function boostCandidate(map, cityId, boost, reason) {
  const candidate = map.get(cityId);
  if (!candidate) return;
  candidate.confidence = clamp(candidate.confidence + boost);
  if (reason) candidate.reasons.push(reason);
}

function classifyCityCandidates(signalInput = {}, citiesInput = [], coverageInput = [], options = {}) {
  const signal = normalizeInputSignal(signalInput);
  const cities = citiesInput.length ? citiesInput : readLocalCities(options.paths?.localCities).cities;
  const coverage = coverageInput.length ? coverageInput : readSourceCityCoverage(options.paths?.sourceCityCoverage).source_city_coverage;
  const source = options.source || getSource(signal, options.sources || []);
  const text = textForSignal(signal);
  const sourceCombinedText = sourceText(source || {});
  const latLon = getSignalLatLon(signal);
  const candidateMap = new Map();

  for (const existing of signal.city_candidates_json || []) {
    const city = cities.find((item) => item.id === existing.city_id || item.slug === existing.slug);
    if (city) addCandidateScore(candidateMap, city, Number(existing.confidence || 60), "existing city candidate on signal");
  }

  for (const row of coverage || []) {
    if (row.source_id !== signal.source_id) continue;
    const city = cities.find((item) => item.id === row.city_id);
    if (!city) continue;
    addCandidateScore(candidateMap, city, Number(row.confidence || 0), `source_city_coverage ${row.coverage_type}`);
    if (source && ["official_city", "official_county"].includes(source.source_type)) {
      boostCandidate(candidateMap, city.id, COVERAGE_BOOSTS[row.coverage_type] || 6, "official source mapping");
    }
  }

  for (const city of cities || []) {
    if (!city.name) continue;
    if (hasPhrase(text, city.name)) {
      addCandidateScore(candidateMap, city, 82, "city name found in title or excerpt");
      if (city.state_abbr && hasPhrase(text, city.state_abbr)) boostCandidate(candidateMap, city.id, 7, "state abbreviation found");
      if (city.state_name && hasPhrase(text, city.state_name)) boostCandidate(candidateMap, city.id, 7, "state name found");
    }
    if (city.county_name && hasPhrase(text, city.county_name)) {
      addCandidateScore(candidateMap, city, 66, "county reference found in title or excerpt");
    }
    for (const neighborhood of city.neighborhoods || []) {
      if (hasPhrase(text, neighborhood)) {
        addCandidateScore(candidateMap, city, 72, `neighborhood reference found: ${neighborhood}`);
      }
    }
    if (sourceCombinedText && hasPhrase(sourceCombinedText, city.name)) {
      addCandidateScore(candidateMap, city, source?.source_type?.startsWith("official") ? 78 : 58, "source name or homepage references city");
    }
    if (latLon && Number.isFinite(city.latitude) && Number.isFinite(city.longitude)) {
      const miles = distanceMiles(latLon, city);
      if (miles <= 25) addCandidateScore(candidateMap, city, 86, "source latitude/longitude near city center");
      else if (miles <= 50) addCandidateScore(candidateMap, city, 72, "source latitude/longitude near city region");
      else if (miles <= 100) addCandidateScore(candidateMap, city, 55, "source latitude/longitude in broader regional range");
    }
  }

  return [...candidateMap.values()]
    .map((candidate) => ({
      ...candidate,
      confidence: clamp(candidate.confidence),
      reasons: unique(candidate.reasons),
    }))
    .filter((candidate) => candidate.confidence >= 35)
    .sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name));
}

function scoreTopicRule(rule, signal = {}, sourceType = "other") {
  const text = textForSignal(signal);
  const matches = [];
  for (const term of rule.terms || []) {
    if (hasPhrase(text, term)) matches.push(term);
  }
  let confidence = matches.length ? Math.min(82, 34 + matches.length * 12) : 0;
  const reasons = matches.map((term) => `matched "${term}"`);
  if ((rule.sourceTypes || []).includes(sourceType)) {
    confidence = Math.max(confidence, 58);
    reasons.push(`source type ${sourceType}`);
  }
  return {
    topic: rule.topic,
    label: rule.label,
    confidence: clamp(confidence),
    reasons: unique(reasons),
    sensitive: Boolean(rule.sensitive),
    urgency_hint: rule.urgency || "",
  };
}

function classifyTopicCandidates(signalInput = {}, options = {}) {
  const signal = normalizeInputSignal(signalInput);
  const sourceType = options.sourceType || getSignalSourceType(signal, options.sources || []);
  const topicMap = new Map();

  for (const existing of signal.topic_candidates_json || []) {
    const topic = cleanText(existing.topic || existing.id);
    if (!topic) continue;
    topicMap.set(topic, {
      topic,
      label: cleanText(existing.label || topic),
      confidence: clamp(existing.confidence || 45),
      reasons: unique([...(existing.reasons || []), "existing topic candidate on signal"]),
      sensitive: Boolean(existing.sensitive),
      urgency_hint: existing.urgency_hint || "",
    });
  }

  for (const rule of LOCAL_TOPIC_RULES) {
    const scored = scoreTopicRule(rule, signal, sourceType);
    if (scored.confidence < 20) continue;
    const existing = topicMap.get(scored.topic);
    if (!existing || scored.confidence > existing.confidence) {
      topicMap.set(scored.topic, scored);
    } else {
      existing.reasons = unique([...existing.reasons, ...scored.reasons]);
    }
  }

  if (!topicMap.size) {
    topicMap.set("community", {
      topic: "community",
      label: "Community",
      confidence: 30,
      reasons: ["fallback local topic until stronger local signal is available"],
      sensitive: false,
      urgency_hint: "",
    });
  }

  return [...topicMap.values()]
    .map((candidate) => ({
      ...candidate,
      confidence: clamp(candidate.confidence),
      reasons: unique(candidate.reasons),
    }))
    .sort((left, right) => right.confidence - left.confidence || left.topic.localeCompare(right.topic));
}

function classifyUrgency(signalInput = {}, topicCandidates = []) {
  const signal = normalizeInputSignal(signalInput);
  const text = textForSignal(signal);
  const reasons = [];
  if (topicCandidates.some((topic) => topic.topic === "breaking" || topic.urgency_hint === "breaking")) {
    reasons.push("breaking topic signal");
    return { urgency: "breaking", reasons };
  }
  for (const term of HIGH_URGENCY_TERMS) {
    if (hasPhrase(text, term)) reasons.push(`urgent phrase "${term}"`);
  }
  if (reasons.length) return { urgency: "high", reasons: unique(reasons) };
  if (topicCandidates.some((topic) => topic.urgency_hint === "high")) {
    return { urgency: "high", reasons: ["high-urgency topic signal"] };
  }
  const lowReasons = LOW_URGENCY_TERMS.filter((term) => hasPhrase(text, term)).map((term) => `low urgency phrase "${term}"`);
  if (lowReasons.length) return { urgency: "low", reasons: unique(lowReasons) };
  return { urgency: "normal", reasons: ["no urgent local signal terms found"] };
}

function extractCapitalizedPhrases(text, allowedSuffixes = []) {
  const phrases = cleanText(text).match(/\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5}\b/g) || [];
  return unique(phrases.filter((phrase) => (
    allowedSuffixes.length
      ? allowedSuffixes.some((suffix) => compact(phrase).includes(compact(suffix)))
      : phrase.length > 2
  )));
}

function extractLocalEntities(signalInput = {}, options = {}) {
  const signal = normalizeInputSignal(signalInput);
  const text = textForSignal(signal);
  const cities = options.cities || [];
  const places = [];
  const counties = [];
  for (const city of cities) {
    if (hasPhrase(text, city.name)) places.push(city.name);
    if (city.county_name && hasPhrase(text, city.county_name)) counties.push(city.county_name);
  }
  const roads = unique(cleanText(text).match(/\b(?:I|US|SR|CA|Route|Highway|Interstate)\s?-?\s?\d{1,4}\b/gi) || []);
  const schools = extractCapitalizedPhrases(text, ["School", "College", "University", "Campus", "District"]);
  const agencies = extractCapitalizedPhrases(text, ["Police", "Fire", "Transit", "Council", "County", "City", "Department", "Authority"]);
  const organizations = unique([
    ...(signal.entities_json?.organizations || []),
    ...extractCapitalizedPhrases(text, ["Hospital", "Library", "Foundation", "Center", "Association", "District"]),
    ...agencies,
  ]);
  const people = unique(signal.entities_json?.people || []);
  const latLon = getSignalLatLon(signal);
  return {
    people,
    organizations,
    places: unique([...(signal.entities_json?.places || []), ...places]),
    counties: unique(counties),
    neighborhoods: unique(signal.entities_json?.neighborhoods || []),
    roads,
    schools,
    agencies,
    coordinates: latLon,
  };
}

function getClassificationConfidence(classification = {}, source = {}) {
  const cityScore = Math.max(0, ...(classification.cityCandidates || []).map((candidate) => Number(candidate.confidence || 0)));
  const topicScore = Math.max(0, ...(classification.topicCandidates || []).map((candidate) => Number(candidate.confidence || 0)));
  const trustScore = TRUST_CONFIDENCE[source?.trust_level] || TRUST_CONFIDENCE.unknown;
  const signal = classification.signal || {};
  const completeness = [
    signal.title,
    signal.canonical_url,
    signal.published_at,
    signal.excerpt,
  ].filter(Boolean).length / 4 * 100;
  return clamp(Math.round(cityScore * 0.35 + topicScore * 0.35 + trustScore * 0.2 + completeness * 0.1));
}

function classifyInputSignal(signalInput = {}, options = {}) {
  const signal = normalizeInputSignal(signalInput);
  const cities = options.cities || readLocalCities(options.paths?.localCities).cities;
  const sources = options.sources || readLocalSources(options.paths?.localSources).local_sources;
  const sourceCityCoverage = options.sourceCityCoverage || readSourceCityCoverage(options.paths?.sourceCityCoverage).source_city_coverage;
  const source = getSource(signal, sources);
  const sourceType = getSignalSourceType(signal, sources);
  const cityCandidates = classifyCityCandidates(signal, cities, sourceCityCoverage, { ...options, sources, source });
  const topicCandidates = classifyTopicCandidates(signal, { ...options, sourceType, sources });
  const urgencyResult = classifyUrgency(signal, topicCandidates);
  const localEntities = extractLocalEntities(signal, { ...options, cities, source });
  const baseClassification = {
    classifierVersion: CLASSIFIER_VERSION,
    signalId: signal.id,
    signal,
    cityCandidates,
    topicCandidates,
    urgency: urgencyResult.urgency,
    urgencyReasons: urgencyResult.reasons,
    sourceType,
    sourceTrustLevel: source?.trust_level || "unknown",
    confidence: 0,
    localEntities,
    extensionPoint: {
      aiClassifier: typeof options.aiClassifier === "function" ? "available_not_required" : "not_configured",
    },
  };
  baseClassification.confidence = getClassificationConfidence(baseClassification, source);
  baseClassification.status = baseClassification.confidence >= 45 ? "classified" : "classified_low_confidence";
  return baseClassification;
}

function applySignalClassification(signalInput = {}, classificationInput = {}) {
  const signal = normalizeInputSignal(signalInput);
  const classification = classificationInput.signalId ? classificationInput : classifyInputSignal(signal);
  return normalizeInputSignal({
    ...signal,
    city_candidates_json: classification.cityCandidates || [],
    topic_candidates_json: classification.topicCandidates || [],
    entities_json: {
      ...(signal.entities_json || {}),
      local_entities: classification.localEntities || {},
      localClassification: {
        classifierVersion: classification.classifierVersion || CLASSIFIER_VERSION,
        urgency: classification.urgency,
        urgencyReasons: classification.urgencyReasons || [],
        source_type: classification.sourceType || "other",
        source_trust_level: classification.sourceTrustLevel || "unknown",
        confidence: classification.confidence || 0,
        status: classification.status || "classified",
      },
    },
    signal_status: "classified",
  });
}

function classifyInputSignals(signals = [], options = {}) {
  const cities = options.cities || readLocalCities(options.paths?.localCities).cities;
  const sources = options.sources || readLocalSources(options.paths?.localSources).local_sources;
  const sourceCityCoverage = options.sourceCityCoverage || readSourceCityCoverage(options.paths?.sourceCityCoverage).source_city_coverage;
  return (signals || []).map((signal) => {
    const classification = classifyInputSignal(signal, { ...options, cities, sources, sourceCityCoverage });
    return {
      classification,
      signal: applySignalClassification(signal, classification),
    };
  });
}

function createLocalSignalClassifierService(options = {}) {
  return {
    classifyInputSignal: (signal, callOptions = {}) => classifyInputSignal(signal, { ...options, ...callOptions }),
    classifyInputSignals: (signals, callOptions = {}) => classifyInputSignals(signals, { ...options, ...callOptions }),
    classifyCityCandidates: (signal, cities, coverage, callOptions = {}) => classifyCityCandidates(signal, cities, coverage, { ...options, ...callOptions }),
    classifyTopicCandidates: (signal, callOptions = {}) => classifyTopicCandidates(signal, { ...options, ...callOptions }),
    applySignalClassification,
  };
}

module.exports = {
  CLASSIFIER_VERSION,
  LOCAL_TOPIC_RULES,
  applySignalClassification,
  classifyCityCandidates,
  classifyInputSignal,
  classifyInputSignals,
  classifyTopicCandidates,
  classifyUrgency,
  createLocalSignalClassifierService,
  extractLocalEntities,
  getClassificationConfidence,
  getSignalSourceType,
};
