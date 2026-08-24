# WHICH-52 Limited Beta and Public v0 Go/No-Go

Status: operating runbook  
Beta plan: `which-52-limited-beta-v1`  
Safety rule: the evidence tool is read-only and never makes or publishes a final release decision.

## Beta contract

The first limited beta runs for at least seven full days with ten invited users. At least five
participants should leave structured feedback and at least ten privacy-safe qualified Analytics
Sessions must be available. These are evidence sufficiency minimums, not product-success targets.

The official population remains `traffic_class = PRODUCT`. Test Subjects, operator traffic, bots, and
unclassified legacy Sessions are excluded by the WHICH-50 measurement contract. Do not identify
participants inside Analytics or copy names, emails, Member IDs, OAuth Subjects, cookies, or tokens
into observation artifacts.

## Before inviting users

1. Confirm the current main CI and Render deploy are green.
2. Run the WHICH-51 Public and full Launch Gates and require `GO`.
3. Confirm at least 24 active eligible Issues and no Vote Aggregate mismatch.
4. Copy the observation template outside tracked source files:

```bash
cp apps/api/content/beta/which-52-operator-observation.example.json \
  artifacts/which-52-operator-observation.json
```

Set `observationStartedAt` when the invitation is actually sent. Keep the counts cumulative through
the observation window. Feedback themes must be paraphrased and de-identified.

## Daily evidence review

Run from Render Shell so the command reads the production PostgreSQL database:

```bash
node apps/api/dist/beta-operator.js review \
  artifacts/which-52-operator-observation.json \
  7 \
  artifacts/which-52-beta-review.json
```

For local development, use:

```bash
pnpm --filter @which/api beta:review -- \
  artifacts/which-52-operator-observation.json \
  7 \
  artifacts/which-52-beta-review.json
```

The report combines:

- Product Loop and Segment metrics from WHICH-50;
- Event↔Vote and Vote Aggregate reconciliation;
- active Issue Pool and category supply;
- Comment reports, current Moderation Queue age, and decisions;
- accepted, review, duplicate, abuse-rejected, and invalidated Vote signals;
- incomplete Vote attempts, Outbox Dead Letters, and new Member count;
- de-identified feedback, incident, and release-blocker records.

Each report contains a SHA-256 digest. Attach or copy the complete report to the WHICH-52 evidence
record; do not edit a report after it has been cited. Generate a new report after correcting input.

## Evidence statuses

- `COLLECTING`: observation duration, cohort, feedback, or qualified Session sample is still below the
  configured minimum.
- `BLOCKED`: an open SEV-1, unrecovered data incident, open release blocker, Vote mismatch, exhausted
  operating capacity, old Moderation Queue, measurement degradation, or Dead Letter exists.
- `READY_FOR_DECISION`: minimum evidence is present and no automated blocking condition exists. This
  is not an automatic `GO`.

The configured operating capacity is at least 24 active Issues, at most five open Moderation cases,
no case older than 24 hours, no Vote Aggregate mismatch, and no Outbox Dead Letter. Change these only
through a reviewed plan version; never edit a generated report to change the outcome.

## Daily human review

Record the following once per day in the WHICH-52 Notion task:

- UTC/KST observation window and immutable report digest;
- QVPS, First Vote, Result, Next Issue, and Second Vote counts/rates;
- Issue Pool size, zero-exposure supply, and top-Issue concentration;
- Moderation reports, queue size/age, and actions taken;
- integrity and reliability signals;
- feedback themes and observed exit points;
- incidents, recovery action, and remaining release blockers.

Usability requests that do not block the core Vote → Result → Next loop stay in Post-v0 Backlog.
Do not implement every beta suggestion during the observation period.

## Final Public v0 decision

When the report becomes `READY_FOR_DECISION`, create a separate Notion Decision containing:

1. immutable main commit, Render deploy, beta start/end, and report digest;
2. quantitative baseline plus its sample-size limits;
3. de-identified feedback and exit themes;
4. Pool, Moderation, Integrity, incident, and recovery evidence;
5. `GO`, `CONDITIONAL_GO`, or `NO_GO`, with owner and rationale;
6. release blockers for `CONDITIONAL_GO`/`NO_GO`;
7. Post-v0 priority order derived from the evidence.

A `GO` requires zero unresolved release blockers and SEV-1 data incidents. `CONDITIONAL_GO` cannot be
used to waive a privacy, source-of-truth, safety, deployment, or rollback blocker.
