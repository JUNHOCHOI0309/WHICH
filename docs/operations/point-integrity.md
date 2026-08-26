# W Point Integrity Operations

Status: Production runbook
Scope: WHICH-114 — Reversal, reconciliation, repair, and operator adjustment

## Safety boundary

- Point ledger rows are immutable. Never update or delete `point_ledger_entries`.
- User-facing API responses never include Incident IDs, operator identities, Event IDs, or ledger metadata.
- Browser operations require Cloudflare Access first, then a valid WHICH Member session with an active
  `OPERATOR` grant. The API also requires the internal BFF secret.
- Render Shell CLI operations require the operator Member UUID and write `operator_audit_logs`.
- Always save and review a Dry Run artifact before a repair, reversal, or adjustment.

## Account invariant

```text
ledger_net = SUM(point_ledger_entries.amount)
cached_balance = MAX(ledger_net, 0)
restricted_debt = MAX(-ledger_net, 0)
lifetime_earned = SUM(EARN.amount)
lifetime_spent = SUM(ABS(SPEND.amount))
```

Forced reversals and negative adjustments never make `cached_balance` negative. A shortage becomes
`restricted_debt`; later positive entries reduce that debt before increasing spendable balance.

## Reconciliation and repair

Dry Run:

```bash
pnpm --filter @which/api points:reconcile --operator <operator-member-uuid> \
  --artifact artifacts/point-reconciliation.json
```

Optional single account filter:

```bash
pnpm --filter @which/api points:reconcile --operator <operator-member-uuid> \
  --member <member-uuid> --artifact artifacts/point-reconciliation.json
```

Review `mismatches`, `repairCount`, `digest`, and `confirmationToken`. Apply exactly that artifact:

```bash
pnpm --filter @which/api points:repair --operator <operator-member-uuid> \
  --artifact artifacts/point-reconciliation.json --confirm <confirmationToken>
```

The repair is idempotent. A second execution reports already-consistent accounts. If an account changed
to a third state after the Dry Run, the repair stops as stale rather than overwriting it.

## Invalidated Vote reversal

`VOTE_INVALIDATED` Domain Events are consumed automatically by the Point Worker even when new earning is
feature-disabled. The CLI is the backfill and recovery path:

```bash
pnpm --filter @which/api points:reversals --operator <operator-member-uuid> \
  --artifact artifacts/point-reversals.json

pnpm --filter @which/api points:apply-reversals --operator <operator-member-uuid> \
  --artifact artifacts/point-reversals.json --confirm <confirmationToken>
```

Reversal application verifies that each Vote is still `INVALIDATED` or `REJECTED_ABUSE`. Replaying the
same artifact creates no additional ledger entry.

## Operator adjustment

First run without `--confirm` to print the exact confirmation token:

```bash
pnpm --filter @which/api points:adjust --operator <operator-member-uuid> \
  --member <target-member-uuid> --amount 20 --incident INC-1234 \
  --idempotency INC-1234-member-credit-v1 --reason "Confirmed recovery adjustment"
```

Then rerun with the printed token. Operator, human-readable reason, Incident ID, amount, target, and
idempotency key are mandatory and stored in private ledger metadata and the operator audit log.

## Ledger lookup

```bash
pnpm --filter @which/api points:ledger --operator <operator-member-uuid> \
  --member <member-uuid> --from 2026-08-01T00:00:00Z --to 2026-09-01T00:00:00Z
```

Available filters are `--member`, `--event`, `--source-type`, `--from`, `--to`, and `--limit`. The result
includes earned, spent, reversed, adjusted, and net totals for the returned rows.

## Post-operation verification

1. Run reconciliation again and confirm `mismatched = 0`.
2. Confirm the relevant `operator_audit_logs` event is `SUCCEEDED`.
3. Confirm no user-facing response or application log contains the internal secret or private ledger
   metadata.
4. Preserve the Dry Run artifact and Incident reference with the operational record.
