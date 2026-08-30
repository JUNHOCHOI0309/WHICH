# WHICH Cloud Run migration

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
./scripts/cloud-run/deploy-preview.ps1 -Image <image-at-sha256-digest> -ReleaseId <git-commit> -SecretVersion 1
```

`NEXT_STANDALONE=true` is used only by the Docker build; the existing Render build/start remains supported. Credentials are loaded only at runtime. `/api/health` checks the API and DB with a bounded timeout, does not cache, and returns no private details. Child failures terminate the instance; SIGTERM is forwarded and the supervisor enforces an 8-second shutdown deadline within Cloud Run's 10-second grace period.

Use the authenticated local proxy for verification, without making the service public:

```powershell
gcloud run services proxy which-web --project=which-505908 --region=asia-southeast1 --port=18081
```

Verify `/api/health`, the home page and public feed, static assets, expected unauthenticated `/api/me` behavior, and fail-closed `/api/ops` behavior. Do not create real votes, send emails, mutate user records, or publish pending images just to verify migration.

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

To be completed with the actual image digest, revision, test results, and preview status after deployment. No production cutover is implied by a successful preview.
