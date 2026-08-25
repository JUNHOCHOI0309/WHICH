# Public v0 Release Verification

Status: WHICH-51 operating runbook  
Target: `https://whichone.site`  
Safety rule: production checks are read-only unless a dedicated test identity and Issue are declared.

## Evidence contract

A release is `GO` only when all three evidence layers agree:

1. **Automated release evidence** — CI, Render deployment, Public Surface Gate, full Launch Gate.
2. **Platform evidence** — backup freshness, deployment health, DNS/TLS, and blocking error review.
3. **User-flow evidence** — PC, mobile Web, and Android in-app checks, using prior operating QA only
   when the code path and environment have not changed.

Record the immutable commit, deployment ID, timestamps in KST, operator, device/browser, and artifact
paths. Never paste secrets, session cookies, password-reset tokens, or OAuth authorization codes.

## Automated release evidence

Run outside Render first:

```bash
pnpm check
pnpm --filter @which/api launch:public-smoke https://whichone.site \
  artifacts/which-51-public-surface.json
```

Then run the full Gate from Render Shell:

```bash
pnpm --filter @which/api launch:gate artifacts/which-51-public-mvp-gate.json
```

Both reports must be immutable and return `GO`. The Public Surface Gate verifies home, Feed,
canonical Issue deep link, next Issue exclusion, mobile BFF Feed, email credential and `/me` entry points,
privacy/terms, and Google/X/Naver/Kakao OAuth starts. The full Gate additionally verifies release
identity, migrations, API health, Outbox, and Vote reconciliation.

The HTTP Probe supplies a fixed Probe-only Guest Cookie so the Web BFF does not create a Guest Subject
during Feed inspection. The identifier is never used for Vote, Comment, Reaction, Report, or login.

## Platform checklist

- [ ] Render deploy is `Live` for the same immutable commit returned by `/v1/meta`.
- [ ] Render service metrics show no sustained CPU, memory, restart, or latency anomaly.
- [ ] Render logs contain no blocking `5xx`, authentication loop, database, or migration error for
      the observation window.
- [ ] PostgreSQL backup is enabled and the latest successful backup/restore point is fresh enough for
      the current recovery objective.
- [ ] `whichone.site` and its canonical redirect resolve to the intended service.
- [ ] HTTPS is valid, has no browser certificate warning, and the certificate expiry is acceptable.
- [ ] External OAuth console callback URLs match the canonical production URL.
- [ ] Deferred Outbox status is explicitly acknowledged until a real consumer is introduced.

## Operator dashboard checklist

- [ ] `/ops` rejects a logged-out browser without returning an operational payload.
- [ ] An ordinary Member receives `OPERATOR_ROLE_REQUIRED`, and the denied read is present in
      `operator_audit_logs`.
- [ ] The designated operator has an active grant shown by `node apps/api/dist/ops-operator.js list`.
- [ ] Cloudflare Access protects `/ops*` and `/api/ops/*`; a request without a valid application JWT
      is blocked before the dashboard BFF forwards it.
- [ ] Release ID and migration count match the deployed release and Render pre-deploy migration.
- [ ] The 1/7/30-day Funnel reports its aggregate refresh time and Vote reconciliation is
      `CONSISTENT`.
- [ ] No email, OAuth subject, Member session, secret, raw event, IP address, or SQL appears in the
      browser response.
- [ ] The latest provider backup has been checked and recorded with
      `ops-operator.js confirm-backup`.
- [ ] PC and mobile Web can read the dashboard without horizontal overflow; five-minute refresh does
      not create a sustained database latency anomaly.

## User-flow matrix

Use one dedicated low-risk Issue. Record `PASS`, `FAIL`, or `PRIOR EVIDENCE` with a short note.

| Flow                                | PC Web | Mobile Web | Android in-app | Evidence rule                                |
| ----------------------------------- | ------ | ---------- | -------------- | -------------------------------------------- |
| Guest Feed → Vote → Result          |        |            |                | Result and selected side remain correct      |
| Result → next Issue                 |        |            |                | A different eligible Issue opens             |
| Result share → deep link            |        |            |                | Exact Issue opens before voting              |
| Comment create/read                 |        |            |                | Comment appears on the selected side         |
| Helpful reaction toggle             |        |            |                | Duplicate identity reaction is prevented     |
| Report submission                   |        |            |                | Success is shown once; no duplicate mutation |
| Email signup → verification → login |        |            |                | Mail uses the production callback origin     |
| Email password reset                |        |            |                | Token is single-use and new login succeeds   |
| Google login/logout                 |        |            |                | `/me` returns to Guest after logout          |
| X login/logout                      |        |            |                | `/me` returns to Guest after logout          |
| Naver login/logout                  |        |            |                | `/me` returns to Guest after logout          |
| Kakao login/logout                  |        |            |                | `/me` returns to Guest after logout          |
| Connected account continuity        |        |            |                | Providers resolve to one canonical Member    |

Do not repeat production mutations solely to make a checklist look current when the same deployed
code path already has dated operating QA. Instead, cite the task and commit that produced the prior
evidence, then perform a read-only regression check.

## Existing operating evidence accepted for WHICH-51

- WHICH-31: Android logout → home → `/me` returns to the four-provider Guest screen.
- WHICH-32: Naver exposure and Kakao callback create an active Member Session in production.
- WHICH-34/35: connected providers and legacy duplicate Members preserve one canonical history.
- WHICH-38: production email verification, password recovery, legal URLs, PC and mobile QA.
- WHICH-42: account deletion anonymizes the Member while preserving required content.
- WHICH-43: login → Comment create/read/edit/delete and deleted-list exclusion.
- WHICH-44: Guest-to-Member activity link and duplicate reaction prevention.
- WHICH-49: production has a non-empty, sufficiently broad Issue supply.
- WHICH-50: Analytics, Vote reconciliation, and supply baselines are measurement-ready.

These references remain valid only if the relevant route, session, schema, or platform configuration
has not changed since their recorded deployment.

## Rollback drill

### Target selection

Choose the immediately previous known-good immutable release. Confirm its application code is
forward-compatible with every migration currently applied. An additive migration may remain in the
database; no down migration is allowed.

### Before rollback

```bash
pnpm --filter @which/api launch:rollback-snapshot \
  artifacts/which-51-rollback-before.json \
  <previous-known-good-release-id>
```

- [ ] Snapshot source release matches `/v1/meta`.
- [ ] Target differs from source and is a known-good built artifact.
- [ ] Vote and Outbox counts/digests are present.
- [ ] Maintenance/observation window and forward-restoration target are recorded.
- [ ] The operator has explicit approval before changing the public release.

### During and after rollback

1. Deploy the declared prior application release without changing PostgreSQL schema.
2. Run rollback verification and require `VERIFIED`.
3. Run the Public Surface Gate and the blocking read-only user-flow checks.
4. Redeploy the source/current release as the forward restoration.
5. Re-run the full Launch Gate and require `GO`.
6. Compare Vote and Outbox protected facts with the pre-rollback snapshot.

```bash
pnpm --filter @which/api launch:rollback-verify \
  artifacts/which-51-rollback-before.json \
  artifacts/which-51-rollback-after.json
```

If verification fails, keep every artifact, do not rewrite facts, and restore the source release or a
forward fix. Mark WHICH-51 `NO_GO` until the failed condition is understood.

## v1 boundaries to record, not hide

- There is no dedicated staging environment in the current single-service topology.
- Production write-path E2E requires a dedicated test identity/Issue to avoid polluting public data.
- Render backup restore is platform-operated and is not automated by this repository.
- Outbox delivery remains `DEFERRED` until a real external consumer is enabled.
- The full Gate reconciles one configured Issue Version; aggregate-wide reconciliation is a separate
  operator command.
