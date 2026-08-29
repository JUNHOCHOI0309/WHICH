# Issue media rule signal gate

WHICH-108 Phase A defines a provider-independent, fail-closed rule gate for Member-submitted Issue images. It runs after signature/decode validation and WebP normalization and before an asset can enter editorial review.

## Runtime mode

`ISSUE_MEDIA_RULE_GATE_MODE` accepts:

- `OFF`: do not invoke the local signal detector. Intended only for immediate rollback.
- `SHADOW`: record normalization, hash, local signal, and routing findings, but downgrade a private auto-reject result to review-required.
- `ENFORCE`: exact verified known-block hashes are rejected privately. Review signals and incomplete scans remain private and enter the operator queue.

The production default is `ENFORCE`, preserving the existing exact-block protection. This flag is independent from `MODERATION_PROVIDER_MODE`, so Phase A local rules and the later Phase B provider shadow pilot can be rolled back separately.

## Canonical findings

Every successfully staged Member image records immutable `issue_media_rule_findings` for:

1. source signature/decode verification;
2. metadata-free WebP normalization;
3. source SHA-256, normalized SHA-256, and dHash computation;
4. local QR/barcode, OCR-PII, and visual candidate signals;
5. the final private routing decision.

An exact known-block rejection records the same evidence against its upload session before the session becomes `REJECTED`. Known-block policy version and reason code are copied into evidence. Only exact verified SHA-256 matches may produce `AUTO_REJECT_PRIVATE`; dHash similarity always requires human review.

OCR text is transient. Findings persist only detected categories such as `EMAIL`, `PHONE`, `NATIONAL_ID`, or `ACCOUNT_LIKE`; raw OCR text must never be stored or shown in Ops.

## Fail-closed detector contract

The local detector adapter reports `COMPLETE`, `PARTIAL`, or `UNAVAILABLE` independently for QR, barcode, OCR, and visual scans. A partial or unavailable scan creates a review finding. Detector failure therefore never becomes an automatic approval.

The default adapter is deliberately `UNAVAILABLE`, which supports a limited manual-review pilot without an external AI provider. A concrete local OCR/QR/visual engine can later implement the same adapter without changing storage, routing, or Ops contracts.

## Operator evidence

Image Review and the Moderation Queue display the same canonical findings, including stage, code, severity, source version, detector version, local processing region, and safe evidence. Question and all choice context remain visible beside the image. Operator decisions continue to be retained as a separate override history.

## Phase boundary

Phase A does not call an AI moderation provider. Phase B may consume the normalized derivative in `SHADOW` mode only after privacy/retention evidence, canary limits, cost caps, and the provider kill switch are approved. Provider results must append new findings; they must not overwrite Phase A evidence.
