# Operator dashboard

Tasks: WHICH-72, WHICH-73

Surface: `https://whichone.site/ops`

Mode: aggregate/member read-only + bounded Editorial Review decisions

The console has three tabs: Overview, 사용자 DB, and Issue Review. It does not publish Issues,
change moderation state, rebuild analytics, requeue Outbox events, or browse arbitrary tables.

## Access model

Two independent checks protect every dashboard read:

1. A valid WHICH Member session whose Member has an active `OPERATOR` grant.
2. When configured, a valid Cloudflare Access application JWT with the configured issuer and AUD.

Every allowed read, denied read from a valid Member, Editorial decision, grant, revoke, and backup
confirmation is written to `operator_audit_logs`. Audit metadata must remain aggregate and must not
contain tokens, OAuth subjects, email addresses, raw user agents, or IP addresses.

## First operator

After the deployment migration has completed, use Render Shell. The identifier can be the Member
UUID returned by `/api/me` or the email credential for an active Member.

```bash
node apps/api/dist/ops-operator.js grant owner@example.com
node apps/api/dist/ops-operator.js list
```

회원 알림 센터에 운영 안내를 1건 추가할 때는 이메일 또는 Member ID, 짧은 제목, 다음 행동 안내를 순서대로 전달합니다. 대상은 활성 회원 1명으로 확인되며 알림과 감사 로그가 같은 트랜잭션에 기록됩니다.

```bash
node apps/api/dist/ops-operator.js notify-member owner@example.com "테스트 알림" "헤더의 알림 버튼에서 이 안내를 확인해 주세요."
```

Revoke access immediately when it is no longer needed:

```bash
node apps/api/dist/ops-operator.js revoke owner@example.com
```

These commands are idempotent. Granting an already active operator and revoking an already revoked
operator return `changed: false`.

## Cloudflare Access

Create a self-hosted Access application and protect both paths:

- `whichone.site/ops*`
- `whichone.site/api/ops/*`

Allow only the operator identity. Then configure both Render values:

```text
CF_ACCESS_TEAM_DOMAIN=https://<team-name>.cloudflareaccess.com
CF_ACCESS_AUD=<application-audience-tag>
```

The values are all-or-nothing. When only one is present, the BFF fails closed. The BFF validates the
`Cf-Access-Jwt-Assertion` signature against Cloudflare's remote JWKS and validates both issuer and
audience. A header's mere presence is never treated as authentication.

## Backup confirmation

The dashboard never guesses that a backup exists. After verifying the backup in the provider, record
the evidence reference through Render Shell:

```bash
node apps/api/dist/ops-operator.js confirm-backup owner@example.com render-snapshot-2026-08-25 "manual restore-point check"
```

Only an active operator can create this record.

## Data contract

- Windows are fixed to 1, 7, or 30 days.
- Official funnel rows come from `analytics_daily_funnel_metrics_v2` and are never refreshed by a
  dashboard GET.
- Official population is `traffic_class = PRODUCT`; test-subject Votes are excluded.
- The screen shows the latest aggregate refresh time and compares aggregate Accepted Votes with the
  qualifying Vote source facts.
- Production supply comes from currently eligible Issues in PostgreSQL. Editorial Active, Reserve,
  and Long-term counts come from the versioned repository inventory and are labeled separately.
- Moderation, integrity, and rate-limit values are aggregate counts only.

The browser receives no email, OAuth provider subject, session identifier, secret, raw event, or SQL.

## 사용자 DB

The Member directory is a deliberately bounded read model. It exposes Member UUID, display name,
status, public Handle/visibility, connected provider names, joined/last-active timestamps, and
Vote/Comment/Issue counts. It never returns credential email, password hash, provider subject,
session/token data, IP address, or user agent. Search is limited to display name, Handle, and Member
UUID, and cursor pagination is capped at 50 rows per request.

## Issue Review

The candidate catalog and source registries remain immutable repository inputs. The operator can
record `APPROVED`, `NEEDS_CHANGES`, or `REJECTED`; direct candidate text editing and Pack publication
are intentionally separate workflows. Approval requires all four explicit checks: binary fit,
choice parity, duplicate review, and source review.

Decisions are stored in `operator_editorial_decisions`. Each update increments `revision`; a stale
browser receives `409 REVISION_CONFLICT` and must reload before retrying. This prevents one operator
from silently overwriting a newer decision.

### Importing the reviewed local baseline

Use the bounded importer once when a reviewed local decision ledger must become the production
baseline. The first command is always a dry run and prints an exact confirmation token:

```bash
node apps/api/dist/ops-operator.js import-editorial owner@example.com \
  apps/api/content/editorial/expanded/editorial-review-decisions-v1.json
```

Review `create`, `noOp`, and `conflict`. Apply only when `conflict` is zero:

```bash
node apps/api/dist/ops-operator.js import-editorial owner@example.com \
  apps/api/content/editorial/expanded/editorial-review-decisions-v1.json \
  --confirm production:which-expanded-500-catalog-v2:<sha256-from-dry-run>
```

The importer validates the ledger and Catalog, requires an active OPERATOR, runs in one database
transaction, preserves the original review timestamps, and writes one audit record. Re-running the
same file produces only `noOp` entries. If production already contains a different decision for any
candidate, the whole import stops without overwriting it.

## Refresh and incidents

The browser refreshes every five minutes and supports manual refresh. Shorter automatic polling is
intentionally excluded from v1 to avoid turning an incident into additional database load.

Use the linked runbooks for changes:

- `public-v0-release-verification.md` for release and database checks.
- `outbox-publisher.md` for Dead Letter inspection and requeue.
- `issue-pack-publication.md` for supply publication.

For an access incident, revoke the OPERATOR grant first, then remove the Cloudflare Access allow
policy or identity. Review `operator_audit_logs` before restoring access.
