# Live News Social Performance Memory Brief

Last updated: 2026-05-09

## Purpose

Performance Memory is the private learning layer for Live News social distribution. Its job is to learn what helps real people understand a story and click the exact Live News article page, without turning Live News into a clickbait machine.

The system learns from two safe signal groups:

- Owned aggregate results from approved manual Instagram and Facebook posts.
- Trusted public-interest signals such as Google Trends, trending search topics, official data, and source coverage patterns.

It must not learn from private people, cookies, copied comments, private messages, access tokens, usernames, or profile data.

## Human-Public Learning Goal

The teacher should ask:

- What are humans trying to understand right now?
- Which topics have public urgency or usefulness?
- Which angle helps readers understand the story fastest?
- Which caption and image shape moves people to the exact article, not only to likes?
- Which topics need calmer wording because they are sensitive?

The strongest outcome is:

`public curiosity + useful explanation + source respect + exact article clicks + no safety flags`

## Manual Posting Phase

The first posting phase stays manual:

1. Approve a Live News story page.
2. Generate social drafts with exact story links.
3. Manually post one approved variant to Instagram or Facebook.
4. Record aggregate results in the private Performance Memory page.
5. Let the teacher convert results into safe lessons.

This avoids giving Meta API posting power before the editorial workflow proves itself.

## Public-Interest Signals

Public trend signals help Live News understand attention, but they do not verify facts.

Safe examples:

- Google Trends topic or query pages.
- Official agency dashboards.
- Trusted news coverage patterns.
- Public platform trend pages.

Unsafe examples:

- Private cookies.
- Usernames.
- Private messages.
- Copied comment text.
- Personal profiles.
- Any token or secret.

## Meta Connection Rule

Meta API posting should stay disabled until:

- Exact Live News story pages are consistently approved.
- Social drafts pass teacher checks.
- Manual posting results show clean performance.
- Meta app review permissions are approved.
- Tokens are stored only in private Railway variables.

Auto-posting remains off until a separate approval decision.

## Sources Reviewed

- Google Trends Help: Trends data is anonymized, categorized, aggregated, and normalized.
  https://support.google.com/trends/answer/4365533
- Google Search Central: Google Trends can help understand what people are searching for.
  https://developers.google.com/search/docs/monitor-debug/trends-start
- Meta for Developers: Instagram Platform content publishing.
  https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Meta for Developers: Instagram Platform insights.
  https://developers.facebook.com/docs/instagram-platform/insights/
- Meta Sharing for Web: Open Graph sharing metadata.
  https://developers.facebook.com/docs/sharing/webmasters/
