# Web DB connection resilience — 2026-09-01

## Observed failure

Production revision `which-web-00009-72c` returned HTTP 500 for member session,
submissions, points, private profile, and point-shop reads around 01:57 KST.
Failed HTTP requests took 2.02–2.31 seconds. The API logged PostgreSQL
connection-acquisition timeouts, matching the HTTP service's two-second pool
timeout. A subsequent submissions read completed successfully in 47 ms.

This confirms transient connection acquisition failure, not lost member data.
The evidence does not establish whether the underlying delay was connection
setup, network latency, or pool contention. The image moderation Job's existing
ten-second timeout did not apply to the HTTP server.

## Change

- HTTP server explicitly uses `DATABASE_CONNECTION_TIMEOUT_MS`, default 10000,
  validated between 1000 and 60000. Generic CLI defaults and the moderation Job
  are unchanged. TLS validation, DB host, maximum pool size (10), and idle
  timeout (30 seconds) are unchanged.
- The web BFF retries at most once, after 250 ms, for GET requests to these
  exact paths: `/v1/me`, `/v1/me/points`, `/v1/me/point-shop`,
  `/v1/member/issue-submissions`, `/v1/member-session`.
- Retryable responses are 500/502/503/504; fetch transport failures and the
  per-attempt 12-second timeout are also eligible. Other HTTP statuses,
  including 401/403/409/429, are returned immediately. A second failure stays
  a failure. Requests retain their auth headers, query and `no-store` policy.
- No POST, PUT, PATCH, DELETE, token-exchange GET, or arbitrary endpoint is
  replayed. Profile GET's existing attendance side effect is transactionally
  deduplicated by the existing member/day constraint; it is not new write logic.
- No browser-level retry was added, avoiding stacked retries. Caller aborts
  are honored before the next attempt; each attempt has a 12-second deadline.
- On DB connection timeouts, the API additionally logs
  `DATABASE_CONNECTION_TIMEOUT`, the route template, failure kind, and pool
  total/idle/waiting counters plus effective connection timeout. This new
  diagnostic contains no SQL, parameters, session hashes, or credentials.
  Startup also emits `DATABASE_POOL_CONFIGURED` with only these safe counters
  so the deployed effective timeout can be verified without opening secrets.

## Verification and deployment

Regression coverage includes nested error causes, invalid timeout settings,
pool diagnostic counters, successful retry, persistent failure, network failure,
bounded hung requests, cancellation, non-retryable HTTP statuses, and mutations.
Deployment follows the protected PR/CI → main → Cloud Build → Cloud Run path.
The PR deployment comment records the actual revision and verification result.

Authenticated smoke checks should cover profile, points, shop and submissions
after a short idle period and again immediately. Do not mint a production
session or expose credentials just to run a smoke check. If no authenticated
browser session is available, record that verification limitation explicitly.

Roll back by deploying the prior reviewed revision if needed. Do not change
moderation modes, publication gates, Scheduler, DB contents, or cloud capacity
as part of this fix. Raising the connection budget mitigates short delays;
persistent failures still require investigation using the new pool counters.
