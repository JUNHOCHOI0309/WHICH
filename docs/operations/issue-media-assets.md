# Issue media asset operations

WHICH-84 establishes the server-side asset lifecycle for operator-managed A/B option images.
WHICH-85 adds the controlled review console and immutable decision/rights history. Public product
exposure remains deferred to WHICH-86.

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

1. Open `/ops` through Cloudflare Access and select `Image Review`.
2. Stage an upload with a 20-2000 character rights attestation. It stays in the private bucket.
3. Inspect its normalized preview, source/rights basis, dimensions, hashes, and linked Issue.
4. Record a policy-versioned approval or rejection with a reason code and rationale.
5. Only approval moves the object to the published bucket and creates a public URL.
6. Attach one published asset to each unlocked, unpublished A/B choice with alt text and crop mode.
7. Publish the Issue through the existing Issue workflow.

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

## Review states and immutable history

The Ops queue exposes five effective states: `PENDING`, `APPROVED`, `REJECTED`, `HIDDEN`, and
`DELETED`. `RESTORED` is an operator action that returns a rights-cleared hidden asset to
`APPROVED`; it is stored as a decision event rather than a sixth current state.

Every decision is append-only and records target scope (`ASSET` or `ISSUE`), target ID, action,
reason code, free-text rationale, policy version, operator, request ID, and timestamp. Asset-level
blind affects one image. Issue-level blind affects every linked image and creates an explicit
Issue-scoped decision, so the two operations are distinguishable during audit.

## Privacy, defamation, and copyright desk

The Image Review tab records `PRIVACY`, `DEFAMATION`, and `COPYRIGHT` cases independently of the
decision history. Opening a case immediately moves the targeted image or Issue media to private
quarantine and records a `HIDDEN` decision. The request retains the requester reference, details,
initial action decision, recorder, and final resolution. `ACTIONED` preserves the block;
`DISMISSED` clears the rights challenge but deliberately requires a separate restore decision.

## Emergency QA

Before enabling image Issues publicly, verify this sequence against staging R2:

1. Upload an image and confirm its Ops preview works while no public URL exists.
2. Approve it and confirm the published URL works.
3. Apply asset blind and confirm only that image loses its public URL.
4. Restore it and confirm the same normalized WebP returns.
5. Apply Issue blind and confirm every linked image is quarantined; then restore the Issue.
6. Open each rights request type and confirm immediate quarantine, immutable history, and final
   resolution metadata.
7. Delete a test asset and confirm binary restoration is rejected while metadata/history remain.
8. Verify corresponding `operator_audit_logs` contain operator, request ID, action, reason code,
   target, outcome, and decision ID.

## Orphan cleanup

The operator-only orphan purge removes staged assets that are older than the supplied threshold
(24 hours by default) and have no choice link. Run it from a controlled scheduler or operator job;
do not expose it to public clients.

## Rollback and compatibility

- Migration `0030_flimsy_hobgoblin.sql` is additive and backfills every existing Issue version
  as `format_mode = 'VS'` and `media_mode = 'TEXT_ONLY'`.
- Migration `0031_violet_peter_quill.sql` adds only append-only review decisions and rights request
  records. It does not expose existing media or alter text-only Issues.
- Removing the R2 Issue media variables disables new media operations without affecting voting,
  comments, or text-only Issue rendering.
- To roll back one unpublished media draft, detach its links and quarantine or purge its assets.
- Do not drop the media tables during an application rollback; older application versions ignore
  them safely and the rows preserve audit evidence.
