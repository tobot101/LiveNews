# LiveNews Project Notes

Last updated: 2026-04-12 (America/Los_Angeles)

## User Intent
- Use the "LIveNews setup" PDF as the base spec for a new Railway project.
- Not ready to deploy yet; wants to decide on website colors, organization, columns, advertising section, and other layout/UX elements first.
- Wants all provided info captured for later use.

## From "LIveNews setup.pdf"
- Goal & scope: fast news web app with frequent refresh, personalized feeds, local coverage; community discussions with likes/comments/reporting.
- Project setup: Node/Express app with static frontend; deployed on Railway using GitHub integration; clean repo with .gitignore.
- Core news feed:
- Categories: Top, International, National, Business, Tech, Sports, Entertainment.
- Scope filter: All, National, International, Local.
- Latest-first timeline with stable refresh ordering.
- Article count selector: 15/20/30/50.
- Refresh interval controls: 3 min, 10 min.
- "Verified Radar" page for primary + major outlets.
- Personalization & consent: opt-in consent modal for personalization/analytics/ads; only personalize on consent; respect GPC.
- Local news: use my location + manual city input; local news page and hub routing; improved geocoding to city/state only; local outlet list for 30 major US cities; city-scoped community hubs.
- YouTube radar: search; categories; trending/recency (last 5 days); discuss link from YouTube items.
- Thumbnails/images: RSS/OG images; ScreenshotMax fallback; fixed layout alignment and badge overlap.
- Community hub: Firebase Auth; posts/likes/comments/report flow; edit/delete rules (authors); global + local hubs.
- Reliability/performance: refresh on wake/online; cache feeds; Railway OOM tuning and env changes; reduced concurrency.
- Key files: server.js, app.js, community.js, local.html, verified.html, community-hub.html, community-local.html, agents/sources.json, data/news.json, data/deals.json.
- Env vars: FEED_REFRESH_MAX_AGE_MS, FEED_MAX_ITEM_AGE_MS, FEED_DISPLAY_MAX_AGE_MS, FEED_MIN_RECENT_ITEMS, RSS_MAX_ITEMS, IMAGE_LOOKUP_CONCURRENCY, IMAGE_LOOKUP_LIMIT, SCREENSHOTMAX_KEY, SCREENSHOTMAX_FALLBACK_LIMIT, SCREENSHOTMAX_WIDTH, SCREENSHOTMAX_HEIGHT, SCREENSHOTMAX_QUALITY, YT_API_KEY, FIREBASE_SERVICE_ACCOUNT.

## From Screenshots
- Railway shows "LiveNews" service active and online; domain livenews-production-4b04.up.railway.app; deploy log indicates `node server.js` and "Running on 8080" (Apr 11, 2026, 7:27 PM PDT).
- GitHub repo "LiveNews" (public) has initial commit and README tagline: "A fast, personalized news hub with verified coverage, local radar, and subscription-ready features."
- Terminal shows push to https://github.com/tobot101/LiveNews.git and main branch tracking origin/main.

## Pending Decisions (Design)
- Color palette and overall visual theme.
- Layout organization and column strategy.
- Advertising section placement and format.
- Homepage information hierarchy and navigation model.

## Design Decisions (Captured)
- Preferred direction: "Breaking Grid".
- Night-time theme should adapt based on the user's local time zone.
- Daylight palette choice: "Cool Blue-Gray" (calm, crisp, low glare).
- Night mode: lock "Breaking Grid" for the night theme.
- Theme switch logic: if cookies are enabled, switch based on the user's local time zone. If cookies are not enabled, use 7:30 PM to 5:30 AM.
- Theme toggle: user can manually switch Daylight/Night mode.
- Layout: 75% main column for important/trending/most-clicked news across the web; beneath/after that, the news feed.
- Right rail: 25% column with local news option (use location if cookies allowed; otherwise allow manual county/city input), plus Community Hub with login & sign up.
- Night palette (Breaking Grid): background #0B1220, surface #0F172A, text #E2E8F0, accent red #EF4444, accent cyan #22D3EE.
- Refresh control: user-selectable auto refresh at 3 or 10 minutes; allow turning refresh off when logged in.

## Next Steps (When Ready)
- Choose a layout direction and palette.
- Confirm whether to deploy via Railway GitHub integration or Railway CLI.
- Generate exact Railway deployment commands after design choices are set.
