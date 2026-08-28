# Image Moderation Operating Strategy v2

- Status: proposed operating contract — production member upload remains disabled
- Last updated: 2026-08-28
- Task: `WHICH-140`
- Notion report: [WHICH 이미지 Moderation 운영 전략 v2](https://app.notion.com/p/3c928b27a5598189aa9bef1335295840)
- Approved library backlog: [WHICH-141](https://app.notion.com/p/3c928b27a55981ab94abc6322a125bf8)
- Supersedes for planning: `WHICH_IMAGE_MODERATION_OPERATING_STRATEGY_v1.md`
- AI roadmap: [`ai-moderator-implementation-roadmap.md`](../product/ai-moderator-implementation-roadmap.md)
- Trusted uploader decision: [`ADR-0005`](../architecture/adr/0005-trusted-image-uploader-capability.md)
- Pilot runbook: [`trusted-image-uploader-pilot.md`](./trusted-image-uploader-pilot.md)

## Decision

WHICH does not make one operator approve every member image forever, and it does not replace that
operator with one opaque AI score. It reduces review demand before automating decisions:

```text
text-only or approved library
  -> immediate publish

member direct upload
  -> private upload session
  -> deterministic file and privacy gates
  -> calibrated safety adapters
  -> policy decision engine
  -> exceptional human review or provisional publish
  -> risk-stratified audit and post-publication reports
```

The first member pilot remains pre-publication human review. A future fast lane is a separate
release decision that requires substantially more evidence than the pilot smoke test.

## What the source proposal gets right

- Text-only, approved-library, and direct-upload paths have different risk and latency.
- Staging, published, and quarantine objects must be isolated.
- Member status and the image-upload capability must remain independent.
- Decode and known-block failures can be deterministic; rights and contextual harm cannot.
- AI should start in shadow mode and then reviewer assist.
- All automated actions must be reversible, attributable, and covered by audit and appeal.

## Required corrections

### Thirty assets prove operations, not automated safety

The existing `14 days / 10 uploaders / 30 assets` gate is retained only as a smoke test for upload
UX, queue flow, R2 lifecycle, notices, and operator workload. With zero critical misses in 30
samples, the rule-of-three still gives an approximate one-sided 95% upper miss-rate bound near
10%. It cannot justify automatic publication.

Automation evidence is evaluated per action and risk slice:

- maintain a separately adjudicated image and multimodal golden set;
- require two independent labels and adjudication for release-gate examples;
- report precision, critical false negatives, abstentions, and worst-slice performance;
- use at least 300 representative zero-critical-miss cases before claiming a critical miss rate
  below roughly 1%; use a larger gate when the target is stricter;
- require sufficient positive examples for every label whose output triggers an action;
- audit the first 500 provisionally published assets at 20%, plus targeted audits for new members,
  threshold-near scores, model disagreement, and novel clusters;
- stop the affected category immediately after one credible critical public miss.

These are release floors, not proof that a system is harmless. A policy owner can demand larger
samples based on severity and prevalence.

### Risk is not one confidence score

Every asset is assessed on independent axes:

| Axis               | Examples                                                   | Can automation finalize it?                          |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| Technical security | type, signature, decode, size, malware, known-block hash   | Yes, only deterministic failures                     |
| Content safety     | sexual content, violence, self-harm, hate-related imagery  | Only calibrated reversible actions                   |
| Privacy            | OCR PII, identity documents, faces, location clues         | Detection can assist; ambiguous cases require review |
| Rights             | source, licence, likeness, copyright request               | No; AI cannot clear ownership                        |
| Relevance          | image-question fit, misleading context                     | Assist or review                                     |
| Visual fairness    | A/B information density, crop, salience, presence symmetry | Assist or review                                     |

Provider confidence is recorded as a signal, not interpreted as a universal probability. Thresholds
are versioned per `label + action + content slice`, with an explicit abstain range.

### Safety, rights, and publication stay independent

Recommended current-state axes:

```text
safety:       CLEAR_CANDIDATE | REVIEW | BLOCK_CANDIDATE
rights:       ASSERTED | CHALLENGED | CLEARED | WITHDRAWN
publication:  PRIVATE | PROVISIONAL | PUBLISHED | QUARANTINED | PURGED
source:       RULE | MODEL | OPERATOR
```

A model can never turn `ASSERTED` into `CLEARED`. `PROVISIONAL` means that a calibrated low-risk
lane published the normalized derivative and that the asset remains subject to audit. It does not
mean that WHICH verified ownership.

### Reports are sensors, not verdicts

General reports, urgent safety reports, product appeals, and formal rights requests are separate
workflows.

- A report count alone never deletes an asset or imposes a permanent restriction.
- Credible privacy or severe safety signals may trigger reversible quarantine.
- Rights requests use their own evidence, deadlines, legal-hold, counter-notice, and restoration
  workflow; the product's default 14-day appeal window is not reused as a universal legal rule.
- Coordinated or duplicate reports are clustered without discarding their audit history.

WHICH should obtain legal review before enabling a jurisdiction-specific copyright takedown flow.

## Three publication paths

### 1. Text-only

- Default for every eligible member.
- Publishes through the existing text policy path.
- Image-provider outage or budget exhaustion cannot block it.

### 2. Approved library

- Publishes immediately after the Issue policy checks pass.
- Uses a dedicated reusable library asset and usage model, not the current one-asset-per-choice
  link contract.
- Stores source URL, creator, licence and version, acquisition date, permitted use and alteration,
  attribution requirements, evidence snapshot, and withdrawal state.
- A perceptual-hash match is a review signal; only a verified known-block hash is an automatic
  rejection.

### 3. Direct upload

- Disabled by default.
- Requires `ISSUE_MEMBER_MEDIA_UPLOAD_MODE=PILOT`, an active `ISSUE_IMAGE_UPLOAD` grant, current
  rights/privacy consent, ownership of an unpublished eligible Issue, and server-enforced daily and
  open-asset quotas.
- Starts with a named cohort and pre-publication human approval.
- Can move to a provisional lane only after the separate automation gate passes.

## Secure upload and processing contract

The existing operator-only base64 route must not be reused as the public member upload transport.
Use a short-lived, one-time upload session with a server-generated object key and a narrowly scoped
private R2 upload. The server or isolated worker then:

1. authenticates member, capability, consent version, Issue ownership, mode, quota, and session;
2. checks allowlisted extension only as a hint, then validates MIME signature and complete decode;
3. applies byte, pixel, CPU, memory, wall-clock, and concurrency limits;
4. strips EXIF and GPS, normalizes orientation, and re-encodes a bounded WebP derivative;
5. calculates SHA-256 and perceptual hash and checks a versioned known-block registry;
6. detects QR/barcodes and performs OCR before external model calls;
7. detects local PII patterns and routes faces, documents, screenshots, or location clues to review;
8. sends only a downscaled normalized derivative and minimum redacted context to approved providers;
9. stores stage findings with rule/model/policy versions, input hash, latency, and cost;
10. emits an idempotent decision request and reconciles R2 and database state through the outbox.

Raw objects never receive a public URL. Bucket listing is disabled, staging CORS is narrow, served
media uses an explicit content type and `X-Content-Type-Options: nosniff`, and quarantine includes
CDN invalidation verification. Raw upload deletion and derivative retention use explicit TTLs.

This follows the defense-in-depth shape recommended by the
[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html):
allowlisting, signature validation, generated names, limits, authorized uploaders, isolated storage,
and layered scanning.

## Decision routing

```text
deterministic technical failure or verified known-block hash
  -> AUTO_REJECT_PRIVATE

credible urgent risk
  -> QUARANTINE + P0 exception queue

uncertain result, provider failure, partial OCR, model disagreement, unsupported slice
  -> PRIVATE_PENDING + human exception queue

validated low-risk candidate during pre-review pilot
  -> REVIEW_READY + human review

validated low-risk candidate after automation release gate
  -> PROVISIONAL_PUBLISH + random/targeted audit
```

All conditions in a provisional-publish policy must pass. Missing data is not treated as safe.
Permanent deletion, long account restriction, appeal, rights resolution, identity inference, minor
status, defamation truth, and copyright ownership remain human decisions.

## Failure isolation and cost control

| Failure                                 | Image behavior                             | Product behavior                               |
| --------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Provider timeout, 429, malformed output | Private pending; never auto-allow          | Text-only/library remain available             |
| Daily cost cap reached                  | Pause external calls and provisional lane  | Preserve drafts and explain alternatives       |
| Queue age or backlog exceeds SLO        | Stop new direct uploads                    | Existing votes and text issues continue        |
| R2 copy/DB transition mismatch          | Keep non-public and enqueue reconciliation | No broken public reference                     |
| CDN quarantine purge failure            | Escalate P0 and retry until verified       | Hide media through API response immediately    |
| Model/policy version changes            | Shadow canary and regression gate          | Previous production version remains selectable |

Each adapter has timeouts, retry budgets, a circuit breaker, dead-letter handling, a kill switch,
and a daily spend ceiling. Duplicate input hashes can reuse a compatible result, but policy or model
version changes invalidate the cache.

## Provider role and privacy gate

No single provider covers the full policy. For example, OpenAI's current multimodal moderation
model accepts image input, while its documented image-category coverage is still narrower than the
full text taxonomy. Google SafeSearch exposes only a small likelihood set, and AWS Rekognition
provides hierarchical moderation labels rather than rights or context decisions. Provider selection
therefore occurs behind a common adapter and a WHICH-owned decision engine.

Before any production call, WHICH-97 records:

- exact input fields and derivative size;
- processing country/region and subprocessors;
- retention, deletion, breach, and no-training terms;
- encryption and credential rotation;
- raw upload, staging derivative, rejected/quarantined binary, OCR text and coordinates, provider
  input/output, hashes, appeal evidence, rights evidence, and legal-hold retention;
- deletion propagation and operator access logs.

Only normalized, minimized data leaves WHICH. Face presence may be a routing signal; face
recognition, identity matching, demographic inference, and biometric embeddings are out of scope.
The current Korean privacy baseline is the Personal Information Protection Commission's
[generative AI privacy guidance](https://m.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=11439).

WHICH-97 is now pinned by
[`ai-image-provider-privacy-retention-gate-v1.md`](./ai-image-provider-privacy-retention-gate-v1.md).
The decision is `NO_GO`: external image-provider mode remains `OFF` until every contractual,
international-transfer, provider-data-control, deletion-propagation, and public-policy evidence item
passes. OpenAI Moderation and Google Cloud Vision are conditional candidates only; neither is an
approved production processor in the current release.

## Reviewer experience and automation-bias control

The exception queue shows the Issue question, both options, both assets, alt text, crop, source and
rights assertion, technical findings, OCR/QR regions, safety signals, similar assets, and prior
decisions. Risky previews are blurred until revealed, and every raw view is audited.

For release-gate audit samples, the reviewer records a provisional label before seeing the AI
recommendation. Other cases may show AI assistance immediately. WHICH records agreement,
overrides, override direction, reason, review time, and final action. Irreversible bulk actions are
not provided.

## Metrics and release gates

### Operational smoke gate

- at least 14 days, 10 uploaders, and 30 submitted assets;
- upload, cancel, replace, text-only fallback, notice, review, appeal, quarantine, restore, and purge
  paths pass;
- review p95, oldest queue age, per-asset review time, weekly operator hours, errors, and costs are
  measured;
- `GO` authorizes only another limited cohort under the same all-human boundary.

### Shadow and reviewer-assist gate

- golden-set and production-shadow results are separate;
- metrics are reported per label, action, content type, source type, and risk slice;
- model disagreement, abstention, reviewer override, queue savings, and provider failure are visible;
- no AI result changes publication during shadow mode.

### Provisional-publish gate

- the exact low-risk cohort and content types are allowlisted;
- per-action precision and critical false-negative objectives pass the agreed sample floor;
- every irreversible and rights-related action remains manual;
- random and targeted audits, immediate category kill switch, rollback, and incident playbook pass;
- cost per asset and operator time are demonstrably lower than the pre-review baseline;
- one credible critical public miss stops the affected category pending investigation.

NIST AI RMF calls for explicit human roles, repeatable evaluation, monitoring, and review after
deployment; these gates follow that lifecycle rather than treating a one-time accuracy result as a
release certificate. See [NIST AI RMF Govern/Measure guidance](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/).

## Current repository audit

Production `origin/main` at `43e9df6` still exposes only the operator image path. Existing reusable
foundations include R2 staging/published isolation, signature/decode/size checks, metadata stripping,
WebP normalization, SHA-256/dHash generation, append-only media review decisions, Rights Desk,
operator audit, public text fallback, outbox retry/DLQ, and feature flags.

The following are not yet production-ready:

- trusted-uploader grant/event persistence and a service that enforces it;
- member upload mode, consent, daily/open-asset quotas, and audit enforcement;
- member upload sessions and isolated processing;
- QR/OCR/PII/known-block/safety findings and provider adapters;
- asset reports, user notices, appeals, legal hold, and deletion guards;
- Issue-submission context in the image review screen;
- reusable approved-library assets;
- common moderation run/case/action and immutable comment revisions;
- model evaluation, reviewer-assist, threshold registry, and provisional-publish engine.

There is member-image work in the current local uncommitted tree that checks only an active member
session before staging. It must not be merged or enabled until the capability, mode, quota, consent,
submission context, report/appeal, and audit gates above are enforced server-side. The current
immediate text Issue route must also reject any attempt to smuggle image payloads around the
reviewed submission flow.

## Revised delivery order

```text
Policy and privacy
  WHICH-91 -> WHICH-92 + WHICH-93 + WHICH-97

Deterministic and data foundation
  -> WHICH-94 + WHICH-98 + WHICH-108

Human-safe pilot foundation
  -> WHICH-95 + WHICH-96 + WHICH-99 + WHICH-100

AI observation and assistance
  -> WHICH-101 + WHICH-104 -> WHICH-102

Narrow reversible automation
  -> WHICH-103 -> WHICH-105 -> WHICH-111

Evidence-driven extensions
  WHICH-106, WHICH-107, WHICH-109, WHICH-110
```

`WHICH-108` is raised from a distant P3 research item to a P0/P1 prerequisite for member images.
`WHICH-105` can ship text-only and approved-library flows before AI, but direct upload cannot enter a
fast lane until WHICH-108 and the release gates are complete.

The reusable approved-library model is tracked separately in WHICH-141 because the current
one-asset-per-choice link and replacement quarantine semantics cannot safely represent a shared
licensed asset.

## Source notes

- [OpenAI multimodal moderation model](https://developers.openai.com/api/docs/models/omni-moderation-latest)
- [AWS Rekognition content moderation](https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html)
- [Google Cloud Vision SafeSearch](https://docs.cloud.google.com/vision/docs/detecting-safe-search)
- [Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [NIST AI Risk Management Framework](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)
- [Korean PIPC generative AI privacy guidance](https://m.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=11439)
