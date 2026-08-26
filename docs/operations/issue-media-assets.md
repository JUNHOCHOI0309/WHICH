# Issue media asset operations

WHICH-84 establishes the server-side asset lifecycle for operator-managed A/B option images.
Review UI and client exposure are intentionally deferred to WHICH-85 and WHICH-86.

## Scope and security boundary

- Only an authenticated Member with an active `OPERATOR` grant can call the internal routes.
- Requests also require `x-internal-auth-secret`.
- Uploads accept a base64-encoded file body. External URLs are not accepted.
- Anonymous uploads, GIFs, SVGs, and multiple images on one choice are rejected.
- Existing text-only A/B Issues remain the default and require no media configuration.

## Accepted input and normalization

- Input MIME: JPEG, PNG, or WebP
- Maximum input size: 10 MiB
- Maximum decoded pixel count: 40 million
- Declared MIME must match the decoded file type.
- Sharp applies orientation correction, strips metadata through re-encoding, limits the long edge
  to 1600 px without enlargement, and emits WebP at quality 84.
- The service records the original SHA-256, a 64-bit perceptual dHash, input/output MIME, byte
  size, width, and height. An exact SHA-256 duplicate is rejected globally, including after purge.

## R2 isolation

Use two physically distinct buckets:

1. `R2_ISSUE_MEDIA_STAGING_BUCKET` is private. New, rejected, replaced, and quarantined objects
   never receive public URLs.
2. `R2_ISSUE_MEDIA_PUBLISHED_BUCKET` contains only approved objects and is exposed through
   `R2_ISSUE_MEDIA_PUBLIC_BASE_URL`.

Objects use separate `staging/`, `published/`, and `quarantine/` namespaces. Publishing copies the
normalized object to the published bucket and removes the staging copy.

Required API environment variables:

```dotenv
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ISSUE_MEDIA_STAGING_BUCKET=
R2_ISSUE_MEDIA_PUBLISHED_BUCKET=
R2_ISSUE_MEDIA_PUBLIC_BASE_URL=https://media.example.com
```

Invalid or incomplete configuration disables only the Issue media service and its routes.

## State model

The database tracks independent axes instead of one overloaded status:

- Processing: `READY`, `FAILED`
- Moderation: `PENDING`, `APPROVED`, `REJECTED`, `REVOKED`
- Storage: `STAGED`, `PUBLISHED`, `QUARANTINED`, `PURGED`
- Rights: `ASSERTED`, `CLEARED`, `CHALLENGED`, `WITHDRAWN`

An asset can be linked only when it is `READY`, `APPROVED`, `PUBLISHED`, and its rights are
`ASSERTED` or `CLEARED`. A choice has at most one media link, and the A/B version has at most two.
Both choices must have media before the version switches from `TEXT_ONLY` to `OPTION_IMAGES`.

## Operator sequence

1. Stage an upload with a 20-2000 character rights attestation.
2. Inspect its metadata and hashes.
3. Approve and publish the asset.
4. Attach one published asset to each unlocked, unpublished A/B choice with alt text and crop mode.
5. Publish the Issue through the existing Issue workflow.

All lifecycle calls write operator audit events. Published or locked Issue versions cannot be
mutated in place; create a new Issue version instead.

## Replacement, blind, delete, and rights actions

- Replacing a choice image quarantines the previous asset.
- Detaching a choice returns an unpublished version to `TEXT_ONLY`.
- Blinding an Issue quarantines all linked assets and removes their public object paths.
- A rights challenge quarantines the object and records `CHALLENGED` even when already quarantined.
- Issue deletion or rights withdrawal purges all object copies, removes media links, and preserves
  the text Issue data for audit/history behavior.
- Purged assets retain metadata and hashes; the binary object is irrecoverably removed.

## Orphan cleanup

The operator-only orphan purge removes staged assets that are older than the supplied threshold
(24 hours by default) and have no choice link. Run it from a controlled scheduler or operator job;
do not expose it to public clients.

## Rollback and compatibility

- Migration `0030_flimsy_hobgoblin.sql` is additive and backfills every existing Issue version
  as `format_mode = 'VS'` and `media_mode = 'TEXT_ONLY'`.
- Removing the R2 Issue media variables disables new media operations without affecting voting,
  comments, or text-only Issue rendering.
- To roll back one unpublished media draft, detach its links and quarantine or purge its assets.
- Do not drop the media tables during an application rollback; older application versions ignore
  them safely and the rows preserve audit evidence.
