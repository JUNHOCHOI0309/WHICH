# WHICH Cloud Run edge and cutover

> **Current state (2026-08-31): apex/www DNS switched to the regional load balancer and HTTP→HTTPS now passes.** Both records are proxied A records to `34.1.141.120`, TTL Auto. Public HTTP/HTTPS health/home/feed/static/OAuth-start checks pass and Cloud Run logs confirm signed-in requests. Full (strict), restricted ingress and application Access checks remain intact. A hostname-scoped active Cloudflare Redirect Rule returns 308 and preserves paths, query strings and HTTP method. **Render `which-web` is suspended (not deleted); Cloud Run revision `which-web-00003-gcb` has the points worker ON and moderation worker OFF.** The original global inventory and cutover sequence below are historical design context, **not executable regional instructions**.

## Boundaries

The owner approved the Google global external Application Load Balancer and production cutover on 2026-08-31 KST, after confirming that eligible load-balancer charges consume the same $300 trial credit. This does not authorize paid-account activation, enabling AI moderation, expanding image-upload cohorts, or deleting Render/DB/R2 data.

- Project: `which-505908`; Cloud Run region: `asia-southeast1`.
- Billing: `011AB8-5A70E9-6037F0`, verified Free Trial. Expiry observed as 2026-11-30; check remaining credit before later deployment.
- Origin capacity: 1 vCPU / 2 GiB, minimum 1 / maximum 1 instance, always-allocated CPU, concurrency 8. Deployments can temporarily overlap revisions; this is not a hard spending cap.
- PostgreSQL stays on Render and images stay on Cloudflare R2. OAuth/session configuration stays on `https://whichone.site`.

## Edge resources

| Resource              | Name / value                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| Global frontend IPv4  | `which-edge-ip`: `136.68.85.146`                                                   |
| Serverless NEG        | `which-web-neg`, Singapore, service `which-web`                                    |
| Global backend        | `which-web-backend`, `EXTERNAL_MANAGED`                                            |
| URL map               | `which-web-map`                                                                    |
| HTTPS proxy           | `which-web-map-target-proxy` (console-generated name)                              |
| HTTPS forwarding rule | `which-web-https-rule`, port 443                                                   |
| SSL policy            | `which-modern-tls`, MODERN, minimum TLS 1.2                                        |
| Managed certificates  | `which-site-cert`, verification retry `which-site-cert-retry`; apex and `www` only |
| Certificate map       | `which-site-map`, entries `which-apex` and `which-www`                             |
| DNS authorizations    | `which-apex-auth`, `which-www-auth`, PER_PROJECT_RECORD                            |

Resource names are the intended cutover inventory, not evidence that every resource is ready. Check the verification record before changing traffic.

Cloudflare stays proxied with Full (strict) encryption. The zone-wide Always Use HTTPS toggle remains OFF, but an explicitly owner-approved **hostname-scoped Redirect Rule** now redirects HTTP only for apex/www. This avoids changing other proxied hostnames and avoids a paid port-80 frontend. No Cloud CDN or Cloud Armor policy is enabled implicitly. Cloud Run ingress is restricted to `internal-and-cloud-load-balancing`; only after that restriction is verified may its service receive public invoker permission for the public load balancer. The app still validates Cloudflare Access JWTs and member operator authorization for ops routes. The load-balancer origin is internet-reachable, but must not bypass those application checks.

### Certificate renewal DNS

These **DNS-only CNAMEs** authorize Google certificate issuance/renewal without moving production traffic. Keep them after issuance and do not replace them with proxied records:

| Name under `whichone.site`             | Target                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `_acme-challenge_xbf3idjijqt5nbro`     | `d67d43ec-81ba-42e1-af84-c75a936a7559.13.authorize.certificatemanager.goog` |
| `_acme-challenge_xbf3idjijqt5nbro.www` | `8b3aae41-f943-4b2a-9b4f-12304dae71e5.5.authorize.certificatemanager.goog`  |

Do not use a wildcard certificate, change R2 records, change email records, or disable certificate verification for testing.

## Cutover sequence

1. Confirm managed certificate and both map entries are ACTIVE; verify the frontend, NEG/backend, SSL policy, and Cloud Run readiness.
2. Run `node scripts/cloud-run/smoke-edge.mjs --origin-ip 136.68.85.146`. TLS validates `whichone.site` normally; never use `--insecure`. Also test `www` certificate coverage and blocked direct `run.app` access.
3. Verify workers are still OFF on Cloud Run. The imported AI settings must remain OFF. Preserve the numbered Secret Manager version rather than printing/re-exporting secrets.
4. Change only the Cloudflare apex and `www` records to proxied A records targeting the frontend IPv4. Preserve all other DNS records and existing Cloudflare Access protections.
5. Run `node scripts/cloud-run/smoke-edge.mjs`, confirm requests reach the new revision, and check the existing signed-in `/me` session and navigation without posting/voting or changing profile data.
6. After public-route verification, suspend (do not delete) the Render **web service only** and verify suspension. Its current start script always launches the points consumer; setting `POINTS_WORKER_ENABLED=false` there does not stop it. Do not suspend the Render database.
7. Enable only Cloud Run's points consumer with `CLOUD_RUN_PREVIEW=false,POINTS_WORKER_ENABLED=true,MODERATION_WORKER_ENABLED=false`; verify the new revision and worker logs. Check for old-revision shutdown. Never enable points on both hosts at once.
8. Record public health, login-session continuity, ops access rejection, errors, revision IDs, and Render suspension. Fresh social-login callbacks and real posting/upload acceptance require explicit user interaction; do not claim those tests from a guest smoke.

## Rollback

Original DNS values: apex and `www` were **proxied CNAMEs to `which-web.onrender.com`, TTL Auto**. The preserved Render web service is `srv-da2vjmbncjis73d3g3kg`; its verified release is `af454bd1031453b9e0fca88bb88b1a2046f4ef1f`.

If Cloud Run workers were enabled, first turn them OFF and verify shutdown before resuming Render workers. Resume the preserved Render service, verify it is healthy, then restore only the two DNS records. Keep the DB's workstation rule and remove the dedicated Cloud Run `/32` only if actually decommissioning its network; do not release an IP while it remains allowlisted. Do not run schema migrations or regenerate credentials as a rollback shortcut.

## Budget notifications

Created and verified `WHICH monthly usage alerts - KRW 100000` on the trial billing account:

- Scope: only `which-505908`, all services, calendar month.
- Amount: KRW 100,000; actual-spend alerts at 50%, 90%, 100%.
- Promotional/other credits excluded from the budget calculation so trial credit does not hide usage. Existing CUD credit categories remain included; no CUD was purchased.
- Notify billing admins/users and project owners; no Pub/Sub automation or spending-limit enforcement.
- Budget ID: `75f50540-16bc-41aa-97fb-0ab987e4723d`.

This is an alert, **not a spending cap or a promise of uninterrupted service**. Reporting can lag. Trial exhaustion/expiry stops resources without a separately authorized paid upgrade. Render, R2, and external AI-provider bills are separate.

## Verification record

### Render suspension and points-worker handoff (2026-08-31, approximately 17:07 KST)

- With the owner's explicit approval, suspended only Render web service `which-web` (`srv-da2vjmbncjis73d3g3kg`). Render confirmed `which-web has been suspended`; the Render PostgreSQL database was not suspended, deleted, or reconfigured.
- Created Cloud Run revision `which-web-00003-gcb` from the existing production image and routed 100% traffic to it. The revision detail confirms `CLOUD_RUN_PREVIEW=false`, `POINTS_WORKER_ENABLED=true`, and `MODERATION_WORKER_ENABLED=false`; no AI moderation/provider/automatic-publication setting was enabled.
- Cloud Run marked the revision and service Ready after the `/api/health` startup probe. Visible logs show normal web/API startup, successful startup probe, revision readiness, and clean shutdown of the superseded instance; no worker-start failure was logged. The runtime supervisor therefore starts web, API, and the single points consumer from the verified `POINTS_WORKER_ENABLED` setting.
- Post-handoff `node scripts/cloud-run/smoke-edge.mjs` exited 0: health, home, feed and static assets returned 200; unauthenticated `/api/me` returned 401; ops returned the expected Cloudflare Access 302; all four OAuth-start routes returned the expected 307. This smoke did not submit a vote, post, image, or login form.
- Reloaded `/me/votes` in the existing signed-in `skyho0309` Chrome session after the handoff. The profile and 10 vote records loaded normally, without submitting any change. This confirms retained-session continuity, not a new social-login callback.
- No DB migration, R2 edit, DNS edit, credential change, billing-plan change, or AI moderation activation occurred in this handoff. Rollback order is strict: deploy Cloud Run with `POINTS_WORKER_ENABLED=false` and verify the old consumer has stopped, then resume the preserved Render web service; do not run both point consumers concurrently.

### Regional DNS cutover and partial public verification (2026-08-31, approximately 16:33-16:38 KST)

- The owner approved switching apex/www to the new load balancer while preserving Cloudflare protections and keeping Render running. Before the change, repeated the regional origin smoke successfully and confirmed revision `which-web-00002-mbk` receives 100% of service traffic, with `POINTS_WORKER_ENABLED=false` and `MODERATION_WORKER_ENABLED=false`. No worker or deployment setting was edited.
- In Cloudflare Chrome UI, replaced **only** the two proxied CNAMEs to `which-web.onrender.com` with proxied **A `34.1.141.120`**, TTL Auto, using each record's edit form and provider-target confirmation. Existing comments `render(plain)` / `render(www)` were preserved as metadata; they no longer describe the current target. The UI explains that type changes recreate the records. Both final rows were verified. Existing certificate-renewal CNAMEs, R2 and email records remain present and were not edited.
- Ran `node scripts/cloud-run/smoke-edge.mjs` without an origin override: exit 0. Public HTTPS health/home/feed and three static assets returned 200; `/api/me` without cookies returned 401; `/api/ops/members` returned Cloudflare Access redirect 302. Google/Kakao/Naver/X authorization-start routes returned the expected 307/provider/callback values; no full social login was completed.
- Fresh no-cache health requests to **both apex and www** returned 200 with `server: cloudflare`, `cf-cache-status: DYNAMIC`, and `via: 1.1 google`, confirming the Google path rather than just successful DNS configuration. TLS verification was not disabled. An earlier unbusted www health request returned 301; subsequent fresh requests returned 200.
- Opened `/me` in the existing Chrome session: `skyho0309` remained signed in and the profile loaded. Navigated to `/me/votes` and verified the account's 10 recorded choices without submitting any form, vote or profile change. Cloud Run's visible request logs include `/api/me?limit=3` 200 and signed-in `/me`/`/me/votes` requests around 16:34 KST. This verifies session continuity, not fresh OAuth completion.
- Cloudflare SSL/TLS overview confirms **Full (strict)**. However, two independent plain-HTTP probes to the apex returned **522**, including a cache-busting URL. The Edge Certificates page explicitly shows **Always Use HTTPS unchecked**. The prior runbook's claimed existing edge redirect was not verified correctly; the HTTPS-only regional LB cannot serve the attempted port-80 origin connection. Do not confuse Automatic HTTPS Rewrites (ON) with request redirection (OFF).
- **Pending permission:** enable an appropriate Cloudflare HTTP-to-HTTPS redirect. Zone-wide Always Use HTTPS also affects other proxied hostnames; a hostname-scoped rule is the narrower alternative. No redirect, HSTS, TLS minimum, SSL mode, security rule or additional paid forwarding rule was changed in this DNS-only turn. HTTPS remains on the new origin; HTTP is not yet healthy. The SSL settings tab is retained for explicit follow-up.
- Render web/DB, R2, secret versions and AI/worker settings remain untouched. Do not suspend Render or enable Cloud Run workers until HTTP and the remaining cutover checks pass. Rollback remains available by restoring the two original proxied CNAMEs; no service/data was deleted. No commit or push was performed.

### Hostname-scoped HTTP redirect verification (2026-08-31)

- The owner approved fixing the HTTP gate. Cloudflare's zone-wide Always Use HTTPS remains unchecked because it would affect every proxied hostname. There were no existing Redirect Rules.
- Created and activated one rule: **`WHICH apex-www HTTP to HTTPS`**. It matches only `http://whichone.site/*` and `http://www.whichone.site/*`, dynamically redirects to the same HTTPS hostname/path, preserves query strings, and returns **308 Permanent Redirect** to preserve request methods. No HSTS, TLS mode/minimum, Cloudflare Access, cache, DNS, origin, worker or billing setting changed.
- The first condition using `http.request.scheme` was rejected by Cloudflare as an unknown identifier; it was not deployed. Replaced it with the UI-accepted URI-full wildcard condition. The Redirect Rules list now shows **1 active** rule.
- Fresh checks for both apex and www: HTTP `/api/health` with an encoded value and repeated query keys returned 308 to the exact equivalent HTTPS URL; following it returned 200 through Cloudflare. HTTP POST probes also returned 308. This fixes the previous 522 without exposing a port-80 Google frontend.
- The HTTP redirect gate is complete. Render is intentionally still running, and Cloud Run points/moderation workers remain OFF. The next separate decision is Render web-service suspension followed by the single worker handoff; do not perform either merely because the redirect is healthy.

### Regional public invocation and origin verification (2026-08-31)

- After the owner reported certificate activation, Certificate Manager confirmed `which-site-cert-regional` and both regional DNS authorizations **ACTIVE**. The certificate is attached to `which-web-regional-target-proxy`, covers apex/www, and expires 2026-11-29. Normal TLS validation to the origin passed; before the access change the health request returned 403.
- The owner explicitly approved changing **only `which-web` invocation authentication**, preserving ingress and leaving DNS/Render unchanged. In Chrome, selected **Allow public access** and clicked Save once. The console reported service update and traffic routing complete; the saved Security tab shows public access selected. This is the console's invocation-authentication setting, not evidence that an `allUsers` IAM binding was added.
- The Networking tab still shows **Internal + Allow traffic from external Application Load Balancers**; All remains unselected. Latest revision remains `which-web-00002-mbk`, VPC/subnet and all-traffic egress unchanged, min/max instances 1.
- Ran `node scripts/cloud-run/smoke-edge.mjs --origin-ip 34.1.141.120` with real `whichone.site` SNI/Host and normal TLS verification: exit 0. Health/home/feed and three static assets returned 200; unauthenticated `/api/me` returned 401; `/api/ops/members` returned 403 both without Access credentials and with a deliberately invalid assertion. Google/Kakao/Naver/X start routes returned 307 with the expected provider host and `https://whichone.site/api/auth/{provider}/callback`.
- Additional probes: `www.whichone.site/api/health` at the regional IP returned 200 with successful TLS verification. Both default `run.app` hostnames returned 404 for `/api/health` from the public workstation. `/api/ops/dashboard?days=7` returned 403. The `/ops` HTML shell itself returns 200; local source shows it loads the protected dashboard API client-side and displays denial on 403. Do not misreport the HTML status as privileged access or claim a browser-rendered origin UI test.
- Cloudflare's existing apex/www targets remain `which-web.onrender.com`. No DNS edits, Render suspension, worker/AI activation, DB/R2 changes, new image deployment or billing change occurred. Smoke checks did not complete a social login, create a vote/post or change a member; anonymous feed/OAuth-start may create normal temporary guest/authorization state.
- **Next gate:** separately approve the production apex/www DNS cutover, then verify the actual Cloudflare path and signed-in session before any Render suspension or worker handoff. Keep both renewal CNAMEs. The completed origin smoke is not evidence that production traffic has migrated.

### Current: regional backend created and NEG connected (2026-08-31, Chrome continuation)

- The owner reported that changing region settings resolved creation and asked to continue in the open Chrome tab. The tab shows project `which-505908` and a successful Cloud Shell command: `gcloud compute backend-services create which-web-backend-regional --region=asia-southeast1 --load-balancing-scheme=EXTERNAL_MANAGED --protocol=HTTP --project=which-505908`.
- Before connection, the backend detail page confirmed **regional** external Application Load Balancer, `asia-southeast1`, HTTP, no health check, no attached backends, and not used by a load balancer. This was an actual completed create, not the temporary placeholder seen during the earlier global failures.
- Correction to the earlier diagnosis: Cloud Run and NEG geography did not change. All six failed requests used **global backend scope**; the regional API path succeeds. Global ALBs support Cloud Run in principle, so this result is a working scope alternative, not proof that global scope was categorically invalid or that Singapore was unsupported. The global failure's internal cause remains unconfirmed. The regional alternative should have been evaluated earlier.
- In the browser edit form, the agent selected **Serverless NEG** and existing `which-web-neg (asia-southeast1)`. The owner then explicitly approved saving this connection. Update was clicked once; the console subsequently reported **the backend service was updated**. The re-opened detail page shows **`which-web-neg`, SERVERLESS, `asia-southeast1`**, protocol **HTTPS**, no health check, no Cloud Armor policy, and not used by a load balancer yet. The UI reports health/balancing mode as not applicable; this is not an application health-test result. The protocol was supplied by the console's Serverless NEG editor. No Cloud Shell command was executed by the agent in this continuation.
- No public frontend, URL map/proxy, Cloud Run invoker permission, DNS, Render, DB, R2, worker, billing or support setting was changed by this connection. The backend attachment is complete; the complete HTTPS ingress and production cutover remain outstanding. The Chrome detail tab is retained as the verified result.
- A complete regional HTTPS setup additionally requires a proxy-only subnet, regional frontend IP, regional URL map/HTTPS proxy and regional TLS certificate. Existing global `which-edge-ip`, certificate map and global certificate cannot simply substitute for their regional counterparts. Reuse the existing VPC/Cloud Run/NEG where appropriate after verifying current resources. No extra firewall rule is needed solely for a serverless NEG backend.
- References: [regional Cloud Run load balancer setup](https://docs.cloud.google.com/load-balancing/docs/https/setting-up-reg-ext-https-serverless). Regional Certificate Manager certificates attach directly to the regional HTTPS proxy; certificate maps are unsupported.
- Keep production DNS, Render, DB allowlists, R2, Cloud Run invocation permissions and workers unchanged while preparing this alternative. Do not delete/release old global or egress IP resources without the separate cleanup safety checks and approval.

### Regional HTTPS creation (2026-08-31; owner-approved)

- The owner approved creating the regional IP, proxy-only subnet, certificate/TLS policy and HTTPS load balancer after being informed of usage charges. Production DNS cutover, Render suspension and Cloud Run invocation permission remain excluded.
- Reserved `which-edge-ip-regional` in `asia-southeast1`, Standard network tier: **`34.1.141.120`**. The console confirmed reservation and the completed load-balancer detail page shows this IP on port 443; do not confuse it with the old global IP or the in-use NAT egress IP.
- Verified `which-run-vpc` had only `which-run-subnet` (`10.88.0.0/26`, no secondary ranges) and no proxy-only subnet. Created `which-regional-proxy-subnet` (`10.88.2.0/23`); reopened VPC details confirm `ACTIVE`, regional managed proxy purpose, gateway `10.88.2.1`.
- Created the regional DNS authorizations and `which-site-cert-regional`. Certificate Manager lists the certificate in `asia-southeast1`, Google-managed, covering `whichone.site` and `www.whichone.site`, **pending DNS authorization**. Existing global certificates were preserved.
- Prepared regional policy `which-modern-tls-regional` with `MODERN`, minimum `TLS_1_2`, default post-quantum key exchange. The wizard's equivalent REST includes its creation as part of final submission; saving the nested policy form alone was not proof of API creation.
- Reviewed the wizard's equivalent REST: regional URL map `which-web-regional` defaults to existing `which-web-backend-regional`; regional target HTTPS proxy `which-web-regional-target-proxy` directly attaches the regional Certificate Manager certificate and regional TLS policy; Standard regional forwarding rule `which-web-https-regional` exposes TCP 443 only. The existing backend patch only disables CDN; no health check or balancing-mode mutation was present.
- Submitted the final creation once. A prior browser click timed out before submission; the wizard and notification list showed no creation operation, then a fresh click returned to the list with creation in progress. The console subsequently reported **load balancer created**, and reopening the detail page verified regional external ALB `which-web-regional`, Standard HTTPS `34.1.141.120:443`, regional certificate and TLS policy attached, and default routing to the existing backend/NEG. Serverless health and balancing mode are not applicable. No operation retry is needed.
- After separate explicit owner approval, added the two CNAMEs below to Cloudflare on 2026-08-31 KST, both **DNS only**, TTL Auto. The initial 10-record inventory had neither regional record; existing global renewal CNAMEs were preserved. After saving, verified both rows and exact target values, and confirmed both CNAME answers through public resolver `1.1.1.1` with `Resolve-DnsName`. Existing apex/www remain proxied CNAMEs to `which-web.onrender.com`; no traffic cutover or other DNS edits occurred.
- The subsequent regional certificate detail page still shows certificate and both DNS authorizations **pending**, with no failure reason. DNS publication alone is not evidence of completed certificate issuance; recheck Google before origin TLS testing/cutover. No certificate recreation or new authorization is needed merely while pending.

| DNS-only CNAME name                                  | Target                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `_acme-challenge_zkrjoldq3tyazigf.whichone.site`     | `7aaea64f-fb75-4bc0-93c9-8620fbe88509.0.asia-southeast1.authorize.certificatemanager.goog` |
| `_acme-challenge_zkrjoldq3tyazigf.www.whichone.site` | `0d38aebe-b88b-4f0b-8ff0-89f66a9216e1.4.asia-southeast1.authorize.certificatemanager.goog` |

Authorization resources are `which-apex-auth-regional` and `which-www-auth-regional` in `asia-southeast1`. Do not replace the existing apex/www Render records or old certificate-renewal records. Creating edge resources does not make the migration complete: certificate activation and origin access/functional validation are still gates.

### Certificate and origin preflight (2026-08-31, approximately 13:58 KST)

- Reopened the regional certificate detail: certificate and both authorizations remain **pending**, with no failure reason. Both generated CNAMEs resolve to the exact expected targets via Google Public DNS `8.8.8.8`, in addition to the prior `1.1.1.1` verification. No DNS replacement or certificate recreation was attempted.
- Cloud Run `which-web` is ready in `asia-southeast1`, revision `which-web-00002-mbk`, min/max instances 1. The Networking tab confirms **Internal + Allow traffic from external Application Load Balancers**, not All. Direct VPC egress remains `which-run-vpc` / `which-run-subnet`, all traffic routed through VPC.
- The Security tab still has **Require authentication / IAM** selected, with IAP off. No public-invoker binding, disabled IAM check or other access-policy change was performed. Google IAM authentication and ingress restrictions are independent controls: [Cloud Run ingress documentation](https://docs.cloud.google.com/run/docs/securing/ingress).
- A no-cookie/no-token HTTPS probe to `34.1.141.120` with SNI/Host `whichone.site` and normal certificate verification failed during TLS negotiation (`curl` exit 35, no HTTP response). A separate Node/OpenSSL TLS-only connection also returned handshake alert 40. This is consistent with the pending certificate but does not independently establish its root cause. No insecure TLS option was used, and no application-health success is claimed.
- Reviewed the existing read-only origin smoke script; deferred its full route/OAuth checks until TLS and the access gate are ready. Local source shows ops API proxy checks Cloudflare Access JWTs before forwarding, but deployed enforcement still requires origin smoke validation.
- Requested explicit approval to permit unauthenticated invocation of **this Cloud Run service only after certificate activation**, while preserving restricted ingress and WHICH application auth. No production DNS switch, Render suspension, worker flag, billing or runtime deployment change is authorized by this preflight. Browser security/network and certificate tabs were retained for continuation.

### Historical next-stage browser preparation (2026-08-31; not submitted at that stage)

- The owner asked to continue with regional HTTPS configuration. The existing Chrome tab is now in the **regional external Application Load Balancer** creation wizard, not the global wizard.
- Draft: load balancer `which-web-regional`, region `asia-southeast1`, existing VPC `which-run-vpc`; frontend `which-web-https-regional`, HTTPS port 443, Standard network tier. Project-wide network tier was not changed. Backend/routing selection and final review are still outstanding in this wizard.
- The selected network has no available proxy-only subnet in the wizard. The Standard-tier regional IP picker has no reusable address. The **new static IP reservation dialog** is open with name `which-edge-ip-regional`; **Reserve has not been clicked**. No IP was allocated by this stage.
- A separate Certificate Manager tab has an unsaved **regional Google-managed public certificate** draft `which-site-cert-regional`, `asia-southeast1`, default scope, DNS authorization, and two separate validated domain entries: `whichone.site` and `www.whichone.site`. Both domains require new regional DNS authorizations; those authorizations and the certificate have **not** been created. The console's comma-separated paste became one invalid chip; it was corrected to two individual entries before handoff.
- Existing certificates `which-site-cert` and `which-site-cert-retry` were both observed ACTIVE but **global**. They were not deleted or reused as regional certificates. Regional DNS authorizations must be in the same location as the certificate: [regional managed certificate guide](https://docs.cloud.google.com/certificate-manager/docs/deploy-google-managed-regional).
- An action-time confirmation was requested for regional IP, proxy-only subnet, certificate/TLS policy and HTTPS frontend creation, noting IP/load-balancer usage charges. No new cloud resource was submitted by this preparation. Both browser drafts are marked for handoff. Resume from them rather than creating duplicate drafts/resources.
- Before reserving the proxy subnet, verify existing VPC subnet ranges to avoid overlap. Preserve TLS 1.2 or stronger with an appropriate regional policy; the draft still shows the default policy and must not be finalized that way. Do not enable Cloud Armor/CDN/IAP or create an HTTP port-80 frontend implicitly.
- DNS traffic cutover, Render suspension and Cloud Run invocation-permission changes remain excluded. Creating DNS-validation CNAMEs will require inspecting the generated records and confirming that limited DNS change separately; never overwrite existing apex/www production records to validate a certificate.

### Historical: single owner-authorized managed retry failed (2026-08-31 11:33 KST)

- The owner requested exactly one more Google attempt after reviewing the five previous failures. This retry does not authorize a different project, paid billing/support activation, a DNS cutover, or changes to Render.
- Before submission, backend and running Compute operation inventories were empty; project billing was enabled.
- Submitted one managed, empty backend create at **11:12:28 KST**: `gcloud compute backend-services create which-web-backend --project=which-505908 --global --protocol=HTTP --load-balancing-scheme=EXTERNAL_MANAGED --quiet --format=json`.
- Operation: `operation-1788142348515-65a4e557db9b8-72f35531-acba7998`. Final state: **DONE with HTTP 503 / SERVICE UNAVAILABLE / INTERNAL_ERROR**, error reference `-7024040391563626471`. It ran from **11:12:28.893 to 11:33:43.150 KST**, approximately **21 minutes 14 seconds**. The CLI exited with code 1.
- After completion, backend and running Compute operation inventories were both empty. No backend deletion was needed. No dependent resource, invocation permission, production DNS, Render setting, or billing setting was changed. Further retries are stopped; the cause remains unconfirmed. Existing Cloud Run/NAT/reserved-IP resources were not stopped or deleted and can continue consuming trial credit.
- The audit request contains no `backends`, `healthChecks`, or `balancingMode`. The CLI supplies default `portName: http` and `timeoutSec: 30` for this **empty** backend; these are not a configured Serverless NEG endpoint port or a modified serverless timeout.
- An initial invocation with `--async` was rejected by the local CLI argument parser before submission. Removing that unsupported flag produced the one accepted create above; it was not a second API creation attempt.
- All five earlier attempts, including the classic comparison below, ultimately failed. The classic operation ended at **05:01:32 KST** with HTTP 503 / `INTERNAL_ERROR`, reference `3748256421093801381`. Its historical pending snapshot below must not be treated as current state.

### Historical snapshot: classic backend comparison (2026-08-31 04:51 KST)

Cutover is **not complete**. All four managed backend inserts below finished with HTTP 503 / `INTERNAL_ERROR`. Their temporary backend entries disappeared; no deletion was needed. The error is a Google resource-creation operation failure, not an HTTP response from the WHICH application. Its underlying cause is still unconfirmed.

| Attempt                                                    | Operation                                                 | Finished (KST) | Google error reference |
| ---------------------------------------------------------- | --------------------------------------------------------- | -------------- | ---------------------- |
| Empty managed backend, CLI                                 | `operation-1788110848110-65a46ffebb0b3-54e460e7-417c2d45` | 02:48:43       | `730389151359505014`   |
| Empty managed backend, CLI retry                           | `operation-1788112650932-65a476b6090ac-47fc1fe2-b868f596` | 03:18:48       | `-6810333619241256391` |
| NEG-attached managed backend, console LB workflow          | `operation-1788114646658-65a47e254ed2b-d82d771d-c7f3c7ba` | 03:52:20       | `-6229719532309145028` |
| Standalone managed backend `which-web-backend-v2`, console | `operation-1788117240404-65a487cee5ad8-09180b45-5d149183` | 04:35:20       | `-1476718102206605432` |

- The classic console wizard only retained the entered backend in its unsaved LB form; a separately refreshed backend inventory was empty. Do not submit that old draft after creating the same backend with the CLI.
- The owner then explicitly approved a **CLI classic-backend-only comparison**. Before submission, backend and running-operation inventories were empty; the existing `which-web-neg` was verified as SERVERLESS, pointing to `which-web` in `asia-southeast1`.
- Submitted exactly one minimal create at **04:50:54 KST**: `gcloud compute backend-services create which-web-backend-classic --load-balancing-scheme=EXTERNAL --global --project=which-505908 --quiet --format=json`.
- Operation **`operation-1788119454255-65a4900e30911-d00e8d17-3b422d26`** is **RUNNING, progress 0** at this snapshot. Its placeholder is `EXTERNAL`, protocol HTTP, CDN disabled, and has no NEG attached. **Existence is not completion.** Do not attach the NEG or create dependent resources before `DONE` without an error.
- This diagnostic does not by itself switch the intended production architecture to classic. No frontend, URL map, proxy, DNS, Cloud Run invocation permission, billing, IAM, Render, worker, or AI setting was changed by this comparison. There are no queued dependent CLI mutations.
- The local CLI wait was stopped after recording the pending operation; this does **not** cancel the Google operation. No scheduled monitoring or unattended follow-on changes were configured. A later continuation must read the operation before acting.
- `scripts/cloud-run/inspect-edge.ps1` still targets the original managed backend name. Use the explicit comparison-operation check below; do not treat the script's missing-managed-backend result as the comparison's outcome.

```powershell
gcloud compute operations describe operation-1788119454255-65a4900e30911-d00e8d17-3b422d26 --global --project=which-505908 --format='json(name,status,progress,startTime,endTime,error,httpErrorStatusCode)'
gcloud compute backend-services describe which-web-backend-classic --global --project=which-505908 --format='json(name,loadBalancingScheme,protocol,backends,enableCDN)'
```

If it fails, retain the new operation/error reference and stop duplicate creation attempts. If it succeeds, record that distinction before proceeding with an explicitly selected architecture and the existing cutover gates. No production readiness or root-cause conclusion follows from a pending operation.

### Historical snapshot: user-requested console continuation (2026-08-31 KST)

- The user opened the global external Application Load Balancer form and explicitly asked the agent to continue from that screen. The form is in project `which-505908`, signed in as the existing project owner. The user separately granted `roles/compute.networkViewer` to `cjh3141592@gmail.com`; no additional IAM grant was made by this continuation.
- The CLI retry `operation-1788112650932-65a476b6090ac-47fc1fe2-b868f596` finished with `INTERNAL_ERROR`, reference `-6810333619241256391`. Before using the console, the backend list and running operation list were both empty. Neither failed attempt left a backend requiring deletion.
- Completed the user's existing form using HTTPS/443, `which-edge-ip`, `which-site-map`, and `which-modern-tls`. Selected the existing `which-web-neg` in Singapore. Disabled the form's default Cloud CDN and new Cloud Armor policy options, preserving the approved architecture; no existing policy was removed. Left IAP and LB request logging disabled. No new VPC, NEG, IP, firewall, credential, or public Cloud Run invoker permission was added.
- Submitted the **console-created, NEG-attached** backend request (HTTPS, EXTERNAL_MANAGED), followed by the console's URL-map/proxy/forwarding-rule workflow. Current backend operation: `operation-1788114646658-65a47e254ed2b-d82d771d-c7f3c7ba`, still `RUNNING`, progress 0. This differs from the previous empty-backend CLI inserts; successful completion is **not** yet established. The placeholder includes the correct existing NEG, but that alone is not success.
- The console now shows `which-web-map` **creating**, not ready. Its intended proxy name is **`which-web-map-target-proxy`**, and the forwarding rule is `which-web-https-rule`. The browser may continue the dependent creation steps when the backend completes: **do not launch parallel CLI creates**. Inventory resources and console workflow status first. The claimed user tab is left open for handoff.
- **Certificate gate resolved:** `which-site-cert` is `ACTIVE`; both apex/www authorizations and both `which-site-map` entries are `ACTIVE`. Earlier CNAME/CAA errors resolved without DNS/CAA changes or relaxed validation. `which-site-cert-retry` is still pending and unused; remove it only after checking certificate-map references once deployment is settled. No further certificate retry is needed.
- Cloud Run remains revision `which-web-00002-mbk`, ingress `internal-and-cloud-load-balancing`, points/moderation overrides false, and no public invoker binding. Production DNS, Render web/points, DB firewall, and AI OFF controls remain unchanged. No origin TLS/route smoke or production cutover is claimed.

### Historical snapshot: 03:04 KST

Cutover is **not complete**. At the resumed preparation check on 2026-08-31 03:04 KST:

- The original backend insert `operation-1788110848110-65a46ffebb0b3-54e460e7-417c2d45` finished with **HTTP 503 / `INTERNAL_ERROR`**, Google reference `730389151359505014`, after approximately 21 minutes. The failed backend was absent and no URL maps or pending operations remained when inspected. No cleanup/delete was necessary.
- Exactly one backend retry was submitted: `operation-1788112650932-65a476b6090ac-47fc1fe2-b868f596`. It remains `RUNNING`, progress 0; the placeholder backend has no NEG attached. **Resource existence is not completion.** Do not retry again or attach dependent resources while this operation is pending. Billing is enabled on the approved trial account; Compute/Certificate Manager/Cloud Run APIs are enabled; relevant backend/forwarding/proxy quotas have headroom.
- The original `which-site-cert` is `PROVISIONING`: apex `AUTHORIZED`; `www` now reports `FAILED / CONFIG / CNAME_MISMATCH` for its initial 02:27 KST authorization attempt. Subsequent checks on Google DNS (`8.8.8.8`, `8.8.4.4`), `1.1.1.1`, and both authoritative nameservers resolve the exact expected DNS-only CNAME. No current record mismatch or CAA restriction was found; the initial check may have preceded DNS propagation.
- Created **one** verification certificate, `which-site-cert-retry`, using the same two domain names and existing DNS authorizations after verifying DNS. It is still `PROVISIONING / AUTHORIZING`. No production certificate, DNS authorization, or DNS record was removed. If the retry becomes ACTIVE first, update both existing certificate-map entries to it, verify readiness, and then remove the unused old pending certificate only after confirming there are no references. Do not accumulate additional retry certificates or weaken TLS.
- The original waiting CLI process had been stopped before queued attachment/URL-map commands ran. The retry command contained only backend creation, with no queued dependent mutations; its local wait was also stopped after recording the operation ID and pending state. Stopping a CLI wait does **not** cancel the Google operation or certificate issuance. No unattended DNS change, worker switch, or scheduled monitoring was configured.
- Created resources: global frontend IP, serverless NEG, pending backend, two DNS authorizations, pending certificate, certificate map and two pending map entries, MODERN/TLS1.2 SSL policy, and budget notifications. The URL map, HTTPS proxy, and forwarding rule have not been created. Public Cloud Run invoker access has not been granted.
- Cloud Run revision `which-web-00002-mbk` is ready with `CLOUD_RUN_PREVIEW=false,POINTS_WORKER_ENABLED=false,MODERATION_WORKER_ENABLED=false` and `internal-and-cloud-load-balancing` ingress. Logs confirm exactly two processes. Imported provider/judge/decision/automatic-publication settings remain OFF. Until the load balancer is ready, the earlier external local-proxy URL is intentionally not a working access path.
- Production apex/`www` remain proxied CNAMEs to Render. Render remains active, including its original points consumer. Its existing signed-in `/me` and Cloudflare Full (strict) encryption were confirmed. No member content was created or changed by these checks.
- Runtime tests 5/5 and whitespace checks passed again. Added a read-only one-shot `scripts/cloud-run/inspect-edge.ps1` snapshot; parser validation and execution passed, correctly identifying pending backend/certificate gates. It reads no runtime secret and changes no cloud state.
- A pre-cutover public baseline confirmed home/feed/static assets 200, unauthenticated `/api/me` 401, ops redirected to Access, and all four OAuth starts use the expected providers and callback host. `/api/health` returns **404 on the old Render release**, because this route was introduced by Cloud Run commit `6a85901`; that baseline is **not** a successful Cloud Run smoke. Keep the post-cutover 200 requirement. The origin script has not run against a completed load balancer, and post-cutover login continuity is not yet verified.

Retained Cloud Run/NAT/IP resources consume trial credit while waiting. No paid activation, production DNS change, Render suspension, or AI activation occurred. Remaining work requires Google provisioning to complete, not a second cost approval.

### Historical managed-workflow recovery examples — do not execute for the classic comparison

The following instructions predate the confirmed managed-operation failures and classic diagnostic above. They are **not the current resume command sequence**. In particular, do not mix the classic `EXTERNAL` backend with the `EXTERNAL_MANAGED` forwarding-rule example, or retry the failed managed backend automatically.

First run the one-shot snapshot below. The certificate gate is now satisfied; require the latest backend operation `DONE` **without error**. Check the open console workflow before any mutation: it may be creating the dependent resources. The commands below are recovery examples only, for resources still absent after that workflow has stopped. Always stop on a failed command. If this console attempt also fails with a Google internal error, preserve production on Render and use all operation IDs/error references for Google troubleshooting; do not repeatedly recreate it, switch billing, or expand IAM/firewalls.

```powershell
./scripts/cloud-run/inspect-edge.ps1
gcloud compute operations describe operation-1788114646658-65a47e254ed2b-d82d771d-c7f3c7ba --global --project=which-505908
gcloud certificate-manager certificates describe which-site-cert --project=which-505908 --format='json(managed)'
gcloud certificate-manager certificates describe which-site-cert-retry --project=which-505908 --format='json(managed)'
gcloud certificate-manager maps entries list --map=which-site-map --project=which-505908
gcloud compute backend-services describe which-web-backend --global --project=which-505908
# Only if its backend list is still empty:
gcloud compute backend-services add-backend which-web-backend --global --network-endpoint-group=which-web-neg --network-endpoint-group-region=asia-southeast1 --project=which-505908
# Only if absent and certificate/map entries are ACTIVE:
gcloud compute url-maps create which-web-map --default-service=which-web-backend --global --project=which-505908
gcloud compute target-https-proxies create which-web-map-target-proxy --certificate-map=which-site-map --url-map=which-web-map --ssl-policy=which-modern-tls --global --project=which-505908
gcloud compute forwarding-rules create which-web-https-rule --load-balancing-scheme=EXTERNAL_MANAGED --network-tier=PREMIUM --address=which-edge-ip --target-https-proxy=which-web-map-target-proxy --global --ports=443 --project=which-505908
```

Verify Cloud Run ingress is still restricted before granting `roles/run.invoker` to `allUsers` **on this service only** for public LB access. Then follow the ordered cutover and rollback checks above. Do not change DNS before successful certificate/origin validation, and do not enable Cloud Run points before Render suspension has been verified.

## References

- [Global load balancer with serverless NEG](https://docs.cloud.google.com/load-balancing/docs/https/setup-global-ext-https-serverless)
- [Managed certificate with DNS authorization](https://docs.cloud.google.com/certificate-manager/docs/deploy-google-managed-dns-auth)
- [Cloud Run ingress restrictions](https://docs.cloud.google.com/run/docs/securing/ingress)
- [Certificate Manager troubleshooting and verification certificate](https://docs.cloud.google.com/certificate-manager/docs/troubleshooting)
