# Comment Data Architecture & Guest Read Flow v1

- Branch: `feature/comment-data-read-flow-v1`
- Public endpoint: `GET /v1/issues/:issueId/comments`
- Guest access requires the first-party anonymous Subject to have an `ACCEPTED` Vote for the same Issue.
- Reads use the Issue Version stored on that accepted Vote, not a later mutable Version.
- Comment rows store `choice_snapshot` and `author_display_name_snapshot` so the public response preserves creation context.
- Public eligibility requires `PUBLISHED`, visibility `VISIBLE` or `DEPRIORITIZED`, integrity `NORMAL`, no author deletion, and a top-level Comment.
- `LOCKED` Threads remain readable; lock controls writing rather than visibility.
- Cursor order is `created_at DESC, comment_id DESC`; side filtering (`ALL`, `A`, `B`) is applied before pagination.
- The Result screen loads Comments independently so Empty or Error states never remove result data or the Next Issue action.
- Cyan marks A and Orange marks B using both color and explicit letter badges.
- Development seed contains one A and one B reason for each stable Issue and is repeatable with conflict-safe inserts.
- Verification baseline: API 24 tests, Web 7 tests, full `pnpm check`, and 390×844 browser flow.
