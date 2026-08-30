# Read-only, one-shot provisioning snapshot. Does not expose runtime secrets,
# retry operations, grant access, change DNS, or start/stop workers.
$ErrorActionPreference = 'Stop'
$whichProject = 'which-505908'

function Read-GcloudJson {
  param([string[]] $CommandArguments)
  $result = & gcloud @CommandArguments "--project=$whichProject" '--quiet' '--format=json'
  if ($LASTEXITCODE -ne 0) {
    throw "Read-only gcloud check failed: $($CommandArguments -join ' ')"
  }
  return (($result -join "`n") | ConvertFrom-Json)
}

$backend = @(Read-GcloudJson @('compute', 'backend-services', 'list', '--filter=name=which-web-backend'))
$operations = @(Read-GcloudJson @('compute', 'operations', 'list', '--filter=targetLink=https://www.googleapis.com/compute/v1/projects/which-505908/global/backendServices/which-web-backend', '--sort-by=~insertTime', '--limit=5'))
$certificates = @(Read-GcloudJson @('certificate-manager', 'certificates', 'list'))
$entries = @(Read-GcloudJson @('certificate-manager', 'maps', 'entries', 'list', '--map=which-site-map'))
$rules = @(Read-GcloudJson @('compute', 'forwarding-rules', 'list') | Where-Object { $_.name -eq 'which-web-https-rule' })

$latest = $operations | Select-Object -First 1
$backendReady = $backend.Count -eq 1 -and $null -ne $latest -and $latest.status -eq 'DONE' -and $null -eq $latest.error
$attached = $backendReady -and @($backend[0].backends | Where-Object { $_.group -like '*/regions/asia-southeast1/networkEndpointGroups/which-web-neg' }).Count -eq 1
$activeCertificateNames = @($certificates | Where-Object { $_.managed.state -eq 'ACTIVE' } | ForEach-Object { $_.name -replace '^projects/[^/]+/', '' })
$readyHostnames = @($entries | Where-Object {
  $entryHasActiveCertificate = @($_.certificates | Where-Object { ($_ -replace '^projects/[^/]+/', '') -in $activeCertificateNames }).Count -gt 0
  $_.state -eq 'ACTIVE' -and $entryHasActiveCertificate
} | ForEach-Object { $_.hostname })

[ordered]@{
  checkedAt = (Get-Date).ToString('o')
  project = $whichProject
  backendOperationSucceeded = $backendReady
  serverlessNegAttached = $attached
  latestBackendOperation = $latest | Select-Object name, status, progress, error
  certificates = @($certificates | Where-Object { $_.name -match '/which-site-cert(-retry)?$' } | ForEach-Object {
    [ordered]@{ name = $_.name; state = $_.managed.state; authorization = $_.managed.authorizationAttemptInfo }
  })
  certificateMapHostnamesReady = ('whichone.site' -in $readyHostnames -and 'www.whichone.site' -in $readyHostnames)
  httpsForwardingRulePresent = ($rules.Count -eq 1)
  note = 'This snapshot is not a cutover approval. Require successful origin TLS, route/auth smoke, and worker-isolation checks before moving production traffic.'
} | ConvertTo-Json -Depth 10
