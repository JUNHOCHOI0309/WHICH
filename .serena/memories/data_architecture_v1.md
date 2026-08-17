# Data Architecture v1 memory

## Implemented baseline

- Branch: `feature/data-architecture-v1`
- Feature commit: `937cd30`
- Main merge: `778beef`
- Design: `docs/architecture/data-architecture-v1.md`
- Migration: `apps/api/migrations/0000_data_architecture_v1.sql`
- Schema modules: `apps/api/src/database/schema/`

## Non-negotiable contracts

- Vote Fact and append-only Integrity Decisions are the source of truth.
- Aggregate and Result Snapshot are rebuildable projections.
- A transactional Outbox event accompanies domain writes.
- Vote and Vote Attempt reference the exact `(issue_id, issue_version, choice_id)`.
- The partial unique index on `(issue_id, subject_id)` permits at most one current ACCEPTED Vote.
- REVIEW, rejected, and INVALIDATED votes are excluded from displayed counts.
- The first ACCEPTED vote transaction locks the Issue Version.
- Guest identity is a first-party anonymous subject; raw IP is never a unique voter key.
- Political Issues are RESTRICTED and voting remains feature-flagged off for MVP.

## Next implementation

Implement `feature/core-vote-transaction-v1`: Guest Subject resolution, idempotent submit, concurrent duplicate handling, Issue Version lock, Aggregate/Snapshot update, Outbox write, HTTP/OpenAPI contract, and PostgreSQL integration tests. Keep all writes in one server-owned transaction.