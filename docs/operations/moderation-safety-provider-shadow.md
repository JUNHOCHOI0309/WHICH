# Safety Classifier Shadow 운영 계약

Status: WHICH-101 implemented, production traffic disabled by default  
Provider: OpenAI Moderation (`omni-moderation-2024-09-26`)  
Mode: observation only; never a publication, rights, or account decision

## What is connected

`moderation-worker` now resolves immutable Comment, Issue, and Issue-media versions into a minimal
provider input and invokes a replaceable adapter. Text is whitespace-normalized and bounded. Images
are read from private R2, rotated, stripped of metadata, resized within 1024×1024, and re-encoded as
WebP. Only a redacted question/choice/alt-text excerpt may accompany the derivative. Member IDs,
email, IP, OAuth subject, Vote choice, Guest/session data, source object key, and public CDN URL do
not leave WHICH.

The stored result contains only modality, provider label, canonical reason code, raw score,
calibrated band, applied input modality, flagged state, model snapshot, latency, zero-dollar cost,
abstain state, provider disagreement state, and supported/unsupported label inventories. Raw
request pixels, prompt text, provider response, and credentials are not persisted. OpenAI does not
return bounding boxes, so `regions` is empty and `capabilities.boundingBoxes` is false; this is not
interpreted as an image-region safety judgment.

## Activation gates

An API key alone cannot enable calls. Every condition must pass:

1. `MODERATION_PROVIDER_MODE=SHADOW`
2. `MODERATION_PROVIDER=OPENAI_MODERATION`
3. `MODERATION_PROVIDER_KILL_SWITCH=false`
4. `MODERATION_PROVIDER_CANARY_PERCENT` is greater than zero
5. `MODERATION_PROVIDER_DAILY_CALL_CAP` is greater than zero
6. `OPENAI_API_KEY` is configured
7. Every WHICH-97 evidence key appears in `MODERATION_PROVIDER_APPROVAL_EVIDENCE`

The evidence value is a comma-separated list of these exact keys:

```text
dpaExecuted,noTrainingConfirmed,retentionTermsRecorded,deletionTermsRecorded,
subprocessorsRecorded,processingRegionRecorded,encryptionConfirmed,
credentialRotationOwnerAssigned,breachResponseRecorded,
internationalTransferLegalReviewApproved,providerDataControlApproved
```

Inspect the redacted configuration without exposing the key:

```bash
node apps/api/dist/moderation-worker.js diagnose-provider
```

Recommended rollout is 1% → 5% → 25%, with a fixed daily cap. Stop by setting the global kill
switch to `true`; already stored Shadow observations remain auditable. The worker is still an
operator-run one-shot/loop and is not executed in the user request path.

## Failure and disagreement contract

Failures are separated as `TIMEOUT`, `RATE_LIMITED`, `REFUSAL`, `MALFORMED_OUTPUT`,
`AUTHENTICATION`, `PROVIDER_UNAVAILABLE`, and `INPUT_UNAVAILABLE`. Retryable failures use the
existing bounded backoff/dead-letter path. All failures keep publication unchanged.

The normalized result lists unsupported WHICH policy labels such as PII, spam/manipulation,
copyright/rights, defamation, relevance, visual fairness, and identity. Unsupported never means
safe. A second adapter can be compared with `compareModerationProviders`; disagreement is an
evaluation/queue signal, not an enforcement decision.

`toGoldenSetPrediction` exports the normalized result to the existing WHICH-100 evaluator. Release
analysis compares provider output with the two-reviewer Golden Set, optional adjudication,
operator action, latency/cost, and required language/modality/safety slices. A model snapshot change
is a new evaluation run and requires canary regression review before promotion.

## Provider comparison recorded for selection

| Provider                       | Actual useful surface for WHICH                                  | Known gap / retention-cost gate                                                                                      | Current decision                                                             |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| OpenAI Moderation              | Text + image category scores and applied input type              | No bbox; not PII/rights/relevance; business-data controls and project retention approval still required              | Implemented as pinned Shadow adapter; moderation model is documented as free |
| AWS Rekognition                | Image moderation taxonomy with confidence                        | Image-only for this use; per-image pricing; account data-use/opt-out and regional contract review required           | Candidate second image adapter                                               |
| Google Cloud Vision SafeSearch | Image SafeSearch likelihoods                                     | No general Korean text policy; billed per image feature after free tier; location/retention contract review required | Candidate specialist adapter                                                 |
| Azure AI Content Safety        | Text/image severity labels for hate, sexual, violence, self-harm | Separate pricing/region configuration and different taxonomy/calibration                                             | Candidate enterprise fallback                                                |

Primary references: [OpenAI Moderations API](https://developers.openai.com/api/reference/resources/moderations),
[OpenAI omni-moderation model](https://developers.openai.com/api/docs/models/omni-moderation-latest),
[AWS Rekognition moderation](https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html),
[Google Cloud Vision pricing](https://cloud.google.com/vision/pricing), and
[Azure AI Content Safety overview](https://learn.microsoft.com/azure/ai-services/content-safety/overview).

## Go / no-go

Remain OFF when any approval evidence is missing, the Golden Set is not representative, a required
slice regresses, provider errors exceed the declared SLO, drift is unexplained, or an input cannot
be minimized. Shadow output cannot directly hide/publish content, change rights state, sanction a
Member, or send a Member notification. Those remain deterministic rule or accountable operator
workflows.
