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

## Live News Writing Intelligence Rules

Live News must write from article context, not from generic templates.

The writing system should improve:

- Article titles.
- Article descriptions.
- Deks/subheadlines.
- Story summaries.
- Why-it-matters text.
- Homepage card text.
- Top Story of the Day explanations.
- Story of the Week explanations.
- SEO titles.
- Meta descriptions.
- Facebook captions.
- Instagram captions.
- Image/card text.

The Live News writing voice is:

- Clear.
- Story-focused.
- Source-respectful.
- Human-readable.
- Low-hype.
- Grammatically correct.
- Context-aware.
- Not robotic.
- Not generic.
- Not copied from the original publisher.

Every public-facing title, description, summary, and caption must answer:

1. What happened?
2. Who or what is involved?
3. Why does it matter to readers?
4. What is confirmed?
5. What should not be overstated?

The writing system must not:

- Invent facts.
- Copy publisher wording.
- Copy public comments.
- Use private user data.
- Use usernames or personal profiles.
- Use unsupported claims from social comments.
- Depend on weak fallback text.
- Use vague filler such as "This article discusses..."
- Use robotic phrases such as "In a recent development..."
- Create clickbait.
- Force public-safety framing unless the article clearly supports it.

Use communication-course principles as rubrics:

- Audience adaptation.
- Structural framing.
- Rhetorical situation.
- Conversational repair.
- Evidence integration.
- Respectful intercultural language.
- Rhythm and cadence.
- Multimodal alignment.

Do not ingest or copy entire course materials into the repo.
Use course concepts as writing rubrics and teacher checks only.

Fallback rule:

If the system cannot describe the actual article situation, it should return a blocked or needs-more-context status instead of publishing a generic public description.

Required future teacher checks:

- `StoryFocusTeacher`
- `ContextFaithfulnessTeacher`
- `HumanClarityTeacher`
- `DescriptionSpecificityTeacher`
- `RhetoricalSituationTeacher`
- `RhythmCadenceTeacher`
- `InterculturalRespectTeacher`
- `DigitalMediaTeacher`
- `CopyRiskTeacher`
- `FallbackDependencyTeacher`

Writing quality gate:

- Block public title/description if fact faithfulness is below 90.
- Block public title/description if story focus is below 85.
- Block public title/description if generic fallback language appears.
- Block public title/description if unsupported claims appear.
- Block public title/description if it copies publisher wording too closely.

Keep existing rules:

- Exact `/stories/...` links.
- Homepage link blocking.
- Human approval.
- Source attribution.
- Safe aggregate learning only.
- No private user data.
- No copied comments.
- No exposed tokens.
- Public safety conditional only, not default.

## Live News Original Writer Engine Rules

Live News must not act like a transcriber.

The original writer must transform source-backed facts into original Live News writing.

The system should not rewrite source sentences line by line.
The system should extract facts, set source wording aside, then write from a clean fact map.

Core principle:
Facts can be reused.
Publisher wording and sentence structure should not be copied.

The writer must:

- Understand the article situation.
- Identify the main event.
- Identify people, organizations, projects, places, dates, and context.
- Separate confirmed facts from uncertain claims.
- Build a fact map before writing.
- Choose a clear reader angle.
- Write in Live News voice.
- Use source attribution.
- Preserve exact `/stories/...` links.
- Stay story-focused.
- Use clean grammar.
- Avoid robotic language.
- Avoid generic fallback text.
- Avoid copied publisher wording.
- Avoid copied comments.
- Avoid unsupported claims.
- Ask for more context when context is too weak.

The writer may improve:

- Structure.
- Clarity.
- Grammar.
- Rhythm.
- Sentence flow.
- Reader angle.
- Title strength.
- Description specificity.
- SEO description usefulness.
- Social caption clarity.
- Homepage card readability.

The writer must not:

- Invent facts.
- Copy publisher wording.
- Copy publisher sentence structure.
- Copy comments.
- Use private user data.
- Use usernames or profiles.
- Use unsupported facts from comments.
- Create gossip bait.
- Create clickbait.
- Force public safety framing.
- Publish weak fallback text.
- Weaken quality gates just to pass.

If `CopyRiskTeacher` fails:

- Do not simply swap words.
- Rebuild from extracted facts.
- Change sentence structure.
- Change opening angle.
- Use Live News voice.
- Keep the meaning accurate.
- Preserve attribution.

If `StoryFocusTeacher` fails:

- Identify who or what the story is about.
- Identify what happened.
- Identify why it matters.
- Identify what is confirmed.
- Rewrite around the actual situation.

If context is weak:

- Return `needs_more_context`.
- List what is missing.
- Do not publish filler.

The writing process should follow this internal workflow:

1. Read source context.
2. Extract facts.
3. Close the source wording.
4. Write from the fact map.
5. Check accuracy.
6. Check copy distance.
7. Check story focus.
8. Rewrite until passing or `needs_more_context`.
9. Save approved lessons safely.

The Original Writer should use communication-course rubrics:

- Audience adaptation.
- Structural framing.
- Rhetorical situation.
- Evidence integration.
- Directness calibration.
- Rhythm and cadence.
- Intercultural respect.
- Digital media scannability.
- Conversational repair when a draft fails.

Blocked phrases:

- This article discusses.
- In a recent development.
- The story continues to unfold.
- Readers are reacting.
- A major update has emerged.
- You won't believe.
- Shocking.
- `Top Story:` as a default.
- Stay safe unless `publicSafetyRelevant` is true.

Bounded persistence:

- Maximum 3 rewrite rounds.
- Maximum 5 candidates per round.
- Maximum 15 total attempts.
- Never infinite loop.
- If still failing, return `needs_more_context` with reasons.

Memory rule:

- Store safe lessons from approved rewrites.
- Do not store full source article text as training memory.
- Do not store copied publisher wording as a preferred style.
- Do not store copied comments.
- Do not store private user data.

Keep existing Live News rules:

- Exact `/stories/...` links.
- Homepage link blocking.
- Human approval.
- Source attribution.
- No real tokens.
- No private user data.
- No copied comments.
- Public safety conditional only.

## Live News Entertainment Intelligence Rules

Entertainment is an important Live News section, but it must stay source-linked, readable, accurate, and not gossip bait.

Allowed public entertainment sections/subbeats:

- Movies.
- TV and streaming.
- Music.
- Celebrity and culture.
- Awards season.
- Books and publishing.
- Theater and arts.
- Gaming and creator culture.
- Trailers and releases.
- Stars we lost, handled respectfully.
- General entertainment.

Do not create public sections for:

- Box Office.
- What To Watch.
- Entertainment Biz.
- Business of Entertainment.
- Trends.

Entertainment classification rules:

- Entertainment-adjacent stories should be recognized even if the publisher category is Top, Culture, Lifestyle, or General.
- A story should classify as entertainment only when the title, summary, source, tags, or entities support it.
- Do not force unrelated sports, crime, public safety, or general news into entertainment.
- Celebrity death, legal, allegation, family tragedy, or health stories must stay neutral and sensitive.
- Public comments are not verified facts.
- Do not copy publisher wording.
- Do not copy comments.
- Do not scrape private accounts.
- Public safety remains conditional only, not default.

Entertainment writing rules:

- Prefer approved Live News headline/description over raw publisher title.
- Do not show generic fallback summaries publicly.
- Do not use robotic phrases like "This article discusses..." or "In a recent development..."
- Describe the actual entertainment situation.
- Name the person, project, show, film, song, album, book, award, platform, studio, or event when source-backed.
- Avoid fake hype and gossip bait.

Entertainment build exclusions:

- Do not add box office features in this entertainment pass.
- Do not add what-to-watch features in this entertainment pass.
- Do not add trend intelligence, Google Trends, Search Console, Semrush, Ahrefs, Glimpse, or Exploding Topics in this entertainment pass.
- Do not add new social-caption expansion or new Instagram/Facebook entertainment packages in this entertainment pass.
- Do not add public "Entertainment Biz" or "Business of Entertainment" sections.

Keep existing Live News rules:

- Exact `/stories/...` links.
- Homepage link blocking.
- Human approval.
- Source attribution.
- Writing-quality gates.
- No real tokens.
- No private user data.
- No copied comments.
- No copied publisher wording.

## Live News Local Intelligence Rules

Unlimited local intake means no artificial cap on approved public source signals.

Unlimited intake does not mean:

- Uncontrolled crawling.
- Scraping private pages.
- Bypassing paywalls.
- Ignoring robots.txt.
- Ignoring source terms.
- Republishing full copyrighted articles.

The Local Intelligence Engine should prioritize:

- RSS/Atom feeds.
- XML sitemaps.
- Official APIs.
- Official government and public agency pages.
- Approved public pages.
- User-submitted sources after review.
- Licensed data providers if added later.

Local source intake must store only what is needed for:

- Classification.
- Deduplication.
- Attribution.
- Summary generation.
- City/topic intelligence.
- Source quality.
- Future relevance and trend detection.

Do not publish full external article text.
Do not store full source article text as preferred writing memory.
Do not treat public comments as verified facts.

Public story pages must:

- Link to original sources.
- Attribute the original source clearly.
- Add Live News context.
- Use Live News original writing.
- Avoid copying publisher wording or sentence structure.
- Avoid showing public story details older than 7 days.

Expired local story metadata may be retained privately for deduplication, source quality, city intelligence, trend detection, and future relevance, but expired public story details must not be shown publicly.

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
