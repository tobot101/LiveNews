function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function absoluteUrl(origin, value) {
  if (!value) return origin;
  try {
    return new URL(value, origin).toString();
  } catch {
    return origin;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderSourceList(story) {
  const sources = story.supportingSources?.length
    ? story.supportingSources
    : [
        {
          sourceName: story.primarySourceName || "Original source",
          sourceUrl: story.originalSourceUrl,
        },
      ];
  return sources
    .filter((source) => source.sourceUrl)
    .map(
      (source, index) => `
        <li>
          <span>${index === 0 ? "Original source" : "Supporting source"}</span>
          <a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(source.sourceName || source.domain || source.sourceUrl)}
          </a>
        </li>
      `
    )
    .join("");
}

function buildNewsArticleSchema(story, origin) {
  const canonicalUrl = absoluteUrl(origin, story.canonicalUrl || story.liveNewsUrl);
  return {
    "@context": "https://schema.org",
    "@type": story.schemaType || "NewsArticle",
    headline: story.headline,
    description: story.metaDescription || story.summaryShort || story.dek,
    datePublished: story.publishedAt,
    dateModified: story.updatedAt || story.publishedAt,
    mainEntityOfPage: canonicalUrl,
    author: {
      "@type": "Organization",
      name: "Live News",
    },
    publisher: {
      "@type": "Organization",
      name: "Live News",
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl(origin, "/favicon-192.png"),
      },
    },
    isBasedOn: story.originalSourceUrl ? [story.originalSourceUrl] : undefined,
    citation: (story.supportingSources || []).map((source) => source.sourceUrl).filter(Boolean),
  };
}

function renderPublicStoryPage(story, options = {}) {
  const origin = options.origin || "https://newsmorenow.com";
  const canonicalUrl = absoluteUrl(origin, story.canonicalUrl || story.liveNewsUrl);
  const title = story.metaTitle || `${story.headline} | Live News`;
  const description = story.metaDescription || story.summaryShort || story.dek || "";
  const schema = buildNewsArticleSchema(story, origin);
  const summary = Array.isArray(story.summary) ? story.summary : [story.summary].filter(Boolean);
  const keyPoints = (story.keyPoints || [])
    .map((point) => `<li>${escapeHtml(point)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en" data-theme="day">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:title" content="${escapeHtml(story.headline)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <link rel="shortcut icon" href="/favicon.png" />
    <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Newsreader:wght@400;600;700&family=Space+Grotesk:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <script>
      (() => {
        try {
          const mode = localStorage.getItem("ln_mode") || "auto";
          const now = new Date();
          const minutes = now.getHours() * 60 + now.getMinutes();
          const autoNight = minutes >= 1170 || minutes <= 330;
          const theme = mode === "night" || (mode === "auto" && autoNight) ? "night" : "day";
          document.documentElement.setAttribute("data-theme", theme);
        } catch {}
      })();
    </script>
    <script type="application/ld+json">${escapeJson(schema)}</script>
  </head>
  <body class="story-body-page">
    <header class="topbar story-topbar">
      <a class="brand" href="/" aria-label="Live News home">
        <img class="brand-mark" src="/brand-mark.png" alt="" aria-hidden="true" />
        <span class="brand-text">
          <span class="brand-title">Live News</span>
          <span class="brand-sub">Anytime &amp; Anywhere</span>
        </span>
      </a>
    </header>
    <main class="story-page">
      <article class="story-shell">
        <div class="story-kicker">
          <span>${escapeHtml(story.category || "Top")}</span>
          <span>Source-linked coverage</span>
          <span>Approved</span>
        </div>
        <h1>${escapeHtml(story.headline)}</h1>
        <p class="story-dek">${escapeHtml(story.dek || story.summaryShort || "")}</p>
        <div class="story-page-actions">
          ${
            story.originalSourceUrl
              ? `<a class="story-action source-action" href="${escapeHtml(story.originalSourceUrl)}" target="_blank" rel="noopener noreferrer">Read original source</a>`
              : ""
          }
          <a class="story-action" href="/">Browse more Live News</a>
        </div>
        <div class="story-timestamp">
          Last updated ${escapeHtml(formatDate(story.updatedAt || story.publishedAt))}
        </div>
        <section class="story-section">
          <h2>Summary</h2>
          ${summary.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </section>
        <section class="story-section story-facts">
          <h2>Story facts</h2>
          <ul>${keyPoints}</ul>
        </section>
        <section class="story-section">
          <h2>Why it matters</h2>
          <p>${escapeHtml(story.whyItMatters || "This story helps readers understand a recent development while keeping the original source attached for verification.")}</p>
        </section>
        <section class="story-section source-card">
          <h2>Sources</h2>
          <p>${escapeHtml(story.sourceAttribution || story.sourceBlock?.attribution || "Live News links readers back to the original source.")}</p>
          <ul>${renderSourceList(story)}</ul>
        </section>
      </article>
    </main>
  </body>
</html>`;
}

function renderStoryNotFoundPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Story not found | Live News</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header class="topbar story-topbar">
      <a class="brand" href="/" aria-label="Live News home">
        <img class="brand-mark" src="/brand-mark.png" alt="" aria-hidden="true" />
        <span class="brand-text">
          <span class="brand-title">Live News</span>
          <span class="brand-sub">Anytime &amp; Anywhere</span>
        </span>
      </a>
    </header>
    <main class="story-page">
      <section class="story-shell">
        <div class="story-kicker"><span>Live News</span></div>
        <h1>Story not found</h1>
        <p class="story-dek">This Live News article is not public yet or has not been approved.</p>
      </section>
    </main>
  </body>
</html>`;
}

module.exports = {
  absoluteUrl,
  escapeHtml,
  renderPublicStoryPage,
  renderStoryNotFoundPage,
};
