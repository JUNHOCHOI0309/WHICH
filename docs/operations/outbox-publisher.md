# Outbox Publisher Operations

Status: Implemented v1  
Worker: `apps/api/src/outbox-worker.ts`  
Delivery guarantee: at-least-once

## Purpose

Domain transactions store Events in `outbox_events` with `PENDING` status. The independent Outbox Worker claims those rows, sends the stored payload to a configured HTTP consumer, and records delivery state without coupling API request latency to the downstream system.

At-least-once means the same Event can be delivered more than once when a Worker stops after the HTTP request succeeds but before PostgreSQL records `PUBLISHED`. Consumers must therefore use `x-which-event-id` or the payload `event_id` as their idempotency key.

## Configuration

Set the following values in the root `.env` when running publish commands:

```dotenv
OUTBOX_WEBHOOK_URL=https://events.example.com/which
OUTBOX_WEBHOOK_SECRET=replace-with-a-random-secret-of-at-least-16-characters
OUTBOX_BATCH_SIZE=50
OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_LEASE_MS=30000
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_RETRY_BASE_MS=5000
OUTBOX_RETRY_MAX_MS=300000
OUTBOX_HTTP_TIMEOUT_MS=5000
```

`OUTBOX_WEBHOOK_SECRET` is independent from API and moderation secrets. Generate one with:

```bash
openssl rand -base64 32
```

Do not commit the real URL or secret.

## Commands

```bash
# Continuously poll and publish
pnpm --filter @which/api outbox:worker

# Claim and process one batch, then exit
pnpm --filter @which/api outbox:publish-once

# List the newest Dead Letters (optional limit)
pnpm --filter @which/api outbox:dead-letters 50

# Requeue one Dead Letter
pnpm --filter @which/api outbox:requeue <event-id>
```

The API server does not start this Worker automatically. Run it as a separate process so downstream slowness and restarts do not affect public API availability.

## Delivery contract

The Worker sends the exact JSON stored in `outbox_events.payload` and includes:

| Header                     | Meaning                                              |
| -------------------------- | ---------------------------------------------------- |
| `x-which-event-id`         | Stable consumer idempotency key                      |
| `x-which-event-type`       | Versioned Domain Event name                          |
| `x-which-schema-version`   | Payload schema version                               |
| `x-which-delivery-attempt` | Lifetime delivery attempt count                      |
| `x-which-signature`        | `sha256=<HMAC-SHA256 hex of the exact request body>` |

The consumer must verify the signature against the raw body before parsing JSON and return any `2xx` response only after it has durably accepted or idempotently ignored the Event. Other responses are retryable delivery failures.

## State transitions

```text
PENDING and available
  -> leased PENDING
  -> PUBLISHED on HTTP 2xx
  -> PENDING with exponential backoff on failure
  -> FAILED Dead Letter after the configured maximum attempts
  -> PENDING after an explicit operator requeue
```

- `attempt_count` counts attempts in the current retry cycle and resets on requeue.
- `total_attempt_count` never resets and preserves lifetime delivery attempts.
- `requeue_count` records how often an operator started a new retry cycle.
- `claim_token` prevents a Worker with an expired lease from overwriting a newer Worker's result.
- `last_error` stores a bounded operational message; it must never contain secrets or the signed request headers.

## Concurrency and recovery

Claim uses `FOR UPDATE SKIP LOCKED` in a short transaction and sets a lease before network I/O. Multiple Workers can run safely without delivering the same Event during an active lease. If a Worker stops, the unchanged `PENDING` row becomes claimable when `available_at` reaches the lease expiry.

Strict global ordering is not guaranteed across Workers. Consumers must use the Event schema and domain versions such as `result_version` when ordering matters.

## Dead Letter response

1. List Dead Letters and inspect `eventType`, `aggregateId`, attempts, and `lastError`.
2. Fix or verify the downstream consumer before replaying.
3. Requeue the Event explicitly.
4. Run one batch and confirm it becomes `PUBLISHED`.
5. If the Event fails again, retain it for investigation; do not delete the Outbox row.

## Rollback

Stop the Worker process first. API transactions will continue storing `PENDING` Events. Fix or roll back the Worker and resume publishing later; do not delete or rewrite Domain facts to compensate for a delivery failure.
