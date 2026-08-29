# Korean Text and Image Moderation Golden Set

Status: WHICH-100 foundation
Dataset: `which-ko-moderation-golden`
Bundled fixture: `which-100-smoke-v1`

## Purpose and boundary

The Golden Set is the fixed, versioned evidence used to compare moderation Rule, Prompt, Model, and
Policy changes before any automation promotion. It is separate from the 30-item production smoke
pilot and from live Member content.

The repository fixture contains synthetic summaries and private `golden://` references only. It does
not contain source images, public URLs, direct identifiers, unredacted abuse, or Member content.
Real evaluation media must remain in approved private storage and be referenced by an immutable
private object key.

Rights ownership and defamation veracity are not model truth labels. Such cases contain only a
`RIGHTS_OWNERSHIP` or `DEFAMATION_VERACITY` human-workflow outcome and are excluded from model
Precision/Recall calculations.

## Required slices

The validator fails coverage when any required slice is absent.

- Text: normal disagreement, friendly profanity, hate, threat, PII, Spam, satire, quotation, and
  Korean initials/spacing obfuscation.
- Image: food, landscape, illustration, anime, skin-exposure false positive, PII, QR, document,
  screenshot, violence, sexual risk, news/politics, and low light.
- Multimodal: question relevance, misleading context, A/B information volume, crop, and salience
  asymmetry.

Slices should be extended rather than renamed. Dataset version must change whenever cases, labels,
or slice membership changes.

## Two-person labeling and adjudication

1. Two different reviewers independently label each release-gate case.
2. Reviewers do not see model output or the other review before submission.
3. Exact agreement resolves the case.
4. Disagreement requires a third reviewer adjudication and rationale in the source review system.
5. A case without agreement or adjudication is invalid and cannot enter a report.
6. Reviewer identity in exported datasets must be a stable pseudonym, never an email address.

The bundled fixture demonstrates the contract. It is not evidence that a 300/500 production sample
has completed human review.

## Commands

```bash
# Validate the bundled 30-case synthetic coverage fixture
pnpm --filter @which/api moderation:evaluate:validate

# Print the fixture as portable JSON
pnpm --filter @which/api moderation:evaluate:seed -- --output ./golden-set.json

# Run a zero-cost perfect-fixture smoke report
pnpm --filter @which/api moderation:evaluate:smoke -- --output ./smoke-report.json

# Evaluate real exported predictions and optionally compare a baseline run
pnpm --filter @which/api moderation:evaluate:report -- \
  ./golden-set.json ./candidate-run.json \
  --baseline ./baseline-run.json \
  --output ./evaluation-report.json
```

Production build equivalent:

```bash
node apps/api/dist/moderation-evaluator.js report <dataset.json> <run.json>
```

The harness rejects unknown/duplicate Case IDs and mismatched Dataset or Policy versions. Missing
predictions are reported as coverage gaps and abstentions rather than silently removed.

## Report contract

Each report includes:

- Action-level TP, FP, FN, Precision, Recall, 95% Wilson intervals, and critical false negatives;
- global accuracy, abstain rate, latency, cost, and reviewer override rate;
- per-slice accuracy, abstentions, critical misses, and Action metrics;
- the worst-performing slice;
- human-only case IDs excluded from model scoring;
- Model, Prompt, Policy, and Dataset versions;
- candidate-versus-baseline accuracy, abstention, critical miss, override, prediction, and Action
  distribution drift.

Confidence intervals are evidence bounds, not pass/fail thresholds. WHICH-103 owns the final
promotion gate values.

## Separate release evidence

The report never combines these two cohorts:

| Cohort                    | Required sample | Evidence                                                          |
| ------------------------- | --------------: | ----------------------------------------------------------------- |
| `ZERO_CRITICAL_REFERENCE` |             300 | Complete fixed reference sample and zero critical false negatives |
| `PROVISIONAL_AUDIT`       |             500 | First 500 provisionally published assets audited independently    |

An incomplete cohort reports `complete: false`. `zeroCriticalMiss` is true only after the full
sample floor is reached with no critical miss. The 500-audit result is reported separately and does
not retroactively relabel the fixed 300-case set.

## Version and drift policy

- Model, Prompt, Policy, and Dataset versions are mandatory on every Run.
- Compare only shared Case IDs for prediction-change rate.
- Dataset/Policy changes are explicit report dimensions, not hidden baseline replacements.
- Preserve prior reports immutably so regression and drift remain reproducible.
- Never promote solely because aggregate accuracy improved; inspect critical FN, abstention,
  reviewer override, and worst slice first.

## Next dependency

WHICH-101 may connect a provider only after this harness can ingest its Shadow output. External
provider calls remain disabled and cost-free in WHICH-100.
