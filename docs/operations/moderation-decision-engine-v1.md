# Moderation Decision Engine v2

WHICH-103 adds the policy boundary between moderation evidence and any automated product action.
It does not turn on action automation. Production defaults remain `OFF`, the global kill switch is
enabled, the canary is `0`, no category is allowlisted, and provisional publication is unapproved.

## Product action mapping

| Product action    | Canonical moderation state | Automated scope                                                 |
| ----------------- | -------------------------- | --------------------------------------------------------------- |
| `ALLOW`           | `PUBLISHED`                | not executed by v1 engine                                       |
| `NUDGE`           | `REVIEW`                   | not executed by v1 engine                                       |
| `LIMIT`           | `REVIEW`                   | not executed by v1 engine                                       |
| `PRIVATE_PENDING` | `REVIEW`                   | fail-closed fallback                                            |
| `QUARANTINE`      | `QUARANTINED`              | reversible, gated, TTL required                                 |
| `BLOCK`           | `PRIVATE_REJECT`           | only deterministic decode, format, or known-block rule evidence |
| `PROVISIONAL`     | `PROVISIONAL`              | reversible, all release gates required                          |

The engine never executes `PURGED`, rights clearance, appeal outcomes, permanent deletion, long
restrictions, vote invalidation, identity decisions, or minor-status decisions. Those remain
operator-only.

## Fail-closed validation

Every request is downgraded to `PRIVATE_PENDING` when any of the following is present:

- an unknown reason or unsupported label/target;
- a stale policy or threshold-registry version;
- a missing signal, invalid evidence, insufficient context, or insufficient evidence count;
- provider failure, provider abstention, model disagreement, or a score in the abstain band;
- a missing exact threshold for `label + action + modality + slice + policy version`;
- an unauthorized source or a human-only decision;
- an unhealthy operational budget, disabled category, closed canary, or kill switch.

Provider/model confidence by itself is never sufficient. The threshold registry is versioned in
`decision-threshold-registry.ts` and must contain an exact match.

## Reversible actions

- `QUARANTINE` records the previous state and defaults to a 24-hour TTL. Expiry or rollback restores
  that previous state.
- `PROVISIONAL` defaults to a 6-hour TTL. Expiry or rollback returns the asset to
  `PRIVATE_PENDING`.
- A category or global kill switch causes new decisions to fail closed. Existing action records can
  use the returned `rollbackAction` to restore visibility safely.

The execution and persistence path is intentionally separate. The engine returns a decision; it
does not write real actions or operate storage. Issue publication execution, expiry, rollback,
notices and reconciliation remain part of WHICH-105 integration and WHICH-111 release validation.
WHICH-109 tracks Profile safety, not this Issue publication executor.

## Provisional publication gate

All conditions must be true:

1. mode is `LIMITED_ACTION` and the global kill switch is off;
2. the category is explicitly allowlisted and the stable hash falls inside the canary;
3. operational budgets and provider health are normal;
4. `MODERATION_PROVISIONAL_RELEASE_APPROVED=true` after WHICH-111 category approval;
5. cohort and asset type are both explicitly allowlisted;
6. the provider succeeded, did not abstain, agrees with the required evidence, and meets the exact
   threshold;
7. the action is reversible and has an expiry/rollback path.

Since `which-decision-engine-v2`, PROVISIONAL also requires the internal
`which-provisional-evidence-v1` contract. Every required check (technical, known-block, local PII,
local visual, image safety, context safety, rights, capability, consent) needs exactly one PASS
bound to the same input hash and current policy, a source version, evidence ID and valid time window.
Missing/duplicate checks, stale/expired/future evidence, competing risk signals and duplicated or
miscounted signal evidence IDs fail closed. This is not a client/provider response schema.
PROVISIONAL requires a positive integer TTL and expires no later than its earliest required evidence.
Do not manufacture a clear signal from `1 - max(category_scores)` or treat configured thresholds
as completed production calibration. The current Shadow pipeline supplies observations only;
see [publication readiness](./issue-media-publication-readiness.md).

One credible critical public miss must disable the affected category and invoke the rollback action
for outstanding provisional decisions.

## Runtime variables

```dotenv
MODERATION_DECISION_MODE=OFF
MODERATION_DECISION_KILL_SWITCH=true
MODERATION_DECISION_CANARY_PERCENT=0
MODERATION_DECISION_CATEGORY_FLAGS=
MODERATION_PROVISIONAL_RELEASE_APPROVED=false
MODERATION_PROVISIONAL_COHORTS=
MODERATION_PROVISIONAL_ASSET_TYPES=
MODERATION_QUARANTINE_TTL_SECONDS=86400
MODERATION_PROVISIONAL_TTL_SECONDS=21600
```

Do not copy a provider canary value into these variables. Provider inspection and action execution
are independent gates, and both must pass.

## Verification

Run:

```bash
pnpm --filter @which/api test -- moderation-decision-engine.test.ts
pnpm --filter @which/api typecheck
pnpm --filter @which/api lint
```

The test suite covers invalid inputs, deterministic private rejection, abstain thresholds,
reversible quarantine, expiry/rollback, provisional release gates, category flags, canary, budget,
human-only boundaries and kill switches.
