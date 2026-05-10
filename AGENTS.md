# Live News Codex Instructions

## Project Identity

Live News is a readability-first, low-clutter, source-respectful news website with the tagline:

Anytime & Anywhere

The private social publishing app creates Facebook and Instagram post drafts that drive readers to exact Live News article pages.

The app is not a public community hub.
The app is not a generic social network.
The app is not a comment scraper.
The app is not an auto-poster for sensitive news.

## Non-Negotiable Publishing Rules

- Never request, print, log, or expose real Railway tokens, Meta tokens, admin tokens, browser URLs containing tokens, or private credentials.
- Use placeholders such as `YOUR_ADMIN_TOKEN`, `YOUR_META_ACCESS_TOKEN`, and `YOUR_PAGE_ID` in docs and tests.
- Social posts must point to exact internal Live News story URLs under `/stories/...`.
- Never post the homepage as the article link.
- Human approval remains required before publishing.
- Auto-posting must remain disabled unless explicitly requested later.
- Public captions must not include internal workflow language such as:
- `review-only`
- `source packet`
- `draft packet`
- `teacher layer`
- `private dashboard`
- `API test`
- Social posts must respect attribution and original source links.
- Social posts must use Live News wording.
- Do not copy publisher wording.
- Do not copy public comments.
- Do not learn from private messages, profiles, usernames, or personal identifiers.
- Learn only from aggregate metrics and editor-approved lessons.

## Public Safety Framing Rule

Public safety is not a default Live News social angle.

Do not frame ordinary stories as public safety stories.

Use public safety framing only when the article itself clearly supports it, such as:

- Official advisory.
- Emergency alert.
- Evacuation.
- Road closure.
- Recall.
- Missing person alert.
- Active disaster.
- Health warning.
- Weather warning.
- Source-backed safety instruction.

Weather does not automatically equal public safety.
Local news does not automatically equal public safety.
Crime does not automatically equal public safety.
Traffic does not automatically equal public safety unless the article is about an active closure, warning, or official advisory.

When public safety is not explicitly supported:

- Do not use safety-warning captions.
- Do not use safety hashtags.
- Do not say "stay safe".
- Do not say "officials urge" unless the article says that.
- Do not make public safety the reader angle.

## Facebook Rules

Facebook posts should be clear, human-readable, link-friendly, and source-respectful.

Required Facebook package fields:

- `title`
- `message`
- `description`
- `exactArticleUrl`
- `sourceAttribution`
- `hashtags`
- `safetyScore`
- `teacherChecks`
- `publishPlan`

Facebook captions should usually follow this structure:

1. Useful human-readable lead.
2. One sentence of article context.
3. Source-linked attribution when available.
4. Exact call to action: `Read the Live News page: {{exactArticleUrl}}`
5. Small relevant hashtag set.

Avoid stiff openings such as:

- `Top Story:`
- `Breaking:`
- `You won't believe`
- `Shocking`
- `Internet reacts`
- `Fans are saying`

## Instagram Rules

Instagram packages must be more visual and card-aware than Facebook.

Required Instagram package fields:

- `caption`
- `shortTitle`
- `cardTitle`
- `cardSubtitle`
- `imageUrl` or `generatedCardUrl`
- `altText`
- `hashtags`
- `storyText`
- `carouselSlides`
- `safetyScore`
- `teacherChecks`
- `publishPlan`

Instagram should not be published unless it has a durable public image URL or a generated social card that passes validation.

Instagram captions should usually follow this structure:

1. Strong visual or human-interest first line.
2. Short context.
3. Source-safe article framing.
4. Link-in-bio or Live News page CTA, depending on current product routing.
5. Small relevant hashtag set.

## Caption Intelligence Rules

Every generated post must answer:

- What happened?
- Why does it matter to readers?
- What is the safest source-backed angle?
- What platform is this for?
- What should not be overstated?
- Does the caption match the article exactly?
- Does the caption add unsupported claims?

Generate at least 3 variants:

- Source-first.
- Reader-impact.
- Platform-engagement.

The editor should be able to choose one variant.

## Safety Categories Requiring Human Review

Always require human review for:

- Crime.
- Death.
- Injury.
- Politics.
- Lawsuits.
- Children or minors.
- Health or medical stories.
- Legal allegations.
- Disasters.
- Active emergency alerts.
- Active official advisories.

Do not use "public safety" as a broad default sensitive category.

## Growth Memory Rules

Allowed learning:

- Reach.
- Views.
- Likes count.
- Comments count.
- Shares.
- Saves.
- Link clicks.
- Profile visits.
- Follows.
- Hides.
- Reports.
- Posting time.
- Category.
- Caption shape.
- Media shape.
- Exact article clicks.
- Editor-selected variant.

Blocked learning:

- Private messages.
- Usernames.
- Personal profiles.
- Individual identities.
- Copied comment text.
- Copied creator language.
- Unsupported facts from comments.
- Outrage bait.
- Unrelated hashtags.
- Misleading captions.

## Testing Expectations

After modifying JavaScript files, run:

```bash
npm test
node scripts/check-social-intelligence.js
node scripts/check-meta-publishing.js
```

If a test does not exist for new behavior, add one.

## Acceptance Standard

A change is not complete unless:

- Exact `/stories/...` link enforcement still works.
- Homepage link blocking still works.
- Human approval gate still works.
- Facebook publishing guard still works.
- Instagram media readiness is validated.
- Social captions avoid internal workflow terms.
- Public safety is conditional only, not default.
- Teacher checks catch generic, copied, unsupported, or unrelated captions.
- Tests pass.
