# WHICH Cloud Run edge and cutover

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
| HTTPS proxy           | `which-web-https`                                                                  |
| HTTPS forwarding rule | `which-web-https-rule`, port 443                                                   |
| SSL policy            | `which-modern-tls`, MODERN, minimum TLS 1.2                                        |
| Managed certificates  | `which-site-cert`, verification retry `which-site-cert-retry`; apex and `www` only |
| Certificate map       | `which-site-map`, entries `which-apex` and `which-www`                             |
| DNS authorizations    | `which-apex-auth`, `which-www-auth`, PER_PROJECT_RECORD                            |

Resource names are the intended cutover inventory, not evidence that every resource is ready. Check the verification record before changing traffic.

Cloudflare stays proxied with Full (strict) encryption. Its existing HTTP-to-HTTPS redirect is retained; no additional HTTP forwarding rule is required. No Cloud CDN or Cloud Armor policy is enabled implicitly. Cloud Run ingress is restricted to `internal-and-cloud-load-balancing`; only after that restriction is verified may its service receive public invoker permission for the public load balancer. The app still validates Cloudflare Access JWTs and member operator authorization for ops routes. The load-balancer origin is internet-reachable, but must not bypass those application checks.

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

### Resume after Google provisioning

First run the one-shot snapshot below. Require the latest backend operation `DONE` **without error**, a certificate `ACTIVE`, and both certificate map entries referencing that active certificate. Inventory each resource before creating anything; the commands below are only for resources still absent. Always stop on any failed command. If the backend retry fails with another Google internal error, preserve production on Render and use the operation IDs/error reference for Google troubleshooting; do not repeatedly recreate it, switch billing, or expand IAM/firewalls.

```powershell
./scripts/cloud-run/inspect-edge.ps1
gcloud compute operations describe operation-1788112650932-65a476b6090ac-47fc1fe2-b868f596 --global --project=which-505908
gcloud certificate-manager certificates describe which-site-cert --project=which-505908 --format='json(managed)'
gcloud certificate-manager certificates describe which-site-cert-retry --project=which-505908 --format='json(managed)'
gcloud certificate-manager maps entries list --map=which-site-map --project=which-505908
gcloud compute backend-services describe which-web-backend --global --project=which-505908
# Only if its backend list is still empty:
gcloud compute backend-services add-backend which-web-backend --global --network-endpoint-group=which-web-neg --network-endpoint-group-region=asia-southeast1 --project=which-505908
# Only if absent and certificate/map entries are ACTIVE:
gcloud compute url-maps create which-web-map --default-service=which-web-backend --global --project=which-505908
gcloud compute target-https-proxies create which-web-https --certificate-map=which-site-map --url-map=which-web-map --ssl-policy=which-modern-tls --global --project=which-505908
gcloud compute forwarding-rules create which-web-https-rule --load-balancing-scheme=EXTERNAL_MANAGED --network-tier=PREMIUM --address=which-edge-ip --target-https-proxy=which-web-https --global --ports=443 --project=which-505908
```

Verify Cloud Run ingress is still restricted before granting `roles/run.invoker` to `allUsers` **on this service only** for public LB access. Then follow the ordered cutover and rollback checks above. Do not change DNS before successful certificate/origin validation, and do not enable Cloud Run points before Render suspension has been verified.

## References

- [Global load balancer with serverless NEG](https://docs.cloud.google.com/load-balancing/docs/https/setup-global-ext-https-serverless)
- [Managed certificate with DNS authorization](https://docs.cloud.google.com/certificate-manager/docs/deploy-google-managed-dns-auth)
- [Cloud Run ingress restrictions](https://docs.cloud.google.com/run/docs/securing/ingress)
- [Certificate Manager troubleshooting and verification certificate](https://docs.cloud.google.com/certificate-manager/docs/troubleshooting)
