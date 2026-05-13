# Live News Local Intelligence Engine

## Current Stack Fit

Live News currently runs as a Node/Express app from `server.js`.

- Framework: Express 4.
- Routing: Express routes plus static files in `public/`.
- Data layer: JSON files in `data/` plus in-memory caches.
- Source intake: `rss-parser` for official RSS and public RSS-style feeds.
- Worker/job model: in-process refresh loop with `setInterval(refreshNewsSafely, ...)`; no separate queue or worker service yet.
- Tests: Node script checks under `scripts/`, wired through `npm test`.
- Deployment assumption: single Node service, compatible with Railway-style `PORT` deployment.

This engine is built to match that stack. It does not require a database, login system, API keys, or a new worker process.

## Architecture

The first production-ready version is centered on `lib/local-intelligence-engine.js`.

The engine has five jobs:

1. Build an intake plan from approved public local source definitions.
2. Normalize public source signals into safe local signal records.
3. Classify signals by local topic, city relevance, sensitivity, and confidence.
4. Cluster and deduplicate signals into current local story clusters.
5. Apply public freshness and SEO rules before anything reaches public pages.

The server remains responsible for fetching feeds and resolving city input. The engine remains responsible for source rules, public-window enforcement, clustering, classification, SEO state, and health reporting.

## Data Model

### LocalSource

Stored in `data/local-intelligence-sources.json`.

Fields:

- `id`
- `name`
- `type`
- `enabled`
- `approvedPublicSource`
- `access`
- `collectionMethod`
- `requiresCredentials`
- `robotsPolicy`
- `rateLimit`
- `cursorSupport`
- `notes`

Only approved public source definitions should be enabled. Sources that require private credentials, paywall bypassing, comment scraping, or private user data must stay disabled.

### LocalSignal

Created from public RSS/search/source output.

Fields:

- `id`
- `title`
- `summary`
- `link`
- `sourceName`
- `sourceDomain`
- `publishedAt`
- `category`
- `city`
- `state`
- `topic`
- `topicTags`
- `classification`
- `sourceSafety`

Signals may retain metadata privately for deduplication, source quality, city intelligence, trend detection, and future relevance. They must not copy full publisher articles.

### LocalStoryCluster

Public pages use clusters, not raw unlimited source dumps.

Fields:

- `id`
- `title`
- `summary`
- `link`
- `publishedAt`
- `sourceName`
- `sourceCount`
- `relatedSources`
- `supportingLinks`
- `city`
- `state`
- `topic`
- `topicTags`
- `localRelevanceScore`
- `expiresAt`
- `publicStatus`

## Intake Jobs

The intake model is cursor-friendly.

- `buildLocalIntakePlan(place, queryVariants)` creates approved source requests.
- Each source may support `nextCursor` later.
- The current Google News RSS adapter has no cursor, but the engine is designed so future adapters can process pages until no cursor remains.
- There is no fixed article intake limit. Limits may be used for UI display only, not for source ingestion.

Unlimited intake means Live News does not impose an artificial cap on approved public source signals. It does not mean uncontrolled crawling, private scraping, paywall bypassing, ignoring robots.txt, ignoring source terms, or republishing full copyrighted articles.

The engine should prioritize source types in this order:

- RSS/Atom feeds
- XML sitemaps
- official APIs
- official government and public agency pages
- approved public pages
- user-submitted sources after review
- licensed data providers if added later

Allowed source types include:

- official RSS feeds
- public RSS search feeds
- official city/county/state feeds
- public agency advisories
- public school, transit, weather, court, and civic feeds when permitted
- manual editor-approved public source exports

Blocked intake:

- private accounts
- copied comments
- usernames or personal profiles
- private messages
- paywall bypassing
- full article republication
- scraping against source terms

## Source Text and Public Page Boundaries

Live News must not publish full external article text. Source intake should store only what is needed for classification, deduplication, attribution, summary generation, city/topic intelligence, source quality, and future relevance.

Public story pages must link to original sources, clearly attribute them, and add Live News context with original Live News writing. They should not copy publisher wording, copy sentence structure, copy public comments, or expose full source article text.

Historical source metadata can remain private for deduplication, source quality, city intelligence, trend detection, and future relevance, but expired public story details must not be shown after the 7-day public window.

## Seven-Day Public Expiration

Public story details must be current.

- Public local city/topic lists only show stories from the last 7 days.
- Internal search and category/listing pools must not show expired public story details.
- Expired public story URLs return `410 Gone` or a minimal expired notice without old story details.
- Historical metadata may remain privately for dedupe and intelligence.

The engine exposes:

- `isWithinPublicWindow(item)`
- `filterCurrentPublicStories(items)`
- `getExpiredStoryResponse(story)`

## SEO Rules

- `/sitemap.xml` includes only stable indexable pages.
- `/news-sitemap.xml` includes only internal Live News story pages from the last 48 hours.
- External publisher URLs are never included in Live News sitemaps.
- Thin city/topic pages use `noindex, follow` and are not included in public sitemaps.
- Query-driven city pages are not listed in the regular XML sitemap.
- Story structured data must use exact Live News story URLs when a story page exists.

The engine exposes:

- `isWithinNewsSitemapWindow(story)`
- `getCityPageSeoState({ place, clusters })`

## Privacy Rules

The public site works without login.

Anonymous personalization may use localStorage only for:

- saved city
- followed topics
- last visit time
- seen story IDs
- dismissed prompts

If localStorage is unavailable or blocked, the client falls back to a non-personalized experience.

Do not store:

- usernames
- private messages
- personal profiles
- individual identities
- copied comments
- real tokens
- private admin URLs

## Coverage Health

The server exposes local diagnostics through `/api/health`.

Health fields include:

- request count
- last resolved place
- source count
- signal count
- cluster count
- expired signal count
- source safety warnings
- thin-page SEO state
- summary health

This is operational visibility, not public user profiling.

## Test Plan

Required checks:

- Source registry loads and blocks disabled/non-public sources.
- Intake plan is cursor-capable and does not impose a fixed source item limit.
- Signals older than 7 days are blocked from public output.
- Current signals classify into local topics.
- Similar local signals cluster together with attribution.
- Expired story URLs are eligible for `410 Gone`.
- News sitemap stories are limited to 48 hours.
- Thin city pages return `noindex, follow`.
- LocalStorage personalization has safe fallback behavior.
- Existing writing, social, Meta, local-news, search, SEO, and homepage checks still pass.
