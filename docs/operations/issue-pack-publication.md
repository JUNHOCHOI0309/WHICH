# Issue Pack Publication and Content Readiness

Status: WHICH-49 Content-ready RC

Policy: `apps/api/content/issue-packs/public-v0-inventory-policy.json`

## Public v0 inventory contract

The limited-beta inventory is deliberately small enough to review manually and large enough to avoid
an immediate per-user Feed exhaustion.

| Measure                     |                Target |                    Ready state |
| --------------------------- | --------------------: | -----------------------------: |
| Active Pool                 |             36 Issues |      12 WHICH-19 + 24 WHICH-49 |
| Daily publication target    |              6 Issues |             one reviewed batch |
| Active Days of Supply       |                6 days |                         36 / 6 |
| Approved Reserve            |             18 Issues |             three batches of 6 |
| Reserve Days of Supply      |                3 days |                         18 / 6 |
| Category floor              |       3 Active Issues |           each of 9 categories |
| Interest-card floor         |       2 Active Issues |               each of 14 cards |
| Per-user exhaustion Dry Run | 3 sessions x 8 Issues | 12 Active Issues remain unseen |

The Dry Run is a per-user unique-content scenario. Votes do not globally consume an Issue. The reserve
is therefore an editorial publication buffer, not a replacement for measuring real beta session depth.

When the eligible pool is exhausted, the required fallback is `STOP_WITH_EMPTY_STATE`. The service must
show its safe empty/fallback state; it must not publish an unreviewed, MEDIUM, political, duplicated, or
otherwise ineligible Issue to fill the Feed.

## Reviewed artifacts

- Existing Active Pack: `which-19-initial-low-v1.json` — 12 Issues
- Active expansion: `which-49-active-expansion-v1.json` — 24 Issues
- Approved Reserve day 1: `which-49-approved-reserve-day-1-v1.json` — 6 Issues
- Approved Reserve day 2: `which-49-approved-reserve-day-2-v1.json` — 6 Issues
- Approved Reserve day 3: `which-49-approved-reserve-day-3-v1.json` — 6 Issues
- Approved editorial source: `content/editorial/which-49-public-v0-catalog-v1.json`

The four WHICH-49 manifests contain only subjective evergreen, LOW, non-political questions. Each item
records passed choice-parity and duplicate review plus an explicit `NOT_REQUIRED_SUBJECTIVE` source
decision. Questions that make current factual claims must instead use `SOURCE_REQUIRED` and include a
reviewed URL.

## Rebuild and validate

Run from `apps/api`:

```bash
pnpm issues:build \
  content/editorial/which-49-public-v0-catalog-v1.json \
  content/issue-packs
pnpm issues:readiness content/issue-packs/public-v0-inventory-policy.json
```

Expected readiness summary:

```json
{
  "ready": true,
  "summary": {
    "activeIssues": 36,
    "approvedReserveIssues": 18,
    "dailyPublicationTarget": 6,
    "activeDaysOfSupply": 6,
    "reserveDaysOfSupply": 3
  },
  "exhaustionDryRun": {
    "requiredUniqueIssues": 24,
    "unseenActiveBuffer": 12,
    "fallback": "STOP_WITH_EMPTY_STATE",
    "passed": true
  },
  "violations": []
}
```

The builder creates stable UUIDs and content hashes from the approved source. An identical rebuild must
produce byte-identical manifests. Any editorial source change requires a new review, regenerated files,
and new digest confirmation.

## Publisher safety contract

- The checked-in Manifest parses with no unknown fields.
- It contains only approved LOW, non-political, publicly votable Issues.
- A/B, UUID, text normalization, timestamps, taxonomy, meaning hashes, and editorial source decisions
  are validated before a database connection is needed.
- `dry-run` reads the database and reports `CREATE`, `NOOP`, or `CONFLICT`; it never writes.
- `publish` requires an exact `<target>:<pack-id>:<manifest-digest>` confirmation.
- An identical replay is a strict no-op and emits no duplicate Outbox Event.
- Existing partial or different state is a conflict. Never work around it with direct SQL.
- The Pack is serialized with an advisory transaction lock and committed atomically at `SERIALIZABLE`
  isolation.
- Publication stays a deliberate operator action and is not added to Render `preDeployCommand`.

## Publish the Active expansion

The WHICH-19 Pack is already active. After the code containing WHICH-49 has deployed, run the following
from a Render Shell with the internal `DATABASE_URL`:

```bash
node apps/api/dist/issue-publisher.js dry-run \
  apps/api/content/issue-packs/which-49-active-expansion-v1.json \
  --target production
```

Expected first-run summary is `create=24`, `noOp=0`, `conflict=0`. The reviewed manifest digest is:

```text
976be9751e21d35a40edd9bfdcdf62c89940740892553c0dc44e12f1f03e573c
```

Stop if the digest differs or any conflict exists. Otherwise publish:

```bash
node apps/api/dist/issue-publisher.js publish \
  apps/api/content/issue-packs/which-49-active-expansion-v1.json \
  --target production \
  --confirm production:which-49-active-expansion-v1:976be9751e21d35a40edd9bfdcdf62c89940740892553c0dc44e12f1f03e573c
```

Expected verification is `created=24`, `alreadyPresent=0`, followed by 24 `NOOP` items. Repeating the
same command must return `created=0`, `alreadyPresent=24`.

## Approved Reserve calendar

Reserve publication is manual. Run readiness again before each batch, then use the same `dry-run ->
digest check -> publish` sequence.

| Planned time (Asia/Seoul) | Pack                                 | Digest                                                             |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| 2026-08-25 10:00          | `which-49-approved-reserve-day-1-v1` | `a2a48fc497526efdad34ddc6e7684580740df9e4bd3b2f4438a9d2a5032bbb3f` |
| 2026-08-26 10:00          | `which-49-approved-reserve-day-2-v1` | `353e022c5c3c50069723d435a28a1c28af8ad7a0b51c851957940e37f3a81e0e` |
| 2026-08-27 10:00          | `which-49-approved-reserve-day-3-v1` | `a97328e7f17579f92212018dd0cac9652ad7eb7e4984d398dc32eb101d4e3c8f` |

Do not publish a reserve batch merely because a clock elapsed. Confirm actual unseen inventory, Feed
health, category exposure, report signals, and beta cadence first. A delayed batch is safer than an
unreviewed substitute.

## Launch Gate and correction

Keep the stable WHICH-19 Issue as the Launch Gate target:

```env
LAUNCH_GATE_ISSUE_ID=591f2e90-996a-50c5-af46-967dd0793000
LAUNCH_GATE_ISSUE_VERSION=1
```

After a Vote exists, do not delete or rewrite Issue meaning, Choices, Votes, result baselines, or Outbox
history. Close or archive the affected Issue and publish a reviewed successor instead.
