# WHICH Cloud Run CI/CD

## Target behavior

Only a protected `main`-branch push triggers production delivery:

```text
GitHub main push
  -> GitHub Actions full verification
  -> Cloud Build runtime verification and Docker build
  -> Artifact Registry immutable image ($COMMIT_SHA)
  -> Cloud Run which-web new revision
```

`cloudbuild.yaml` intentionally updates only the image and `RELEASE_ID`. It
does not copy environment values into source control or reset the current
Cloud Run service configuration. The existing Secret Manager mount, Render
PostgreSQL TLS/VPC egress, restricted ingress, instance sizing, points worker
control and AI moderation controls remain service-managed settings.

## Preconditions

The remote `main` branch must first contain the Cloud Run runtime introduced
on `codex/cloud-run-migration`, including `infra/cloud-run/Dockerfile`,
`.dockerignore`, `scripts/cloud-run/*` and `cloudbuild.yaml`. As of
2026-08-31, `main` does not yet contain the Dockerfile; do not enable a
production `main` trigger before that merge or its builds will fail.

Keep GitHub branch protection requiring the existing `CI / verify` check before
merging to `main`. Cloud Build does not replace the PostgreSQL-backed test
service used by that GitHub workflow; it additionally verifies the Cloud Run
runtime isolation and builds the exact production image.

## Trigger and identity

After `main` contains this configuration, create one Cloud Build GitHub trigger:

| Setting        | Value                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name           | `which-main-cloud-run`                                                                                                                            |
| Event          | Push to branch                                                                                                                                    |
| Branch regex   | `^main$`                                                                                                                                          |
| Build config   | `cloudbuild.yaml`                                                                                                                                 |
| Region         | `asia-southeast1`                                                                                                                                 |
| Included files | `apps/api/**`, `apps/web/**`, `scripts/cloud-run/**`, `infra/cloud-run/**`, `cloudbuild.yaml`, root package/lock/workspace files, `.dockerignore` |

Use a dedicated trigger service account, for example
`which-cloud-build@which-505908.iam.gserviceaccount.com`, rather than a
broad default account. On 2026-08-31, the `JUNHOCHOI0309/WHICH` repository
was connected through the GitHub Cloud Build app in `asia-southeast1`; no
production trigger was created. The dedicated account was provisioned with
only:

1. Project-level Logs Writer so the user-specified build account can emit
   Cloud Build logs.
2. Artifact Registry Writer on repository `which` to push the immutable image.
3. Cloud Run Developer on service `which-web` to create revisions.
4. Service Account User on runtime identity
   `which-web@which-505908.iam.gserviceaccount.com`.

Artifact Registry read access for the deployed image remains the Cloud Run
runtime/service-agent responsibility; the deployer already receives image
read capability through its repository-scoped Writer role.

Do not grant the trigger Owner, Editor, Secret Manager Secret Accessor,
Cloud SQL Admin, or broad project-wide service-account impersonation. The
build neither reads the runtime secret nor changes database, R2, DNS,
load-balancer, ingress, worker, or AI settings.

## First release and rollback

Run the trigger once manually after activation and confirm a new Cloud Run
revision is Ready, the release ID equals the Git commit, and
`node scripts/cloud-run/smoke-edge.mjs` exits successfully. Do not use a PR
commit as production deployment input.

For an application rollback, route traffic to the known-good Cloud Run
revision; this retains the one active points consumer. If reverting to the
preserved Render web service, first deploy Cloud Run with
`POINTS_WORKER_ENABLED=false` and verify shutdown before resuming Render.
