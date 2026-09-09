# Korean context text moderation

WHICH applies a compact, local Korean text classifier to Member comments, replies, comment edits,
and Member-authored questions. The runtime sends no text to an external provider.

## Runtime policy

`TEXT_MODERATION_MODE` controls rollout:

- `OFF`: do not score text.
- `SHADOW`: score and attach aggregate model evidence to emitted events, but do not change content
  state.
- `ENFORCE` (default): enforce the actions below.

| Surface                                | `ALLOW`                                                   | `REVIEW`                                                                                         | `BLOCK`                                                      |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Comment, reply, edit                   | Publish normally                                          | Store as `PENDING_HUMAN_REVIEW`, `HIDDEN`, and `REVIEW`; add it to the existing moderation queue | Return `COMMENT_HARMFUL_CONTENT` before storing the new text |
| Question submission or direct creation | Continue through the existing submission/publication flow | Continue through the existing flow                                                               | Return `UNSAFE_ISSUE_CONTENT` before storing or publishing   |

The question path intentionally uses only the higher `BLOCK` threshold. The lower review threshold
has a higher false-positive rate and every editorial submission already has a human review step.

Before model scoring, runtime policy `korean-context-text-v2` applies the narrow
`korean-high-precision-rules-v1` ruleset to the authored target text. It blocks only explicit sexual
slur compounds, sexualized references to a person's anatomy, severe targeted abuse, and explicit
dehumanizing slurs. The rules do not inherit a match from parent/context text, and wording that
clearly reports, quotes, explains, or studies a prohibited expression falls back to the model. This
keeps ordinary verb forms such as `자지 않았어요` and `보지 못했어요` out of the rule lane.

## Model

The model is a deterministic logistic classifier over hashed Korean character 2–5 grams, word
unigrams/bigrams, and separately weighted context features. The target text has full weight; up to
600 characters of prior context has weight 0.35. Comments use the Issue question, Issue context,
and immediate parent Comment as context. Questions use the short description and A–D labels.

Version `korean-context-hash-logreg-2026-09-09` was trained on 763,153 examples. The held-out
conversation validation split contains 45,215 sentences.

| Threshold             |    Score | Precision |   Recall | False-positive rate |
| --------------------- | -------: | --------: | -------: | ------------------: |
| Human review / hidden | 0.942313 |  0.950122 | 0.062804 |            0.004031 |
| Block                 | 0.968765 |  0.970732 | 0.024004 |            0.000885 |

These thresholds favor precision. In particular, the review lane targets at least 95% precision
and at most a 1% false-positive rate because a review decision immediately hides user content.
Reports and human moderation remain necessary because both automated lanes intentionally catch
only a subset of all harmful text.

Rule decisions are emitted with `decision_source`, `rule_id`, and `rule_version` so moderation audit
events can distinguish deterministic policy matches from model scores.

## Provenance and retraining

The raw archives are read in place and are not copied into the repository or bundled into the API.
The generated artifact contains only quantized weights, aggregate validation metrics, and hashes:

- `147.텍스트 윤리검증 데이터.zip` — SHA-256
  `55a4f24f601839edac4d0f3645714f15e2c3c866a2eea5523294838c40550d2c`
- `유해표현 검출 AI모델 학습용 데이터.zip` — SHA-256
  `fc9fc4e058e6fdef871ec49c190f7116748bf2135d51060448cc9e554e4c1b21`

Before redistributing either source data or trained weights outside WHICH, confirm the source
license and redistribution terms. To reproduce the artifact locally:

```powershell
python scripts/text-moderation/train_korean_context_model.py `
  --context-archive 'C:\path\to\147.텍스트 윤리검증 데이터.zip' `
  --harmful-archive 'C:\path\to\유해표현 검출 AI모델 학습용 데이터.zip' `
  --output 'apps\api\src\modules\text-moderation\korean-context-model-v1.json'
```

After retraining, run the model unit test, Comment and Issue integration tests, API typecheck, and
API build before changing `TEXT_MODERATION_MODE` to `ENFORCE`.
