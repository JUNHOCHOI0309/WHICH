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

The production scanner defaults to `OFF` and reports `UNAVAILABLE`, preserving the existing private-review behavior. The opt-in local OCR/QR/barcode engine below implements the same adapter. Visual classification remains unsupported; no scan result from this phase grants approval.

## Local engine (WHICH-105, 2026-08-30)

`ISSUE_MEDIA_LOCAL_SCANNER_MODE=LOCAL` enables Tesseract.js 7 English/Korean OCR and ZXing WASM QR/barcode scanning. The default is `OFF`. `ISSUE_MEDIA_RULE_GATE_MODE=OFF` also skips this detector. These settings do not enable member upload capabilities, change provider privacy gates, or enable automatic publication.

- Scan the normalized WebP, not the original upload. Only a single-frame WebP at most 10 MiB, 1600px per edge and 2,560,000 pixels is accepted. Alpha is flattened onto white consistently for both engines; no additional downscaling occurs.
- English and Korean OCR run sequentially. Persist only candidate categories (`EMAIL`, `PHONE`, `NATIONAL_ID`, `ACCOUNT_LIKE`), never recognized text, matched values, QR payloads, URLs, pixels, or engine stderr. These are heuristic candidates, not verified identities or an exhaustive PII detector.
- QR/barcode payloads are neither followed nor sent to another service. Presence routes to review, not automatic rejection. A saturated 32-symbol result or an invalid decoded symbol is `PARTIAL`.
- OCR is `PARTIAL` when a language pass fails, output exceeds 16,000 characters, or non-empty text has confidence below 50. Both language passes must finish for `COMPLETE`; this status means scan completion, not a guarantee that no text or PII was missed.
- Face, identity-document, and screenshot visual classification remains `UNAVAILABLE`, even on a blank image. Thus a clean OCR/QR result still does not satisfy all release gates. OCR text is not added to OpenAI input in this phase.
- Canonical evidence includes `detectorVersion=which-local-tesseract7-zxing3-v1`, per-engine `scanStatus`, and a sanitized `scanFailureCode`. Failures (`DISABLED`, `BUSY`, `TIMEOUT`, `INPUT_LIMIT`, `INVALID_IMAGE`, `ENGINE_FAILURE`, `INVALID_OUTPUT`) cannot become a clean approval.

### Process and resource bounds

The API spawns one disposable Node process per scan, with **one concurrent scan per API process** and no waiting queue. Concurrent arrivals receive `BUSY` and remain private. The parent kills a timed-out child; the slot remains occupied until that process closes. `ISSUE_MEDIA_LOCAL_SCANNER_TIMEOUT_MS` accepts 1000–30000, default 15000. Oversized or malformed child output is discarded (8 KiB maximum). Failures are recorded rather than automatically retried in the upload request.

The child receives only basic path/system/temp environment variables, not database, R2, OpenAI credentials, or `NODE_OPTIONS`. This is process separation, **not an OS security sandbox**: filesystem/network access is not independently blocked. English/Korean trained data and the ZXing WASM binary are installed dependencies; runtime CDN downloads are not required. Engine dependency security updates still need maintenance.

`--max-old-space-size=192` limits only the JavaScript heap, **not total process RSS, native allocations, or WASM memory**. A small Render host also serving Next.js can still exhaust memory. Measure combined RSS, concurrent request latency, timeout/BUSY rate and host restarts before enabling. This phase does not verify production capacity or impose a host-wide memory quota. Multiple API replicas have separate one-scan limits.

### Deployment, smoke and rollback

1. Install the locked dependencies and build the API; `dist/local-media-scanner.js` is a build entry. No system Tesseract installation, new key, or external OCR service is needed.
2. Verify packaged assets without uploading an image or exposing credentials:

   ```sh
   node apps/api/dist/local-media-scanner.js diagnose
   ```

   Expect `localResourcesAvailable: true`, languages `eng`/`kor`, and `visualSupported: false`. This command checks resource availability, not scan accuracy or host capacity.

3. Keep production `ISSUE_MEDIA_LOCAL_SCANNER_MODE=OFF` until a permitted synthetic-image pilot verifies CPU/RSS and deadlines on the target host. Then an explicitly approved pilot may use `LOCAL`; do not change provider/automatic-publication flags as a side effect.
4. Verify a synthetic email/phone image, QR, barcode, blank image, and concurrent/timeout requests. Review private findings; no decoded raw content should appear in DB, responses or logs. Existing images are not backfilled automatically.
5. Roll back to `OFF` if resource pressure or false positives are unacceptable. Keep rule gate `ENFORCE` so exact known-block protection remains active. Prior findings are retained; do not delete evidence or approve images merely because scanning is off.

Automated coverage uses real rasterized text, QR and Code128 pixels, plus input/timeout/concurrency/credential/output isolation tests and a real-engine upload integration test. R2 is fake storage in that integration test; it is not a production upload verification.

Engine references: [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [ZXing WASM](https://github.com/Sec-ant/zxing-wasm).

## Operator evidence

Image Review and the Moderation Queue display the same canonical findings, including stage, code, severity, source version, detector version, local processing region, and safe evidence. Question and all choice context remain visible beside the image. Operator decisions continue to be retained as a separate override history.

## Phase boundary

Phase A does not call an AI moderation provider. Phase B may consume the normalized derivative in `SHADOW` mode only after privacy/retention evidence, canary limits, cost caps, and the provider kill switch are approved. Provider results append new findings and never overwrite Phase A evidence. The Phase B contract and activation sequence are documented in [`issue-media-provider-shadow.md`](./issue-media-provider-shadow.md).
