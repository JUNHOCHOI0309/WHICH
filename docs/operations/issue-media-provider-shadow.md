# Issue Media Provider Shadow

Status: WHICH-108 Phase B

Mode: Shadow only

Provider snapshot: `omni-moderation-2024-09-26`

## Boundary

The existing Moderation Outbox Worker resolves an immutable `ISSUE_MEDIA_ASSET` target, verifies
the normalized binary hash, reads the private R2 object, and re-encodes it as metadata-free WebP
within 1024px. This target sends **image-only** input. It must not look up arbitrary live Issue
context, because the asset hash does not bind that context. No public CDN
URL, member identity, session data, IP address, raw EXIF, or original upload is sent.

Member submission `ISSUE_VERSION` targets resolve their exact immutable submission revision and
send its minimized question/context, A/B labels, and both corresponding images in A/B order in one
mixed-input request. Direct contact data in submission context is redacted. The submission hash
binds text and asset identities; each asset's immutable version separately verifies the bytes.
Changing text, choices or the image pair creates a new revision and new check. Published editorial
Issue snapshot checks remain text-only; `inputScope` and `imageCount` make that scope explicit.

Input contract `which-provider-input-v2` namespaces reusable cache keys by contract, target type,
and input hash. Legacy unbound caches are ignored. Completion revalidates target state under row
locks and discards stale/lease-lost evidence. Uncached attempts, completions and failures have
separate audit events so discarding a result does not erase its usage accounting. This does not
replace the separate rollout requirement for atomic multi-worker budget reservation.

Submission-level combined findings remain attached to the versioned Run, not copied onto both
individual images as if the provider identified which image caused the result. The provider does
not supply that attribution. `inputBinding` identifies the contract, target type/version and hash;
no request text or image content is persisted in it.

OpenAI's Moderation endpoint accepts mixed text and `image_url` inputs, including base64 data URLs.
The pinned `omni-moderation-2024-09-26` snapshot returns category flags, category scores, and the
input types to which each category applies. It does not return bounding boxes, Issue relevance, or
A/B visual-fairness judgments, so WHICH records those capabilities as unsupported instead of
inferring a safe result.

## Canonical findings

A successful image Shadow Run appends immutable `issue_media_rule_findings` with stage
`PROVIDER_SHADOW`:

- one `MEDIA_AI_<CANONICAL_CODE>` finding per provider category;
- `REVIEW` severity only for provider-flagged or HIGH/CRITICAL score bands;
- `INFO` for all other category observations;
- one `MEDIA_AI_PROVIDER_CAPABILITIES` finding containing the supported/unsupported label matrix
  and bounding-box capability;
- explicit `MEDIA_AI_PROVIDER_ABSTAINED` and `MEDIA_AI_PROVIDER_DISAGREEMENT` review findings when
  those adapter states occur.

The evidence contains only versioned model/policy identifiers, score, calibrated band, applied
modality, provider capability, cache status, and empty/normalized regions. Provider response bodies
and image bytes are never stored in findings.

## Non-enforcement invariant

Provider findings never use `BLOCK` severity and the worker never updates Issue visibility,
publication, participation, media moderation state, or storage state. `publicationChanged` is fixed
to `false`. Findings are reviewer-assist evidence in Ops only; they do not create Member
notifications or automatic sanctions.

Phase A and Phase B can be rolled back independently:

- Phase A local rules: `ISSUE_MEDIA_RULE_GATE_MODE=OFF|SHADOW|ENFORCE`
- Phase B provider: `MODERATION_PROVIDER_MODE=OFF|SHADOW`
- emergency stop: `MODERATION_PROVIDER_KILL_SWITCH=true`

## Production activation

Keep all provider defaults OFF. After the privacy evidence gate is complete, start with a bounded
canary and an explicit daily cap:

```text
MODERATION_PROVIDER_MODE=SHADOW
MODERATION_PROVIDER=OPENAI_MODERATION
MODERATION_PROVIDER_KILL_SWITCH=false
MODERATION_PROVIDER_CANARY_PERCENT=1
MODERATION_PROVIDER_DAILY_CALL_CAP=<approved small cap>
OPENAI_MODERATION_MODEL=omni-moderation-2024-09-26
```

Run `node apps/api/dist/moderation-worker.js diagnose-provider` before processing. Increase the
canary only after reviewing provider call/failure/abstention rates, queue age, cache hit rate,
category distribution, Phase A/provider disagreement samples, and false-positive/false-negative
Golden Set results. Roll back by setting the kill switch to `true` or mode to `OFF`; queued content
and publication remain unchanged.

After this update, diagnostics include `inputContractVersion: "which-provider-input-v2"`.
Use that field to verify the worker build without submitting production content. Existing completed
Runs are not silently re-executed; new submissions/edits use the new contract. Rechecking historical
content requires a separate authorized, current-revision recheck under the normal provider gates.

## Verification

- adapter contract tests assert the exact mixed text/image request shape and model snapshot;
- mapper tests prove malformed or text-only outputs cannot create image findings;
- integration tests prove successful Shadow output is appended to the existing Ops finding stream;
- integration tests prove STAGED/PENDING media remains STAGED/PENDING even when the provider flags
  a critical image category;
- all findings keep unsupported reviewer-assist areas explicit and never claim bounding boxes.

References:

- [OpenAI Moderation guide](https://developers.openai.com/api/docs/guides/moderation)
- [OpenAI Create moderation API](https://developers.openai.com/api/reference/resources/moderations/methods/create)
- [`moderation-shadow-worker.md`](./moderation-shadow-worker.md)
- [`moderation-safety-provider-shadow.md`](./moderation-safety-provider-shadow.md)
- [`issue-media-rule-signal-gate.md`](./issue-media-rule-signal-gate.md)
