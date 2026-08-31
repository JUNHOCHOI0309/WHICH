# WHICH Cloud Run moderation job

## Purpose and boundary

`which-web` remains the HTTP/API service. Image OCR and moderation are a
finite Cloud Run **Job** that runs one locked `moderation-worker once` batch
and exits. It reuses the production image, verified Render PostgreSQL route,
and private R2 access without starting another web server or point consumer.

This document prepares workload separation only. Creating the Job has no
schedule and does not itself process a submission. Do not create a scheduler,
execute the Job, enable provider/judge modes, or enable automatic publication
until the explicit pilot settings and member cohort have been reviewed.

## Runtime safeguards

`scripts/cloud-run/moderation-job.mjs` imports the same mounted runtime secret
as the web service and fails before spawning unless both are true:

1. `CLOUD_RUN_PREVIEW=false`
2. `MODERATION_WORKER_ENABLED=true`

It starts only `node dist/moderation-worker.js once`; it never uses the
long-running `run` command. The existing database advisory lock still
serializes overlapping executions. Provider, Luna, decision, and automatic
publication gates stay governed by their existing environment controls.

## Production Job

Use the same runtime identity, Direct VPC subnet, and Secret Manager volume as
`which-web`. The current web values are documented here deliberately so this
Job does not fall back to an internal Render hostname or unverified TLS.

```powershell
gcloud run jobs create which-moderation `
  --project=which-505908 `
  --region=asia-southeast1 `
  --image=asia-southeast1-docker.pkg.dev/which-505908/which/web@sha256:<IMAGE_DIGEST> `
  --command=node `
  --args=scripts/cloud-run/moderation-job.mjs `
  --service-account=which-web@which-505908.iam.gserviceaccount.com `
  --network=which-run-vpc `
  --subnet=which-run-subnet `
  --vpc-egress=all-traffic `
  --cpu=2 `
  --memory=4Gi `
  --tasks=1 `
  --parallelism=1 `
  --max-retries=0 `
  --task-timeout=10m `
  --set-env-vars '^@^CLOUD_RUN_ENV_FILE=/var/run/which/runtime.json@CLOUD_RUN_PREVIEW=false@POINTS_WORKER_ENABLED=false@MODERATION_WORKER_ENABLED=true@RELEASE_ID=<COMMIT_SHA>' `
  --set-secrets=/var/run/which/runtime.json=which-runtime-env:latest
```

The 2 vCPU / 4 GiB limit is isolated from the web service and sized for one
bounded OCR/model batch. It is a starting capacity, not permission to process
multiple submissions concurrently. Keep task count and parallelism at one
until the moderation ledger, R2 latency, and database impact are measured.

## Provisioning record

On 2026-08-31, `which-moderation` was created in `asia-southeast1` from the
immutable image
`asia-southeast1-docker.pkg.dev/which-505908/which/web@sha256:e16cf0f7207d982496f3898fbf01ede929939b4719d1f07af4835bc76d79b6f1`.
It is Ready with one task, parallelism one, no retries, a 10-minute timeout,
2 vCPU, and 4 GiB memory. It uses
`which-web@which-505908.iam.gserviceaccount.com`, the `which-run-vpc` /
`which-run-subnet` Direct VPC path with all-traffic egress, and mounts
`which-runtime-env` only at `/var/run/which/runtime.json`.

The Job has no execution history and no Cloud Scheduler attachment. The
provider, policy-judge, and automatic-publication switches remain unchanged;
creating this resource did not make a moderation provider call or publish an
Issue image.

## Activation sequence

1. Merge the Job runner and verify its Cloud Build image deployment.
2. Create the Job only; inspect its configuration and confirm no execution was
   created.
3. Set the separately approved pilot environment gates and exact member UUID
   allowlist on the Job, never by modifying `which-web`.
4. Run one Job execution and review the private moderation evidence, provider
   ledger, and resulting member notification.
5. Only after that evidence review, add a conservative schedule. Begin at one
   invocation per minute and retain one task/parallelism; stop scheduling first
   when the provider kill switch or automatic-publication kill switch is set.

For rollback, pause the schedule and avoid new executions. Existing private
evidence and published issues are handled by the existing moderation/rights
controls; deleting the Job is not a substitute for those workflows.
