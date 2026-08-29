# Moderation Outbox Dispatcher and Shadow Worker

Status: WHICH-99 foundation  
Mode: Shadow only  
Policy: `moderation-shadow-v1`

## Boundary

The Moderation Worker consumes only `MODERATION_REQUESTED` records from the transactional
`outbox_events` table. Comment revisions, sealed Issue versions, media asset versions, and their
request Events are committed in the same database transaction. The request contains only:

- immutable target ID and version;
- a WHICH-private reference such as `comment://`, `issue://`, or `issue-media://`;
- normalized SHA-256 input hash;
- policy version, reason, and `SHADOW` mode.

Binary data, base64 bodies, public CDN URLs, member identity, Vote choice, IP address, and session
data are prohibited from this Event contract.

The dispatcher registers one immutable `moderation_target` and one idempotent `moderation_run`.
Deleted, replaced, purged, hash-changed, or policy-stale targets are recorded as `SKIPPED`. A policy
change schedules a new request under the current policy instead of mutating the old Run.

## Shadow safety

Shadow execution may write only Run result, signal metadata, latency, cost, cache, audit, and
reconciliation records. It must not update Issue visibility, Comment visibility, publication state,
participation state, or Member enforcement. A human moderation decision remains the only path to a
member-facing moderation notice.

The provider adapter is absent by default. Injecting an adapter is still insufficient: the
WHICH-97 provider/privacy gate must explicitly return `allowed`. Otherwise the Run is `SKIPPED` with
zero cost. Provider output is cached by provider, model, model version, policy version, and input
hash so the same compatible inspection is not charged twice.

## Commands

```bash
pnpm --filter @which/api moderation:once
pnpm --filter @which/api moderation:worker
pnpm --filter @which/api moderation:dead-letters
pnpm --filter @which/api moderation:requeue -- <run-id>
pnpm --filter @which/api moderation:reconcile-media
pnpm --filter @which/api moderation:diagnose-provider
```

Production build equivalents use `node apps/api/dist/moderation-worker.js <command>`.

Configuration:

| Variable                          | Default | Purpose                         |
| --------------------------------- | ------: | ------------------------------- |
| `MODERATION_WORKER_BATCH_SIZE`    |      25 | Maximum dispatch and Run batch  |
| `MODERATION_WORKER_LEASE_MS`      |  60,000 | Recoverable lease duration      |
| `MODERATION_WORKER_MAX_ATTEMPTS`  |       5 | Retry budget before dead letter |
| `MODERATION_WORKER_RETRY_BASE_MS` |   5,000 | Exponential retry base          |
| `MODERATION_WORKER_RETRY_MAX_MS`  | 300,000 | Retry delay ceiling             |
| `MODERATION_WORKER_POLL_MS`       |   2,000 | Dedicated-worker poll interval  |

## Deployment and SLO boundary

| Shape                   | When to use                                                       | Target SLO                                                              | Cost boundary                                                                              |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| API same process        | Local smoke tests only; never inside the user request transaction | No production SLO                                                       | No additional service, but competes with API CPU/DB pool                                   |
| Render cron / one-shot  | Initial Shadow pilot with a small queue                           | p95 request-to-Run start under 5 minutes; oldest queue under 15 minutes | Existing service plus scheduled execution; provider daily cap remains zero until WHICH-101 |
| Dedicated Render worker | Sustained backlog, oldest age breach, or API resource contention  | p95 start under 60 seconds; lease recovery under 2 minutes              | Separate fixed service cost plus bounded provider budget                                   |

Move from cron to a dedicated worker when any of these holds for three consecutive observation
windows: oldest request exceeds 15 minutes, pending count exceeds 500, processing consumes more than
10% of the API database pool, or the API p95 latency regresses by more than 10% while the worker runs.

WHICH-101 adds the replaceable OpenAI Moderation adapter, minimized input resolver, approval gate,
global kill switch, deterministic canary, daily call cap, failure taxonomy, and Golden Set export.
All defaults remain OFF. The activation and rollback contract is documented in
[`moderation-safety-provider-shadow.md`](./moderation-safety-provider-shadow.md).

## Retry and dead letter

Both dispatch Events and Shadow Runs use `FOR UPDATE SKIP LOCKED`, expiring leases, exponential
backoff, bounded attempts, and a manual requeue command. A requeue resets the current retry count but
preserves lifetime attempts. Repeated failures never make content public or restricted.

## R2 and database reconciliation

`moderation:reconcile-media` checks the object expected by each STAGED, PUBLISHED, or QUARANTINED
asset. A missing object is repaired fail-closed by marking the asset PURGED/REVOKED and recording a
`moderation_reconciliation`; it is never treated as approved. Consistent checks are also recorded.
Bucket-wide orphan discovery requires a future paginated R2 inventory job; this command covers the
database-to-R2 direction without requiring bucket listing permission.

## Member notifications

Member-facing image decisions, human-review outcomes, appeals, and rights outcomes continue to
write `member_moderation_notices`, which feed the header bell. Shadow signals, Run retries, queue
state, provider cache hits, and reconciliation internals are audit-only and intentionally do not
notify Members.

## Verification

- Event schemas reject public URLs for private references and contain no binary payload.
- Integration tests prove idempotent dispatch, no publication change, privacy-gate default deny,
  provider-call cache reuse, retry, and dead-letter behavior.
- Existing comment, Issue creation/publication, media, content-revision, and moderation-operation
  suites verify that transactional Event wiring does not regress the product flow.
