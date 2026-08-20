# Issue Pack Publication

Status: WHICH-19 operating procedure  
Initial Pack: `apps/api/content/issue-packs/which-19-initial-low-v1.json`

## Purpose

The Publisher is the only supported path for loading an approved editorial
Issue Pack into an operating database. It publishes the twelve reviewed LOW,
non-political Issues from WHICH-19. It does not enable Creator submissions or
publish the nine MEDIUM and two RESTRICTED source-Pack candidates.

Each new Issue is created with its Version, exact A/B Choices, a zero-result
Aggregate and Snapshot baseline, and one `ISSUE_PUBLISHED` Outbox Event in a
single PostgreSQL transaction. The baseline lets the Launch Gate run a
consistent reconciliation Dry Run before the first real Vote.

Do not add the publish command to Render `preDeployCommand`. Database migration
is automatic; editorial publication remains a deliberate operator action.

## Safety contract

- The checked-in Manifest must parse with no unknown fields.
- It must contain only approved LOW, non-political, publicly votable Issues.
- A/B, UUID, text normalization, timestamps, taxonomy, and meaning hashes are
  validated before a database connection is needed.
- `dry-run` reads the database and reports `CREATE`, `NOOP`, or `CONFLICT`; it
  never writes.
- Every result includes the SHA-256 digest of the exact Manifest file bytes.
- `publish` requires an explicit target and an exact
  `<target>:<pack-id>:<manifest-digest>` confirmation. This binds approval to
  the file that was inspected during Dry Run.
- An identical replay is a strict no-op and emits no duplicate Outbox Event.
- Existing partial or different state is a conflict. The Publisher never
  silently updates or repairs it.
- The whole Pack is serialized with an advisory transaction lock and committed
  atomically at `SERIALIZABLE` isolation.

## Validate locally

From `apps/api`:

```bash
pnpm issues:validate content/issue-packs/which-19-initial-low-v1.json
```

Validation does not require `DATABASE_URL`.

## Production Dry Run

Run from a Render Shell for `which-web`, where the internal `DATABASE_URL` is
already configured:

```bash
node apps/api/dist/issue-publisher.js dry-run \
  apps/api/content/issue-packs/which-19-initial-low-v1.json \
  --target production
```

Expected first-run summary:

```json
{ "create": 12, "noOp": 0, "conflict": 0 }
```

Confirm that `manifestDigest` is
`90634e07e38a8ec1c34f85081b0d1c3224fbe4a6c9e0990db2e343a9f58a55c4`. If the
file changes after validation or Dry Run, its digest changes and the old
confirmation cannot publish it.

Stop if `conflict` is not zero. Do not work around a conflict with direct SQL.
Investigate the reported Issue fields and either correct the approved Manifest
before any Votes exist or create a successor Issue when meaning has already
been locked.

## Publish

After reviewing the Dry Run output, run:

```bash
node apps/api/dist/issue-publisher.js publish \
  apps/api/content/issue-packs/which-19-initial-low-v1.json \
  --target production \
  --confirm production:which-19-initial-low-v1:90634e07e38a8ec1c34f85081b0d1c3224fbe4a6c9e0990db2e343a9f58a55c4
```

Expected first-run result: `created=12`, `alreadyPresent=0`, followed by a
verification plan containing twelve `NOOP` items. Repeating the same command
must return `created=0`, `alreadyPresent=12`.

The command prints no database credentials. Preserve the secret-free JSON
output with the release evidence.

## Launch Gate connection

Use the Pack's stable first Issue:

```env
LAUNCH_GATE_ISSUE_ID=591f2e90-996a-50c5-af46-967dd0793000
LAUNCH_GATE_ISSUE_VERSION=1
```

`LAUNCH_GATE_ISSUE_ID` is `sync: false` in `render.yaml`, so update it in the
Render environment before running the Gate.

Then verify:

```bash
pnpm launch:gate artifacts/public-mvp-gate.json
```

The public Feed should contain twelve Issues, with “야식으로 둘 중 하나만
고른다면?” first. The reconciliation check for the configured Issue should be
`CONSISTENT` even before it receives a Vote.

## Rollback and correction

Before traffic, use a reviewed database restore or an explicit forward cleanup
plan. After a Vote exists, do not delete or rewrite Issue meaning, Choices,
Votes, result baselines, or Outbox history. Close/archive the affected Issue and
publish a reviewed successor instead.
