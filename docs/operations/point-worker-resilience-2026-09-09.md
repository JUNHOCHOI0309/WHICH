# Point Worker resilience incident — 2026-09-09

## Impact

At 20:35 KST, a successful `PUT /api/interest-profile` was followed by HTTP
500/503 responses across the site. Cloud Run kept replacing the web instance
because the colocated Point Worker exited and the PID 1 supervisor correctly
treated an unexpected child exit as a container failure.

## Root cause

`INTEREST_PROFILE_COMPLETED` was emitted on every save while a Member profile
was already complete. Account-once rewards use the stable Member ID as their
source key. A later completion Event therefore found the original reward, but
its newer operation day made the generic ledger equality check classify it as
`POINT_IDEMPOTENCY_CONFLICT` instead of a duplicate. That deterministic error
escaped the policy consumer and terminated the Point Worker.

The restart storm then produced secondary PostgreSQL connection timeouts. The
database timeouts were not the initiating fault.

## Recovery controls

- Account-once reward Events first look up the already-awarded source fact and
  record a `DUPLICATE` receipt independent of the later Event's operation day.
- Other deterministic idempotency conflicts record an `INELIGIBLE` receipt with
  the error code, preventing one poison Event from blocking the queue.
- The long-running Point Worker catches batch-level infrastructure errors,
  emits a bounded structured error without connection details, and retries
  with exponential backoff capped at 30 seconds.
- Interest Profile and public Creator Profile producers emit completion Events
  only when entering the completed state, not on every edit while complete.

No Event or ledger row is deleted during recovery. The existing poison Event
is expected to finish with a duplicate receipt when the fixed worker starts.

## Verification after deployment

1. Confirm the new `which-web` revision is Ready and receives 100% traffic.
2. Confirm `/api/health`, `/`, and `/api/issues/feed` return HTTP 200.
3. Confirm the Point Worker reports a claimed batch containing `DUPLICATE` and
   no longer exits or restarts the container.
4. Run Point reconciliation in dry-run mode for the affected Member and verify
   that the cached balance equals the ledger sum before considering repairs.
5. Monitor `POINT_WORKER_BATCH_FAILED`, `POINT_IDEMPOTENCY_CONFLICT`, container
   exits, and HTTP 5xx together; page only when retries persist or web health
   degrades.

## Follow-up architecture

Move the Point Worker to its own Cloud Run service or Job so a future worker
defect cannot affect HTTP availability. Keep only one active production point
consumer during that cutover, and preserve the current Outbox and receipt
idempotency guarantees.
