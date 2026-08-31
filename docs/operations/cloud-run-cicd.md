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

The remote `main` branch must contain the Cloud Run runtime introduced on
`codex/cloud-run-migration`, including `infra/cloud-run/Dockerfile`,
`.dockerignore`, `scripts/cloud-run/*` and `cloudbuild.yaml`. This condition
was satisfied by merge commit `cd8601245f01b7a3f6cb7f394b0c266c307582e9` on
2026-08-31 before the production trigger was created.

Keep GitHub branch protection requiring the existing `CI / verify` check before
merging to `main`. Cloud Build does not replace the PostgreSQL-backed test
service used by that GitHub workflow; it additionally verifies the Cloud Run
runtime isolation and builds the exact production image.

## Trigger and identity

The production Cloud Build GitHub trigger is configured as follows:

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

## Verified first release

On 2026-08-31, a manual run of `which-main-cloud-run` successfully deployed
the merged `main` commit before relying on automatic pushes:

| Check              | Verified result                                                           |
| ------------------ | ------------------------------------------------------------------------- |
| Cloud Build        | `3c8feb08-36c5-4517-80b2-84ed2904da5f` succeeded                          |
| Source revision    | `cd8601245f01b7a3f6cb7f394b0c266c307582e9`                                |
| Image digest       | `sha256:5aa44f82ca176a4aed21002be8ab5d4fba627fb7eb63c1dbf3d8b1e9f9945c27` |
| Cloud Run revision | `which-web-00004-s7n`, Ready and receiving 100% traffic                   |
| Release identifier | `RELEASE_ID=cd8601245f01b7a3f6cb7f394b0c266c307582e9`                     |
| Edge smoke         | `node scripts/cloud-run/smoke-edge.mjs` passed                            |

The trigger runs only for `main` pushes that alter one of its included runtime
inputs. Documentation-only changes are intentionally excluded, so they do not
create a production image or revision.

## First release and rollback

Run the trigger once manually after activation and confirm a new Cloud Run
revision is Ready, the release ID equals the Git commit, and
`node scripts/cloud-run/smoke-edge.mjs` exits successfully. Do not use a PR
commit as production deployment input.

For an application rollback, route traffic to the known-good Cloud Run
revision; this retains the one active points consumer. If reverting to the
preserved Render web service, first deploy Cloud Run with
`POINTS_WORKER_ENABLED=false` and verify shutdown before resuming Render.
