const {
  readInputSignals,
  readLocalCities,
  readLocalSources,
  readSourceCityCoverage,
  readStoryClusterSignals,
  slugify,
} = require("./local-intelligence-models");
const {
  findStoryClusterBySlug,
  getExpiredStoryClusterResponse,
  getLiveStoriesForCity,
  getLiveStoriesForTopic,
  getRegularSitemapStoryClusters,
} = require("./local-story-expiration");
const { getLocalIntelligenceConfig } = require("./local-intelligence-config");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function topicLabel(topic) {
  return cleanText(topic || "local")
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function localStatePath(city = {}) {
  return `/local/${encodeURIComponent(city.state_slug || slugify(city.state_name || city.state_abbr || ""))}`;
}

function localCityPath(city = {}) {
  return `${localStatePath(city)}/${encodeURIComponent(city.slug)}`;
}

function localTopicPath(city = {}, topic = "") {
  return `${localCityPath(city)}/${encodeURIComponent(slugify(topic) || "local")}`;
}

function localStoryPath(city = {}, cluster = {}) {
  return `${localCityPath(city)}/story/${encodeURIComponent(cluster.slug)}`;
}

function absoluteLocalUrl(pathname = "") {
  const baseUrl = getLocalIntelligenceConfig().baseUrl.replace(/\/+$/, "");
  const path = String(pathname || "/").startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${path}`;
}

function readContext(options = {}) {
  const paths = options.paths || {};
  return {
    cities: readLocalCities(paths.localCities).cities || [],
    localSources: readLocalSources(paths.localSources).local_sources || [],
    sourceCityCoverage: readSourceCityCoverage(paths.sourceCityCoverage).source_city_coverage || [],
    storyClusterSignals: readStoryClusterSignals(paths.storyClusterSignals).story_cluster_signals || [],
    inputSignals: readInputSignals(paths.inputSignals).input_signals || [],
  };
}

function findCityByRoute(stateSlug, citySlug, options = {}) {
  const context = readContext(options);
  const stateTarget = cleanText(stateSlug).toLowerCase();
  const cityTarget = cleanText(citySlug).toLowerCase();
  return (
    context.cities.find((city) => {
      const stateMatches =
        cleanText(city.state_slug).toLowerCase() === stateTarget ||
        cleanText(city.state_abbr).toLowerCase() === stateTarget ||
        slugify(city.state_name) === stateTarget;
      return stateMatches && cleanText(city.slug).toLowerCase() === cityTarget;
    }) || null
  );
}

function findStateCities(stateSlug, options = {}) {
  const context = readContext(options);
  const stateTarget = cleanText(stateSlug).toLowerCase();
  return context.cities.filter((city) => {
    return (
      cleanText(city.state_slug).toLowerCase() === stateTarget ||
      cleanText(city.state_abbr).toLowerCase() === stateTarget ||
      slugify(city.state_name) === stateTarget
    );
  });
}

function sortClusters(clusters = []) {
  return [...clusters].sort((left, right) => {
    return new Date(right.last_updated_at || right.public_started_at || 0) -
      new Date(left.last_updated_at || left.public_started_at || 0);
  });
}

function getClusterSignals(cluster = {}, context = {}) {
  const links = (context.storyClusterSignals || []).filter((link) => link.story_cluster_id === cluster.id);
  const signalById = new Map((context.inputSignals || []).map((signal) => [signal.id, signal]));
  const sourceById = new Map((context.localSources || []).map((source) => [source.id, source]));
  return links
    .map((link) => {
      const signal = signalById.get(link.input_signal_id) || {};
      const source = sourceById.get(link.source_id || signal.source_id) || {};
      return {
        sourceId: source.id || link.source_id || signal.source_id || "",
        sourceName: source.name || signal.author || signal.raw_source_type || "Original source",
        sourceType: source.source_type || signal.raw_source_type || "other",
        trustLevel: source.trust_level || "unknown",
        url: signal.canonical_url || signal.original_url || source.homepage_url || "",
        title: signal.title || "",
        publishedAt: signal.published_at || signal.discovered_at || "",
        isPrimary: link.is_primary === true,
      };
    })
    .filter((source) => source.sourceId || source.url || source.sourceName);
}

function getSourceMix(clusters = [], context = {}) {
  const counts = new Map();
  for (const cluster of clusters) {
    for (const source of getClusterSignals(cluster, context)) {
      const key = source.sourceName || source.sourceId || "Original source";
      const entry = counts.get(key) || {
        name: key,
        sourceType: source.sourceType,
        trustLevel: source.trustLevel,
        count: 0,
      };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function getCitySourceDirectory(city = {}, context = {}) {
  const coverageRows = (context.sourceCityCoverage || []).filter((row) => row.city_id === city.id);
  const sourceById = new Map((context.localSources || []).map((source) => [source.id, source]));
  return coverageRows
    .map((row) => {
      const source = sourceById.get(row.source_id);
      if (!source) return null;
      return {
        ...source,
        confidence: row.confidence,
        coverageType: row.coverage_type,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const officialSort = Number(right.trust_level === "official") - Number(left.trust_level === "official");
      return officialSort || Number(right.confidence || 0) - Number(left.confidence || 0);
    });
}

function getNearbyCities(city = {}, context = {}) {
  return (context.cities || [])
    .filter((candidate) => candidate.id !== city.id && candidate.state_abbr === city.state_abbr)
    .slice(0, 8);
}

function getLastUpdated(clusters = []) {
  const timestamps = clusters
    .map((cluster) => cluster.last_updated_at || cluster.public_started_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!timestamps.length) return new Date().toISOString();
  return new Date(Math.max(...timestamps)).toISOString();
}

function getPageRobots({ clusters = [], sourceMix = [], forceNoindex = false } = {}) {
  if (forceNoindex || clusters.length < 2 || sourceMix.length < 2) return "noindex, follow";
  return "index, follow";
}

function clusterCard(cluster = {}, city = {}, options = {}) {
  const sources = options.sources || [];
  const sourceText = sources.length
    ? sources.slice(0, 2).map((source) => source.sourceName).join(", ")
    : `${cluster.source_count || 1} source${Number(cluster.source_count || 1) === 1 ? "" : "s"}`;
  return `<article class="local-crawl-card">
    <div class="local-crawl-card-meta">
      <span>${escapeHtml(topicLabel(cluster.primary_topic))}</span>
      <span>${escapeHtml(cluster.confidence_label || "developing")}</span>
    </div>
    <h3><a href="${escapeHtml(localStoryPath(city, cluster))}">${escapeHtml(cluster.headline)}</a></h3>
    <p>${escapeHtml(cluster.summary || "Live News is tracking this current local story cluster from source-linked public signals.")}</p>
    <div class="local-crawl-card-footer">
      <span>${escapeHtml(sourceText)}</span>
      <span>Updated ${escapeHtml(formatDateTime(cluster.last_updated_at || cluster.public_started_at))}</span>
    </div>
  </article>`;
}

function sourceList(sources = [], { officialOnly = false } = {}) {
  const rows = (officialOnly ? sources.filter((source) => source.trust_level === "official") : sources).slice(0, 12);
  if (!rows.length) return `<p class="local-crawl-muted">No eligible sources are mapped yet.</p>`;
  return `<div class="local-source-directory">${rows.map((source) => `
    <a class="local-source-row" href="${escapeHtml(source.homepage_url || "#")}" ${source.homepage_url ? 'target="_blank" rel="noopener noreferrer"' : ""}>
      <strong>${escapeHtml(source.name)}</strong>
      <span>${escapeHtml(source.source_type)} • ${escapeHtml(source.trust_level)} • ${escapeHtml(source.coverageType || "mapped")}</span>
    </a>`).join("")}</div>`;
}

function topicModules(clusters = [], city = {}) {
  const grouped = new Map();
  for (const cluster of clusters) {
    const topic = cleanText(cluster.primary_topic || "community");
    const entry = grouped.get(topic) || { topic, count: 0, confidence: new Set() };
    entry.count += 1;
    entry.confidence.add(cluster.confidence_label);
    grouped.set(topic, entry);
  }
  if (!grouped.size) return `<p class="local-crawl-muted">No live topic modules are available yet.</p>`;
  return `<div class="local-topic-grid">${[...grouped.values()].map((entry) => `
    <a class="local-topic-module" href="${escapeHtml(localTopicPath(city, entry.topic))}">
      <strong>${escapeHtml(topicLabel(entry.topic))}</strong>
      <span>${entry.count} live cluster${entry.count === 1 ? "" : "s"}</span>
      <small>${escapeHtml([...entry.confidence].join(", "))}</small>
    </a>`).join("")}</div>`;
}

function pageShell({ title, description, canonicalPath, robots, body, structuredData = [] }) {
  const canonicalUrl = absoluteLocalUrl(canonicalPath);
  return `<!doctype html>
<html lang="en" data-theme="day">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="${escapeHtml(robots)}" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <link rel="stylesheet" href="/styles.css" />
  ${structuredData.map((schema) => `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`).join("\n  ")}
</head>
<body class="local-theme">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Live News home">
      <img class="brand-mark" src="/brand-mark.png" alt="" aria-hidden="true" />
      <div class="brand-text">
        <div class="brand-title">Live News</div>
        <div class="brand-sub">Anytime &amp; Anywhere</div>
      </div>
    </a>
  </header>
  <main class="local-crawl-page">
    ${body}
  </main>
  <footer class="footer">
    <div>Live News • Local Intelligence</div>
    <div class="footer-note">Source-linked local coverage from public signals. Full reporting remains with original publishers.</div>
  </footer>
  <script src="/live-news-prefs.js?v=20260513-local-prefs"></script>
  <script>
    document.addEventListener("click", function(event) {
      var saveCity = event.target.closest("[data-save-city]");
      if (saveCity && window.LiveNewsPrefs) {
        try { window.LiveNewsPrefs.setSavedCity(JSON.parse(saveCity.getAttribute("data-save-city") || "{}")); } catch (error) {}
        saveCity.textContent = "City saved";
      }
      var followTopic = event.target.closest("[data-follow-topic]");
      if (followTopic && window.LiveNewsPrefs) {
        try {
          var topic = followTopic.getAttribute("data-follow-topic");
          var cityId = followTopic.getAttribute("data-city-id");
          if (topic && cityId) window.LiveNewsPrefs.followTopic(cityId, topic);
        } catch (error) {}
        followTopic.textContent = "Topic followed";
      }
      var clearPrefs = event.target.closest("[data-clear-local-prefs]");
      if (clearPrefs && window.LiveNewsPrefs) {
        window.LiveNewsPrefs.clearLiveNewsPrefs();
        clearPrefs.textContent = "Preferences cleared";
      }
    });
  </script>
</body>
</html>`;
}

function renderLocalStatePage(stateSlug, options = {}) {
  const cities = findStateCities(stateSlug, options);
  if (!cities.length) return null;
  const context = readContext(options);
  const stateName = cities[0].state_name || cities[0].state_abbr;
  const citySummaries = cities.map((city) => {
    const clusters = getLiveStoriesForCity(city.id, options);
    return { city, clusters, sourceMix: getSourceMix(clusters, context) };
  });
  const liveCount = citySummaries.reduce((sum, item) => sum + item.clusters.length, 0);
  const robots = liveCount >= 3 ? "index, follow" : "noindex, follow";
  const body = `<section class="panel local-crawl-hero">
    <p class="story-kicker">Local News</p>
    <h1>${escapeHtml(stateName)} Local News</h1>
    <p class="panel-note">Browse crawlable Live News city pages with current public coverage from the last 7 days.</p>
    <p class="local-crawl-muted">Last updated ${escapeHtml(formatDateTime(getLastUpdated(citySummaries.flatMap((item) => item.clusters))))}</p>
  </section>
  <section class="panel">
    <h2>Cities</h2>
    <div class="local-topic-grid">${citySummaries.map(({ city, clusters }) => `
      <a class="local-topic-module" href="${escapeHtml(localCityPath(city))}">
        <strong>${escapeHtml(city.name)}, ${escapeHtml(city.state_abbr)}</strong>
        <span>${clusters.length} live cluster${clusters.length === 1 ? "" : "s"}</span>
        <small>Live updates from the last 7 days</small>
      </a>`).join("")}</div>
  </section>`;
  return {
    status: 200,
    robots,
    html: pageShell({
      title: `${stateName} Local News | Live News`,
      description: `Browse current ${stateName} local news pages from Live News, with source-linked public coverage from the last 7 days.`,
      canonicalPath: localStatePath(cities[0]),
      robots,
      body,
    }),
  };
}

function renderLocalCityPage(stateSlug, citySlug, options = {}) {
  const city = findCityByRoute(stateSlug, citySlug, options);
  if (!city) return null;
  const context = readContext(options);
  const clusters = sortClusters(getLiveStoriesForCity(city.id, options));
  const sourceMix = getSourceMix(clusters, context);
  const sourceDirectory = getCitySourceDirectory(city, context);
  const robots = getPageRobots({ clusters, sourceMix });
  const changedToday = clusters.filter((cluster) => {
    const time = new Date(cluster.last_updated_at || cluster.public_started_at || 0).getTime();
    return Number.isFinite(time) && Date.now() - time <= 24 * 60 * 60 * 1000;
  });
  const topClusters = clusters.slice(0, 6);
  const nearby = getNearbyCities(city, context);
  const body = `<section class="panel local-crawl-hero">
    <p class="story-kicker">Local News</p>
    <h1>${escapeHtml(city.name)}, ${escapeHtml(city.state_abbr)}</h1>
    <p class="panel-note">Live updates from the last 7 days</p>
    <p class="local-crawl-muted">Last updated ${escapeHtml(formatDateTime(getLastUpdated(clusters)))}</p>
    <div class="local-pulse-grid" aria-label="Local Pulse">
      <div><strong>${clusters.length}</strong><span>live clusters</span></div>
      <div><strong>${sourceMix.length}</strong><span>sources in mix</span></div>
      <div><strong>${clusters.filter((cluster) => cluster.urgency === "breaking" || cluster.urgency === "high").length}</strong><span>high urgency</span></div>
      <div><strong>${sourceDirectory.filter((source) => source.trust_level === "official").length}</strong><span>official sources</span></div>
    </div>
    <div class="local-crawl-actions">
      <button class="btn" data-save-city="${escapeHtml(JSON.stringify({ cityId: city.id.replace(/^city-/, ""), citySlug: city.slug, stateSlug: city.state_slug, label: `${city.name}, ${city.state_abbr}` }))}">Save city</button>
      <a class="btn ghost" href="/local?city=${encodeURIComponent(city.name)}&state=${encodeURIComponent(city.state_abbr)}">Open interactive local page</a>
      <button class="btn ghost" disabled>Newsletter placeholder</button>
      <button class="btn ghost" data-clear-local-prefs>Clear local preferences</button>
    </div>
  </section>
  <section class="panel">
    <h2>What changed today</h2>
    <div class="local-crawl-grid">${(changedToday.length ? changedToday : clusters.slice(0, 3)).map((cluster) => clusterCard(cluster, city, { sources: getClusterSignals(cluster, context) })).join("") || `<p class="local-crawl-muted">No live changes today yet.</p>`}</div>
  </section>
  <section class="panel">
    <h2>Top story clusters</h2>
    <div class="local-crawl-grid">${topClusters.map((cluster) => clusterCard(cluster, city, { sources: getClusterSignals(cluster, context) })).join("") || `<p class="local-crawl-muted">No live story clusters are available yet.</p>`}</div>
  </section>
  <section class="panel">
    <h2>Topic modules</h2>
    ${topicModules(clusters, city)}
  </section>
  <section class="panel">
    <h2>Official sources</h2>
    ${sourceList(sourceDirectory, { officialOnly: true })}
  </section>
  <section class="panel">
    <h2>Local source directory</h2>
    ${sourceList(sourceDirectory)}
  </section>
  <section class="panel">
    <h2>Nearby cities</h2>
    <div class="local-topic-grid">${nearby.map((nearbyCity) => `
      <a class="local-topic-module" href="${escapeHtml(localCityPath(nearbyCity))}">
        <strong>${escapeHtml(nearbyCity.name)}, ${escapeHtml(nearbyCity.state_abbr)}</strong>
        <span>Open city page</span>
      </a>`).join("") || `<p class="local-crawl-muted">Nearby city pages are being prepared.</p>`}</div>
  </section>`;
  return {
    status: 200,
    robots,
    html: pageShell({
      title: `${city.name}, ${city.state_abbr} Local News | Live News`,
      description: `Live updates from the last 7 days for ${city.name}, ${city.state_abbr}, including story clusters, source mix, official sources, and topic modules.`,
      canonicalPath: localCityPath(city),
      robots,
      body,
    }),
  };
}

function renderLocalTopicPage(stateSlug, citySlug, topicSlug, options = {}) {
  const city = findCityByRoute(stateSlug, citySlug, options);
  if (!city) return null;
  const context = readContext(options);
  const allClusters = getLiveStoriesForCity(city.id, options);
  const matchingTopic = [...new Set(allClusters.map((cluster) => cluster.primary_topic))]
    .find((topic) => slugify(topic) === cleanText(topicSlug).toLowerCase());
  if (!matchingTopic) return null;
  const clusters = sortClusters(getLiveStoriesForTopic(city.id, matchingTopic, options));
  const sourceMix = getSourceMix(clusters, context);
  const confidenceLabels = [...new Set(clusters.map((cluster) => cluster.confidence_label).filter(Boolean))];
  const robots = getPageRobots({ clusters, sourceMix });
  const body = `<section class="panel local-crawl-hero">
    <p class="story-kicker">Local Topic</p>
    <h1>${escapeHtml(topicLabel(matchingTopic))} in ${escapeHtml(city.name)}, ${escapeHtml(city.state_abbr)}</h1>
    <p class="panel-note">Topic-specific live story clusters from the last 7 days.</p>
    <p class="local-crawl-muted">Last updated ${escapeHtml(formatDateTime(getLastUpdated(clusters)))}</p>
    <div class="local-crawl-actions">
      <button class="btn" data-save-city="${escapeHtml(JSON.stringify({ cityId: city.id.replace(/^city-/, ""), citySlug: city.slug, stateSlug: city.state_slug, label: `${city.name}, ${city.state_abbr}` }))}">Save city</button>
      <button class="btn ghost" data-follow-topic="${escapeHtml(matchingTopic)}" data-city-id="${escapeHtml(city.id.replace(/^city-/, ""))}">Follow topic</button>
      <button class="btn ghost" disabled>Newsletter placeholder</button>
      <button class="btn ghost" data-clear-local-prefs>Clear local preferences</button>
    </div>
  </section>
  <section class="panel">
    <h2>Live ${escapeHtml(topicLabel(matchingTopic))} clusters</h2>
    <div class="local-crawl-grid">${clusters.map((cluster) => clusterCard(cluster, city, { sources: getClusterSignals(cluster, context) })).join("") || `<p class="local-crawl-muted">No live clusters are available for this topic yet.</p>`}</div>
  </section>
  <section class="panel">
    <h2>Topic source mix</h2>
    <div class="local-source-directory">${sourceMix.map((source) => `
      <div class="local-source-row">
        <strong>${escapeHtml(source.name)}</strong>
        <span>${escapeHtml(source.sourceType)} • ${escapeHtml(source.trustLevel)} • ${source.count} signal${source.count === 1 ? "" : "s"}</span>
      </div>`).join("") || `<p class="local-crawl-muted">No source mix is available yet.</p>`}</div>
  </section>
  <section class="panel">
    <h2>Confidence labels</h2>
    <p class="panel-note">${escapeHtml(confidenceLabels.join(", ") || "No confidence labels yet.")}</p>
  </section>`;
  return {
    status: 200,
    robots,
    html: pageShell({
      title: `${topicLabel(matchingTopic)} in ${city.name}, ${city.state_abbr} | Live News`,
      description: `Current ${topicLabel(matchingTopic).toLowerCase()} story clusters for ${city.name}, ${city.state_abbr}, from Live News local intelligence.`,
      canonicalPath: localTopicPath(city, matchingTopic),
      robots,
      body,
    }),
  };
}

function renderLocalStoryPage(stateSlug, citySlug, storySlug, options = {}) {
  const city = findCityByRoute(stateSlug, citySlug, options);
  if (!city) return null;
  const context = readContext(options);
  const cluster = findStoryClusterBySlug(storySlug, options);
  if (!cluster || cluster.city_id !== city.id) return null;
  const expiration = getExpiredStoryClusterResponse(cluster, options);
  if (expiration.expired) {
    return {
      status: expiration.status,
      robots: "noindex, follow, noarchive",
      html: pageShell({
        title: "Live News local story expired",
        description: "This Live News local story cluster has expired from public coverage.",
        canonicalPath: localStoryPath(city, cluster),
        robots: "noindex, follow, noarchive",
        body: `<section class="panel local-crawl-hero">
          <p class="story-kicker">Expired coverage</p>
          <h1>Live News local story expired</h1>
          <p class="panel-note">This local story is no longer shown publicly because Live News only displays current story details from the last 7 days.</p>
        </section>`,
      }),
    };
  }
  const sources = getClusterSignals(cluster, context);
  const primarySource = sources.find((source) => source.isPrimary) || sources[0] || null;
  const timeline = [
    { label: "First seen", value: cluster.first_seen_at },
    { label: "Latest update", value: cluster.last_updated_at || cluster.public_started_at },
    { label: "Expires from public pages", value: cluster.expires_at },
  ].filter((item) => item.value);
  const body = `<article class="panel local-crawl-story">
    <p class="story-kicker">${escapeHtml(topicLabel(cluster.primary_topic))}</p>
    <h1>${escapeHtml(cluster.headline)}</h1>
    <p class="panel-note">Live News shows recent local stories from the last 7 days and links to original sources for full reporting.</p>
    <h2>Live News summary</h2>
    <p>${escapeHtml(cluster.summary || "Live News is tracking this current local story cluster from source-linked public signals.")}</p>
    <div class="local-pulse-grid">
      <div><strong>${escapeHtml(cluster.confidence_label)}</strong><span>confidence</span></div>
      <div><strong>${escapeHtml(cluster.urgency)}</strong><span>urgency</span></div>
      <div><strong>${sources.length || cluster.source_count || 1}</strong><span>sources</span></div>
      <div><strong>${escapeHtml(formatDateTime(cluster.last_updated_at || cluster.public_started_at))}</strong><span>last updated</span></div>
    </div>
    <div class="local-crawl-actions">
      <a class="btn ghost" href="${escapeHtml(localCityPath(city))}">${escapeHtml(city.name)}, ${escapeHtml(city.state_abbr)}</a>
      <a class="btn ghost" href="${escapeHtml(localTopicPath(city, cluster.primary_topic))}">${escapeHtml(topicLabel(cluster.primary_topic))}</a>
    </div>
  </article>
  <section class="panel">
    <h2>Latest update</h2>
    <p class="panel-note">${escapeHtml(cluster.headline)} was last updated ${escapeHtml(formatDateTime(cluster.last_updated_at || cluster.public_started_at))}.</p>
    <p class="local-crawl-muted">Confidence label: ${escapeHtml(cluster.confidence_label)}.</p>
  </section>
  <section class="panel">
    <h2>Timeline</h2>
    <div class="local-source-directory">${timeline.map((item) => `
      <div class="local-source-row">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(formatDateTime(item.value))}</span>
      </div>`).join("")}</div>
  </section>
  <section class="panel">
    <h2>Original source attribution</h2>
    ${primarySource ? `<p class="panel-note">Primary source: ${escapeHtml(primarySource.sourceName)}. Open the original source for full reporting.</p>` : `<p class="panel-note">Open original sources for full reporting.</p>`}
    <div class="local-source-directory">${sources.map((source) => `
      <a class="local-source-row" href="${escapeHtml(source.url || "#")}" ${source.url ? 'target="_blank" rel="noopener noreferrer"' : ""}>
        <strong>${escapeHtml(source.sourceName)}</strong>
        <span>${escapeHtml(source.sourceType)} • ${escapeHtml(source.trustLevel)}${source.title ? ` • ${escapeHtml(source.title)}` : ""}</span>
      </a>`).join("") || `<p class="local-crawl-muted">Source links are being prepared.</p>`}</div>
  </section>`;
  return {
    status: 200,
    robots: cluster.index_status === "index" ? "index, follow" : "noindex, follow",
    html: pageShell({
      title: `${cluster.headline} | Live News Local`,
      description: cleanText(cluster.summary || `Current local story cluster for ${city.name}, ${city.state_abbr}.`),
      canonicalPath: localStoryPath(city, cluster),
      robots: cluster.index_status === "index" ? "index, follow" : "noindex, follow",
      body,
    }),
  };
}

function getCrawlableLocalSitemapEntries(options = {}) {
  const context = readContext(options);
  const cityById = new Map(context.cities.map((city) => [city.id, city]));
  const clusters = getRegularSitemapStoryClusters(options);
  const entries = [];
  const cityGroups = new Map();
  for (const cluster of clusters) {
    const city = cityById.get(cluster.city_id);
    if (!city) continue;
    const list = cityGroups.get(city.id) || [];
    list.push(cluster);
    cityGroups.set(city.id, list);
    entries.push({
      path: localStoryPath(city, cluster),
      lastmod: cluster.last_updated_at || cluster.public_started_at || new Date().toISOString(),
      changefreq: "hourly",
      priority: "0.6",
    });
  }
  for (const [cityId, cityClusters] of cityGroups.entries()) {
    const city = cityById.get(cityId);
    const sourceMix = getSourceMix(cityClusters, context);
    if (getPageRobots({ clusters: cityClusters, sourceMix }) !== "index, follow") continue;
    entries.push({
      path: localCityPath(city),
      lastmod: getLastUpdated(cityClusters),
      changefreq: "hourly",
      priority: "0.7",
    });
    const topics = [...new Set(cityClusters.map((cluster) => cluster.primary_topic))];
    for (const topic of topics) {
      const topicClusters = cityClusters.filter((cluster) => cluster.primary_topic === topic);
      const topicSourceMix = getSourceMix(topicClusters, context);
      if (getPageRobots({ clusters: topicClusters, sourceMix: topicSourceMix }) !== "index, follow") continue;
      entries.push({
        path: localTopicPath(city, topic),
        lastmod: getLastUpdated(topicClusters),
        changefreq: "hourly",
        priority: "0.6",
      });
    }
  }
  return entries;
}

module.exports = {
  findCityByRoute,
  findStateCities,
  getCrawlableLocalSitemapEntries,
  localCityPath,
  localStatePath,
  localStoryPath,
  localTopicPath,
  renderLocalCityPage,
  renderLocalStatePage,
  renderLocalStoryPage,
  renderLocalTopicPage,
  topicLabel,
};
