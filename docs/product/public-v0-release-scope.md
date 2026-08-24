# Public v0 Release Scope

Status: Release Candidate preparation  
Last synchronized: 2026-08-24  
Source of truth: deployed behavior and repository code

## Purpose

This document separates three things that had started to blur together:

1. behavior already implemented in the repository;
2. work still required before a public v0 decision;
3. product expansion that must wait for evidence from real users.

The product hypothesis remains deliberately narrow: a person arriving at a question can vote without
signing up, understand the result, and willingly continue to another question. A feature belongs in
public v0 only when it enables that loop, keeps its data trustworthy, or makes the release operable.

## Current release position

The original implementation backlog through WHICH-47 is complete. The repository is no longer in
Platform Foundation or initial feature construction. It is in **Release Candidate preparation**.

"Implemented" in this document means a code path and automated verification exist. It does not by
itself mean the feature has passed production traffic, content-capacity, observability, or rollback
gates. Those remaining gates are tracked by WHICH-49 through WHICH-52.

## Implemented inventory

### Core Vote and result loop

- Public Web feed and direct Issue URL.
- Guest Subject issuance through an HttpOnly Web boundary.
- Versioned Issue and exactly two A/B Choices.
- Idempotent Vote submission, duplicate protection, immutable first accepted Choice, and server-owned
  aggregate/result snapshots.
- Result visibility after an accepted Vote and restoration of the previous selection.
- Next Issue navigation that excludes the current Issue and Issues already voted by the signed-in
  Member.
- Responsive Light Social Decision Feed with Cyan A and Orange B semantics.
- Share Card and deep-link result sharing behind the release configuration.

### Identity and private records

- Minimal email/password signup and login.
- Email verification, password reset, delivery throttling, and token-consumption protection.
- Google, X, Naver, and Kakao Web authentication.
- Explicit linking of multiple providers to one Member instead of email-based automatic merging.
- Guest-to-Member migration for Votes, Interests, and eligible reactions.
- Private Vote history, public/private creator profile settings, session revocation, and reliable
  logout handling.
- Account withdrawal with session revocation and personal-data anonymization while preserving the
  integrity of retained public records.

### Interest and feed personalization v0

- Guest and Member interest selection, reset, and Guest-to-Member merge.
- Deterministic `interest_content_v1` ranking using interest weights, bounded exploration, recency
  fallback, and persisted recommendation requests/items.
- Stable Cursor pagination and safe fallback when the profile or ranking path is unavailable.
- Signed-in Member feed exclusion for already-voted Issues.

### Comments, reactions, and moderation

- Comment read/write for an eligible Guest or Member after an accepted Vote.
- A/B side preservation from the accepted Vote; the Client cannot choose or forge a side.
- Latest and A/B filters, Cursor pagination, and representative A/B comment highlights.
- Rotating representative comments in completed Feed cards.
- Helpful reaction with identity-link migration and duplicate prevention.
- Author edit and soft delete; withdrawn authors are displayed as deleted users.
- Comment reporting, reporter limits, weighted automatic collapse at 10 points/five reporters and
  automatic hide at 20 points/ten reporters.
- Internal moderation queue and collapse, hide, policy removal, and restore decisions with audit
  evidence.

### Content, analytics, and release operations

- Versioned JSON Issue Pack validation and idempotent publication.
- PostgreSQL migrations, Development seed, Source/Issue/Vote/Comment/Identity/Interest/Analytics data
  contracts, and forward-only migration operation.
- Transactional Outbox, lease-based publisher, retry/backoff, Dead Letter, and requeue operation.
- First-party 30-minute Analytics Session, Viewable Impression, Vote Submit/Accepted, Result, Next,
  channel attribution, daily aggregation, and raw-event retention.
- Public smoke test, immutable Release ID, migration and Vote reconciliation checks, Public MVP Gate,
  and non-destructive Rollback Snapshot/Verify drill.
- CI coverage for formatting, lint, type checking, automated tests, and production builds.

### Client coverage

- **Public launch surface:** responsive Next.js Web, including mobile browsers and external deep
  links.
- **Parallel native lane:** Expo Android/iOS Guest Feed, Interest, Issue, Vote, Result, representative
  comments, Secure Storage Guest Subject, and public Mobile BFF.
- Native Member authentication, push, signed store binaries, and full Web parity are not public-v0
  dependencies.

## Public v0 In

Public v0 is the smallest operable release that contains:

- external or Home entry into a real Issue;
- Guest Vote -> Result -> Next -> second Vote without a signup wall;
- optional lightweight Member conversion after value is delivered;
- private history and linked login methods for returning Members;
- comments, helpful reactions, reporting, and author controls after a valid Vote;
- interest-based ranking v0 with a recency fallback;
- manual, reviewed Issue Pack supply with enough eligible inventory;
- first-party measurement of the core loop;
- production monitoring, moderation operation, launch gating, and rollback capability;
- political and election content disabled.

## Release Candidate work still required

The following work is not new product scope. It is evidence required to approve the implemented v0.

1. **Content-ready RC — WHICH-49**
   - Set Active Pool, category minimum, Days of Supply, daily publication, and Approved Reserve
     targets.
   - Expand and editorially review the launch Issue Packs.
   - Pass a pool-exhaustion dry run without filling gaps with unsafe or low-quality content.
2. **Measurement-ready RC — WHICH-50**
   - Establish the production baseline for Viewable -> Submit -> Accepted -> Result -> Next -> Second
     Vote.
   - Reconcile events with the Vote source of truth and exclude test/operator traffic.
   - Pre-register the first low-risk product experiment.
3. **Operational hardening — WHICH-51**
   - Run the full Gate, browser/device/auth matrix, deep-link/share flow, moderation smoke, backup
     freshness check, and rollback drill in the target environment.
4. **Limited beta and decision — WHICH-52**
   - Observe real users, pool capacity, moderation load, integrity signals, and failure recovery.
   - Record a public v0 Go/No-Go decision and only then reorder Post-v0 work.

## Public v0 Out

These items may be valuable, but they do not block validation of the core hypothesis:

- advanced learned ranking, Two-Tower, sequence models, real-time Bandit, or real-time feature store;
- native Member OAuth, push notifications, signed App Store/Play Store distribution, and complete Web
  parity;
- unrestricted Creator publishing, large-scale UGC automation, Following, notification expansion, or
  social graph features;
- threaded Reply expansion, DM, groups, quote posts, or real-time chat;
- new Search, Trending, Live, bookmark, or notification product surfaces;
- political/election voting, representative polling claims, monetization, B2B analytics, multi-region,
  or multilingual launch.

## Change classification rule

Use this order whenever a new request or defect appears:

1. **v0 release blocker:** breaks Guest Vote -> Result -> Next, corrupts source-of-truth data, weakens
   privacy/safety, or prevents deploy/rollback.
2. **Release Candidate work:** required to measure the hypothesis, supply enough reviewed Issues, or
   operate the release safely.
3. **Post-v0 backlog:** improves breadth or convenience but is not required to make the public v0
   decision.

## Approved post-v0 extension: Member Issue creation v1

WHICH-57 introduces a deliberately narrow Creator publishing path without changing the validated
Guest Vote core loop:

- only an active Member session can publish;
- each Issue contains one question, optional short context, and exactly two distinct A/B choices;
- only LOW-risk, non-political, link-free subjective topics are accepted;
- the server normalizes and validates all text, enforces idempotency, and limits each Member to three
  Issues per rolling 24 hours;
- Issue, Version, Choices, Interest mapping, Author, zero-result baseline, and Outbox event are created
  in one transaction;
- published Issues reuse the existing Feed, Detail, Vote, Result, Comment, and Creator Profile paths.
- Production exposure is controlled by `FEATURE_CREATOR_SUBMISSIONS_ENABLED` as an operational kill
  switch; Render enables it for WHICH-57.

Drafts, editing, deletion, human review queues, broad automated moderation, and AI-assisted rewriting
remain follow-up scope. This limited path must not be described as unrestricted open publishing.

A Post-v0 request does not interrupt the current milestone unless new evidence changes this release
contract.

## Public v0 decision gate

A public v0 Go decision requires all of the following, not only a green build:

- the Content-ready, Measurement-ready, and Operational Hardening tasks are complete;
- the limited beta has no unresolved release blocker or SEV-1 data incident;
- the Issue Pool and moderation queue remain within the agreed operating capacity;
- QVPS, Next Issue Rate, and the activation funnel are reproducible from trustworthy data;
- rollback preserves Vote and Outbox facts;
- known limitations and Post-v0 priorities are recorded from beta evidence.
