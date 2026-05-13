# Live News Local Intelligence Engine

## Current Stack Fit

Live News currently runs as a Node/Express app from `server.js`.

- Framework: Express 4.
- Routing: Express routes plus static files in `public/`.
- Data layer: JSON files in `data/` plus in-memory caches.
- Source intake: `rss-parser` for official RSS and public RSS-style feeds.
- Job model: in-process refresh loop with `setInterval(refreshNewsSafely, ...)`; no separate queue or worker service yet.
- Tests: Node script checks under `scripts/`, wired through `npm test`.
- Deployment assumption: single Node service, compatible with Railway-style `PORT` deployment.

The first version is designed for the existing stack. It does not require a new database, login system, API key, or worker process.

## Product Rules

Live News local coverage should continuously organize current public local signals into readable, source-linked local story clusters.

Non-negotiable product rules:

- No fixed article intake limit for approved public source signals.
- Intake must use safe pagination or cursor processing where a source supports it.
- Public website content must never show local story details older than 7 days.
- Expired story URLs should return `410 Gone` or a minimal expired notice without showing old story details.
- City and topic pages may remain live, but their story lists must only show stories from the last 7 days.
- Thin city and topic pages must use `noindex, follow` and must not be included in public sitemaps.
- Historical story metadata may be retained privately for deduplication, source quality, city intelligence, trend detection, and future relevance.
- Live News must not republish full articles from other publishers.
- Public story pages must attribute and link to original sources.
- The site must work without login.
- Anonymous personalization must use localStorage only and must gracefully fall back when storage is blocked.

## Source Intake Policy

Unlimited intake means Live News does not impose an artificial cap on approved public source signals.

Unlimited intake does not mean:

- Uncontrolled crawling.
- Scraping private pages.
- Bypassing paywalls.
- Ignoring robots.txt.
- Ignoring source terms.
- Republishing full copyrighted articles.

Preferred source types:

- RSS/Atom feeds.
- XML sitemaps.
- Official APIs.
- Official government and public agency pages.
- Approved public pages.
- User-submitted sources after review.
- Licensed data providers if added later.

Allowed source intake:

- Official RSS feeds.
- Public RSS search feeds.
- Official city, county, and state feeds.
- Public agency advisories.
- Public school, transit, weather, court, and civic feeds when permitted.
- Manual editor-approved public source exports.

Blocked source intake:

- Private accounts.
- Private messages.
- Usernames or personal profiles.
- Copied comments.
- Paywall bypassing.
- Full article republication.
- Scraping against source terms.
- Any source that requires credentials unless explicitly approved and documented.

Source intake should store only what is needed for classification, deduplication, attribution, summary generation, city/topic intelligence, source quality, and future relevance.

## Configuration

The first version uses the existing repository pattern: configuration comes from environment variables with safe code defaults.

Recommended production values:

```bash
STORY_PUBLIC_TTL_DAYS=7
GOOGLE_NEWS_TTL_HOURS=48
SOURCE_FETCH_CONCURRENCY=5
SOURCE_FETCH_TIMEOUT_MS=15000
SOURCE_DEFAULT_RATE_LIMIT_MINUTES=15
CRAWLER_USER_AGENT="LiveNewsBot/1.0 (+https://newsmorenow.com/contact)"
BASE_URL="https://newsmorenow.com"
```

Configuration is validated in `lib/local-intelligence-config.js`.

- Invalid numeric values fall back to safe defaults and return validation warnings.
- `BASE_URL` must be a valid `http` or `https` URL.
- `CRAWLER_USER_AGENT` should include a public contact URL.
- `SOURCE_FETCH_CONCURRENCY` controls safe parallel source fetching.
- `SOURCE_FETCH_TIMEOUT_MS` prevents source fetches from hanging indefinitely.
- `SOURCE_DEFAULT_RATE_LIMIT_MINUTES` is the default source-level rate-limit interval when a source does not define one.

## Seven-Day Public Expiration Policy

Public local story details must be current.

- Public story lists only show stories from the last 7 days.
- City pages only show story clusters from the last 7 days.
- Topic pages only show story clusters from the last 7 days.
- Internal search must not expose expired public story details.
- Article lists must not expose expired public story details.
- Sitemaps must not include expired story URLs.
- Expired story URLs return `410 Gone` or a minimal expired notice without old details.

Private retained metadata may include identifiers, source attribution, hashes, timestamps, city/topic labels, and source-quality signals. It must not expose old public story text after the 7-day window.

Engine helpers:

- `isWithinPublicWindow(item)`
- `filterCurrentPublicStories(items)`
- `getExpiredStoryResponse(story)`

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

Only enabled, approved public source definitions should be used for public intake.

### LocalSignal

Created from approved public source output.

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

Signals are source-linked facts and metadata. They are not full publisher article copies.

### LocalStoryCluster

Public local pages use clusters instead of raw source dumps.

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

### LocalIntelligenceRun

Stored privately in `data/local-intelligence-store.json`.

Fields:

- `id`
- `place`
- `createdAt`
- `publicWindowDays`
- `signalCount`
- `publicSignalCount`
- `expiredSignalCount`
- `clusterCount`
- `health`
- `historicalMetadata`

Historical metadata supports deduplication and coverage intelligence. It must not become public expired story content.

## Job/Worker Flow

The first version runs inside the current server refresh flow and uses a small safe worker abstraction in `lib/local-intelligence-worker.js`. A later version can move the same steps into a queue or separate worker process without changing the product rules.

Flow:

1. Load approved local source registry.
2. Build an intake plan for the requested city, state, and local query variants.
3. Process each approved source request.
4. Follow safe cursor or pagination rules when available.
5. Normalize source items into `LocalSignal` records.
6. Classify each signal by city relevance, topic, source safety, and sensitivity.
7. Deduplicate and cluster related signals.
8. Filter public output to the 7-day window.
9. Save private run metadata and historical dedupe metadata.
10. Return current public clusters to city/topic pages and local APIs.

Worker safety:

- Source fetches run with configured concurrency.
- Source fetches use configured timeout protection.
- Worker results are settled so one source failure does not break the whole local page.
- Current implementation is intentionally simple because the repo does not yet have a queue system.

The intake plan is cursor-friendly:

- `buildLocalIntakePlan(place, queryVariants)` creates approved source requests.
- Each source may support `nextCursor` later.
- The current Google News RSS adapter has no cursor, but future adapters can process pages until no cursor remains.
- UI display limits may exist, but source ingestion should not use a fixed artificial article cap.

## City/Topic Page Behavior

City and topic pages are live public discovery pages, but their story lists must stay current.

City pages should:

- Resolve the requested city and state.
- Show only current clusters from the last 7 days.
- Attribute all source-linked stories.
- Link to original publishers.
- Use noindex, follow when thin.
- Avoid sitemap inclusion when thin or query-driven.
- Continue working when localStorage is unavailable.

Topic pages should:

- Show only current clusters from the last 7 days.
- Use topic classification from local signals.
- Avoid showing expired story details.
- Use noindex, follow when thin.
- Avoid sitemap inclusion when thin.

Thin page criteria should consider:

- Current story count.
- Source diversity.
- City/topic confidence.
- Whether the page has enough useful current public coverage.

## Anonymous Personalization Design

Live News local personalization must not require login.

Allowed localStorage fields:

- Saved city.
- Followed topics.
- Last visit time.
- Seen story IDs.
- Dismissed prompts.

Client behavior:

- Read localStorage only inside safe wrappers.
- If localStorage is blocked, continue with a non-personalized local page.
- Do not send private localStorage identifiers to the server as user profiles.
- Do not store usernames, emails, private messages, personal profiles, or real identities.
- Seen story IDs may be used locally to reduce repeated cards or mark previously seen stories.

The product should feel personalized without creating account-level tracking.

## SEO/Indexing Rules

SEO must prioritize current, useful, indexable pages.

Rules:

- Stable public landing pages can be indexable.
- Thin city/topic pages must use `noindex, follow`.
- Query-driven city pages should not be listed in the regular XML sitemap.
- Expired story URLs should return `410 Gone` or a minimal expired notice.
- Expired story pages should include no old story details.
- External publisher URLs must not be included as Live News sitemap URLs.
- Story structured data must use exact Live News story URLs when a story page exists.
- Trend or source-volume signals may guide ranking but must not add unsupported facts to public copy.

Engine helpers:

- `getCityPageSeoState({ place, clusters })`
- `getExpiredStoryResponse(story)`

## Sitemap Rules

Regular XML sitemap:

- Include only stable indexable Live News pages.
- Exclude expired stories.
- Exclude thin city/topic pages.
- Exclude query-driven local pages.
- Exclude external publisher URLs.

Google News sitemap:

- Include only Live News story pages.
- Include only articles created within the last 48 hours.
- Exclude expired stories.
- Exclude thin city/topic pages.
- Exclude external publisher URLs.

Engine helper:

- `isWithinNewsSitemapWindow(story)`

## Testing Plan

Required checks:

- Source registry loads approved public sources.
- Disabled or non-public sources are blocked.
- Intake plan is cursor-capable.
- Intake has no fixed artificial article limit.
- Signals older than 7 days are blocked from public output.
- Current signals classify into local topics.
- Similar local signals cluster together.
- Public clusters preserve source attribution.
- Expired story URLs are eligible for `410 Gone`.
- News sitemap stories are limited to 48 hours.
- Regular sitemap only includes indexable live pages.
- Thin city/topic pages return `noindex, follow`.
- LocalStorage personalization has safe fallback behavior.
- Public pages do not show full publisher articles.
- Public pages link to original sources.
- Existing writing, social, Meta, local-news, search, SEO, and homepage checks still pass.

Primary check script:

- `node scripts/check-local-intelligence-engine.js`

Recommended full verification:

```bash
npm test
node scripts/check-writing-intelligence.js
node scripts/check-social-intelligence.js
node scripts/check-meta-publishing.js
node scripts/check-local-intelligence-engine.js
```

## Privacy and Copyright Guardrails

Privacy guardrails:

- No login required.
- No private profile building.
- No usernames.
- No private messages.
- No personal profiles.
- No individual identities.
- No copied comments.
- No real tokens in docs, tests, logs, or rendered pages.
- No private admin URLs in memory records.

Copyright and source guardrails:

- Do not republish full external article text.
- Do not copy publisher wording or sentence structure.
- Do not copy public comments.
- Do not treat comments as verified facts.
- Store only source-linked metadata needed for classification, deduplication, attribution, summary generation, and private quality signals.
- Public story pages must link to original sources.
- Public story pages must add Live News context using original Live News writing.
- Respect robots.txt, source terms, rate limits, paywalls, and licensing boundaries.

This engine is a local intelligence and source-linking layer, not a full-text republication system.
