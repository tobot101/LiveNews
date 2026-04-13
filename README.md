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
- Right rail for Local News + Community Hub + Sponsor slot.
- Opt-in cookie consent modal and GPC-aware behavior.
- Live RSS ingestion from verified sources (BBC News, PBS NewsHour) with 48-hour cutoff.

## News ingestion settings
- `NEWS_MAX_AGE_HOURS` (default: 48)
- `NEWS_REFRESH_INTERVAL_MINUTES` (default: 10)
- Update `data/sources.json` to add or remove official RSS sources.
