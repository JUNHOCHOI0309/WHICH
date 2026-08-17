# Issue Read API & Development Seed v1

## Public API

- `GET /v1/issues/:issueId` returns the highest numbered published Issue Version and exactly two
  Choices ordered A then B.
- Guest availability matches the Vote path: `PUBLISHED`, `VISIBLE`, `VOTING_OPEN`, `LOW`,
  non-political, and inside the voting window.
- Missing Issues return `ISSUE_NOT_FOUND`; existing but Guest-ineligible or structurally incomplete
  Issues return `ISSUE_NOT_AVAILABLE`.
- Public responses exclude lifecycle, risk level, content hash, Subject data, and management fields.

## Result visibility

- The response always exposes the public Result Visibility state.
- A tally is returned only for `RESULT_VISIBLE` and only when a Vote Aggregate exists.
- `PRE_VOTE_HIDDEN`, locked, degraded, and unavailable result states return a null tally to avoid
  disclosing counts early or during an integrity restriction.

## Development seed

- Run `pnpm --filter @which/api db:seed` after migrations.
- Stable UUIDs and `ON CONFLICT DO NOTHING` make the seed repeatable and preserve local edits or a
  locked Issue Version.
- The command is blocked when `NODE_ENV=production`.

## Verification

- Integration tests use real temporary PostgreSQL databases and migrations.
- Tests cover repeatable seed execution, preservation on conflict, latest published Version selection,
  A/B ordering, hidden and visible results, unavailable states, expired windows, and incomplete Choices.

Read `mem:data_architecture_v1` and `mem:core_vote_transaction_v1` before changing availability or
result visibility behavior.
