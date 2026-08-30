# AI Image Provider, Privacy, and Retention Gate v1

Status: `NO_GO` for external image-provider calls  
Owner: Product / Privacy / Operations  
Policy registry: `apps/api/src/modules/moderation/provider-privacy-policy.ts`  
Task: WHICH-97

## Decision

WHICH does not send user images to an external AI provider by default. `OFF` is the code default,
and adding an API key alone cannot open the gate. The first permitted rollout, after every item in
the evidence checklist is complete, is `SHADOW`: a provider result is compared with an operator
decision and cannot publish, reject, quarantine, sanction, identify, or delete content.

The following fields must never be included in an external request:

- raw IP address or network fingerprint;
- device identifier;
- OAuth subject or social-provider account identifier;
- email address;
- Member ID or Guest ID;
- Vote choice or voting history;
- raw upload URL, original metadata, or unredacted OCR/context.

An opaque, provider-specific request ID is used for correlation. It must not be reversible to an
account, device, vote, or content author.

## Approved data path

```text
private raw upload
  -> signature/decode/malware gate
  -> EXIF/GPS removal
  -> orientation normalization, downscale to <= 1024 px, WebP re-encode
  -> local OCR/QR/PII redaction gate
  -> minimized question/options/alt text (<= 1500 characters)
  -> external provider only when the runtime gate is open
  -> policy-versioned labels/scores only
  -> raw request/response discarded
```

The provider input is a review derivative, not the public asset and not the original upload. Normal
application logs, error logs, traces, analytics, and alerts may contain only an opaque request ID,
provider/stage, bounded error code, HTTP status, latency, cost, policy/model version, and derived
labels. They must not contain pixels, base64, signed URLs, prompts, OCR text/coordinates, provider
raw responses, or the prohibited identifiers above.

## Face and biometric boundary

Face presence can be a boolean routing signal for human review. WHICH prohibits face recognition,
identity matching, identity inference, demographic or sensitive-attribute inference, age/minor
inference, face templates, and biometric embeddings. A provider capable of these functions does not
authorize WHICH to use them. Rights, identity, real-person, and minor decisions remain human-only.

## Retention matrix

`ttlDays = 0` means no day-based persistent retention. The shorter `purgeWithinHours` operational
deadline applies. Legal hold is the only event-bound exception: it has no autonomous TTL, and the
binary/evidence must be purged within 720 hours after an authorized release unless another active
directive applies.

| Data class                     |                  TTL |          Purge deadline | Start / rule                                                          |
| ------------------------------ | -------------------: | ----------------------: | --------------------------------------------------------------------- |
| Raw upload                     |               0 days |                  1 hour | Delete after the normalized derivative is created or processing fails |
| Private staging derivative     |              14 days |                24 hours | Upload time; active Appeal/Rights/Legal Hold can override             |
| Rejected or quarantined binary |              30 days |                24 hours | Final decision or appeal resolution, whichever is later               |
| OCR text and coordinates       |               7 days |                24 hours | Restricted evidence plane only; never normal logs                     |
| Provider input and raw output  |               0 days |                  1 hour | Do not persist; transient request handling only                       |
| Provider-derived labels/scores |             180 days |                24 hours | Completion time; retain policy/model version with the result          |
| SHA-256 and dHash              |             365 days |                24 hours | Binary purge time; restricted anti-abuse evidence                     |
| Appeal evidence                |             180 days |                24 hours | Final appeal resolution                                               |
| Rights evidence                |           1,095 days |                24 hours | Final rights resolution; period requires legal approval               |
| Legal hold                     | 0 days / event-bound | 720 hours after release | Authorized hold release; no deletion while active                     |

The existing directive order is authoritative:

```text
LEGAL_HOLD (500)
  > RIGHTS (400)
  > APPEAL (300)
  > MEMBER_DELETION (200)
  > CONTENT_DELETION (100)
```

Account deletion immediately removes account credentials, sessions, identity links, and public
profile data. It requests deletion of unneeded moderation data, but it cannot silently destroy an
active appeal, rights case, or legal hold. When the higher directive is released, the next directive
must be re-evaluated and deletion propagated to PostgreSQL, R2 staging/published/quarantine,
provider-side stored state if any, caches/CDN, search indexes, analytics exports, backups, and DLQ
payloads. Reconciliation records the requested, observed, and completed timestamps without copying
the deleted content into the audit event.

## Provider decision register

The initial gate default is OFF. Endpoint-specific owner review and runtime activation are separate:
the restricted evidence register records approvals; the table below is not blanket authorization
to process traffic or to publish content.

| Provider            | Candidate role                                        | Current decision | Key constraints                                                                                                                                                          |
| ------------------- | ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI Moderation   | Image content-safety shadow signal                    | `CONDITIONAL`    | Executed DPA; endpoint-specific data-control approval; Global processing and international-transfer owner review; project-scoped key. ZDR/MAM is not enabled or claimed. |
| OpenAI Luna         | A/B image context policy shadow                       | `CONDITIONAL`    | Separate Responses retention approval; current v2 member consent; store:false; strict call/cost caps; no publication authority.                                          |
| Google Cloud Vision | Local-gate supplement for OCR/QR or SafeSearch shadow | `CONDITIONAL`    | Executed DPA; exact project location/configuration; subprocessor and retention review; Korean international-transfer review; project-scoped service account              |

OpenAI documents that API business data is not used for training by default and that the moderation
endpoint has no default abuse-monitoring or application-state retention. Responses is different:
even with store:false, default abuse logs can remain for up to 30 days (longer for legal obligations
or necessary service/third-party protection). Encrypted prompt-cache state can remain for up to
24 hours; suspected CSAM image inputs have a manual-review retention exception. Global processing
does not guarantee Korean storage or processing. WHICH has not enabled or claimed ZDR/MAM.

The owner accepted these Responses-specific terms for a bounded Shadow validation on 2026-08-30,
subject to deployed notice and current member consent. This records internal owner review, not
independent legal advice, regulatory approval, or approval of automatic publication/sanctions.
See [the bounded validation runbook](luna-shadow-validation-2026-08-30.md).

Google SafeSearch returns a limited likelihood taxonomy and cannot decide privacy, rights,
relevance, visual fairness, identity, or context. Google publishes a Cloud subprocessor register,
but WHICH still needs the executed contract, selected service configuration, retention/deletion
evidence, and transfer review for its own project before use.

## Evidence checklist to open `SHADOW`

Every item must have an owner, approval date, source URL or signed-document reference, review date,
and expiry/revalidation date:

- DPA executed for the actual WHICH legal entity/project;
- no-training term confirmed;
- request, abuse-log, application-state, and exception retention recorded;
- deletion request and account/project termination behavior recorded;
- processing countries/regions and subprocessor register recorded;
- Korean international-transfer notice/consent or other lawful basis reviewed by counsel;
- encryption in transit and at rest confirmed;
- secret stored server-side only, project-scoped, least privilege, 90-day rotation owner assigned;
- breach notification contact, escalation SLA, and provider incident channel recorded;
- provider-specific data control (such as enhanced ZDR/MAM) approved and verified in the project;
- provider timeout, circuit breaker, daily cost cap, kill switch, and text-only fallback tested;
- deletion propagation and legal-hold release reconciliation tested;
- public Privacy Policy, Community Policy, and Appeal Guide changes legally approved and deployed.

Evidence belongs in the restricted operator evidence register. Secrets, full DPAs, raw requests,
and personal information do not belong in Git or Notion task comments.

## Incident and credential rules

- Provider credentials are server-only and must never be exposed to the web bundle or client.
- Use a separate key/service account per environment and provider role; no shared avatar/R2 key.
- Rotate at least every 90 days and immediately after suspected exposure, staff/owner change, or
  provider incident.
- A suspected data leak sets the provider mode to `OFF`, preserves only sanitized audit evidence,
  activates the breach runbook, and pauses direct image uploads if local-only processing cannot keep
  them safely private.
- Provider timeout, 429, malformed output, policy mismatch, or cost-cap exhaustion is `SKIPPED` or
  `FAILED`; the image remains private pending. It is never auto-allowed.

## Legal review items

The following are product drafts, not a legal conclusion:

- Korean overseas-transfer disclosure/consent or lawful-basis language for each provider;
- exact rights-evidence retention period and preservation obligations;
- legal-hold authority, release, and user-notice exceptions;
- provider and subprocessor naming, processing country, purpose, fields, timing, and deletion method;
- handling of images containing minors, real people, sensitive information, or biometric signals;
- user access/deletion requests when an appeal, rights request, or legal hold is active.

See [`ai-image-policy-change-draft-v1.md`](../legal/ai-image-policy-change-draft-v1.md).

## Verification

- Unit tests reject prohibited fields at any nesting depth.
- Unit tests reject raw/non-WebP/metadata-bearing/oversized derivatives.
- Unit tests prove `OFF` is the default and incomplete evidence cannot open the Gate.
- Unit tests pin all numeric TTLs and the existing retention precedence.
- Unit tests ensure provider failures produce only bounded operational metadata.
- WHICH-99/101 must call this Gate before adding any provider adapter or worker call.

## Official sources

- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI Moderation API](https://developers.openai.com/api/reference/resources/moderations)
- [OpenAI business data privacy, security, and DPA](https://openai.com/business-data/)
- [Google Cloud Vision SafeSearch](https://docs.cloud.google.com/vision/docs/detecting-safe-search)
- [Google Cloud Data Processing Addendum](https://cloud.google.com/terms/data-processing-addendum)
- [Google Cloud service-specific terms](https://cloud.google.com/terms/service-terms)
- [Google Cloud subprocessors](https://cloud.google.com/terms/subprocessors)
- [Korean PIPC generative-AI privacy guidance](https://m.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=11439)
