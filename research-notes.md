# LiveNews Research Notes

Last updated: 2026-04-12 (America/Los_Angeles)

## Advertising Standards (IAB)
- IAB New Ad Portfolio emphasizes flexible, aspect-ratio-based ad units and LEAN principles (lightweight, encrypted, AdChoices supported, non-invasive). This supports responsive layouts and cross-screen delivery.
- Common fixed sizes still widely used and supported in the IAB portfolio include: 728x90 (leaderboard), 300x250 (medium rectangle), 160x600 (wide skyscraper), 300x600 (half page), 970x250 (billboard), 320x50 (mobile banner).
- For the right rail in Breaking Grid, 300x600 or 300x250 are the most practical starting slots.

Sources:
- IAB Tech Lab New Ad Portfolio: Advertising Creative Guidelines (2024)
- IAB New Standard Ad Unit Portfolio PDF

## Auto-Refresh + Accessibility
- WCAG 2.2.2 requires that auto-updating content provide a mechanism to pause/stop/hide or control update frequency unless essential. This supports our 3m / 10m / Off refresh control.
- When content updates in place, use live regions to inform assistive tech when updates are important (avoid focus jumps).

Sources:
- W3C WAI WCAG 2.2.2 Understanding: Pause, Stop, Hide
- WAI-ARIA guidance on live regions

## Privacy Signals (GPC)
- Global Privacy Control (GPC) lets users signal they do not want data sold/shared. It’s a proposed specification supported by browsers/extensions.
- GPC can be detected via the `Sec-GPC` request header and `navigator.globalPrivacyControl` in JavaScript.

Sources:
- Global Privacy Control FAQ
- MDN: Sec-GPC header

## Geolocation & Local News
- Geolocation API requires HTTPS (secure context) and explicit user permission. If denied, fall back to manual county/city input.

Sources:
- MDN: Geolocation API
