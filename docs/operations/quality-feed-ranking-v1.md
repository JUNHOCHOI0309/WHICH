# Quality Feed Ranking v1

WHICH-87 introduces an explainable quality layer after the existing feed eligibility and interest
retrieval stages. It does not call an external model and does not change production order until the
operator explicitly selects `LIVE`.

## Pipeline

1. **Eligibility** keeps only published, visible, voting-open, feed-eligible, low-risk,
   non-political Issues with complete A/B choices and removes every Issue already accepted by the
   current Member or linked Guest.
2. **Retrieval** labels candidates as interest, fresh, editorial quality, behavior quality,
   exploration, or deterministic default fallback.
3. **Quality scoring** records separate interest, freshness, editorial, behavior, exploration, and
   safety penalty components. The 30-day behavior window includes viewable-to-accepted conversion,
   decision duration, Vote-to-Next, comments, shares, skips, hides, and reports.
4. **Diversity re-ranking** defers repeated categories, more than two Issues from one author, equal
   content hashes, and near-duplicate questions.
5. **Fallback** retains the existing deterministic society/daily-life discovery order for Guests
   and low-information profiles.

An Issue is not a controversy candidate merely because its split is close to 50:50 or its raw vote
count is high. It must also satisfy minimum exposure, conversion, balancedness, skip, and report
guardrails.

## Modes and rollback

```dotenv
QUALITY_RANKER_MODE=SHADOW
```

- `OFF`: existing interest/discovery/recency order only; immediate rollback.
- `SHADOW`: serves the existing order but stores quality score components and shadow positions.
- `LIVE`: serves only quality-eligible candidates in the diversified quality order.

Remain in `SHADOW` for at least seven complete days and review `/ops` → `Ranking Preview`. Move to
`LIVE` only when accepted-vote rate and Vote-to-Next do not regress, report rate is not higher, the
exclusion rate is operationally reasonable, and each major category retains supply. Return to
`SHADOW` for unexplained metric movement and to `OFF` for feed errors, empty slates, or audit write
failures.

The recommendation audit stores candidate sources, component scores, quality eligibility,
exclusion reasons, controversy eligibility, served position, shadow position, policy version, and
fallback reason. The public feed only receives the existing concise recommendation reason fields.
