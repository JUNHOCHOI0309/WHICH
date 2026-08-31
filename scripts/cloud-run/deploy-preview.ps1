param(
  [Parameter(Mandatory = $true)][string]$Image,
  [Parameter(Mandatory = $true)][string]$ReleaseId,
  [string]$Project = 'which-505908',
  [string]$Region = 'asia-southeast1',
  [string]$Network = 'which-run-vpc',
  [string]$Subnet = 'which-run-subnet',
  [string]$SecretVersion = '1'
)
$ErrorActionPreference = 'Stop'
if ($ReleaseId -notmatch '^[a-zA-Z0-9._-]+$' -or $SecretVersion -notmatch '^\d+$') {
  throw 'Release ID must be a safe immutable identifier; pin a numbered secret version.'
}
$deployArguments = @(
  'run', 'deploy', 'which-web',
  "--project=$Project", "--region=$Region", "--image=$Image",
  "--service-account=which-web@$Project.iam.gserviceaccount.com",
  '--execution-environment=gen2', '--port=8080',
  "--network=$Network", "--subnet=$Subnet", '--vpc-egress=all-traffic',
  '--cpu=1', '--memory=2Gi', '--min=1', '--max=1', '--max-instances=1',
  '--concurrency=8', '--no-cpu-throttling', '--timeout=120',
  '--no-allow-unauthenticated',
  "--set-secrets=/var/run/which/runtime.json=which-runtime-env:$SecretVersion",
  "--set-env-vars=CLOUD_RUN_ENV_FILE=/var/run/which/runtime.json,CLOUD_RUN_PREVIEW=true,RELEASE_ID=$ReleaseId",
  '--startup-probe=httpGet.path=/api/health,httpGet.port=8080,periodSeconds=5,timeoutSeconds=4,failureThreshold=48',
  '--labels=app=which,stage=migration-preview',
  '--quiet'
)
& gcloud @deployArguments
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run preview deployment failed.' }
