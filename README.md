# LiveNews

Breaking Grid layout with a 75/25 split, time-aware theming, and refresh controls.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:8080`.

## Features included
- Daylight palette: Cool Blue-Gray.
- Night palette: Breaking Grid Night.
- Auto theme (time-based) with manual Day/Night/Auto toggle.
- Refresh controls: 3m / 10m / Off (Off requires login).
- Main column for Top/Trending/Most Clicked, followed by feed.
- Right rail for Local News + Community Hub (no ads).
- Opt-in cookie consent modal and GPC-aware behavior.
- Live RSS ingestion from verified sources (BBC News, PBS NewsHour, The Guardian, TechCrunch) with 48-hour cutoff.
- Auto-refresh respects user visibility: updates only replace current items once they are seen or near the 48-hour limit.
- Source diversity: top stories and feed are interleaved so one outlet doesn’t dominate the list.
- Granular cookie preferences for functional, personalization, and analytics, with easy opt-out and GPC support.
- Personalization uses an anonymous first-party ID cookie and on-device reading history; analytics stays on-device and prunes data regularly.
- News feed includes a user toggle to show 30/50/100 items, grouped by time buckets for easier scanning.
- Local hub includes a Census-based city picker (19,805 incorporated places; CDPs excluded) plus nearest-city lookup from geolocation.
- Local stories are fetched by city query and always link back to the original source; short summaries come from the RSS description only.

## Source usage notes
- TechCrunch RSS terms allow display with attribution + link and no ads; do not add ads if TechCrunch feeds remain active.
- The Guardian RSS help page states feeds are for personal, non-commercial use; keep this non-commercial unless you obtain permission.

## News ingestion settings
- `NEWS_MAX_AGE_HOURS` (default: 48)
- `NEWS_REFRESH_INTERVAL_MINUTES` (default: 10)
- `NEWS_FEED_LIMIT` (default: 120)
- Update `data/sources.json` to add or remove official RSS sources.
- Local city data lives in `data/us-places.json` (generated from the 2024 Census Gazetteer Places file).
