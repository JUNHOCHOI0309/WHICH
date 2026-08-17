# Feed & Next Issue Navigation v1

## Feed contract

- `GET /v1/issues/feed` returns only Guest-available, `ELIGIBLE`, non-political, low-risk
  Issues with a complete A/B Choice set.
- The latest Version published at or before request time is selected for each Issue.
- Ordering is `publishedAt DESC, issueId DESC`. The opaque Base64URL cursor contains both values and
  keyset pagination uses the same tuple, preventing duplicate or missing rows from offset drift.
- Default page size is 10 and the maximum is 20. Invalid cursors return `INVALID_CURSOR` with 400.
- `excludeIssueId` removes the current question. When a valid anonymous Subject is supplied, Issues
  with an `ACCEPTED` Vote by that Subject are also excluded.
- Next Issue reuses the Feed contract with `limit=1`; there is no separate recommendation endpoint in
  this MVP.

## Web flow

- `/` is the public Guest Feed. Guest Subject preparation finishes before the first personalized Feed
  request so prior accepted votes can be excluded.
- Feed cards show the question and A/B labels but never counts or percentages before Vote.
- Result screens expose an explicit `다음 질문 보기` action. The user is never moved automatically.
- If no candidate remains, the Result screen explains that all currently available questions are
  complete. Root Feed has matching empty and recoverable error states.

## Design direction

- Reference direction: design draft 2 structure with a Cyan–Orange choice system.
- Tokens: Deep Navy `#061923`, Cyan A `#14C8D4`, Orange B `#FF8A3D`, Off White `#F6F8F7`.
- A and B use equal area and full saturation. Dark Navy text, explicit A/B labels, borders, focus rings,
  and geometry avoid relying on color alone.
- Red–Green is intentionally avoided because of answer-value associations and color-vision access.

## Development data and verification

- The repeatable development seed supplies three stable Issues and preserves locally edited rows via
  `ON CONFLICT DO NOTHING`.
- PostgreSQL integration tests cover cursor stability, exclusion of current and accepted Issues,
  invalid cursors, Feed eligibility, and repeatable multi-Issue seed behavior.
- Web tests cover result-free Feed cards, error retry, empty state, and Result-to-Next navigation.
- Mobile browser verification at 390×844 covers Feed → Issue → Vote → Result → Next Issue → final empty
  state with no console warnings or errors.
