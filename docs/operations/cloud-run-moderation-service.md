# WHICH elastic moderation service

## Purpose

The production submission path is:

```text
member submission + DB outbox
  -> web dispatcher claims event
  -> Cloud Tasks queue (opaque event ID + claim token)
  -> private Cloud Run service
  -> one moderation-worker submission command
  -> DB-confirmed publication or needs-changes result
```

The database remains the source of truth. Cloud Tasks delivers work but cannot
choose content, policy, runtime flags, or publication state. A successful HTTP
response only acknowledges that the bound worker command exited normally; the
member sees success only after the submission row contains a published Issue.

## Runtime and identity

- Service: `which-moderation-worker`, region `asia-southeast1`
- Queue: `which-moderation`, same region
- Runtime identity: `which-web@which-505908.iam.gserviceaccount.com` for DB/R2/provider access
- Invocation identity: `which-moderation-task-invoker@which-505908.iam.gserviceaccount.com`
- Private ingress, authenticated invocation only, Direct VPC all-traffic egress
- 2 vCPU / 4 GiB, minimum 1, maximum 8, request concurrency 1, timeout 300 seconds
- Worker DB pool maximum 3 connections per instance

Only the web runtime identity may enqueue tasks and act as the dedicated task
identity. Only the task identity receives `roles/run.invoker` on the worker
service. Cloud Tasks' service agent creates the OIDC token. The worker rejects
requests without the Cloud Tasks header and also requires an exact active DB
event ID/claim-token pair.

## SLO and scaling

The user-facing objective is p50 30 seconds, p95 50 seconds, p99 90 seconds from
submission acceptance to terminal result. Measure at least these separately:

1. outbox occurrence to Cloud Tasks creation;
2. task schedule time to request start (queue wait);
3. local scan, provider, Luna, and publication stage latency;
4. total submission-to-result latency and terminal status.

At 40 seconds per submission, eight single-concurrency instances provide about
12 submissions per minute before provider or database limits. Increase maximum
instances only after checking provider rate limits and database connections.
Keep `max instances * MODERATION_WORKER_DB_POOL_MAX` inside the database's
reserved worker connection budget.

Warn when actionable queue age exceeds 2 minutes. At 10 minutes or more than
100 actionable pending submissions, pause new direct uploads while preserving
all already accepted outbox records. Daily call/cost ceilings may be disabled,
but circuit breaker, policy gates, retry limits, audit ledgers, and fail-closed
publication remain mandatory.

## Operations

Deploy the worker before updating the web dispatcher. Cloud Build keeps the
fallback Job on the same image, grants only the task identity invocation, then
points the web service at the worker URL and queue.

For an incident:

1. set web `MODERATION_JOB_DISPATCH_ENABLED=false`;
2. pause `which-moderation` if queued delivery must stop;
3. set provider, judge, or auto-publication kill switches as appropriate;
4. inspect outbox claims, task attempts, moderation runs, and worker logs;
5. resume the queue and dispatcher after the cause is fixed.

Do not delete outbox rows, reset usage ledgers, or mark HTTP delivery as
publication. The 12-minute DB lease safely makes an unconfirmed task eligible
for a new claim, and deterministic task names make duplicate enqueue responses
harmless.
