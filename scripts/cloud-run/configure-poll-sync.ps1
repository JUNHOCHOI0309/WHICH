param(
  [Parameter(Mandatory=$true)][string]$Image,
  [Parameter(Mandatory=$true)][string]$SchedulerServiceAccount,
  [Parameter(Mandatory=$true)][string]$SecretVersion,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$taskProject = 'which-505908'
$taskRegion = 'asia-southeast1'
$taskJob = 'which-daily-poll-sync'
if ($Image -notmatch '^asia-southeast1-docker\.pkg\.dev/which-505908/which/web@sha256:[a-f0-9]{64}$') { throw 'Use a verified deployed production image digest.' }
if ($SchedulerServiceAccount -notmatch '^[a-z0-9-]+@which-505908\.iam\.gserviceaccount\.com$') { throw 'Use a dedicated, existing scheduler identity in the production project.' }
if ($SecretVersion -notmatch '^which-poll-sync-env:[1-9][0-9]*$') { throw 'Use a pinned version of the verified server-only secret.' }
if ($Apply) {
  $taskExisting = & gcloud scheduler jobs list "--project=$taskProject" "--location=$taskRegion" '--format=value(name)'
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect existing scheduler jobs.' }
  if ($taskExisting | Where-Object { $_ -eq $taskJob -or $_.EndsWith('/' + $taskJob) }) { throw 'The schedule already exists. Inspect and update it separately; no resources were changed.' }
  $taskSecretState = & gcloud secrets versions describe ($SecretVersion.Split(':')[1]) --secret=which-poll-sync-env "--project=$taskProject" '--format=value(state)'
  if ($LASTEXITCODE -ne 0 -or $taskSecretState -ne 'ENABLED') { throw 'Verified, enabled secret version is required before provisioning.' }
}

function Invoke-TaskGcloud([string[]]$Arguments) {
  if (!$Apply) { Write-Output ('PLAN gcloud ' + ($Arguments -join ' ')); return }
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Poll sync setup failed; do not activate the schedule.' }
}
# Plan by default. Applying provisions NEW billable resources; requires separate approval.
# The worker is disabled even if a trigger fires before the final pause operation.
Invoke-TaskGcloud -Arguments @('run','jobs','deploy',$taskJob,"--project=$taskProject","--region=$taskRegion","--image=$Image",'--command=node','--args=scripts/cloud-run/poll-sync-job.mjs',"--service-account=which-web@$taskProject.iam.gserviceaccount.com",'--tasks=1','--max-retries=0','--task-timeout=25m','--cpu=1','--memory=512Mi','--network=which-run-vpc','--subnet=which-run-subnet','--vpc-egress=all-traffic',"--set-secrets=/var/run/which/runtime.json=which-runtime-env:1,/var/run/which/polls.json=$SecretVersion",'--set-env-vars=CLOUD_RUN_ENV_FILE=/var/run/which/runtime.json,POLL_SYNC_ENV_FILE=/var/run/which/polls.json,CLOUD_RUN_PREVIEW=false,POLL_SYNC_ENABLED=false,RELEASE_ID=poll-sync','--quiet')
Invoke-TaskGcloud -Arguments @('run','jobs','add-iam-policy-binding',$taskJob,"--project=$taskProject","--region=$taskRegion","--member=serviceAccount:$SchedulerServiceAccount",'--role=roles/run.invoker','--quiet')
Invoke-TaskGcloud -Arguments @('scheduler','jobs','create','http',$taskJob,"--project=$taskProject","--location=$taskRegion",'--schedule=0 8 * * *','--time-zone=Asia/Seoul',"--uri=https://run.googleapis.com/v2/projects/$taskProject/locations/$taskRegion/jobs/${taskJob}:run",'--http-method=POST','--message-body={}',"--oauth-service-account-email=$SchedulerServiceAccount",'--max-retry-attempts=0','--quiet')
Invoke-TaskGcloud -Arguments @('scheduler','jobs','pause',$taskJob,"--project=$taskProject","--location=$taskRegion",'--quiet')
if ($Apply) { Write-Output 'Prepared disabled worker and paused daily trigger. Validate real mapping, channel scope, export freshness, secrets and costs before activation.' }
else { Write-Output 'Plan only: no resources were created or changed. Do not add a second Octoparse schedule.' }
