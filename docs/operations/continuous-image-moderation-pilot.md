# Continuous image moderation and automatic publication pilot

2026-08-31 · `which-auto-publication-pilot-v1`

## Scope and authority

The owner requested continuous checks and automatic publication for the existing image-upload
test account. This release does not grant upload capabilities, fabricate consent, increase paid
budgets, enable automatic member sanctions, or roll out user uploads to all members.

The general moderation Decision Engine stays independently OFF. Its historical publication
readiness diagnostic deliberately reports that SHADOW is not execution authority. The new
executor is a separate, explicit allowlisted PILOT, not a relabeling of that diagnostic.
Use `node apps/api/dist/moderation-worker.js diagnose-runtime` for effective runtime status.

## Flow

1. The existing upload path normalizes and stores images in private R2 Staging.
2. A Render child worker drains the moderation outbox. Provider processing is restricted to
   current, unpublished, two-image submissions belonging to the configured cohort.
3. Check active membership, current v2 consent and unexpired upload capability before and after
   resolving image input. Run local OCR/QR/barcode checks on hash-verified canonical images.
   PII, detected codes, missing engines or incomplete OCR do not qualify for external pilot checks.
4. Run the configured OpenAI moderation safety model, then the budgeted Luna pair/context judge.
   Luna uses `store:false`, 512px bounded derivatives and the existing USD 0.05 / 5-call daily cap.
   Provider credentials and contract/privacy approvals are reused, never rewritten by this code.
5. The separate publication executor requires current matching A/B pixel hashes, question
   revision, model/profile, complete safety category evidence, no flags or disagreement,
   routing scores below 0.1, and strict Luna ALLOW / NONE / RELATED / BALANCED / LOW / LOW.
   Scores are not probabilities, and this pilot is not a calibrated guarantee of safety.
6. Recheck live consent, access, rights, blocked hashes and text policy under database locks.
   Write the exact reviewed canonical bytes to unique public keys without deleting Staging.
   Atomically approve assets, publish the issue, link A/B images, seal its snapshot, and create
   one member notification plus a SYSTEM audit citing both inspection records.
7. After commit, recovery removes private copies. If publication fails, private originals remain;
   write-ahead R2 reconciliation records remove unreferenced public copies, including unknown
   write outcomes. Recovery takes the same submission lock and never deletes a committed key.

Luna v2 explicitly reviews gaps in the free image endpoint: sexualized minors/ambiguous sexual
age, threats, harmful illegal instructions, self-harm encouragement, identity documents, and
private screenshot content. Uncertainty stays private. Ordinary portraits alone are not blocked.
This does not pretend OCR is a visual safety engine or that text-only endpoint labels cover images.

## Explicit deployment settings

Keep these OFF by default in repository configuration; enable only in the approved environment.

| Setting                                                          | Pilot value                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| `MODERATION_WORKER_ENABLED`                                      | `true`                                                 |
| `MODERATION_WORKER_POLL_MS`                                      | `15000`                                                |
| `MODERATION_WORKER_BATCH_SIZE`                                   | `5`                                                    |
| `ISSUE_MEDIA_LOCAL_SCANNER_MODE`                                 | `LOCAL`                                                |
| `MODERATION_PROVIDER_MODE`                                       | `SHADOW`                                               |
| `MODERATION_PROVIDER_KILL_SWITCH`                                | `false`                                                |
| `MODERATION_PROVIDER_CANARY_PERCENT`                             | `100` within the worker cohort                         |
| `MODERATION_PROVIDER_DAILY_CALL_CAP`                             | `5` initially                                          |
| `MODERATION_POLICY_JUDGE_MODE`                                   | `SHADOW`                                               |
| `MODERATION_POLICY_JUDGE_KILL_SWITCH`                            | `false`                                                |
| `MODERATION_POLICY_JUDGE_CANARY_PERCENT`                         | `100` within the worker cohort                         |
| `MODERATION_POLICY_JUDGE_DAILY_CALL_CAP`                         | retain `5`                                             |
| `MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP`                  | retain `50000`                                         |
| `ISSUE_MEDIA_AUTO_PUBLICATION_MODE`                              | `PILOT`                                                |
| `ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH`                       | `false`                                                |
| `ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS`                        | exact approved member UUIDs; never email or a wildcard |
| `ISSUE_MEMBER_MEDIA_UPLOAD_MODE`                                 | retain `PILOT`                                         |
| `FEATURE_ISSUE_MEDIA_ENABLED` / `ISSUE_MEDIA_EXPERIMENT_PERCENT` | `true` / `100` for published-image display             |

Staging and Published buckets must remain distinct. Staging must not have a public custom domain.
The public domain belongs to Published only. Existing avatar storage remains unchanged.

## Operations, failure and rollback

- One database advisory lock serializes runtime batches across overlapping deployments and CLI
  `once`; the Luna ledger independently reserves daily calls and worst-case cost atomically.
- Provider cap/circuit/config gates defer pending work instead of permanently skipping it.
  Failed or unknown paid attempts are not silently retried. Local failures stay private.
- Every publication is idempotent by submission; the final transition and notification share
  a transaction. A mid-flight revision/cancellation/withdrawal invalidates old evidence.
- Reconciliation runs even when the publication kill switch is ON. If DB/R2 is unavailable,
  failed recovery records remain for the next batch. Public copies use `Cache-Control: no-store`.
- To stop new publication set `ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH=true` and deploy.
  To stop external checks also set provider/judge kill switches true. Existing public issues
  are not automatically deleted. Use existing operator hide/delete controls when required.
- `diagnose-runtime` / `policy-judge-summary` are read-only. `once` performs actual work and
  may call providers and publish eligible content; do not use it as a harmless diagnostic.
- Old SKIPPED runs and old judge profiles are not automatically promoted. Review/requeue only
  explicit targets with evidence; never reset the budget or alter a result to force publication.
- Live verification must distinguish ON configuration from an actually completed model call
  and from a published issue. A REVIEW/BLOCK/ABSTAIN sample is a valid private outcome.

## Verification

Integration tests cover successful and concurrent publication, one notification, disabled/cohort
gates, revocation/expiry, revision/cancellation, rights challenges, pixel/model/profile changes,
incomplete local evidence, conflicting ALLOW fields, R2 partial-write compensation and retry,
provider-cap deferral, and overlapping worker locks. No real model calls are made in tests.

Before broad rollout: review real pilot outcomes, establish a labeled calibration corpus,
measure false-clears/reviews and local OCR failure rates, and choose operating budgets explicitly.
