# Home participation right rail v1

## Purpose

The home right rail uses current service activity instead of a static principle card. It is a
result-free discovery surface, not a result or recommendation explanation surface.

## Current policy

- Source: public, visible, voting-open, feed-eligible, low-risk, non-political Issues.
- Viewer rule: Issues already accepted for the current Member, linked Guest, or current Guest are
  excluded with the same identity boundary as the home feed.
- Primary order: accepted, non-test, non-invalidated votes during the last 24 hours.
- Tie-break: newest published version, then stable Issue ID order.
- Fallback: when recent participation is insufficient, the newest safe unvoted Issues fill the
  remaining positions.
- Limit: three items.
- Public fields: Issue ID, question, category, recent participation count, and reason code only.
- Privacy: A/B counts, percentages, leading choice, and any result state are not returned.

## Evolution path

1. `participation_v1` — recent valid participation with recency fallback.
2. `rising_v1` — add exposure-to-vote conversion, comments, shares, skips, and reports after beta
   volume is sufficient.
3. `controversy_v1` — use the WHICH-87 `controversyEligible` gate only after quality-ranker shadow
   metrics meet the production promotion criteria.

Changing the label to "실시간 논쟁 TOP" before the controversy gate is live is not allowed.

## Rollback

The Web client treats a missing or empty `rightRail` payload as a safe fallback and renders the
existing WHICH principle card. API errors therefore do not leave the right rail blank.

## Verification

- API integration tests verify recent vote ordering, safe fallback, viewer vote exclusion, and the
  absence of result counts.
- Web tests verify links, participation/fallback labels, and the absence of percentages.
