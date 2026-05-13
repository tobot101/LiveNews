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
  getGoogleNewsSitemapStoryClusters,
  getLiveStoriesForCity,
  getLiveStoriesForTopic,
  getRegularSitemapStoryClusters,
  isPublicStoryLive,
} = require("./local-story-expiration");
const { getLocalIntelligenceConfig } = require("./local-intelligence-config");
const {
  getCityIndexEligibility,
  getTopicIndexEligibility,
} = require("./local-index-eligibility");
const { getCityTopStories } = require("./local-top-stories");
const {
  directoryCityToLocalCity,
  findDirectoryCityByRoute,
  getPopularLocalCities,
} = require("./local-city-registry");

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

function absoluteResourceUrl(value = "") {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return absoluteLocalUrl(cleaned);
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
  const seededCity = context.cities.find((city) => {
    const stateMatches =
      cleanText(city.state_slug).toLowerCase() === stateTarget ||
      cleanText(city.state_abbr).toLowerCase() === stateTarget ||
      slugify(city.state_name) === stateTarget;
    return stateMatches && cleanText(city.slug).toLowerCase() === cityTarget;
  });
  if (seededCity) return seededCity;
  const directoryCity = findDirectoryCityByRoute(stateSlug, citySlug, options);
  return directoryCity ? directoryCityToLocalCity(directoryCity) : null;
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

function getCitySeoDecision(city = {}, clusters = [], context = {}, options = {}) {
  const sourceMix = getSourceMix(clusters, context);
  return getCityIndexEligibility({
    clusters,
    sourceMix,
    hasVisibleLastUpdated: clusters.length > 0 && Boolean(getLastUpdated(clusters)),
    onlyShowsLiveStories: clusters.every((cluster) => isPublicStoryLive(cluster, options)),
  });
}

function getTopicSeoDecision(city = {}, topic = "", clusters = [], context = {}, options = {}) {
  const sourceMix = getSourceMix(clusters, context);
  return getTopicIndexEligibility({
    clusters,
    sourceMix,
    onlyShowsLiveStories: clusters.every((cluster) => isPublicStoryLive(cluster, options)),
  });
}

function getStateSeoDecision(cities = [], citySummaries = [], context = {}, options = {}) {
  const allClusters = citySummaries.flatMap((item) => item.clusters || []);
  const sourceMix = getSourceMix(allClusters, context);
  const indexableCityCount = citySummaries.filter((item) =>
    getCitySeoDecision(item.city, item.clusters || [], context, options).indexable
  ).length;
  const stateName = cleanText(cities[0]?.state_name || cities[0]?.state_abbr);
  const reasons = [];
  if (!stateName) reasons.push("needs state metadata");
  if (!indexableCityCount) reasons.push("needs at least one indexable city page");
  if (sourceMix.length < 2) reasons.push("needs 2+ distinct sources across live state coverage");
  const indexable = Boolean(stateName) && sourceMix.length >= 2 && indexableCityCount > 0;
  return {
    indexable,
    robots: indexable ? "index, follow" : "noindex, follow",
    reasons,
    checks: {
      indexableCityCount,
      liveClusterCount: allClusters.length,
      distinctSourceCount: sourceMix.length,
      hasStateMetadata: Boolean(stateName),
    },
  };
}

function buildLocalStructuredData({ type = "CollectionPage", title, description, canonicalPath, items = [], city = null, topic = "" } = {}) {
  const canonicalUrl = absoluteLocalUrl(canonicalPath);
  const schema = {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: title,
    description,
    isPartOf: {
      "@id": `${getLocalIntelligenceConfig().baseUrl.replace(/\/+$/, "")}/#website`,
    },
    inLanguage: "en-US",
  };
  if (city?.name) {
    schema.about = {
      "@type": "Place",
      name: `${city.name}, ${city.state_abbr}`,
    };
  }
  if (topic) schema.keywords = [topicLabel(topic), city?.name, city?.state_abbr].filter(Boolean).join(", ");
  if (items.length) {
    schema.mainEntity = {
      "@type": "ItemList",
      itemListElement: items.slice(0, 20).map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.headline || item.title || item.name,
        url: item.path ? absoluteLocalUrl(item.path) : undefined,
      })),
    };
  }
  return schema;
}

function buildLocalNewsArticleSchema(city = {}, cluster = {}, sources = []) {
  const canonicalPath = localStoryPath(city, cluster);
  const published = cluster.public_started_at || cluster.first_seen_at || new Date().toISOString();
  const modified = cluster.last_updated_at || published;
  const imageUrl = absoluteResourceUrl(cluster.image_url || cluster.imageUrl || cluster.thumbnailUrl || cluster.thumbnail_url || "");
  const schema = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "@id": `${absoluteLocalUrl(canonicalPath)}#newsarticle`,
    mainEntityOfPage: absoluteLocalUrl(canonicalPath),
    headline: cluster.headline,
    description: cluster.summary,
    datePublished: published,
    dateModified: modified,
    articleSection: topicLabel(cluster.primary_topic),
    isAccessibleForFree: true,
    author: {
      "@type": "Organization",
      name: "Live News",
    },
    publisher: {
      "@type": "NewsMediaOrganization",
      name: "Live News",
      url: getLocalIntelligenceConfig().baseUrl,
      logo: {
        "@type": "ImageObject",
        url: absoluteLocalUrl("/android-chrome-192x192.png"),
      },
    },
    about: {
      "@type": "Place",
      name: `${city.name}, ${city.state_abbr}`,
    },
    citation: sources.map((source) => source.url).filter(Boolean),
  };
  if (imageUrl) schema.image = [imageUrl];
  return schema;
}

function buildLocalBreadcrumbSchema(items = []) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteLocalUrl(item.path),
    })),
  };
}

function buildLocalStoryStructuredData(city = {}, cluster = {}, sources = []) {
  return {
    article: buildLocalNewsArticleSchema(city, cluster, sources),
    breadcrumb: buildLocalBreadcrumbSchema([
      { name: "Live News", path: "/" },
      { name: `${city.name}, ${city.state_abbr}`, path: localCityPath(city) },
      { name: topicLabel(cluster.primary_topic), path: localTopicPath(city, cluster.primary_topic) },
      { name: cluster.headline, path: localStoryPath(city, cluster) },
    ]),
  };
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

function isWeakLocalArticleSummary(value) {
  const text = cleanText(value).toLowerCase();
  return !text ||
    text.includes("this article discusses") ||
    text.includes("in a recent development") ||
    text.includes("read more about this story") ||
    text.includes("read the original source for the full report") ||
    text.includes("latest update on this topic");
}

function getLocalArticleSummary(item = {}) {
  const candidates = [
    item.liveNewsSummary,
    item.summaryShort,
    item.summary,
  ];
  return cleanText(candidates.find((value) => !isWeakLocalArticleSummary(value)) || "");
}

function getLocalArticleTopicLabel(item = {}) {
  return cleanText(
    item.topicLabel ||
    item.classification?.topicLabel ||
    topicLabel(item.topic || item.category || "local")
  );
}

function localArticleCard(item = {}) {
  const title = cleanText(item.liveNewsHeadline || item.title || "Local update");
  const summary = getLocalArticleSummary(item);
  const source = cleanText(item.sourceName || item.source || "Original source");
  const topic = getLocalArticleTopicLabel(item);
  const published = item.publishedAt ? formatDateTime(item.publishedAt) : "";
  const link = cleanText(item.link || item.url || "");
  const sourceCount = Number(item.sourceCount || item.clusterSize || 0);
  const coverage = cleanText(item.coverageContext || "");
  return `<article class="local-crawl-card local-live-article-card">
    <div class="local-crawl-card-meta">
      <span>${escapeHtml(topic || "Local")}</span>
      ${published ? `<span>${escapeHtml(published)}</span>` : ""}
    </div>
    <h3>${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}</h3>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
    ${coverage ? `<p class="local-crawl-muted">${escapeHtml(coverage)}</p>` : ""}
    <div class="local-crawl-card-footer">
      <span>${escapeHtml(source)}</span>
      ${sourceCount > 1 ? `<span>${sourceCount} source${sourceCount === 1 ? "" : "s"}</span>` : ""}
      ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Read original source</a>` : ""}
    </div>
  </article>`;
}

function TopStoryCard(selection = null, city = {}, context = {}) {
  if (!selection) return "";
  const sources = getClusterSignals(selection, context);
  const primarySource = sources.find((source) => source.isPrimary) || sources[0] || null;
  const sourceCount = Number(selection.source_count || sources.length || 0);
  const date = formatDateTime(selection.public_started_at || selection.first_seen_at || selection.created_at);
  const updated = formatDateTime(selection.last_updated_at || selection.public_started_at);
  const buttonLabel = selection.slug ? "View live story" : "Read local update";
  const storyHref = selection.slug ? localStoryPath(city, selection) : localCityPath(city);
  return `<article class="local-top-story-card">
    <div class="local-top-story-badges">
      <span class="story-kicker">${escapeHtml(selection.topStoryLabel || "Local Story")}</span>
      <span class="tag">${escapeHtml(date)}</span>
    </div>
    <h3><a href="${escapeHtml(storyHref)}">${escapeHtml(selection.headline)}</a></h3>
    <p>${escapeHtml(selection.summary)}</p>
    <div class="local-top-story-meta">
      <span>${escapeHtml(primarySource?.sourceName || "Source-linked coverage")}</span>
      <span>${sourceCount} source${sourceCount === 1 ? "" : "s"}</span>
      <span>${escapeHtml(topicLabel(selection.primary_topic))}</span>
      <span>Updated ${escapeHtml(updated)}</span>
      <span>${escapeHtml(selection.confidence_label || "developing")}</span>
    </div>
    <a class="btn ghost" href="${escapeHtml(storyHref)}">${buttonLabel}</a>
  </article>`;
}

function CityTopStoriesHero(city = {}, topStories = {}, context = {}) {
  const day = topStories.day || null;
  const week = topStories.week || null;
  const sameStory = day && week && day.id === week.id;
  const cards = [TopStoryCard(day, city, context)];
  if (week && !sameStory) cards.push(TopStoryCard(week, city, context));
  const supportingState = sameStory
    ? `<aside class="local-top-story-supporting">
        <strong>Week view</strong>
        <span>This is the only eligible live story cluster right now, so Live News is not showing a duplicate card.</span>
      </aside>`
    : "";
  return `<section class="panel local-city-hero">
    <nav class="local-breadcrumbs" aria-label="Local breadcrumbs">
      <a href="/local">Local News</a>
      <span>/</span>
      <a href="/local/cities">Cities</a>
      <span>/</span>
      <span>${escapeHtml(city.name)}, ${escapeHtml(city.state_abbr)}</span>
    </nav>
    <a class="local-back-link" href="/local/cities">&larr; Back to all cities</a>
    <p class="story-kicker">Local News</p>
    <h1>${escapeHtml(city.name)} Local News</h1>
    <p class="panel-note">Live local updates from the last 7 days.</p>
    <p class="local-crawl-muted">Last updated ${escapeHtml(formatDateTime(getLastUpdated(topStories.eligibleStories || [])))}</p>
    <div class="local-top-stories-grid">
      ${cards.filter(Boolean).join("") || `<p class="local-crawl-muted">No eligible top local stories are available yet.</p>`}
    </div>
    ${supportingState}
    <div class="local-crawl-actions">
      <button class="btn" data-save-city="${escapeHtml(JSON.stringify({ cityId: city.id.replace(/^city-/, ""), citySlug: city.slug, stateSlug: city.state_slug, label: `${city.name}, ${city.state_abbr}` }))}">Save city</button>
      ${(topStories.eligibleStories || [])[0]?.primary_topic ? `<button class="btn ghost" data-follow-topic="${escapeHtml((topStories.eligibleStories || [])[0].primary_topic)}" data-city-id="${escapeHtml(city.id.replace(/^city-/, ""))}">Follow ${escapeHtml(topicLabel((topStories.eligibleStories || [])[0].primary_topic))}</button>` : ""}
      <button class="btn ghost" disabled>Newsletter placeholder</button>
      <button class="btn ghost" data-clear-local-prefs>Clear local preferences</button>
    </div>
  </section>`;
}

function LocalLiveArticleFeedPanel(city = {}, articleFeed = null) {
  const cityName = escapeHtml(city.name || "");
  const stateAbbr = escapeHtml(city.state_abbr || "");
  const items = Array.isArray(articleFeed?.items) ? articleFeed.items.slice(0, 12) : [];
  const sourceCount = Number(articleFeed?.sourceCount || 0);
  const statusText = items.length
    ? `Showing ${items.length} current local article${items.length === 1 ? "" : "s"}${sourceCount ? ` from ${sourceCount} source${sourceCount === 1 ? "" : "s"}` : ""}.`
    : articleFeed
      ? "No recent local articles were found for this city yet. Try another city or check back soon."
      : "Loading recent local articles...";
  return `<section class="panel local-live-feed-panel" data-local-live-feed data-city-name="${cityName}" data-state-abbr="${stateAbbr}" data-has-initial-items="${items.length ? "true" : "false"}">
    <div class="section-heading">
      <div>
        <p class="story-kicker">Live News Intelligence</p>
        <h2>Latest local articles</h2>
      </div>
      <span class="section-tag">Last 7 days</span>
    </div>
    <p class="panel-note">Source-linked local articles with Live News summaries and current public coverage for ${cityName}, ${stateAbbr}.</p>
    <p class="local-crawl-muted" data-local-live-feed-status>${escapeHtml(statusText)}</p>
    <div class="local-crawl-grid local-live-feed-list" data-local-live-feed-list>${items.map(localArticleCard).join("")}</div>
  </section>
  <script>
    (function() {
      var root = document.querySelector("[data-local-live-feed]");
      if (!root) return;
      var status = root.querySelector("[data-local-live-feed-status]");
      var list = root.querySelector("[data-local-live-feed-list]");
      var city = root.getAttribute("data-city-name") || "";
      var state = root.getAttribute("data-state-abbr") || "";
      var hadInitialItems = root.getAttribute("data-has-initial-items") === "true";
      function escapeText(value) {
        return String(value || "").replace(/[&<>"']/g, function(ch) {
          if (ch === "&") return "&amp;";
          if (ch === "<") return "&lt;";
          if (ch === ">") return "&gt;";
          if (ch === '"') return "&quot;";
          return "&#39;";
        });
      }
      function formatTime(value) {
        var date = new Date(value || "");
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      }
      function isWeakSummary(value) {
        var text = String(value || "").toLowerCase();
        return !text ||
          text.indexOf("this article discusses") !== -1 ||
          text.indexOf("in a recent development") !== -1 ||
          text.indexOf("read more about this story") !== -1 ||
          text.indexOf("read the original source for the full report") !== -1 ||
          text.indexOf("latest update on this topic") !== -1;
      }
      function getTopicLabel(item) {
        return item.topicLabel || (item.classification && item.classification.topicLabel) || item.topic || item.category || "Local";
      }
      function renderItems(items, sourceCount) {
        if (!list || !status) return;
        if (!items.length) {
          if (hadInitialItems) return;
          list.innerHTML = "";
          status.textContent = "No recent local articles were found for this city yet. Try another city or check back soon.";
          return;
        }
        list.innerHTML = "";
        status.textContent = "Showing " + items.length + " recent local article" + (items.length === 1 ? "" : "s") + (sourceCount ? " from " + sourceCount + " source" + (sourceCount === 1 ? "" : "s") : "") + ".";
        items.forEach(function(item) {
          var card = document.createElement("article");
          card.className = "local-crawl-card local-live-article-card";
          var title = item.liveNewsHeadline || item.title || "Local update";
          var summary = isWeakSummary(item.liveNewsSummary || item.summaryShort || item.summary) ? "" : (item.liveNewsSummary || item.summaryShort || item.summary);
          var source = item.sourceName || item.source || "Original source";
          var category = getTopicLabel(item);
          var published = formatTime(item.publishedAt);
          var link = item.link || item.url || "";
          var coverage = item.coverageContext || "";
          var sourceTotal = Number(item.sourceCount || item.clusterSize || 0);
          card.innerHTML =
            '<div class="local-crawl-card-meta"><span>' + escapeText(category) + '</span>' + (published ? '<span>' + escapeText(published) + '</span>' : '') + '</div>' +
            '<h3>' + (link ? '<a href="' + escapeText(link) + '" target="_blank" rel="noopener noreferrer">' + escapeText(title) + '</a>' : escapeText(title)) + '</h3>' +
            (summary ? '<p>' + escapeText(summary) + '</p>' : '') +
            (coverage ? '<p class="local-crawl-muted">' + escapeText(coverage) + '</p>' : '') +
            '<div class="local-crawl-card-footer"><span>' + escapeText(source) + '</span>' +
            (sourceTotal > 1 ? '<span>' + sourceTotal + ' sources</span>' : '') +
            (link ? '<a href="' + escapeText(link) + '" target="_blank" rel="noopener noreferrer">Read original source</a>' : '') + '</div>';
          list.appendChild(card);
        });
        hadInitialItems = true;
      }
      if (!city) {
        if (status) status.textContent = "Choose a city to load recent local articles.";
        return;
      }
      var params = new URLSearchParams({ city: city, state: state });
      fetch("/api/local?" + params.toString(), { headers: { "Accept": "application/json" } })
        .then(function(response) { return response.json(); })
        .then(function(data) { renderItems((data.items || []).slice(0, 12), Number(data.sourceCount || 0)); })
        .catch(function() {
          if (status && !hadInitialItems) status.textContent = "Recent local articles are unavailable right now. Please try again shortly.";
        });
    })();
  </script>`;
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
  const seoDecision = getStateSeoDecision(cities, citySummaries, context, options);
  const robots = seoDecision.robots;
  const liveCount = citySummaries.reduce((sum, item) => sum + item.clusters.length, 0);
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
    seoDecision,
    html: pageShell({
      title: `${stateName} Local News | Live News`,
      description: `Browse current ${stateName} local news pages from Live News, with source-linked public coverage from the last 7 days.`,
      canonicalPath: localStatePath(cities[0]),
      robots,
      body,
      structuredData: [
        buildLocalStructuredData({
          title: `${stateName} Local News | Live News`,
          description: `Browse current ${stateName} local news pages from Live News, with source-linked public coverage from the last 7 days.`,
          canonicalPath: localStatePath(cities[0]),
          items: citySummaries.map(({ city }) => ({
            name: `${city.name}, ${city.state_abbr}`,
            path: localCityPath(city),
          })),
        }),
        buildLocalBreadcrumbSchema([
          { name: "Live News", path: "/" },
          { name: `${stateName} Local News`, path: localStatePath(cities[0]) },
        ]),
      ],
    }),
  };
}

function renderLocalCitiesPage(options = {}) {
  const popularCities = getPopularLocalCities(options);
  const toLocalCity = (city) => directoryCityToLocalCity(city);
  const cityLink = (cityInput) => {
    const city = toLocalCity(cityInput);
    return `<a class="local-directory-city-link" href="${escapeHtml(localCityPath(city))}" data-city-name="${escapeHtml(city.name.toLowerCase())}" data-state-abbr="${escapeHtml(city.state_abbr.toLowerCase())}" data-state-name="${escapeHtml(city.state_name.toLowerCase())}">
    <strong>${escapeHtml(city.name)}</strong>
    <span>${escapeHtml(city.state_abbr)}</span>
  </a>`;
  };
  const body = `<section class="panel local-city-directory-hero">
    <p class="story-kicker">Local News</p>
    <h1>Browse Local News by City</h1>
    <p class="panel-note">Choose a city to see live local updates from the last 7 days. Start with a top city, or search any U.S. city.</p>
    <div class="local-directory-search">
      <label class="sr-only" for="localCityDirectorySearch">Search cities</label>
      <input id="localCityDirectorySearch" type="search" placeholder="Search by city or state" aria-label="Search cities" />
      <button class="btn ghost" id="localCityDirectoryUseLocation" type="button">Use my location</button>
    </div>
    <div class="local-directory-results" id="localCityDirectoryResults" hidden></div>
    <p class="local-directory-empty local-crawl-muted" id="localCityDirectoryEmpty" hidden>No matching cities found.</p>
  </section>
  <section class="panel">
    <h2>Top U.S. cities</h2>
    <p class="panel-note">The directory keeps the page focused while search covers the full U.S. city database.</p>
    <div class="local-directory-grid">${popularCities.map(cityLink).join("") || `<p class="local-crawl-muted">Popular cities are being prepared.</p>`}</div>
  </section>
  <script>
    (function() {
      var input = document.getElementById("localCityDirectorySearch");
      var empty = document.getElementById("localCityDirectoryEmpty");
      var results = document.getElementById("localCityDirectoryResults");
      function slugify(value) {
        return String(value || "").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      }
      function cityHref(place) {
        var stateSlug = place.stateSlug || slugify(place.stateName || place.state || "");
        var citySlug = place.citySlug || slugify(place.name || "");
        return stateSlug && citySlug ? "/local/" + encodeURIComponent(stateSlug) + "/" + encodeURIComponent(citySlug) : "/local/cities";
      }
      function escapeText(value) {
        return String(value || "").replace(/[&<>"]/g, function(ch) {
          if (ch === "&") return "&amp;";
          if (ch === "<") return "&lt;";
          if (ch === ">") return "&gt;";
          return "&quot;";
        });
      }
      function renderResults(items) {
        if (!results) return;
        if (!items.length) {
          results.hidden = true;
          results.innerHTML = "";
          if (empty) empty.hidden = false;
          return;
        }
        if (empty) empty.hidden = true;
        results.hidden = false;
        results.innerHTML = items.map(function(place) {
          var state = place.state || place.stateAbbr || "";
          var stateName = place.stateName || "";
          return '<a class="local-directory-city-link" href="' + cityHref(place) + '">' +
            '<strong>' + escapeText(place.name) + '</strong>' +
            '<span>' + escapeText(state || stateName) + '</span>' +
          '</a>';
        }).join("");
      }
      var pending = null;
      function searchCities() {
        var query = String(input && input.value || "").trim().toLowerCase();
        if (!query || query.length < 2) {
          if (results) {
            results.hidden = true;
            results.innerHTML = "";
          }
          if (empty) empty.hidden = true;
          return;
        }
        if (pending) clearTimeout(pending);
        pending = setTimeout(function() {
          fetch("/api/places?q=" + encodeURIComponent(query) + "&limit=24")
            .then(function(response) { return response.json(); })
            .then(function(data) { renderResults(data.results || []); })
            .catch(function() { renderResults([]); });
        }, 120);
      }
      if (input) input.addEventListener("input", searchCities);
      var geo = document.getElementById("localCityDirectoryUseLocation");
      if (geo) geo.addEventListener("click", function() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(function(position) {
          var url = "/api/places/nearest?lat=" + encodeURIComponent(position.coords.latitude) + "&lon=" + encodeURIComponent(position.coords.longitude);
          fetch(url).then(function(response) { return response.json(); }).then(function(data) {
            if (!data.place) return;
            var stateSlug = data.place.stateSlug || String(data.place.stateName || data.place.state || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            var citySlug = data.place.citySlug || String(data.place.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            if (stateSlug && citySlug) window.location.href = "/local/" + stateSlug + "/" + citySlug;
          }).catch(function() {});
        });
      });
    })();
  </script>`;
  return {
    status: 200,
    robots: "index, follow",
    html: pageShell({
      title: "Browse Local News by City | Live News",
      description: "Choose a city to see Live News local updates from the last 7 days, starting with top cities or searching the full U.S. city directory.",
      canonicalPath: "/local/cities",
      robots: "index, follow",
      body,
      structuredData: [
        buildLocalStructuredData({
          title: "Browse Local News by City | Live News",
          description: "Choose a city to see Live News local updates from the last 7 days, starting with top cities or searching the full U.S. city directory.",
          canonicalPath: "/local/cities",
          items: popularCities.map((cityInput) => {
            const city = toLocalCity(cityInput);
            return {
              name: `${city.name}, ${city.state_abbr}`,
              path: localCityPath(city),
            };
          }),
        }),
        buildLocalBreadcrumbSchema([
          { name: "Live News", path: "/" },
          { name: "Local News", path: "/local" },
          { name: "Cities", path: "/local/cities" },
        ]),
      ],
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
  const seoDecision = getCitySeoDecision(city, clusters, context, options);
  const robots = seoDecision.robots;
  const now = new Date(options.now || Date.now());
  const topStories = getCityTopStories(city.id, now, options);
  const articleFeed = options.localArticleFeed || null;
  const changedToday = clusters.filter((cluster) => {
    const time = new Date(cluster.last_updated_at || cluster.public_started_at || 0).getTime();
    return Number.isFinite(time) && now.getTime() - time <= 24 * 60 * 60 * 1000;
  });
  const topClusters = clusters.slice(0, 6);
  const nearby = getNearbyCities(city, context);
  const clusterSections = clusters.length ? `<section class="panel">
    <h2>Local Pulse</h2>
    <div class="local-pulse-grid" aria-label="Local Pulse">
      <div><strong>${clusters.length}</strong><span>live clusters</span></div>
      <div><strong>${sourceMix.length}</strong><span>sources in mix</span></div>
      <div><strong>${clusters.filter((cluster) => cluster.urgency === "breaking" || cluster.urgency === "high").length}</strong><span>high urgency</span></div>
      <div><strong>${sourceDirectory.filter((source) => source.trust_level === "official").length}</strong><span>official sources</span></div>
    </div>
  </section>
  <section class="panel">
    <h2>What changed today</h2>
    <div class="local-crawl-grid">${(changedToday.length ? changedToday : clusters.slice(0, 3)).map((cluster) => clusterCard(cluster, city, { sources: getClusterSignals(cluster, context) })).join("") || `<p class="local-crawl-muted">No live changes today yet.</p>`}</div>
  </section>
  <section class="panel">
    <h2>Latest local stories</h2>
    <div class="local-crawl-grid">${topClusters.map((cluster) => clusterCard(cluster, city, { sources: getClusterSignals(cluster, context) })).join("") || `<p class="local-crawl-muted">No live story clusters are available yet.</p>`}</div>
  </section>
  <section class="panel">
    <h2>Topic modules</h2>
    ${topicModules(clusters, city)}
  </section>` : "";
  const sourceSections = sourceDirectory.length ? `<section class="panel">
    <h2>Official sources</h2>
    ${sourceList(sourceDirectory, { officialOnly: true })}
  </section>
  <section class="panel">
    <h2>Local source directory</h2>
    ${sourceList(sourceDirectory)}
  </section>` : "";
  const body = `${CityTopStoriesHero(city, topStories, context)}
  ${LocalLiveArticleFeedPanel(city, articleFeed)}
  ${clusterSections}
  ${sourceSections}
  <section class="panel">
    <h2>Nearby cities</h2>
    <div class="local-topic-grid">${nearby.map((nearbyCity) => `
      <a class="local-topic-module" href="${escapeHtml(localCityPath(nearbyCity))}">
        <strong>${escapeHtml(nearbyCity.name)}, ${escapeHtml(nearbyCity.state_abbr)}</strong>
        <span>Open city page</span>
      </a>`).join("") || `<p class="local-crawl-muted">Nearby city pages are being prepared.</p>`}</div>
    <div class="local-crawl-actions">
      <a class="btn ghost" href="/local/cities">Change city / Browse other cities</a>
    </div>
  </section>`;
  return {
    status: 200,
    robots,
    seoDecision,
    html: pageShell({
      title: `${city.name}, ${city.state_abbr} Local News | Live News`,
      description: `Live updates from the last 7 days for ${city.name}, ${city.state_abbr}, including story clusters, source mix, official sources, and topic modules.`,
      canonicalPath: localCityPath(city),
      robots,
      body,
      structuredData: [
        buildLocalStructuredData({
          title: `${city.name}, ${city.state_abbr} Local News | Live News`,
          description: `Live updates from the last 7 days for ${city.name}, ${city.state_abbr}, including story clusters, source mix, official sources, and topic modules.`,
          canonicalPath: localCityPath(city),
          city,
          items: topClusters.map((cluster) => ({
            ...cluster,
            path: localStoryPath(city, cluster),
          })),
        }),
        buildLocalBreadcrumbSchema([
          { name: "Live News", path: "/" },
          { name: `${city.state_name || city.state_abbr} Local News`, path: localStatePath(city) },
          { name: `${city.name}, ${city.state_abbr}`, path: localCityPath(city) },
        ]),
      ],
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
  const seoDecision = getTopicSeoDecision(city, matchingTopic, clusters, context);
  const robots = seoDecision.robots;
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
    seoDecision,
    html: pageShell({
      title: `${topicLabel(matchingTopic)} in ${city.name}, ${city.state_abbr} | Live News`,
      description: `Current ${topicLabel(matchingTopic).toLowerCase()} story clusters for ${city.name}, ${city.state_abbr}, from Live News local intelligence.`,
      canonicalPath: localTopicPath(city, matchingTopic),
      robots,
      body,
      structuredData: [
        buildLocalStructuredData({
          title: `${topicLabel(matchingTopic)} in ${city.name}, ${city.state_abbr} | Live News`,
          description: `Current ${topicLabel(matchingTopic).toLowerCase()} story clusters for ${city.name}, ${city.state_abbr}, from Live News local intelligence.`,
          canonicalPath: localTopicPath(city, matchingTopic),
          city,
          topic: matchingTopic,
          items: clusters.map((cluster) => ({
            ...cluster,
            path: localStoryPath(city, cluster),
          })),
        }),
        buildLocalBreadcrumbSchema([
          { name: "Live News", path: "/" },
          { name: `${city.name}, ${city.state_abbr}`, path: localCityPath(city) },
          { name: topicLabel(matchingTopic), path: localTopicPath(city, matchingTopic) },
        ]),
      ],
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
  const structured = buildLocalStoryStructuredData(city, cluster, sources);
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
      structuredData: [structured.article, structured.breadcrumb],
    }),
  };
}

function getCrawlableLocalSitemapGroups(options = {}) {
  const context = readContext(options);
  const cityById = new Map(context.cities.map((city) => [city.id, city]));
  const clusters = getRegularSitemapStoryClusters(options);
  const groups = {
    states: [],
    cities: [],
    topics: [],
    stories: [],
  };
  const cityGroups = new Map();
  for (const cluster of clusters) {
    const city = cityById.get(cluster.city_id);
    if (!city) continue;
    const list = cityGroups.get(city.id) || [];
    list.push(cluster);
    cityGroups.set(city.id, list);
    groups.stories.push({
      type: "story",
      path: localStoryPath(city, cluster),
      lastmod: cluster.last_updated_at || cluster.public_started_at || new Date().toISOString(),
      changefreq: "hourly",
      priority: "0.6",
      title: cluster.headline,
      publicationDate: cluster.public_started_at || cluster.first_seen_at || cluster.created_at || new Date().toISOString(),
    });
  }
  const stateGroups = new Map();
  for (const [cityId, cityClusters] of cityGroups.entries()) {
    const city = cityById.get(cityId);
    const stateKey = city.state_slug || slugify(city.state_name || city.state_abbr);
    const stateList = stateGroups.get(stateKey) || [];
    stateList.push({ city, clusters: cityClusters, sourceMix: getSourceMix(cityClusters, context) });
    stateGroups.set(stateKey, stateList);
    if (!getCitySeoDecision(city, cityClusters, context, options).indexable) continue;
    groups.cities.push({
      type: "city",
      path: localCityPath(city),
      lastmod: getLastUpdated(cityClusters),
      changefreq: "hourly",
      priority: "0.7",
    });
    const topics = [...new Set(cityClusters.map((cluster) => cluster.primary_topic))];
    for (const topic of topics) {
      const topicClusters = cityClusters.filter((cluster) => cluster.primary_topic === topic);
      if (!getTopicSeoDecision(city, topic, topicClusters, context, options).indexable) continue;
      groups.topics.push({
        type: "topic",
        path: localTopicPath(city, topic),
        lastmod: getLastUpdated(topicClusters),
        changefreq: "hourly",
        priority: "0.6",
      });
    }
  }
  for (const [, citySummaries] of stateGroups.entries()) {
    const cities = citySummaries.map((item) => item.city);
    const stateDecision = getStateSeoDecision(cities, citySummaries, context, options);
    if (!stateDecision.indexable) continue;
    groups.states.push({
      type: "state",
      path: localStatePath(cities[0]),
      lastmod: getLastUpdated(citySummaries.flatMap((item) => item.clusters || [])),
      changefreq: "hourly",
      priority: "0.6",
    });
  }
  return {
    ...groups,
    all: [...groups.states, ...groups.cities, ...groups.topics, ...groups.stories],
  };
}

function getCrawlableLocalSitemapEntries(options = {}) {
  return getCrawlableLocalSitemapGroups(options).all;
}

function getCrawlableLocalNewsSitemapEntries(options = {}) {
  const context = readContext(options);
  const cityById = new Map(context.cities.map((city) => [city.id, city]));
  return getGoogleNewsSitemapStoryClusters(options)
    .map((cluster) => {
      const city = cityById.get(cluster.city_id);
      if (!city) return null;
      return {
        type: "news",
        path: localStoryPath(city, cluster),
        lastmod: cluster.last_updated_at || cluster.public_started_at || new Date().toISOString(),
        title: cluster.headline,
        publicationDate: cluster.public_started_at || cluster.first_seen_at || cluster.created_at || new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

module.exports = {
  CityTopStoriesHero,
  findCityByRoute,
  findStateCities,
  getCitySeoDecision,
  getCrawlableLocalNewsSitemapEntries,
  getCrawlableLocalSitemapEntries,
  getCrawlableLocalSitemapGroups,
  getStateSeoDecision,
  getTopicSeoDecision,
  localCityPath,
  localStatePath,
  localStoryPath,
  localTopicPath,
  renderLocalCitiesPage,
  renderLocalCityPage,
  renderLocalStatePage,
  renderLocalStoryPage,
  renderLocalTopicPage,
  TopStoryCard,
  topicLabel,
};
