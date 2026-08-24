# Post-v0 Discovery, Recommendation, and AI Roadmap

Status: Post-v0 backlog  
Last updated: 2026-08-24  
Release boundary: this document does not expand the Public v0 launch gate.

## Purpose

This roadmap records the product work that should follow Public v0 without interrupting the current
content, measurement, operations, and limited-beta sequence. It covers three connected tracks:

1. a Trending Questions surface based on the approved home design direction;
2. a high-quality feed recommendation system with measurable quality and safety guardrails;
3. AI-assisted editorial and moderation workflows that remain source-grounded and human-reviewed.

The Public v0 boundary remains defined by
[`public-v0-release-scope.md`](./public-v0-release-scope.md). Tasks in this document may be reordered
after beta evidence is available.

## Product principles

- **Quality before raw engagement.** A close vote, controversy, or a high click count is not enough to
  qualify content for Trending or recommendation.
- **Eligibility is a hard gate.** Safety, lifecycle, duplicate, source, moderation, and prior-vote
  checks run before any ranking score.
- **Do not infer political identity from A/B choices.** Choice history is used for duplicate protection
  and explicit product flows, not sensitive-profile inference.
- **Diversity is part of quality.** Topic, source, recency, and creator concentration are controlled in
  the final slate rather than left to a single relevance score.
- **Every automated decision is observable.** Candidate source, score components, policy version,
  model version, and fallback reason must be traceable.
- **AI assists accountable people.** Generative output does not publish directly and moderation models
  do not make irreversible enforcement decisions on their own.

## Track A — Trending Questions on Home

The desktop home design includes a right-side Trending area; mobile receives a compact section that
fits the feed hierarchy. The first release is a separate discovery surface, not a replacement for the
personalized feed.

### Candidate contract

A question can enter Trending only when it:

- is published, currently eligible, and not already voted on by the viewer;
- passes duplicate, editorial-quality, safety, and active moderation gates;
- exceeds a minimum qualified-participant threshold;
- has enough recent activity to avoid promoting stale lifetime totals;
- is not receiving suspicious concentrated traffic or coordinated voting.

### Ranking and assembly

The baseline trend score combines:

- qualified participation velocity and acceleration over bounded time windows;
- freshness decay;
- completion and next-question continuation quality;
- low negative-feedback and report rates;
- editorial confidence.

Final assembly applies category diversity, source concentration limits, near-duplicate suppression,
and a stable editorial fallback. Raw vote count, controversy, or A/B closeness is never the sole
ranking signal.

### Delivery gates

- Define windows, thresholds, cold-start fallback, and anti-brigading rules.
- Add explainable trend-score logs and a staff-only preview.
- Verify empty, sparse, and abuse-heavy traffic scenarios.
- Launch behind a feature flag and compare qualified vote-per-session and next-question rate while
  guarding reports, skips, topic concentration, and latency.

## Track B — High-quality Feed Recommendation

The target architecture is a staged recommender rather than one opaque score:

```text
Eligibility
  -> Candidate retrieval
  -> Quality-aware ranking
  -> Policy and diversity re-ranking
  -> Exploration and deterministic fallback
  -> Feed slate
```

### Stage responsibilities

1. **Eligibility** removes prior votes, hidden or unsafe issues, lifecycle mismatches, duplicates, and
   blocked content.
2. **Retrieval** mixes explicit interests, fresh editorial content, high-quality discovery candidates,
   and a bounded exploration pool.
3. **Ranking** estimates useful engagement rather than clicks alone. Start with an interpretable
   Logistic Regression baseline, then evaluate LightGBM learning-to-rank when behavior volume is
   sufficient.
4. **Policy and diversity re-ranking** limits repeated topics, sources, creators, and semantic
   near-duplicates while preserving freshness and editorial priorities.
5. **Exploration and fallback** reserve a small measurable exploration share and guarantee a safe,
   deterministic slate when personalization data is sparse or services fail.

### Optimization and guardrails

Primary quality metrics:

- qualified votes per session;
- Feed -> Vote and Vote -> Next conversion;
- session depth without repeated or already-voted questions;
- returning qualified voters.

Guardrails:

- report, hide, skip, and rapid-abandonment rates;
- topic and source concentration;
- new-question exposure and exploration coverage;
- p95 ranking latency and fallback rate;
- Guest and Member quality parity.

### Rollout sequence

1. Freeze event and exposure contracts using Public v0 analytics.
2. Build an offline replay set and an interpretable scoring baseline.
3. Run the candidate system in shadow mode and compare slates without affecting users.
4. Use limited A/B or interleaving tests with explicit guardrails and rollback.
5. Promote only when repeatable quality gains exceed the current `interest_content_v1` baseline.

## Track C — Fine-tuned AI Editorial and Moderation

The recommended editorial pipeline is:

```text
Source retrieval and RAG
  -> fine-tuned WHICH editorial draft
  -> quality and risk classifier
  -> human approval
  -> versioned Issue Pack
```

### Suitable fine-tuned capabilities

- **Issue Editorial Copilot:** draft balanced Korean questions, subtitles, A/B choices, and source
  notes in the WHICH house style.
- **Issue Quality/Risk classifier:** multi-label checks for ambiguity, answer overlap, leading wording,
  timeliness, safety, and source requirements.
- **Korean comment moderation triage:** prioritize abuse, harassment, spam, and context-sensitive slang
  for human review.
- **Representative-comment re-ranker:** surface useful A/B reasons while controlling duplication,
  toxicity, and engagement gaming.
- Later candidates: creator submission coaching, follow-up-question generation, and reason clustering.

### Deliberate non-uses

- Current facts and citations remain retrieval problems, not model-memory problems.
- Feed ranking remains a ranking and experimentation problem, not a generative-LLM task.
- Near-duplicate detection starts with embeddings and deterministic thresholds.
- Inventory forecasting uses numeric rules or forecasting models.
- Hard policy enforcement remains rules plus human accountability.

### Data and release gates

- WHICH-49 supplies reviewed issue examples, rejection reasons, category coverage, and editorial labels.
- WHICH-50 supplies exposure and funnel baselines for ranking evaluation.
- WHICH-52 supplies real moderation outcomes and operational failure evidence.
- Create a versioned Golden Set before fine-tuning.
- Compare prompt-only baseline, fine-tuned model, and human reviewers with fixed rubrics.
- Run shadow mode, reviewer-assist mode, and limited automation in that order.
- Record model, prompt, dataset, rubric, decision, and rollback versions.

## Proposed backlog order

1. **Trending Questions Surface v1** — build the safe discovery surface and trend-signal baseline.
2. **High-quality Feed Recommendation Architecture v1** — introduce staged retrieval, ranking,
   diversity, logging, and controlled experiments.
3. **Fine-tuned Editorial and Moderation Pipeline v1** — begin after reviewed labels and behavior data
   are sufficient.

The final order is revisited only after Public v0 Go/No-Go and beta findings are recorded.

## Out of scope for this roadmap

- Replacing editorial approval with automatic publishing.
- Inferring sensitive attributes or ideology from vote choices.
- Optimizing solely for time-on-site, clicks, or controversy.
- Launching a black-box recommender without exposure logs, fallback, and rollback.
- Allowing popularity to bypass safety, duplicate, or integrity gates.
