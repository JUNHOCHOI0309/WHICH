# Immutable Content Revisions Runbook

Status: Active foundation (WHICH-93)  
Scope: Comment bodies, Issue versions, Issue media assets and links, moderation rechecks

## Guarantees

- `comments` and `issue_choice_media` remain current-state projections for existing reads.
- Every new Comment create, edit and author removal appends `comment_revisions`; body history is never updated in place.
- Every staged image creates immutable asset version `1`. A replacement is a new asset ID, not a mutation of published bytes.
- Every draft media attach, replacement and detach appends `issue_choice_media_revisions`.
- Every newly published Issue is sealed in `issue_version_snapshots` after its choices exist. The snapshot includes question, context, ordered choices, asset ID/version/hash, alt text, crop, position and rights assertion.
- Moderation rechecks are idempotent on `(target type, target ID, target version, policy version, input hash)` and retain normalized snapshot and OCR evidence references.

## Migration and backfill

Migration `0041_legal_killraven.sql` is expand-only.

- Existing Comments receive one `LEGACY_BACKFILL` revision containing only the state observable at migration time. Earlier edits are intentionally not reconstructed.
- Existing image assets receive immutable version `1` using their stored SHA-256 and best available object reference. Purged assets receive a non-fetchable audit reference.
- Existing media links receive one `LEGACY_BACKFILL` link revision.
- Existing Issue versions receive a full database snapshot. Legacy input hashes use a deterministic MD5-pair marker because PostgreSQL `pgcrypto` is not assumed.
- All backfills use `ON CONFLICT DO NOTHING`, so interrupted migration replay remains safe.

## Preservation order

When directives conflict, preserve evidence according to this fixed order:

1. `LEGAL_HOLD` (500)
2. `RIGHTS` (400)
3. `APPEAL` (300)
4. `MEMBER_DELETION` (200)
5. `CONTENT_DELETION` (100)

A released directive no longer participates. Product projections may hide or anonymize content while immutable evidence remains retained under a higher active directive.

## Deployment verification

```sql
SELECT operation, count(*) FROM comment_revisions GROUP BY operation ORDER BY operation;
SELECT count(*) AS issue_versions,
       (SELECT count(*) FROM issue_version_snapshots) AS snapshots
FROM issue_versions;
SELECT count(*) AS assets,
       (SELECT count(*) FROM issue_media_asset_versions) AS asset_versions
FROM issue_media_assets;
SELECT target_type, status, count(*)
FROM moderation_recheck_requests
GROUP BY target_type, status;
```

The first three comparisons may briefly differ only if a deployment is accepting writes before the application version has switched. Re-run after deployment reaches healthy state.

## Rollback

Application rollback is safe because the migration only adds tables and one defaulted column. Do not drop revision tables during an incident rollback. The previous application ignores them, and retained history is required for appeal, rights and legal-hold evidence.

After the application is rolled back:

1. stop new moderation recheck dispatch;
2. verify current-state projections remain readable;
3. keep migration `0041` applied;
4. fix forward and redeploy;
5. run the verification queries above before resuming moderation workers.
