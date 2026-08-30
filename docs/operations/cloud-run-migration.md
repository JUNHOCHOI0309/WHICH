# WHICH Cloud Run migration

> **Current state (2026-08-31 KST): compute remains stopped; verified free-trial billing linked.** The Cloud Run preview, Public NAT, router, and reserved external IP have been removed. Production remains on Render. Earlier deployment commands and IP values below are historical/recreation instructions, not active resources. Billing linkage alone does not authorize restarting infrastructure or production cutover.

## Scope and safety boundary

- Project: `which-505908`; service: `which-web`; region: `asia-southeast1` (same region as the existing Render DB).
- One container runs Next.js and the loopback-only API directly with Node, without pnpm wrapper processes.
- Initial capacity: **1 vCPU, 2 GiB, CPU always allocated, minimum 1 / maximum 1 service instance, concurrency 8**. This incurs idle compute charges; it is not a zero-cost scale-to-zero configuration. Revision transitions can briefly overlap; the instance maximum is not a hard spending cap.
- Existing Render Postgres and Cloudflare R2 remain in place. No DB migration, database deletion, R2 copy, model change, or DNS cutover is part of preview deployment.
- Before cutover, the service requires Google IAM authentication. Cloudflare Access checks remain enabled in the application; do not turn them off to make `/ops` work on the preview URL.
- Preview is the default. Both point/moderation consumers, paid provider calls, the decision engine, and automatic publication are forced OFF. The existing Render site remains the production host.

## Credentials

The owner approved reusing existing production keys and importing the Render export into Secret Manager `which-runtime-env` on 2026-08-31.

The secret is a JSON string map mounted read-only at `/var/run/which/runtime.json`. The dedicated `which-web` service account has secret accessor permission **only on this secret**, not project-wide Owner/Editor. Never print the payload or add it to the repository, Docker context, image, environment YAML, or CLI arguments. Pin the secret version instead of `latest` for repeatable rollbacks.

The import helper reads a locally exported `.env`, replaces only the database hostname, sets `sslmode=verify-full`, strips platform-specific values, and pipes JSON directly into Secret Manager. It prints metadata only. The external DB connection must retain the Render certificate hostname, not a resolved IP. Do not relax the DB firewall or disable certificate verification to fix a failed connection.

```powershell
node scripts/cloud-run/import-environment.mjs <Render-export.env> which-505908 <Render-external-db-host>
```

After import verification, remove the task-created plaintext download. Render retains the source environment; the numbered Secret Manager version retains the imported configuration.

## Build and deploy

Docker Desktop must be running in Linux container mode. The runtime runs as non-root and includes Korean/English Tesseract data and ZXing WASM, so scans do not download language data at runtime.

```powershell
docker build --platform linux/amd64 --file infra/cloud-run/Dockerfile --tag which-cloud-run:pilot .
docker run --rm --entrypoint node --workdir /app/apps/api which-cloud-run:pilot dist/local-media-scanner.js diagnose
gcloud auth configure-docker asia-southeast1-docker.pkg.dev
docker tag which-cloud-run:pilot asia-southeast1-docker.pkg.dev/which-505908/which/web:<release>
docker push asia-southeast1-docker.pkg.dev/which-505908/which/web:<release>
./scripts/cloud-run/setup-network.ps1
# Add only the printed static IP /32 to Render's PostgreSQL inbound rules, retaining existing entries.
./scripts/cloud-run/deploy-preview.ps1 -Image <image-at-sha256-digest> -ReleaseId <git-commit> -SecretVersion 1
```

`NEXT_STANDALONE=true` is used only by the Docker build; the existing Render build/start remains supported. Credentials are loaded only at runtime. `/api/health` checks the API and DB with a bounded timeout, does not cache, and returns no private details. Child failures terminate the instance; SIGTERM is forwarded and the supervisor enforces an 8-second shutdown deadline within Cloud Run's 10-second grace period.

Use the authenticated local proxy for verification, without making the service public:

```powershell
gcloud run services proxy which-web --project=which-505908 --region=asia-southeast1 --port=18081
```

Verify `/api/health`, the home page and public feed, static assets, expected unauthenticated `/api/me` behavior, and fail-closed `/api/ops` behavior. Do not create real votes, send emails, mutate user records, or publish pending images just to verify migration.

### Restricted outbound DB connectivity

The deployment uses Direct VPC egress (`all-traffic`) through `which-run-vpc` / `which-run-subnet` (`10.88.0.0/26`, Private Google Access enabled). Router `which-run-router` and Public NAT `which-run-nat` use only the reserved external IPv4 `which-run-egress`; NAT covers only that subnet. No VM, connector, or inbound allow-all firewall rule is required. The setup script checks existing resources and stops on incompatible configuration instead of silently replacing it.

Render's PostgreSQL-specific allowlist must retain the owner's existing entry and add only this egress IP `/32`. Do not release or replace the reserved address while it is allowlisted. Direct VPC startup can take longer than ordinary startup; the HTTP startup probe allows 240 seconds and checks real DB readiness. The service remains IAM-private throughout preview.

## Cutover gate — separate approval

1. Confirm remaining trial credit and the projected post-credit monthly bill. Configure budget notifications and monitor compute, network, storage, and logs. No committed-use purchase.
2. Validate login callbacks/session secrets and routing through the production hostname; staging cannot fully prove OAuth callbacks tied to `whichone.site`.
3. Preserve Cloudflare Access for `/ops*` and `/api/ops/*`; plan TLS/custom-domain routing and verify the origin cannot bypass application access checks.
4. Coordinate stopping Render consumers before enabling Cloud Run consumers. Check DB connection headroom during overlap. The moderation advisory lock/idempotency guards remain required even with max instances 1.
5. Deliberately set `CLOUD_RUN_PREVIEW=false` and `POINTS_WORKER_ENABLED=true` at cutover. Moderation rollout is a separate explicit gate: existing consent, scoped member allowlist, caps, privacy evidence, kill switches, and paid-call limits must be retained; do not simply enable all flags.
6. Switch production traffic only after verification. Keep Render available for rollback until login, posting, votes, notifications, and background processing are verified.
7. On rollback, stop Cloud Run consumers before reverting traffic/consumers to Render. Never rerun schema migrations on every container start.

## References

- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract)
- [CPU allocation and billing](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
- [Render external Postgres connections](https://render.com/docs/postgresql-creating-connecting)

## Verification record

- Code commit: `6a85901e85d844b044e5921b52ebbc51611e81eb`; [PR #8](https://github.com/JUNHOCHOI0309/WHICH/pull/8).
- Uploaded image: `asia-southeast1-docker.pkg.dev/which-505908/which/web@sha256:c94c1172829fc8eacd333fa591d0fd0a58d2dcb32a9028c231aa905e70fa2666`.
- Secret Manager version `which-runtime-env:1`: 105 imported keys; verified TLS external DB URL; task-created plaintext export removed. Application/API keys never entered the image or Git.
- API 512 tests, web 303 tests, runtime 5 tests passed. Lint/typecheck/format passed (8 pre-existing web image lint warnings). GitHub CI for the code commit passed.
- Local Linux container under 1 CPU / 2 GiB: `/api/health`, home, and feed returned 200; `/api/me` returned 401. Feed smoke used the normal guest flow, which created a test anonymous subject; no member account, vote, submission, image, or email was modified.
- OCR/QR/barcode execution against a synthetic blank WebP completed locally; no provider request. This proves engine packaging, not real-image moderation quality or production capacity.
- Local web/API-only memory snapshot was about 152 MiB / 2 GiB with workers OFF. This is **not** comparable to a fully loaded production instance and is not a capacity guarantee.
- Cloud Run revision `which-web-00001-6vk` started both processes but failed DB readiness. A short-lived diagnostic Job reproduced `Connection terminated unexpectedly` in about 359ms after successful DNS resolution. No production traffic was switched.

### Initial activation hold: DB IP allowlist

On 2026-08-31, the Render DB's **PostgreSQL-level inbound IP rules allowed only the owner's workstation `/32`**, although the higher workspace/environment rules displayed `0.0.0.0/0`. All levels must permit the connection. This explains why the same image could connect from the workstation but not Cloud Run. Do not mistake the higher-level defaults for the effective DB allowlist.

Cloud Run uses dynamic outbound IPs by default. To preserve the existing restricted DB access, the owner approved **Direct VPC egress + Cloud Router/Public NAT + one reserved outbound IPv4** on 2026-08-31, followed by adding only that `/32` to the DB rules. This approval does not authorize a production cutover. Do not open the DB to `0.0.0.0/0` or disable TLS verification.

The extra network resources have recurring costs: the NAT external IP alone is $0.005/hour ($3.60 per 30 days), plus NAT gateway usage, data processing, and applicable data transfer. This is separate from Cloud Run compute and is not a quoted total. [Static outbound IP setup](https://docs.cloud.google.com/run/docs/configuring/static-outbound-ip), [NAT pricing](https://cloud.google.com/nat/pricing), [Render layered IP rules](https://render.com/docs/inbound-ip-rules).

While awaiting the network decision, the failed preview service and temporary DB-diagnostic Job were removed to stop failed-start retries. The container image, dedicated service account, secret version, and deployment scripts were retained for redeployment. No production traffic was switched during this hold.

### Private preview activated — 2026-08-31 KST

- Static outbound IPv4: `34.21.233.254`. Render PostgreSQL rules now contain exactly the existing workstation `/32` and `34.21.233.254/32` (`WHICH Cloud Run static egress`); saved state was verified after page reload. No PostgreSQL-level allow-all rule was added.
- Network/subnet/router/NAT creation succeeded; rerunning `setup-network.ps1` passed without creating duplicates. NAT uses one manually reserved IP and only the expected subnet's primary range. No explicit inbound firewall rules were added to this VPC.
- Ready revision: `which-web-00001-vzg`, using the image digest and secret version above. Readiness, configuration, and routes all report `True`. Direct VPC `all-traffic`, 1 vCPU / 2 GiB, and the dedicated service account were verified on the deployed service.
- Preview URL: `https://which-web-416579096500.asia-southeast1.run.app`. IAM policy has no public invoker binding. An unauthenticated `/api/health` request returns **403**.
- Authenticated smoke: `/api/health` **200**, `/` **200**, `/api/issues/feed` **200**, `/api/me` **401**, `/api/ops/members` **403**. The ops check uses an actual route, not a nonexistent session endpoint.
- The authenticated local proxy renders the homepage and six feed cards successfully; CSS and client-side loading were visually checked. Normal anonymous feed requests create guest/session records; no member account, vote, submission, image, or email was modified for this check.
- This revision logs `Started 2 processes; preview=true`. Only web/API are running: point/moderation consumers, paid provider calls, decisions, and automatic publication remain disabled in preview. No error-level log entries were returned for this revision during smoke verification.
- Runtime tests: **5/5** passed again. Network script syntax, repeat execution, Markdown formatting, and diff whitespace checks passed.
- Render remains the production host. Production DNS, OAuth callbacks, Render consumers, R2 contents, and live moderation flags were not changed. Login/posting/upload/background-worker production acceptance remains a **cutover gate**, not a completed test.

The private preview remains running with minimum 1 and always-allocated CPU. Google compute and NAT/IP charges therefore continue while it is retained. **Private preview is ready; production migration is not yet complete.**

### Cutover preflight and cost decision — 2026-08-31 KST

The owner requested proceeding with production migration after the private-preview verification. Read-only preflight found:

- Cloudflare apex `whichone.site` and `www.whichone.site` both remain proxied CNAMEs to `which-web.onrender.com`, TTL Auto. Preserve these values for rollback. Media and email DNS records are out of scope.
- The imported configuration retains `AUTH_BASE_URL` and `WEB_ORIGIN` as `https://whichone.site`. Social credentials, session secret, and Cloudflare Access configuration are present; secret values were not printed. Actual signed-in callback acceptance is still pending.
- The imported moderation worker/provider/judge/decision/automatic-publication flags are OFF. Production migration must not silently enable them or expand the upload cohort. Render's existing start script always launches the points consumer: prepare a controlled shutdown before enabling Cloud Run's points consumer.
- Google Billing for the account linked to `which-505908` displays a paid account and **no issued credits**. Do not assume the earlier-discussed $300 trial is applied. Billing data can lag; an absence here is not an eligibility determination for any other account or promotion.
- Google currently marks direct Cloud Run domain mappings as Preview and not recommended for production. The recommended global external Application Load Balancer introduces an additional base charge of $0.025/hour, approximately **$18 per 30 days**, plus regional traffic processing and applicable data transfer. This is separate from the existing compute/NAT charges and is not the complete infrastructure bill. [Domain options](https://docs.cloud.google.com/run/docs/mapping-custom-domains), [Load balancing pricing](https://cloud.google.com/vpc/network-pricing#lb).

The owner was asked to confirm the additional load-balancer cost and alerted that trial credits are not shown. Pending that decision, no load balancer, certificate, new public access, DNS change, Render shutdown, or worker activation was performed. The already-approved private preview/NAT remain running and billable; stopping them would be a separate explicit action.

### Stopped at owner request — 2026-08-31 KST

- Deleted Cloud Run preview `which-web`; service and Job listings in Singapore are empty.
- Deleted Public NAT `which-run-nat` and its dedicated router `which-run-router`.
- Removed only `34.21.233.254/32` from Render PostgreSQL's inbound rules and verified the saved state after reload. The original workstation rule remains.
- Released reserved external address `which-run-egress` (`34.21.233.254`). **Do not reuse this IP or its old DB allowlist entry when resuming.** A future deployment needs a newly reserved address and explicit authorization.
- Dedicated subnet/VPC removal was deferred because Google still holds the managed internal allocation `10.88.0.16` (`serverless-ipv4-1788108245916965352`). No external address, NAT, router, VM, or running Cloud Run service remains. Do not force-delete managed internal allocations; Google documents waiting 1–2 hours after service deletion before subnet deletion. [Direct VPC IP lifecycle](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc#ip_address_allocation).
- Code, the container image, numbered Secret Manager configuration, and service account are retained for possible reuse. Compute/NAT/external-IP running charges are stopped; previously accrued usage and any retained storage/secret charges are not erased or claimed to be zero.
- `https://whichone.site/` returned HTTP 200 after shutdown. Render web/DB, production DNS, R2, member data, and production worker settings were not changed. No load balancer was created and no production cutover occurred.

If the migration is explicitly resumed, first re-check current billing/credits and configuration drift, then obtain/validate a static IP and DB allowlist before redeployment. Do not execute the old deploy command as though the preview still exists.

### Billing relinked to verified free trial — 2026-08-31 KST

- The owner approved linking the existing `which-505908` project to the new free-trial billing account. No replacement application project was created or selected for deployment.
- The new billing account is `011AB8-5A70E9-6037F0`. The signed-in billing console displayed **Free Trial**, **₩435,523** remaining credit, **90 days**, and expiry **2026-11-30** at verification time. These are observed values, not a guarantee that all future services or external-provider costs are covered. No paid-account activation was performed.
- After the console change, `gcloud billing projects describe which-505908` confirmed `billingAccountName=billingAccounts/011AB8-5A70E9-6037F0` and `billingEnabled=true`.
- The new billing administrator received only temporary, project-scoped `roles/billing.projectManager`, `roles/browser`, and `roles/serviceusage.serviceUsageViewer` bindings under the time-limited `which-trial-billing-transfer` condition. All three were removed after linkage; a filtered project IAM query returned no remaining bindings for that account. Existing project ownership was unchanged. No secret/data access roles were granted.
- The Cloud Run service listing in `asia-southeast1` remains empty. No service, NAT, router, reserved public IP, load balancer, worker, or DNS routing was restarted or changed by this billing operation. Render remains production.
- Charges accrued before the switch remain on the previous billing account (`01076E-0D88E4-64A129`); billing linkage does not refund past usage. Retained artifacts/secrets may still incur usage, and Render/R2/AI-provider charges are separate. [Project billing changes](https://docs.cloud.google.com/billing/docs/how-to/modify-project), [Free trial terms](https://docs.cloud.google.com/free/docs/free-cloud-features).

Infrastructure resumption and production cutover still require explicit authorization and the cutover checks above. Re-check the trial balance and validity before resuming; do not activate a paid billing account implicitly.
