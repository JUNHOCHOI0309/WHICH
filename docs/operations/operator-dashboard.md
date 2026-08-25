# Operator dashboard

Task: WHICH-72  
Surface: `https://whichone.site/ops`  
Mode: production read-only

The dashboard exposes aggregate operational evidence only. It does not publish Issues, change
moderation state, rebuild analytics, requeue Outbox events, or browse arbitrary tables.

## Access model

Two independent checks protect every dashboard read:

1. A valid WHICH Member session whose Member has an active `OPERATOR` grant.
2. When configured, a valid Cloudflare Access application JWT with the configured issuer and AUD.

Every allowed read, denied read from a valid Member, grant, revoke, and backup confirmation is
written to `operator_audit_logs`. Audit metadata must remain aggregate and must not contain tokens,
OAuth subjects, email addresses, raw user agents, or IP addresses.

## First operator

After the deployment migration has completed, use Render Shell. The identifier can be the Member
UUID returned by `/api/me` or the email credential for an active Member.

```bash
node apps/api/dist/ops-operator.js grant owner@example.com
node apps/api/dist/ops-operator.js list
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

## Refresh and incidents

The browser refreshes every five minutes and supports manual refresh. Shorter automatic polling is
intentionally excluded from v1 to avoid turning an incident into additional database load.

Use the linked runbooks for changes:

- `public-v0-release-verification.md` for release and database checks.
- `outbox-publisher.md` for Dead Letter inspection and requeue.
- `issue-pack-publication.md` for supply publication.

For an access incident, revoke the OPERATOR grant first, then remove the Cloudflare Access allow
policy or identity. Review `operator_audit_logs` before restoring access.
