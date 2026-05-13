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

Do not write source jobs that process only a fixed first batch forever. Public UI may display a reasonable first page, but ingestion jobs must continue processing all approved fresh signals by using feed pagination, sitemaps, API cursors, or source-specific cursor fields where available.

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

- `0-48 hours`: stories are public, eligible for the Google News sitemap, eligible for city/topic pages, and eligible for alerts or newsletters.
- `Day 3-7`: stories are public and still eligible for city/topic pages, but are not eligible for the Google News sitemap.
- `After day 7`: stories are not public, not eligible for city/topic pages, not eligible for internal public search, not eligible for any sitemap, and direct URLs return `410 Gone` or a minimal expired notice.
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
- `isPublicStoryLive(story)`
- `getLiveStoriesForCity(cityId)`
- `getLiveStoriesForTopic(cityId, topic)`
- `expireOldStories()`

## Data Model

The repo currently uses JSON files as its data layer. The Local Intelligence Engine models the requested database tables as JSON-backed collections with normalizers and validators in `lib/local-intelligence-models.js`. If Live News later moves to Prisma, Drizzle, or SQL, these schemas should become the migration source of truth.

### cities

Stored in `data/local-cities.json`.

Fields:

- `id`
- `name`
- `slug`
- `state_name`
- `state_slug`
- `state_abbr`
- `county_name`
- `timezone`
- `latitude`
- `longitude`
- `population`
- `coverage_score`
- `index_status`: `watch`, `noindex`, or `index`
- `last_fresh_story_at`
- `created_at`
- `updated_at`

### local_sources

Stored in `data/local-sources.json`.

Fields:

- `id`
- `name`
- `slug`
- `homepage_url`
- `source_type`: `local_news`, `tv`, `radio`, `official_city`, `official_county`, `police_fire`, `school`, `transit`, `weather`, `event`, `blog`, `community`, `sports`, or `other`
- `trust_level`: `official`, `established_publisher`, `community`, `blog`, or `unknown`
- `crawl_status`: `active`, `paused`, `blocked_by_robots`, `failed`, or `pending_review`
- `robots_checked_at`
- `last_successful_fetch_at`
- `last_failed_fetch_at`
- `created_at`
- `updated_at`

### source_feeds

Stored in `data/source-feeds.json`.

Fields:

- `id`
- `source_id`
- `feed_type`: `rss`, `atom`, `sitemap`, `api`, or `html`
- `url`
- `active`
- `fetch_frequency_minutes`
- `last_fetched_at`
- `next_fetch_at`
- `etag`
- `last_modified_header`
- `created_at`
- `updated_at`

### source_city_coverage

Stored in `data/source-city-coverage.json`.

Fields:

- `source_id`
- `city_id`
- `confidence`
- `coverage_type`: `primary`, `nearby`, `statewide`, or `regional`

### source_fetch_runs

Stored in `data/source-fetch-runs.json`.

Fields:

- `id`
- `source_feed_id`
- `started_at`
- `finished_at`
- `status`: `success`, `failed`, or `skipped`
- `status_code`
- `items_found`
- `items_new`
- `error_message`

### input_signals

Stored in `data/input-signals.json`.

Fields:

- `id`
- `source_id`
- `source_feed_id`
- `canonical_url`
- `original_url`
- `title`
- `excerpt`
- `author`
- `published_at`
- `discovered_at`
- `fetched_at`
- `content_hash`
- `url_hash`
- `raw_source_type`
- `city_candidates_json`
- `topic_candidates_json`
- `entities_json`
- `language`
- `signal_status`: `new`, `classified`, `clustered`, `rejected`, or `expired_private`
- `rejection_reason`
- `created_at`
- `updated_at`

### story_clusters

Stored in `data/story-clusters.json`.

Fields:

- `id`
- `city_id`
- `primary_topic`
- `slug`
- `headline`
- `summary`
- `confidence_label`: `official`, `confirmed_multiple_sources`, `reported_one_source`, `community_source`, `developing`, or `low_confidence`
- `urgency`: `breaking`, `high`, `normal`, or `low`
- `first_seen_at`
- `last_updated_at`
- `public_started_at`
- `expires_at`
- `public_status`: `live`, `expired`, `hidden`, or `rejected`
- `index_status`: `noindex` or `index`
- `source_count`
- `official_source_count`
- `latest_signal_id`
- `created_at`
- `updated_at`

### story_cluster_signals

Stored in `data/story-cluster-signals.json`.

Fields:

- `story_cluster_id`
- `input_signal_id`
- `source_id`
- `is_primary`
- `added_at`

### story_cluster_events

Stored in `data/story-cluster-events.json`.

Fields:

- `id`
- `story_cluster_id`
- `event_time`
- `event_type`: `first_seen`, `source_added`, `official_update`, `summary_updated`, `confidence_changed`, or `expired`
- `description`
- `created_at`

### city_topic_coverage

Stored in `data/city-topic-coverage.json`.

Fields:

- `id`
- `city_id`
- `topic`
- `fresh_story_count_24h`
- `fresh_story_count_7d`
- `source_count_7d`
- `official_source_count_7d`
- `coverage_score`
- `index_status`: `watch`, `noindex`, or `index`
- `last_updated_at`

### user_submitted_sources

Stored in `data/user-submitted-sources.json`.

Fields:

- `id`
- `submitted_url`
- `submitted_city`
- `submitted_email_optional`
- `status`: `pending`, `approved`, or `rejected`
- `notes`
- `created_at`
- `reviewed_at`

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

## Source Registry Service

The source registry service lives in `lib/local-source-registry.js`.

Required functions:

- `createSource()`
- `updateSource()`
- `addSourceFeed()`
- `pauseSource()`
- `markRobotsBlocked()`
- `getSourcesDueForFetch()`
- `getSourceHealth()`
- `submitUserSource()`
- `approveUserSource()`

Source registry behavior:

- Sources marked `blocked_by_robots` are not due for fetch.
- Sources marked `paused`, `failed`, or `pending_review` are not due for fetch.
- Feeds marked inactive are not due for fetch.
- Feeds with runtime query templates are not fetched as standalone jobs.
- Source health reports feed count, active feed count, due feed count, latest run, successes, failures, and current crawl status.
- User-submitted sources remain pending until reviewed.
- Approved user-submitted sources default to `pending_review` unless an editor explicitly activates them.

## Source Fetcher Service

The source fetcher service lives in `lib/local-source-fetcher.js`.

Supported functions:

- `fetchRssFeed(feed)`
- `fetchAtomFeed(feed)`
- `fetchSitemap(feed)`
- `fetchApiFeed(feed)`
- `fetchHtmlSource(feed)` only when explicitly allowed
- `normalizeUrl(url)`
- `canonicalizeUrl(url)`
- `dedupeByUrlHash(url)`
- `dedupeByContentHash(title, excerpt, publishedAt)`
- `createInputSignal(signal)`

Fetch behavior:

- Use source-specific rate limits through `source_feeds.next_fetch_at` and `fetch_frequency_minutes`.
- Use `ETag` and `Last-Modified` headers where a source supports them.
- Skip sources marked `blocked_by_robots`.
- Skip sources requiring login.
- Skip paywalled content.
- Log every fetch run in `source_fetch_runs`.
- Use retries with backoff for temporary failures.
- Never throw away the whole job because one source fails.
- Use cursor/pagination processing for API feeds instead of fixed article limits.
- HTML source fetching is disabled unless explicitly allowed on the source or feed.
- Public HTML extraction must stay minimal and source-linked; do not store full article text.
- Newly stored source items are classified and then passed into story clustering.
- Source fetches continue even if one item cannot be classified or clustered.

## Signal Classification Service

The deterministic classification service lives in `lib/local-signal-classifier.js`.

It assigns every input signal to:

- City candidates.
- Topic candidates.
- Urgency.
- Source type.
- Overall confidence.
- Local entities.

The first production version is deterministic. If Live News later adds an AI/LLM classifier, it should be added as a clean extension point after deterministic classification, not as a blocker for this phase.

City classification uses:

- Existing `source_city_coverage` mappings.
- City and state names in the signal title, excerpt, and URL context.
- County references.
- Neighborhood references when a city record provides them.
- Latitude/longitude when a source provides coordinates.
- Official source mapping from `local_sources`.

Topic classification uses:

- Keyword rules.
- Source type.
- Title and excerpt text.
- Official agency type.

Canonical local topics:

- `breaking`
- `crime-public-safety`
- `traffic`
- `weather`
- `schools`
- `city-hall`
- `events`
- `sports`
- `local-economy`
- `health`
- `transit`
- `housing`
- `courts`
- `community`

Classification output is stored on `input_signals` using existing JSON fields:

- `city_candidates_json`
- `topic_candidates_json`
- `entities_json.local_entities`
- `entities_json.localClassification`

`entities_json.localClassification` includes:

- `classifierVersion`
- `urgency`
- `urgencyReasons`
- `source_type`
- `source_trust_level`
- `confidence`
- `status`

Public safety handling remains conditional. Ordinary weather, local, traffic, or crime labels do not automatically become a public-safety angle unless the signal itself contains source-backed alert, closure, evacuation, advisory, warning, missing-person, recall, or emergency language.

## Story Clustering Service

The story clustering service lives in `lib/local-story-clustering.js`.

Its job is to make many public source signals about the same local event become one Live News story cluster.

Matching signals:

- Shared canonical URL.
- Shared URL hash.
- Shared content hash.
- Similar normalized titles.
- Same city candidate.
- Same primary topic.
- Same 72-hour event window.
- Shared local entities.
- Same official incident, case, alert, advisory, permit, project, or entity reference.
- Official-source relationship from government, school, transit, weather, police/fire, or similar public agencies.

When a signal matches an existing live cluster:

- Attach the signal through `story_cluster_signals`.
- Update `source_count`.
- Update `official_source_count`.
- Update `last_updated_at`.
- Update `latest_signal_id`.
- Upgrade `confidence_label` if stronger evidence appears.
- Create a `story_cluster_events` row such as `source_added`, `official_update`, or `confidence_changed`.

When no matching cluster exists:

- Create a new `story_clusters` row.
- Create the primary `story_cluster_signals` row.
- Create a `first_seen` story cluster event.
- Set `public_started_at` from the signal time.
- Set `expires_at` to `public_started_at + STORY_PUBLIC_TTL_DAYS`.

Confidence labels:

- `official`: an official government, school, transit, weather, police/fire, or similar source is attached.
- `confirmed_multiple_sources`: at least two distinct established sources report the same event.
- `reported_one_source`: one established publisher source reports the event.
- `community_source`: community/blog source without official or established publisher confirmation.
- `developing`: story is changing or lacks complete detail.
- `low_confidence`: weak source or unclear locality; set `noindex` and do not alert.

## Story Expiration Job

The story expiration job lives in `lib/local-story-expiration.js`.

The job keeps public local coverage fresh without deleting private intelligence metadata.

Rules enforced by the job:

- `isPublicStoryLive(story)` returns true only when `public_status` is `live`, `public_started_at` is within the configured 7-day window, and `expires_at` is still in the future.
- `expireOldStories()` marks clusters older than the public window as `public_status: expired` and `index_status: noindex`.
- Expiration creates a `story_cluster_events` row with `event_type: expired`.
- Expired clusters remain in private JSON storage for deduplication, source quality, city intelligence, and future relevance.
- `getLiveStoriesForCity(cityId)` and `getLiveStoriesForTopic(cityId, topic)` return only live clusters from the last 7 days.
- `getPublicSearchableStoryClusters()` excludes expired clusters from public internal search.
- `getRegularSitemapStoryClusters()` excludes expired clusters and only returns indexable live clusters.
- `getGoogleNewsSitemapStoryClusters()` only returns indexable live clusters inside the configured 48-hour Google News window.
- Direct expired cluster URLs return `410 Gone` or the minimal expired notice, without old story details.

The Express refresh loop runs the expiration job before the normal news refresh so stale clusters are removed from public eligibility before new responses are built.

## City/Topic Page Behavior

City and topic pages are live public discovery pages, but their story lists must stay current.

Crawlable local routes:

- `/local`
- `/local/[stateSlug]`
- `/local/[stateSlug]/[citySlug]`
- `/local/[stateSlug]/[citySlug]/[topic]`
- `/local/[stateSlug]/[citySlug]/story/[storySlug]`

City pages should:

- Resolve the requested city and state.
- Show only current clusters from the last 7 days.
- Show the city name and state.
- State that Live News shows live updates from the last 7 days.
- Show a last-updated timestamp.
- Include Local Pulse metrics.
- Include What changed today.
- Include top story clusters.
- Include topic modules.
- Include official sources.
- Include a local source directory.
- Include nearby cities.
- Include save-city, follow-topic, and newsletter placeholder CTAs.
- Attribute all source-linked stories.
- Link to original publishers.
- Use noindex, follow when thin.
- Avoid sitemap inclusion when thin or query-driven.
- Continue working when localStorage is unavailable.

Topic pages should:

- Show only current clusters from the last 7 days.
- Show topic-specific live story clusters.
- Show a last-updated timestamp.
- Show the topic source mix.
- Show confidence labels.
- Include save-city, follow-topic, and newsletter placeholder CTAs.
- Use topic classification from local signals.
- Avoid showing expired story details.
- Use noindex, follow when thin.
- Avoid sitemap inclusion when thin.

Local story pages should:

- Show a Live News summary.
- Show the confidence label.
- Link to original sources.
- Show a timeline.
- Show the latest update.
- Include original source attribution.
- Link back to the city and topic pages.
- Return `410 Gone` or a minimal expired notice after expiration.

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

Live News stores these anonymous preferences under `liveNews:v1:prefs`.

Preference shape:

```json
{
  "savedCity": {
    "cityId": "los-angeles-ca",
    "citySlug": "los-angeles",
    "stateSlug": "california",
    "label": "Los Angeles, CA"
  },
  "followedTopics": {
    "los-angeles-ca": ["traffic", "weather", "schools"]
  },
  "lastVisitByCity": {
    "los-angeles-ca": "2026-05-13T09:00:00-07:00"
  },
  "seenStoryIdsByCity": {
    "los-angeles-ca": ["story_1", "story_2"]
  },
  "promptHistory": {
    "save_city": { "status": "accepted", "updatedAt": "..." },
    "newsletter": { "status": "dismissed", "dismissedUntil": "..." },
    "push_alerts": { "status": "not_asked" }
  },
  "updatedAt": "..."
}
```

Preference helper API lives in `src/lib/personalization/liveNewsPrefs.ts` and the browser-safe runtime mirror lives in `public/live-news-prefs.js`.

Required helpers:

- `getLiveNewsPrefs()`
- `saveLiveNewsPrefs(prefs)`
- `clearLiveNewsPrefs()`
- `setSavedCity(city)`
- `getSavedCity()`
- `followTopic(cityId, topic)`
- `unfollowTopic(cityId, topic)`
- `getFollowedTopics(cityId)`
- `markCityVisited(cityId, visibleStoryIds)`
- `getSeenStoryIds(cityId)`
- `getNewStoriesSinceLastVisit(cityId, currentStories)`
- `dismissPrompt(promptKey, days)`
- `shouldShowPrompt(promptKey)`

Prompt behavior:

- First city visit can ask: "Make Los Angeles your local page?"
- Returning visit can say: "8 new updates since your last visit."
- Repeated topic interest can ask: "Follow Los Angeles traffic updates?"
- After multiple visits, Live News can show a newsletter placeholder: "Get the Los Angeles Morning Brief?"
- If a prompt is dismissed, do not show it again until `dismissedUntil`.

Client behavior:

- Read localStorage only inside safe wrappers.
- If localStorage is blocked, continue with a non-personalized local page.
- Do not send private localStorage identifiers to the server as user profiles.
- Do not store usernames, emails, private messages, personal profiles, or real identities.
- Seen story IDs may be used locally to reduce repeated cards or mark previously seen stories.
- Do not store sensitive personal information in localStorage.
- Do not fingerprint users.
- Do not use third-party tracking for this feature.
- Provide a "Clear local preferences" control.

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
- Input signals classify into city candidates, topic candidates, urgency, source type, confidence, and local entities.
- City classification uses source coverage, title/excerpt location text, county/neighborhood references, coordinates, and official source mapping.
- Topic classification uses keyword rules, source type, title/excerpt text, and official agency type.
- Similar signals about the same local event attach to one durable story cluster.
- Cluster matches use URL/hash, city/topic/time/title similarity, shared entities, and official incident references.
- Cluster updates create story cluster events and preserve source attribution.
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
