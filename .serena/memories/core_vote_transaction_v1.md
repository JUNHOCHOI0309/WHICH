# Core Vote Transaction & HTTP API v1

## Public API

- `POST /v1/guest-subjects` creates a first-party anonymous Guest subject.
- `POST /v1/issues/:issueId/votes` requires UUID headers `Idempotency-Key` and
  `X-Anonymous-Subject-Id`, plus `issueVersion` and `choiceId` in the body.
- The OpenAPI document is available from the Fastify documentation route.

## Transaction invariants

- Only `PUBLISHED`, `VISIBLE`, `VOTING_OPEN`, non-political, `LOW`-risk Issues inside their voting
  window are available to Guests.
- The Idempotency Key is also the Vote Attempt ID. A PostgreSQL transaction advisory lock
  serializes concurrent use of the same key.
- Reusing a key with the same request returns the stored HTTP status and body exactly. Reusing it
  with different request data returns `IDEMPOTENCY_CONFLICT`.
- Updating the Guest subject locks that subject row, and the Issue query locks the votable rows.
  Together with `votes_one_accepted_per_issue_subject_unique`, concurrent A/B submissions from
  one Guest can produce only one accepted Vote.
- Vote Attempt, Vote, Integrity Decision, Aggregate, Result Snapshot, Issue Version lock, and
  Outbox Event are written in one transaction.
- Accepted votes emit `VOTE_ACCEPTED`; duplicate attempts emit `VOTE_REJECTED`. Event schema
  version starts at `1`.

## Verification

- Integration tests create a temporary PostgreSQL database, run the real migrations, exercise the
  HTTP routes concurrently, and remove only that generated database afterward.
- CI provides PostgreSQL 17 and runs the repository-wide `pnpm check` gate.

Read `mem:data_architecture_v1` before changing these invariants.
