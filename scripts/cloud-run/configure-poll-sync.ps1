param(
  [Parameter(Mandatory=$true)][string]$Image,
  [Parameter(Mandatory=$true)][string]$SchedulerServiceAccount,
  [Parameter(Mandatory=$true)][string]$ImportMemberId,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$taskProject = 'which-505908'
$taskRegion = 'asia-southeast1'
$taskJob = 'which-daily-poll-sync'
if ($Image -notmatch '^asia-southeast1-docker\.pkg\.dev/which-505908/which/web@sha256:[a-f0-9]{64}$') { throw 'Use a verified deployed production image digest.' }
if ($SchedulerServiceAccount -notmatch '^[a-z0-9-]+@which-505908\.iam\.gserviceaccount\.com$') { throw 'Use a dedicated, existing scheduler identity in the production project.' }
if ($ImportMemberId -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') { throw 'Use an existing active operator member UUID.' }
if ($Apply) {
  $taskExisting = & gcloud scheduler jobs list "--project=$taskProject" "--location=$taskRegion" '--format=value(name)'
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect existing scheduler jobs.' }
  if ($taskExisting | Where-Object { $_ -eq $taskJob -or $_.EndsWith('/' + $taskJob) }) { throw 'The schedule already exists. Inspect and update it separately; no resources were changed.' }
}

function Invoke-TaskGcloud([string[]]$Arguments) {
  if (!$Apply) { Write-Output ('PLAN gcloud ' + ($Arguments -join ' ')); return }
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Poll sync setup failed; do not activate the schedule.' }
}
# Plan by default. Applying provisions NEW billable resources; requires separate approval.
# The worker is disabled even if a trigger fires before the final pause operation.
Invoke-TaskGcloud -Arguments @('run','jobs','deploy',$taskJob,"--project=$taskProject","--region=$taskRegion","--image=$Image",'--command=node','--args=scripts/cloud-run/poll-sync-job.mjs',"--service-account=which-web@$taskProject.iam.gserviceaccount.com",'--tasks=1','--max-retries=0','--task-timeout=25m','--cpu=1','--memory=512Mi','--network=which-run-vpc','--subnet=which-run-subnet','--vpc-egress=all-traffic','--set-secrets=/var/run/which/runtime.json=which-runtime-env:1',"--set-env-vars=CLOUD_RUN_ENV_FILE=/var/run/which/runtime.json,CLOUD_RUN_PREVIEW=false,POLL_SYNC_ENABLED=false,POLL_SYNC_SOURCE_VERIFIED=false,POLL_SYNC_MAX_PAGES=5,POLL_SYNC_IMPORT_MEMBER_ID=$ImportMemberId,RELEASE_ID=poll-sync",'--quiet')
Invoke-TaskGcloud -Arguments @('run','jobs','add-iam-policy-binding',$taskJob,"--project=$taskProject","--region=$taskRegion","--member=serviceAccount:$SchedulerServiceAccount",'--role=roles/run.invoker','--quiet')
Invoke-TaskGcloud -Arguments @('scheduler','jobs','create','http',$taskJob,"--project=$taskProject","--location=$taskRegion",'--schedule=0 8 * * *','--time-zone=Asia/Seoul',"--uri=https://run.googleapis.com/v2/projects/$taskProject/locations/$taskRegion/jobs/${taskJob}:run",'--http-method=POST','--message-body={}',"--oauth-service-account-email=$SchedulerServiceAccount",'--max-retry-attempts=0','--quiet')
Invoke-TaskGcloud -Arguments @('scheduler','jobs','pause',$taskJob,"--project=$taskProject","--location=$taskRegion",'--quiet')
if ($Apply) { Write-Output 'Prepared disabled YouTube.js worker and paused daily trigger. Run the read-only --probe in this production runtime before activation.' }
else { Write-Output 'Plan only: no resources were created or changed. YouTube.js needs no paid source API key.' }
