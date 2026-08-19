# Public MVP Gate & Rollback Drill

Status: Implemented v1  
Gate guarantee: read-only target inspection  
Rollback strategy: application rollback without database downgrade

## Purpose

Public MVP Gate turns the release-critical checks into one reproducible `GO` or `NO_GO` report. It
does not deploy, repair Vote data, publish Outbox Events, or change feature flags. CI remains
responsible for the write-path scenarios such as Guest Vote, Comment write/reaction, reporting,
moderation, reconciliation repair, and Outbox retry. The runtime Gate verifies the deployed
artifact and its target environment without creating user data.

Rollback Drill captures immutable Vote and Outbox fingerprints before an application rollback,
then proves that the declared previous release is running and that the protected facts survived.
It deliberately treats PostgreSQL migrations as forward-only.

## Release identity

Every deployed API must receive a unique `RELEASE_ID`, preferably an immutable Git commit SHA or
container image digest. `/v1/meta` returns this value. Production startup rejects the default
`local` value.

The Gate compares `/v1/meta.releaseId` with `LAUNCH_GATE_EXPECTED_RELEASE_ID`. On Render, the Gate
automatically falls back to the platform-provided `RENDER_GIT_COMMIT`, so the deployed API and Gate
use the same immutable commit without a duplicated manual value. This prevents a healthy but stale
instance from being approved accidentally.

## Configuration

Set the following values in the root `.env` or deployment secret store. Never commit real secrets.

```dotenv
RELEASE_ID=<deployed-commit-or-image-digest>
LAUNCH_GATE_TARGET_ENVIRONMENT=staging
LAUNCH_GATE_API_URL=http://127.0.0.1:4000
LAUNCH_GATE_PUBLIC_WEB_URL=https://staging.example.net
LAUNCH_GATE_EXPECTED_RELEASE_ID=<same-deployed-commit-or-image-digest>
LAUNCH_GATE_OUTBOX_DELIVERY_REQUIRED=true
LAUNCH_GATE_ISSUE_ID=<stable-low-risk-issue-uuid>
LAUNCH_GATE_ISSUE_VERSION=1
LAUNCH_GATE_MAX_DEAD_LETTERS=0
LAUNCH_GATE_MAX_PENDING_AGE_SECONDS=300

INTERNAL_AUTH_SECRET=<target-api-internal-secret>
OUTBOX_WEBHOOK_URL=https://events.example.net/which
OUTBOX_WEBHOOK_SECRET=<outbox-delivery-secret>
DATABASE_URL=<target-postgresql-url>
```

For `production`, the public Web and an enabled Outbox consumer must use HTTPS. The API may use HTTP
only on a loopback host such as `127.0.0.1`, which is the private boundary in the Render single-service
topology. Placeholder release values, example hosts, and local secrets produce `NO_GO`. Reports
contain origins and counts only; they never include secret values or the complete database URL.

If no real Event consumer exists yet, set `LAUNCH_GATE_OUTBOX_DELIVERY_REQUIRED=false`. The Gate then
reports `DEFERRED`, preserves Pending Events, and does not apply the Pending-age threshold. Dead
Letters still produce `NO_GO`. This is an explicit temporary launch mode, not a claim that Events
were delivered.

## Public Surface Smoke

The public-only command runs from any workstation and does not need database or internal secrets:

```bash
pnpm --filter @which/api launch:public-smoke https://whichone.site
```

It requires all three public checks to pass:

1. The canonical home returns an HTML `200` response.
2. The public Feed returns at least one launchable Issue.
3. Google OAuth starts with a redirect to `accounts.google.com`.

This command cannot prove database migrations, Release ID, Outbox state, or Vote reconciliation.
Run the full Gate from a Render Shell for those internal checks.

## Public MVP Gate

Run the API target first, confirm the release branch CI passed, then execute:

```bash
pnpm --filter @which/api launch:gate artifacts/public-mvp-gate.json
```

The optional report path is created but never overwritten. Omit it to print JSON only. Exit code
`0` means `GO`; exit code `1` means `NO_GO` or an invalid invocation.

The Gate requires every check to pass:

1. Release environment values are non-placeholder and transport-safe.
2. PostgreSQL migration timestamps match the release artifact exactly.
3. API liveness and readiness return `200` and `ok`.
4. The running `RELEASE_ID` matches the expected artifact.
5. Outbox Dead Letters stay within threshold; Pending age also applies when HTTP delivery is enabled.
6. The public home, non-empty Feed, and Google OAuth start all pass.
7. The selected Issue Version returns `CONSISTENT` from reconciliation `DRY_RUN`.

Feature flags are captured in the release identity check for review. Political Vote and Comment
flags remain hard-disabled by the API contract.

`NO_GO` is a stop signal. Fix the reported cause and create a new report; do not edit a report or
raise a threshold merely to turn it green.

## Rollback snapshot

Before changing the running application, choose an already-built previous release known to be
compatible with the current forward schema:

```bash
pnpm --filter @which/api launch:rollback-snapshot \
  artifacts/rollback-before.json \
  <previous-release-id>
```

The command refuses a target equal to the current release and verifies the source release through
`/v1/meta`. Inside one read-only repeatable-read transaction it records:

- database time and applied migration timestamps;
- Outbox status counts;
- count and digest of immutable Vote fact identifiers at the snapshot time;
- count and digest of immutable Outbox identity, schema, and payload fields at the snapshot time.

New Votes or Events created after the snapshot do not invalidate verification. Deletion or mutation
of a pre-snapshot protected fact does.

## Application rollback sequence

1. Save the rollback snapshot and copy it to the incident record.
2. Stop the Outbox Worker. API transactions may continue storing Pending Events if traffic remains
   open.
3. Disable optional feature flags involved in the incident.
4. Deploy the declared previous application artifact with `RELEASE_ID` set to its immutable ID.
5. Keep the same PostgreSQL database. Do not run a down migration, delete Outbox rows, or rewrite
   Vote facts.
6. Wait for API liveness and readiness, then run rollback verification.
7. If verification succeeds, resume the Outbox Worker and monitor Pending age and Dead Letters.
8. Record the report, incident cause, and forward-fix owner.

## Rollback verification

```bash
pnpm --filter @which/api launch:rollback-verify \
  artifacts/rollback-before.json \
  artifacts/rollback-after.json
```

`VERIFIED` requires:

- the API is live and ready;
- `/v1/meta` reports the exact rollback target;
- every migration present before rollback still exists;
- pre-snapshot Vote facts and Outbox Events have identical counts and digests;
- rollback did not add Outbox Dead Letters;
- Vote reconciliation remains `CONSISTENT` in `DRY_RUN` mode.

If any check fails, keep the Worker stopped, preserve all database rows and reports, and redeploy the
source release or a forward fix. A failed verification is not repaired automatically.

## Staging drill and manual smoke

Run the full sequence in staging before public launch. After `VERIFIED`, perform one dedicated test
account flow through Issue → Vote → Result → Comment → Helpful Reaction → Report, and confirm the
moderation case. This manual smoke is intentionally isolated from the read-only production Gate.
The same write paths are also covered by PostgreSQL integration tests in `pnpm check`.

## Known v1 boundaries

- Backup freshness, deployment platform health, DNS, CDN, and external consumer internals require
  platform-specific checks outside this repository.
- The Gate samples one explicitly configured Issue Version; it does not reconcile every aggregate.
- Schema compatibility of the previous artifact must be established when that artifact is built.
- Reports are local artifacts by default and must be copied to the release or incident record.
- Render does not provide a Blueprint hook after every successful deploy, so the full Gate remains a
  manual Render Shell release step in v1.1.
